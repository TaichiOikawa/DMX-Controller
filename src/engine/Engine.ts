/**
 * 照明エンジンの中核（§3 / §8）。「単一の真実」。
 *
 * - Project（フェーダー基準値・Show/マスター列）と実行時状態を保持
 * - Show は1本のマスター列を単一プレイヘッドで順送りに再生する（並列なし）
 * - ~40Hz の tick ごとにフェードを進め、512ch を合成し ArtDMX 送出
 * - 出力フレーム・状態スナップショット・Project 変更をリスナーへ通知
 *
 * Electron 非依存の純粋 TS。UDP 送信は `send` で注入、タイマーは Clock 経由で
 * 差し替え可能なので Node 単体テストできる。
 */

import {
  UNIVERSE_SIZE,
  createDefaultProject,
  createCueEntry,
  createGroupEntry,
  createShowRuntime,
  genId,
  type ArtnetSettings,
  type Cue,
  type EngineRuntime,
  type Group,
  type Project,
  type Show,
} from '../shared/types';
import { encodeArtDmx, nextSequence } from './artnet';
import { Clock } from './clock';
import { contextFromRuntime, resolveFrame } from './mixer';
import {
  applyFade,
  computeTarget,
  cueAt,
  currentTarget,
  flattenCues,
  footprintOf,
  nextPosition,
  startFade,
  type Position,
} from './playback';
import type {
  CaptureCueOptions,
  CuePatch,
  EngineStateSnapshot,
} from '../shared/ipc';

export interface EngineOptions {
  /** 符号化済み ArtDMX パケットの送出先（UDP 等）。注入する。 */
  send: (packet: Buffer) => void;
  artnet?: ArtnetSettings;
  setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  nowFn?: () => number;
}

type FrameListener = (frame: number[]) => void;
type StateListener = (state: EngineStateSnapshot) => void;
type ProjectListener = (project: Project) => void;

export class Engine {
  private readonly send: (packet: Buffer) => void;
  private readonly nowFn: () => number;
  private artnet: ArtnetSettings;
  private clock: Clock;

  private project: Project;
  private activeShow: Show | null = null;
  private runtime: EngineRuntime;
  private sequence = 1;

  private frameListeners = new Set<FrameListener>();
  private stateListeners = new Set<StateListener>();
  private projectListeners = new Set<ProjectListener>();

  private tickTimestamps: number[] = [];
  private measuredHz = 0;

  constructor(opts: EngineOptions) {
    this.send = opts.send;
    this.nowFn = opts.nowFn ?? (() => Date.now());
    this.project = createDefaultProject();
    this.artnet = opts.artnet ?? { ...this.project.settings.artnet };

    this.runtime = {
      activeShowId: null,
      show: null,
      captured: new Array(UNIVERSE_SIZE).fill(false),
      faderLive: this.project.faders.slice(),
      activeActions: [],
      output: new Array(UNIVERSE_SIZE).fill(0),
    };

    this.clock = this.makeClock(opts.setTimeoutFn, opts.clearTimeoutFn);
  }

  private makeClock(
    setTimeoutFn?: EngineOptions['setTimeoutFn'],
    clearTimeoutFn?: EngineOptions['clearTimeoutFn'],
  ): Clock {
    return new Clock({
      hz: this.artnet.refreshRateHz,
      onTick: (now) => this.tick(now),
      setTimeoutFn,
      clearTimeoutFn,
      nowFn: this.nowFn,
    });
  }

  // ===== ライフサイクル =====

  start(): void {
    this.clock.start();
  }

  stop(): void {
    this.clock.stop();
  }

  // ===== Project / 永続化 =====

  loadProject(project: Project): void {
    this.project = project;
    this.runtime.faderLive = project.faders.slice();
    this.applyArtnet(project.settings.artnet);
    this.unloadShow();
    this.notifyProject();
    this.emitState();
  }

  newProject(): void {
    this.loadProject(createDefaultProject());
  }

  getProject(): Project {
    this.project.faders = this.runtime.faderLive.slice();
    this.project.settings.artnet = { ...this.artnet };
    return this.project;
  }

  // ===== コマンド: フェーダー / 設定 =====

  /**
   * フェーダー値を設定する（§5.1, 1:1）。
   * TODO(マイルストーン6): show 制御下の ch なら captured=true にする（§6.1）。
   */
  setFader(ch: number, value: number): void {
    if (ch < 0 || ch >= UNIVERSE_SIZE) return;
    this.runtime.faderLive[ch] = clamp255(value);
  }

  updateArtnetSettings(settings: ArtnetSettings): void {
    this.applyArtnet(settings);
    this.emitState();
  }

  private applyArtnet(settings: ArtnetSettings): void {
    const rateChanged = settings.refreshRateHz !== this.artnet.refreshRateHz;
    this.artnet = { ...settings };
    if (rateChanged) {
      const wasRunning = this.clock.isRunning();
      this.clock.stop();
      this.clock = this.makeClock();
      if (wasRunning) this.clock.start();
    }
  }

  // ===== コマンド: 再生 =====

  /** Show を読み込み、単一プレイヘッドのランタイムを構築する。 */
  loadShow(showId: string): void {
    const show = this.project.shows.find((s) => s.id === showId) ?? null;
    this.activeShow = show;
    this.runtime.activeShowId = show?.id ?? null;
    if (show) {
      const rt = createShowRuntime();
      rt.controlled = footprintOf(flattenCues(show.sequence));
      this.runtime.show = rt;
    } else {
      this.runtime.show = null;
    }
    this.emitState();
  }

  unloadShow(): void {
    this.activeShow = null;
    this.runtime.activeShowId = null;
    this.runtime.show = null;
    this.emitState();
  }

  /** マスター列を次へ順送り（§5.3 単一 GO）。末尾は no-op。 */
  go(): void {
    if (!this.activeShow || !this.runtime.show) return;
    const pos = nextPosition(
      this.activeShow.sequence,
      this.runtime.show.mainIndex,
      this.runtime.show.subIndex,
    );
    if (!pos) return;
    this.playPosition(pos, this.nowFn());
    this.emitState();
  }

  /** 任意位置へジャンプして再生（ループ脱出・頭出し）。 */
  goTo(mainIndex: number, subIndex: number): void {
    if (!this.activeShow || !this.runtime.show) return;
    const pos: Position = { main: mainIndex, sub: subIndex };
    if (!cueAt(this.activeShow.sequence, pos)) return; // 無効位置
    this.playPosition(pos, this.nowFn());
    this.emitState();
  }

  private playPosition(pos: Position, now: number): void {
    const rt = this.runtime.show;
    const show = this.activeShow;
    if (!rt || !show) return;
    const cue = cueAt(show.sequence, pos);
    if (!cue) return;
    const target = computeTarget(currentTarget(rt), cue);
    startFade(rt, target, now, cue.fadeInMs, cue.delayMs ?? 0);
    rt.mainIndex = pos.main;
    rt.subIndex = pos.sub;
  }

  // ===== コマンド: オーサリング =====

  newShow(name?: string): void {
    const show = { id: genId(), name: name ?? `Show ${this.project.shows.length + 1}`, sequence: [] };
    this.project.shows.push(show);
    this.notifyProject();
  }

  /** 現在のフェーダーから CUE を作成。targetGroupId 指定で GROUP の子へ、無ければマスター列末尾へ。 */
  recordCue(showId: string, opts?: CaptureCueOptions): void {
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;

    const cue = this.cueFromFaders(opts);
    const targetGroupId = opts?.targetGroupId;
    if (targetGroupId) {
      const group = this.findGroupInShow(show, targetGroupId);
      if (!group) return;
      group.cues.push(cue);
    } else {
      show.sequence.push(createCueEntry(cue));
    }
    this.afterStructureChange(showId);
  }

  /** 空の GROUP エントリをマスター列末尾に追加。 */
  addGroupEntry(showId: string, name?: string): void {
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    show.sequence.push(createGroupEntry(name ?? `Group ${show.sequence.length + 1}`));
    this.afterStructureChange(showId);
  }

  setGroupLoop(groupId: string, loop: boolean): void {
    const found = this.findGroup(groupId);
    if (!found) return;
    found.group.loop = loop;
    this.notifyProject();
  }

  updateCue(cueId: string, patch: CuePatch): void {
    const cue = this.findCue(cueId);
    if (!cue) return;
    if (patch.name !== undefined) cue.name = patch.name;
    if (patch.fadeInMs !== undefined) cue.fadeInMs = Math.max(0, patch.fadeInMs);
    if (patch.delayMs !== undefined) cue.delayMs = Math.max(0, patch.delayMs);
    this.notifyProject();
  }

  /** マスター列のエントリ（CUE / GROUP）を id で削除。 */
  deleteEntry(showId: string, entryId: string): void {
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    const idx = show.sequence.findIndex((e) =>
      e.kind === 'cue' ? e.cue.id === entryId : e.group.id === entryId,
    );
    if (idx < 0) return;
    show.sequence.splice(idx, 1);
    this.afterStructureChange(showId);
  }

  deleteCueFromGroup(groupId: string, cueId: string): void {
    const found = this.findGroup(groupId);
    if (!found) return;
    const idx = found.group.cues.findIndex((c) => c.id === cueId);
    if (idx < 0) return;
    found.group.cues.splice(idx, 1);
    this.afterStructureChange(found.show.id);
  }

  /** マスター列のエントリを並べ替え。 */
  moveEntry(showId: string, entryId: string, toIndex: number): void {
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    moveById(
      show.sequence,
      (e) => (e.kind === 'cue' ? e.cue.id : e.group.id) === entryId,
      toIndex,
    );
    this.afterStructureChange(showId);
  }

  moveCueInGroup(groupId: string, cueId: string, toIndex: number): void {
    const found = this.findGroup(groupId);
    if (!found) return;
    moveById(found.group.cues, (c) => c.id === cueId, toIndex);
    this.afterStructureChange(found.show.id);
  }

  // ===== 内部ヘルパ =====

  private cueFromFaders(opts?: CaptureCueOptions): Cue {
    const includeZero = opts?.includeZero ?? false;
    const channels = opts?.channels ?? Array.from({ length: UNIVERSE_SIZE }, (_, i) => i);
    const values: Record<number, number> = {};
    for (const ch of channels) {
      if (ch < 0 || ch >= UNIVERSE_SIZE) continue;
      const v = this.runtime.faderLive[ch];
      if (v > 0 || includeZero) values[ch] = v;
    }
    return { id: genId(), name: opts?.name, values, fadeInMs: opts?.fadeInMs ?? 1000 };
  }

  /** 構造変更後: 読込中 Show ならフットプリント再計算＋プレイヘッド補正し、Project 通知。 */
  private afterStructureChange(showId: string): void {
    if (this.activeShow?.id === showId && this.runtime.show) {
      this.runtime.show.controlled = footprintOf(flattenCues(this.activeShow.sequence));
      this.clampPlayhead();
      this.emitState();
    }
    this.notifyProject();
  }

  private clampPlayhead(): void {
    const show = this.activeShow;
    const rt = this.runtime.show;
    if (!show || !rt || rt.mainIndex < 0) return;
    if (rt.mainIndex >= show.sequence.length) {
      rt.mainIndex = show.sequence.length - 1;
    }
    if (rt.mainIndex < 0) {
      rt.subIndex = 0;
      return;
    }
    const entry = show.sequence[rt.mainIndex];
    if (entry?.kind === 'group') {
      if (rt.subIndex >= entry.group.cues.length) {
        rt.subIndex = Math.max(0, entry.group.cues.length - 1);
      }
    } else {
      rt.subIndex = 0;
    }
  }

  private findGroupInShow(show: Show, groupId: string): Group | null {
    for (const e of show.sequence) {
      if (e.kind === 'group' && e.group.id === groupId) return e.group;
    }
    return null;
  }

  private findGroup(groupId: string): { show: Show; group: Group } | null {
    for (const show of this.project.shows) {
      const group = this.findGroupInShow(show, groupId);
      if (group) return { show, group };
    }
    return null;
  }

  private findCue(cueId: string): Cue | null {
    for (const show of this.project.shows) {
      for (const e of show.sequence) {
        if (e.kind === 'cue') {
          if (e.cue.id === cueId) return e.cue;
        } else {
          const c = e.group.cues.find((x) => x.id === cueId);
          if (c) return c;
        }
      }
    }
    return null;
  }

  // ===== 状態取得・購読 =====

  getArtnetSettings(): ArtnetSettings {
    return { ...this.artnet };
  }

  getState(): EngineStateSnapshot {
    const show = this.runtime.show;
    return {
      activeShowId: this.runtime.activeShowId,
      captured: this.runtime.captured.slice(),
      artnet: { ...this.artnet },
      measuredHz: this.measuredHz,
      playback:
        show && this.activeShow
          ? {
              mainIndex: show.mainIndex,
              subIndex: show.subIndex,
              fading: !!show.fade,
              entryCount: this.activeShow.sequence.length,
            }
          : null,
    };
  }

  getOutput(): number[] {
    return this.runtime.output.slice();
  }

  onFrame(cb: FrameListener): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  onState(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  onProject(cb: ProjectListener): () => void {
    this.projectListeners.add(cb);
    return () => this.projectListeners.delete(cb);
  }

  emitState(): void {
    if (this.stateListeners.size === 0) return;
    const snapshot = this.getState();
    for (const cb of this.stateListeners) cb(snapshot);
  }

  private notifyProject(): void {
    if (this.projectListeners.size === 0) return;
    const project = this.getProject();
    for (const cb of this.projectListeners) cb(project);
  }

  // ===== 出力ループ =====

  tick(now: number): void {
    if (this.runtime.show) applyFade(this.runtime.show, now);

    const ctx = contextFromRuntime(this.runtime);
    resolveFrame(ctx, this.runtime.output);

    const packet = encodeArtDmx(this.runtime.output, this.sequence, this.artnet);
    this.sequence = nextSequence(this.sequence);
    this.send(packet);

    this.updateMeasuredHz(now);

    if (this.frameListeners.size > 0) {
      const frame = this.runtime.output;
      for (const cb of this.frameListeners) cb(frame);
    }
  }

  private updateMeasuredHz(now: number): void {
    this.tickTimestamps.push(now);
    const cutoff = now - 1000;
    while (this.tickTimestamps.length > 0 && this.tickTimestamps[0] < cutoff) {
      this.tickTimestamps.shift();
    }
    this.measuredHz = this.tickTimestamps.length;
  }
}

/** 配列内の要素を述語で探し、toIndex へ移動する。 */
function moveById<T>(arr: T[], pred: (x: T) => boolean, toIndex: number): void {
  const from = arr.findIndex(pred);
  if (from < 0) return;
  const to = Math.max(0, Math.min(arr.length - 1, toIndex));
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
}

function clamp255(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}
