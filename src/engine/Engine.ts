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
  createAction,
  createDefaultProject,
  createCueEntry,
  createFolder,
  createGroupEntry,
  createRgbFixture,
  createShowRuntime,
  genId,
  type ActionButton,
  type ArtnetSettings,
  type Cue,
  type EngineMode,
  type EngineRuntime,
  type Group,
  type Project,
  type SequenceEntry,
  type Show,
  type TimelinePoint,
} from '../shared/types';
import { encodeArtDmx, nextSequence } from './artnet';
import { Clock } from './clock';
import { contextFromRuntime, resolveFrame } from './mixer';
import {
  applyFade,
  clamp01,
  computeTarget,
  cueAt,
  currentTarget,
  flattenCues,
  footprintOf,
  lerp,
  nextInGroup,
  nextPosition,
  positionOfCue,
  prevPosition,
  startFade,
  type Position,
} from './playback';
import { pointsCrossed } from './timeline';
import { deserializeProject, serializeProject } from '../shared/persistence';
import type {
  ActionPatch,
  AddCueOptions,
  CuePatch,
  EngineStateSnapshot,
  FixtureInit,
  FixturePatch,
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

  /** Timeline: 直近に受け取った playhead（ms）。跨ぎ判定の基準。 */
  private lastPlayheadMs = 0;

  /** Edit ドラッグ中の Project 通知を間引く trailing throttle タイマー。 */
  private projectNotifyTimer: ReturnType<typeof setTimeout> | null = null;

  /** Undo / Redo 履歴（直列化した Project 文字列）。 */
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  /** 連続するフェーダー編集を1バーストに束ねるための直近スナップショット時刻。 */
  private lastCoalesceAt = -Infinity;
  private static readonly MAX_HISTORY = 100;

  constructor(opts: EngineOptions) {
    this.send = opts.send;
    this.nowFn = opts.nowFn ?? (() => Date.now());
    this.project = createDefaultProject();
    this.artnet = opts.artnet ?? { ...this.project.settings.artnet };

    this.runtime = {
      activeShowId: null,
      show: null,
      busking: new Array(UNIVERSE_SIZE).fill(false),
      faderLive: this.project.faders.slice(),
      faderFade: null,
      editingActionId: null,
      mode: 'edit',
      masterLevel: 255,
      blackout: false,
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
    // 別ドキュメントを開いた／新規にしたら Undo 履歴はリセットする。
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesceAt = -Infinity;
    this.notifyProject();
    this.emitState();
  }

  newProject(): void {
    if (!this.editable) return;
    this.loadProject(createDefaultProject());
  }

  getProject(): Project {
    this.project.faders = this.runtime.faderLive.slice();
    this.project.settings.artnet = { ...this.artnet };
    return this.project;
  }

  // ===== Undo / Redo =====

  /** 現在状態を undo スタックへ積む（redo は破棄）。discrete コマンドの直前に呼ぶ。 */
  private snapshot(): void {
    this.undoStack.push(serializeProject(this.getProject()));
    if (this.undoStack.length > Engine.MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  /** discrete な編集の直前スナップショット。フェーダー連続編集と分離する。 */
  private pushUndo(): void {
    this.snapshot();
    this.lastCoalesceAt = -Infinity; // 次のフェーダー編集は新しいバーストとして扱う
  }

  /** フェーダー連続編集用。windowMs 内の連続編集は1スナップショットに束ねる。 */
  private pushUndoCoalesced(windowMs: number): void {
    const now = this.nowFn();
    const sameBurst = now - this.lastCoalesceAt < windowMs;
    this.lastCoalesceAt = now;
    if (sameBurst) return;
    this.snapshot();
  }

  undo(): void {
    if (!this.editable || this.undoStack.length === 0) return;
    this.redoStack.push(serializeProject(this.getProject()));
    this.restoreProject(this.undoStack.pop() as string);
  }

  redo(): void {
    if (!this.editable || this.redoStack.length === 0) return;
    this.undoStack.push(serializeProject(this.getProject()));
    this.restoreProject(this.redoStack.pop() as string);
  }

  /** 履歴から復元した Project を反映し、再生ランタイムを貼り直す。 */
  private restoreProject(json: string): void {
    this.project = deserializeProject(json);
    this.runtime.faderLive = this.project.faders.slice();
    this.applyArtnet(this.project.settings.artnet);
    const showId = this.runtime.activeShowId;
    if (showId) {
      this.activeShow = this.project.shows.find((s) => s.id === showId) ?? null;
      if (this.activeShow && this.runtime.show) {
        this.runtime.show.controlled = footprintOf(flattenCues(this.activeShow.sequence));
        this.clampPlayhead();
      } else if (!this.activeShow) {
        this.runtime.show = null;
        this.runtime.activeShowId = null;
      }
    }
    this.lastCoalesceAt = -Infinity;
    this.notifyProject();
    this.emitState();
  }

  // ===== コマンド: フェーダー / 設定 =====

  /** 操作モードを切り替える（'edit' / 'show'）。 */
  setMode(mode: EngineMode): void {
    this.runtime.mode = mode;
    // SHOW へ切替時は自動送りタイマーを今から測り直す（EDIT 中の古い予定で即発火しないように）。
    if (mode === 'show') {
      this.runtime.editingActionId = null; // SHOW では Action 編集選択を解除（クリックは発火）
      this.scheduleFollow(this.nowFn());
    }
    this.emitState();
  }

  /** グランドマスター（全体調光 0-255）。最終出力に乗算する。 */
  setMasterLevel(level: number): void {
    this.runtime.masterLevel = clamp255(level);
    this.emitState();
  }

  /** ブラックアウト（DBO）。true で全 ch を 0 出力（編集データは保持）。 */
  setBlackout(on: boolean): void {
    this.runtime.blackout = on;
    this.emitState();
  }

  /** 作成系コマンドが許可されるか（Show モードはロック）。 */
  private get editable(): boolean {
    return this.runtime.mode === 'edit';
  }

  /**
   * フェーダー値を設定する（§5.1, 1:1）。CUE 先行モデル:
   * - Edit × CUE 選択中: 選択 CUE へリアルタイム書き込み（全 ch・永続）。
   * - Edit × CUE 未選択: ライブ直接出力のみ（保存しない・層4 faderLive）。
   * - Show モード: busking ライブ上書き（保存しない・層2）。
   */
  setFader(ch: number, value: number): void {
    if (ch < 0 || ch >= UNIVERSE_SIZE) return;
    const v = clamp255(value);
    this.runtime.faderLive[ch] = v;

    // EDIT × Action 選択中は Action の look（step0）へ書き込む（Show 有無に依らずグローバル編集）。
    if (this.runtime.mode === 'edit' && this.runtime.editingActionId) {
      this.editCurrentAction(ch, v);
      return;
    }

    const show = this.runtime.show;
    if (show === null) return; // 解放中: フェーダー直接出力

    if (this.runtime.mode === 'edit') {
      // CUE 選択中なら選択 CUE へ取り込み（未制御 ch も含む）。未選択ならライブプレビューのみ。
      if (show.mainIndex >= 0) this.editCurrentCue(ch, v);
      this.runtime.busking[ch] = false;
      return;
    }
    // Show モード: busking ライブ上書き
    this.runtime.busking[ch] = true;
  }

  /**
   * Edit モード: 現在の再生位置の CUE にこの ch を直接書き込む（Update 相当）。
   * cue.values を更新（永続）し、未制御 ch なら controlled へ加えて tracked を即時反映する。
   */
  private editCurrentCue(ch: number, v: number): void {
    const show = this.activeShow;
    const rt = this.runtime.show;
    if (!show || !rt) return;
    const cue = cueAt(show.sequence, { main: rt.mainIndex, sub: rt.subIndex });
    if (!cue) return;
    this.pushUndoCoalesced(500); // フェーダー連続編集は1バーストに束ねる
    cue.values[ch] = v; // 現在 CUE に追加/上書き
    rt.controlled[ch] = true; // 新規 ch を show 制御下へ（層3 で出力・再選択時も保持）
    rt.tracked[ch] = v; // ライブ反映
    if (rt.fade) rt.fade.to[ch] = v; // フェード中なら着地点も更新
    this.scheduleProjectNotify();
    this.emitState();
  }

  /**
   * Edit モード: 編集中 Action の look（step0）へこの ch を直接書き込む（CUE 編集と同様）。
   * step が無ければ作成する。値 0 はその ch を look から外す（タッチで足し、0 で除く）。
   */
  private editCurrentAction(ch: number, v: number): void {
    const action = this.project.actions.find((a) => a.id === this.runtime.editingActionId);
    if (!action) return;
    if (action.steps.length === 0) action.steps.push({ values: {}, fadeInMs: 0, holdMs: 500 });
    this.pushUndoCoalesced(500); // フェーダー連続編集は1バーストに束ねる
    const step = action.steps[0];
    if (v > 0) step.values[ch] = v;
    else delete step.values[ch];
    this.scheduleProjectNotify();
    this.emitState();
  }

  /**
   * busking 解除（§6.2 リリース）。指定（省略で全 busking）の ch を
   * busking=false かつ faderLive=0 にする。
   * show 制御下 ch は層3(cue値)へ戻り、非制御 ch は 0 にクリアされる。
   */
  releaseCapture(channels?: number[]): void {
    const chs = channels ?? this.buskingChannels();
    for (const ch of chs) {
      if (ch < 0 || ch >= UNIVERSE_SIZE) continue;
      this.runtime.busking[ch] = false;
      this.runtime.faderLive[ch] = 0;
    }
    this.emitState();
  }

  private buskingChannels(): number[] {
    const out: number[] = [];
    for (let ch = 0; ch < UNIVERSE_SIZE; ch++) {
      if (this.runtime.busking[ch]) out.push(ch);
    }
    return out;
  }

  /** 現在のフェーダー位置が非ゼロの ch（Action オーサリングの取り込み元）。 */
  private liveFaderChannels(): number[] {
    const out: number[] = [];
    for (let ch = 0; ch < UNIVERSE_SIZE; ch++) {
      if (this.runtime.faderLive[ch] > 0) out.push(ch);
    }
    return out;
  }

  updateArtnetSettings(settings: ArtnetSettings): void {
    this.applyArtnet(settings);
    this.emitState();
  }

  /** ch ラベルを設定（空文字で削除）。 */
  setChannelLabel(ch: number, label: string): void {
    if (!this.editable) return;
    if (ch < 0 || ch >= UNIVERSE_SIZE) return;
    this.pushUndo();
    this.project.channelLabels ??= {};
    const t = label.trim();
    if (t) this.project.channelLabels[ch] = t;
    else delete this.project.channelLabels[ch];
    this.notifyProject();
  }

  /** バンク(ページ)ラベルを設定（空文字で削除）。 */
  setBankLabel(bank: number, label: string): void {
    if (!this.editable) return;
    if (bank < 0) return;
    this.pushUndo();
    this.project.bankLabels ??= {};
    const t = label.trim();
    if (t) this.project.bankLabels[bank] = t;
    else delete this.project.bankLabels[bank];
    this.notifyProject();
  }

  /** ch を 0..UNIVERSE_SIZE-1 へ丸めて返す（非数は null）。 */
  private clampChannel(v: number): number | null {
    if (!Number.isFinite(v)) return null;
    return Math.max(0, Math.min(UNIVERSE_SIZE - 1, Math.round(v)));
  }

  /** RGB フィクスチャを追加（id は採番）。 */
  addFixture(init: FixtureInit): void {
    if (!this.editable) return;
    const r = this.clampChannel(init.r);
    const g = this.clampChannel(init.g);
    const b = this.clampChannel(init.b);
    if (r === null || g === null || b === null) return;
    this.pushUndo();
    this.project.fixtures ??= [];
    this.project.fixtures.push(createRgbFixture(r, g, b, init.name?.trim() || undefined));
    this.notifyProject();
  }

  /** RGB フィクスチャを更新（指定フィールドのみ・範囲外 ch は無視）。 */
  updateFixture(id: string, patch: FixturePatch): void {
    if (!this.editable) return;
    const fx = this.project.fixtures?.find((f) => f.id === id);
    if (!fx) return;
    this.pushUndo();
    if (patch.name !== undefined) {
      const t = patch.name.trim();
      if (t) fx.name = t;
      else delete fx.name;
    }
    for (const key of ['r', 'g', 'b'] as const) {
      const v = patch[key];
      if (v === undefined) continue;
      const ch = this.clampChannel(v);
      if (ch !== null) fx[key] = ch;
    }
    this.notifyProject();
  }

  /** RGB フィクスチャを削除（空になれば fixtures フィールド自体を省く）。 */
  deleteFixture(id: string): void {
    if (!this.editable) return;
    if (!this.project.fixtures) return;
    const next = this.project.fixtures.filter((f) => f.id !== id);
    if (next.length === this.project.fixtures.length) return;
    this.pushUndo();
    if (next.length > 0) this.project.fixtures = next;
    else delete this.project.fixtures;
    this.notifyProject();
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
    // 解放前の合成出力（グランドマスター適用前）をフェーダーへ取り込み、出力ジャンプを防ぐ。
    // resolveFrame は ch ごとに独立して書き込むため、出力先に faderLive を直接渡せる。
    resolveFrame(contextFromRuntime(this.runtime), this.runtime.faderLive);
    this.runtime.busking.fill(false); // 解放中は busking 概念を持たない
    this.activeShow = null;
    this.runtime.activeShowId = null;
    this.runtime.show = null;
    this.notifyProject(); // faderLive→project.faders をレンダラへ反映（faders 同期）
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

  /** 進行中フェードを現在値で確定（停止）する（HOLD）。 */
  holdFade(): void {
    const rt = this.runtime.show;
    if (!rt || !rt.fade) return;
    rt.fade = null; // tracked は直近 tick の補間値で確定する
    this.emitState();
  }

  /** マスター列を1つ前へ戻す（GO BACK）。先頭より前は no-op。 */
  goBack(): void {
    if (!this.activeShow || !this.runtime.show) return;
    const pos = prevPosition(
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
    this.runtime.editingActionId = null; // CUE 選択へ切替（フェーダーは CUE 側へ）
    this.playPosition(pos, this.nowFn());
    this.emitState();
  }

  /**
   * CUE 選択を解除し、プレイヘッドを未 GO（-1）の初期状態へ戻す。
   * show 層は非アクティブになり、出力はプログラマー/0 に戻る（頭出し前の状態）。
   */
  deselectCue(): void {
    const rt = this.runtime.show;
    if (!rt) return;
    rt.mainIndex = -1;
    rt.subIndex = 0;
    rt.fade = null;
    rt.followAtMs = null;
    rt.tracked.fill(0);
    this.emitState();
  }

  private playPosition(pos: Position, now: number): void {
    const rt = this.runtime.show;
    const show = this.activeShow;
    if (!rt || !show) return;
    const cue = cueAt(show.sequence, pos);
    if (!cue) return;
    const target = computeTarget(currentTarget(rt), cue);
    startFade(rt, target, now, cue.fadeInMs, cue.delayMs ?? 0, cue.fadeOutMs ?? cue.fadeInMs);
    rt.mainIndex = pos.main;
    rt.subIndex = pos.sub;
    this.scheduleFollow(now);
    // §6.2: 新 cue が操作対象に含む ch の busking 上書きを解除（cue が引き継ぐ）。
    for (const k of Object.keys(cue.values)) {
      const ch = Number(k);
      if (ch >= 0 && ch < UNIVERSE_SIZE) this.runtime.busking[ch] = false;
    }
  }

  /**
   * 現在位置が GROUP 子 CUE で followMs を持ち、かつ次位置があるとき、
   * now+followMs を自動送り発火時刻に設定する。それ以外は解除（null）。
   */
  private scheduleFollow(now: number): void {
    const rt = this.runtime.show;
    const show = this.activeShow;
    if (!rt || !show) {
      if (rt) rt.followAtMs = null;
      return;
    }
    const entry = show.sequence[rt.mainIndex];
    let at: number | null = null;
    if (entry?.kind === 'group') {
      const cue = entry.group.cues[rt.subIndex];
      if (
        cue?.followMs !== undefined &&
        nextInGroup(show.sequence, rt.mainIndex, rt.subIndex) !== null
      ) {
        at = now + Math.max(0, cue.followMs);
      }
    }
    rt.followAtMs = at;
  }

  /** GROUP 子 CUE の自動送り: SHOW モードで発火時刻に達したら次の子へ進む。 */
  private maybeAutoAdvance(now: number): void {
    const rt = this.runtime.show;
    if (!rt || rt.followAtMs === null || now < rt.followAtMs) return;
    if (this.runtime.mode !== 'show') return; // 自動再生は SHOW モードのみ（EDIT 中は編集を妨げない）
    const show = this.activeShow;
    if (!show) {
      rt.followAtMs = null;
      return;
    }
    const pos = nextInGroup(show.sequence, rt.mainIndex, rt.subIndex);
    rt.followAtMs = null;
    if (pos) {
      this.playPosition(pos, now); // 次位置で followAtMs を再スケジュール
      this.emitState();
    }
  }

  // ===== コマンド: オーサリング =====

  newShow(name?: string): void {
    if (!this.editable) return;
    this.pushUndo();
    const show = { id: genId(), name: name ?? `Show ${this.project.shows.length + 1}`, sequence: [] };
    this.project.shows.push(show);
    this.notifyProject();
  }

  /**
   * 外部ファイル（.dmxshow）から読み込んだ Show を取り込む。
   * id を全て再採番して既存 Project との衝突を防ぎ、Timeline の参照も新 id へ付け替える。
   * 名前が重複する場合は一意化する。folderId は持たない（ルート直下）。
   */
  importShow(show: Show): void {
    if (!this.editable) return;
    this.pushUndo();

    // 旧 id -> 新 id（cue / group）。Timeline 参照の付け替えに使う。
    const idMap = new Map<string, string>();
    const remapId = (oldId: string): string => {
      const next = genId();
      idMap.set(oldId, next);
      return next;
    };

    show.id = genId();
    for (const entry of show.sequence) {
      if (entry.kind === 'group') {
        entry.group.id = remapId(entry.group.id);
        for (const cue of entry.group.cues) cue.id = remapId(cue.id);
      } else {
        entry.cue.id = remapId(entry.cue.id);
      }
    }

    // Timeline の cueId / groupId を新 id へ。対応が無ければ当該キーを外す（順送りにフォールバック）。
    if (show.timeline) {
      for (const p of show.timeline.points) {
        if (p.cueId !== undefined) {
          const mapped = idMap.get(p.cueId);
          if (mapped) p.cueId = mapped;
          else delete p.cueId;
        }
        if (p.groupId !== undefined) {
          const mapped = idMap.get(p.groupId);
          if (mapped) p.groupId = mapped;
          else delete p.groupId;
        }
      }
    }

    delete show.folderId;
    show.name = this.uniqueShowName(show.name);
    this.project.shows.push(show);
    this.notifyProject();
  }

  /** 既存 Show 名と重複しない名前を返す（重複時は「(取り込み)」＋必要なら連番）。 */
  private uniqueShowName(name: string): string {
    const base = name.trim() || 'Show';
    const taken = new Set(this.project.shows.map((s) => s.name));
    if (!taken.has(base)) return base;
    const withTag = `${base} (取り込み)`;
    if (!taken.has(withTag)) return withTag;
    for (let i = 2; ; i++) {
      const candidate = `${base} (取り込み ${i})`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /** Show 名を変更する。空文字は既定名にフォールバック。 */
  renameShow(showId: string, name: string): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    const next = name.trim() || `Show ${this.project.shows.indexOf(show) + 1}`;
    if (next === show.name) return; // 変更なし
    this.pushUndo();
    show.name = next;
    this.notifyProject();
  }

  /** Show を削除する。読込中（アクティブ）の Show なら先に解放してから削除する。 */
  deleteShow(showId: string): void {
    if (!this.editable) return;
    const idx = this.project.shows.findIndex((s) => s.id === showId);
    if (idx === -1) return;
    this.pushUndo();
    if (this.runtime.activeShowId === showId) this.unloadShow();
    this.project.shows.splice(idx, 1);
    this.notifyProject();
  }

  // ===== コマンド: フォルダ（Show の整理・単層） =====

  /** フォルダを追加する。 */
  addFolder(name?: string): void {
    if (!this.editable) return;
    this.pushUndo();
    const folder = createFolder(name?.trim() || `フォルダ ${(this.project.folders?.length ?? 0) + 1}`);
    this.project.folders = [...(this.project.folders ?? []), folder];
    this.notifyProject();
  }

  /** フォルダ名を変更する。空文字は無視。 */
  renameFolder(folderId: string, name: string): void {
    if (!this.editable) return;
    const folder = this.project.folders?.find((f) => f.id === folderId);
    if (!folder) return;
    const next = name.trim();
    if (!next || next === folder.name) return;
    this.pushUndo();
    folder.name = next;
    this.notifyProject();
  }

  /** フォルダを削除する。中の Show はルート直下へ移す（非破壊）。 */
  deleteFolder(folderId: string): void {
    if (!this.editable) return;
    const folders = this.project.folders;
    if (!folders) return;
    const idx = folders.findIndex((f) => f.id === folderId);
    if (idx === -1) return;
    this.pushUndo();
    for (const show of this.project.shows) {
      if (show.folderId === folderId) delete show.folderId;
    }
    folders.splice(idx, 1);
    if (folders.length === 0) delete this.project.folders;
    this.notifyProject();
  }

  /** Show の所属フォルダを設定/解除する（null/未指定でルートへ）。 */
  setShowFolder(showId: string, folderId: string | null): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    // 実在しないフォルダ指定は無視（ルート扱いにはしない）。
    if (folderId && !this.project.folders?.some((f) => f.id === folderId)) return;
    const next = folderId ?? undefined;
    if (show.folderId === next) return;
    this.pushUndo();
    if (next) show.folderId = next;
    else delete show.folderId;
    this.notifyProject();
  }

  /**
   * 空の CUE を追加する。targetGroupId 指定で GROUP の子へ、無ければマスター列末尾へ。
   * 追加した Show がアクティブなら新 CUE を自動選択し、フェーダーで作り込めるようにする。
   */
  addCue(showId: string, opts?: AddCueOptions): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    this.pushUndo();

    const cue: Cue = { id: genId(), name: opts?.name, values: {}, fadeInMs: opts?.fadeInMs ?? 0 };
    const targetGroupId = opts?.targetGroupId;
    const at = opts?.atIndex;

    let pos: Position | null = null;
    if (targetGroupId) {
      const group = this.findGroupInShow(show, targetGroupId);
      if (!group) return;
      const sub = at === undefined ? group.cues.length : clampInsert(at, group.cues.length);
      group.cues.splice(sub, 0, cue);
      const main = show.sequence.findIndex(
        (e) => e.kind === 'group' && e.group.id === targetGroupId,
      );
      if (main >= 0) pos = { main, sub };
    } else {
      const entry = createCueEntry(cue);
      const main = at === undefined ? show.sequence.length : clampInsert(at, show.sequence.length);
      show.sequence.splice(main, 0, entry);
      pos = { main, sub: 0 };
    }
    this.afterStructureChange(showId);

    if (pos && this.activeShow?.id === showId && this.runtime.show) {
      this.goTo(pos.main, pos.sub);
    }
  }

  /** 空の GROUP エントリをマスター列末尾に追加。 */
  addGroupEntry(showId: string, name?: string): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    this.pushUndo();
    show.sequence.push(createGroupEntry(name ?? `Group ${show.sequence.length + 1}`));
    this.afterStructureChange(showId);
  }

  setGroupLoop(groupId: string, loop: boolean): void {
    if (!this.editable) return;
    const found = this.findGroup(groupId);
    if (!found) return;
    this.pushUndo();
    found.group.loop = loop;
    this.notifyProject();
  }

  updateCue(cueId: string, patch: CuePatch): void {
    if (!this.editable) return;
    const cue = this.findCue(cueId);
    if (!cue) return;
    this.pushUndo();
    if (patch.name !== undefined) cue.name = patch.name;
    if (patch.lyrics !== undefined) cue.lyrics = patch.lyrics;
    if (patch.fadeInMs !== undefined) cue.fadeInMs = Math.max(0, patch.fadeInMs);
    if (patch.fadeOutMs !== undefined) {
      if (patch.fadeOutMs === null) delete cue.fadeOutMs;
      else cue.fadeOutMs = Math.max(0, patch.fadeOutMs);
    }
    if (patch.delayMs !== undefined) cue.delayMs = Math.max(0, patch.delayMs);
    if (patch.followMs !== undefined) {
      if (patch.followMs === null) delete cue.followMs;
      else cue.followMs = Math.max(0, patch.followMs);
    }
    this.notifyProject();
  }

  /**
   * CUE からこの ch を削除する（cue.values からキー削除）。Edit 専用。
   * アクティブ Show なら footprint(controlled) を再計算し、現在(プレイヘッド) CUE なら
   * live 反映として ch を 0 にフォールバックする。
   */
  deleteCueChannel(cueId: string, ch: number): void {
    if (!this.editable) return;
    if (ch < 0 || ch >= UNIVERSE_SIZE) return;
    const cue = this.findCue(cueId);
    if (!cue || cue.values[ch] === undefined) return;
    this.pushUndo();
    delete cue.values[ch];

    const show = this.activeShow;
    const rt = this.runtime.show;
    if (show && rt && flattenCues(show.sequence).includes(cue)) {
      rt.controlled = footprintOf(flattenCues(show.sequence));
      // 現在(プレイヘッド)の CUE なら live 反映：この ch を 0 へ落とす。
      const current = cueAt(show.sequence, { main: rt.mainIndex, sub: rt.subIndex });
      if (current === cue) {
        rt.tracked[ch] = 0;
        if (rt.fade) rt.fade.to[ch] = 0;
        this.runtime.faderLive[ch] = 0;
        this.runtime.busking[ch] = false;
      }
    }
    this.notifyProject();
    this.emitState();
  }

  /** マスター列のエントリ（CUE / GROUP）を id で削除。 */
  deleteEntry(showId: string, entryId: string): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    const idx = show.sequence.findIndex((e) =>
      e.kind === 'cue' ? e.cue.id === entryId : e.group.id === entryId,
    );
    if (idx < 0) return;
    this.pushUndo();
    show.sequence.splice(idx, 1);
    this.afterStructureChange(showId);
  }

  deleteCueFromGroup(groupId: string, cueId: string): void {
    if (!this.editable) return;
    const found = this.findGroup(groupId);
    if (!found) return;
    const idx = found.group.cues.findIndex((c) => c.id === cueId);
    if (idx < 0) return;
    this.pushUndo();
    found.group.cues.splice(idx, 1);
    this.afterStructureChange(found.show.id);
  }

  /** マスター列のエントリを並べ替え。 */
  moveEntry(showId: string, entryId: string, toIndex: number): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    this.pushUndo();
    moveById(
      show.sequence,
      (e) => (e.kind === 'cue' ? e.cue.id : e.group.id) === entryId,
      toIndex,
    );
    this.afterStructureChange(showId);
  }

  moveCueInGroup(groupId: string, cueId: string, toIndex: number): void {
    if (!this.editable) return;
    const found = this.findGroup(groupId);
    if (!found) return;
    this.pushUndo();
    moveById(found.group.cues, (c) => c.id === cueId, toIndex);
    this.afterStructureChange(found.show.id);
  }

  /** マスター列のエントリ（CUE / GROUP）を複製し、直後に挿入する。 */
  duplicateEntry(showId: string, entryId: string): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    const idx = show.sequence.findIndex((e) =>
      e.kind === 'cue' ? e.cue.id === entryId : e.group.id === entryId,
    );
    if (idx < 0) return;
    this.pushUndo();
    const entry = show.sequence[idx];
    const clone: SequenceEntry =
      entry.kind === 'cue'
        ? { kind: 'cue', cue: cloneCue(entry.cue) }
        : { kind: 'group', group: cloneGroup(entry.group) };
    show.sequence.splice(idx + 1, 0, clone);
    this.afterStructureChange(showId);
  }

  /** GROUP 内の子 CUE を複製し、直後に挿入する。 */
  duplicateCueInGroup(groupId: string, cueId: string): void {
    if (!this.editable) return;
    const found = this.findGroup(groupId);
    if (!found) return;
    const idx = found.group.cues.findIndex((c) => c.id === cueId);
    if (idx < 0) return;
    this.pushUndo();
    found.group.cues.splice(idx + 1, 0, cloneCue(found.group.cues[idx]));
    this.afterStructureChange(found.show.id);
  }

  // ===== コマンド: Action（§5.6） =====

  /**
   * Action 押下（発火）: look（step0）を programmer（フェーダー）へ取り込んで保持する。
   * Show 読込中はその ch を busking として CUE を上書き保持、未読込は faderLive へ直接。
   * fadeMs>0 なら現在の出力からその look へ fadeMs かけてフェードする。
   */
  actionDown(actionId: string, fadeMs = 0): void {
    const action = this.project.actions.find((a) => a.id === actionId);
    if (!action) return;
    if (this.applyActionLook(action, fadeMs)) {
      this.notifyProject();
      this.emitState();
    }
  }

  /**
   * Action の look（step0）を faderLive へ書き込む。Show 読込中は busking も立てる。
   * fadeMs>0 なら即時書き込まず、現在の出力を起点に faderFade を仕込んで tick で補間する。
   * @returns 1ch でも look 対象があれば true。
   */
  private applyActionLook(action: ActionButton, fadeMs = 0): boolean {
    const step = action.steps[0];
    if (!step) return false;
    const showLoaded = this.runtime.show !== null;
    const entries = Object.entries(step.values)
      .map(([k, v]) => [Number(k), clamp255(v)] as const)
      .filter(([ch]) => ch >= 0 && ch < UNIVERSE_SIZE);
    if (entries.length === 0) {
      this.runtime.faderFade = null;
      return false;
    }

    if (fadeMs <= 0) {
      // 即時取り込み。進行中フェードは破棄。
      this.runtime.faderFade = null;
      for (const [ch, v] of entries) {
        this.runtime.faderLive[ch] = v;
        if (showLoaded) this.runtime.busking[ch] = true;
      }
      return true;
    }

    // フェード取り込み: 現在の出力（プリマスター）を起点に look へ補間する。
    const from = new Array(UNIVERSE_SIZE).fill(0);
    resolveFrame(contextFromRuntime(this.runtime), from);
    const to = from.slice();
    for (const [ch, v] of entries) {
      to[ch] = v;
      if (showLoaded) this.runtime.busking[ch] = true; // look ch は busking で上書き保持
      this.runtime.faderLive[ch] = from[ch]; // 起点に合わせて段差を無くす
    }
    this.runtime.faderFade = { from, to, startMs: this.nowFn(), durMs: fadeMs, delayMs: 0 };
    return true;
  }

  /** faderFade を now まで進め、look 対象 ch の faderLive を補間する。 */
  private advanceFaderFade(now: number): void {
    const fade = this.runtime.faderFade;
    if (!fade) return;
    const t = fade.durMs <= 0 ? 1 : clamp01((now - fade.startMs) / fade.durMs);
    for (let ch = 0; ch < UNIVERSE_SIZE; ch++) {
      if (fade.from[ch] === fade.to[ch]) continue;
      this.runtime.faderLive[ch] = t >= 1 ? fade.to[ch] : Math.round(lerp(fade.from[ch], fade.to[ch], t));
    }
    if (t >= 1) {
      this.runtime.faderFade = null;
      this.notifyProject(); // 完了でフェーダー位置を確定通知
    } else {
      this.scheduleProjectNotify(); // 途中はスロットルしてスライダーを追従
    }
  }

  // ===== コマンド: Action オーサリング =====

  /**
   * 空の Action を追加し、編集対象に選択する（CUE 先行フローと同じ思想）。
   * 以後フェーダーを操作すると、その look（step0）へ書き込まれる。
   * Action は Project 全体で共通（全 Show で共有）。Show 未読込でも作成できる。
   */
  addAction(name?: string): void {
    if (!this.editable) return;
    this.pushUndo();
    const action = createAction(name ?? `Action ${this.project.actions.length + 1}`);
    action.steps.push({ values: {}, fadeInMs: 0, holdMs: 500 }); // 空 look（フェーダーで作り込む）
    this.project.actions.push(action);
    this.selectActionForEditInternal(action.id);
    this.notifyProject();
    this.emitState();
  }

  /** Action を編集対象に選択する（EDIT のみ）。CUE 選択は解除し、フェーダーを Action 側へ向ける。 */
  selectActionForEdit(actionId: string): void {
    if (!this.editable) return;
    if (!this.project.actions.some((a) => a.id === actionId)) return;
    this.selectActionForEditInternal(actionId);
    this.emitState();
  }

  /** 選択処理本体（CUE 選択解除を含む・emit は呼び出し側）。 */
  private selectActionForEditInternal(actionId: string): void {
    this.runtime.editingActionId = actionId;
    // フェーダーは1つの編集対象のみ。CUE 選択中なら解除する（相互排他）。
    const rt = this.runtime.show;
    if (rt && rt.mainIndex >= 0) {
      rt.mainIndex = -1;
      rt.subIndex = 0;
      rt.fade = null;
      rt.followAtMs = null;
      rt.tracked.fill(0);
    }
  }

  /** Action 編集選択を解除する。 */
  deselectAction(): void {
    if (this.runtime.editingActionId === null) return;
    this.runtime.editingActionId = null;
    this.emitState();
  }

  /**
   * Action の look（step0）を programmer（フェーダー）へ取り込む（キャプチャ）。
   * Show 読込中はその ch を busking として CUE を上書き保持、未読込は faderLive へ直接。
   * EDIT 中は CUE / Action 編集選択を解除し、取り込んだ look をそのまま programmer にする
   * （以後フェーダーで調整・CUE 記録できる）。
   */
  captureAction(actionId: string, fadeMs = 0): void {
    const action = this.project.actions.find((a) => a.id === actionId);
    const step = action?.steps[0];
    if (!action || !step) return;
    if (this.runtime.mode === 'edit') {
      this.runtime.editingActionId = null;
      const rt = this.runtime.show;
      if (rt && rt.mainIndex >= 0) {
        rt.mainIndex = -1;
        rt.subIndex = 0;
        rt.fade = null;
        rt.followAtMs = null;
        rt.tracked.fill(0);
      }
    }
    this.applyActionLook(action, fadeMs);
    this.notifyProject();
    this.emitState();
  }

  updateAction(actionId: string, patch: ActionPatch): void {
    if (!this.editable) return;
    const action = this.project.actions.find((a) => a.id === actionId);
    if (!action) return;
    this.pushUndo();
    if (patch.name !== undefined) action.name = patch.name;
    this.notifyProject();
  }

  deleteAction(actionId: string): void {
    if (!this.editable) return;
    this.pushUndo();
    this.project.actions = this.project.actions.filter((a) => a.id !== actionId);
    if (this.runtime.editingActionId === actionId) this.runtime.editingActionId = null;
    this.notifyProject();
    this.emitState();
  }

  /**
   * 既存 Action の look（step0）を現在のフェーダー位置（非ゼロ ch）で上書きする。
   * SHOW モード中でも実行可（本番で覚え込んだ look を更新するため）。step が無ければ作成する。
   */
  overwriteAction(actionId: string): void {
    const action = this.project.actions.find((a) => a.id === actionId);
    if (!action) return;
    this.pushUndo();
    const values = this.faderValuesFor(this.liveFaderChannels());
    if (action.steps.length > 0) action.steps[0].values = values;
    else action.steps.push({ values, fadeInMs: 0, holdMs: 500 });
    this.notifyProject();
  }

  private faderValuesFor(channels: number[]): Record<number, number> {
    const values: Record<number, number> = {};
    for (const ch of channels) {
      if (ch >= 0 && ch < UNIVERSE_SIZE) values[ch] = this.runtime.faderLive[ch];
    }
    return values;
  }

  // ===== コマンド: Timeline（§5.5・内部タイムコード） =====

  /** レンダラの再生位置（ms）。跨いだポイントで GO を発火。 */
  reportAudioPlayhead(ms: number): void {
    const show = this.activeShow;
    const timeline = show?.timeline;
    if (show && timeline && this.runtime.show) {
      const crossed = pointsCrossed(timeline.points, this.lastPlayheadMs, ms);
      for (const idx of crossed) {
        const pt = timeline.points[idx];
        // CUE 紐づけがあればその CUE へ頭出し。無効/未指定なら従来の順送り GO。
        const pos = pt.cueId ? positionOfCue(show.sequence, pt.cueId) : null;
        if (pos) this.goTo(pos.main, pos.sub);
        else this.go();
      }
    }
    this.lastPlayheadMs = ms;
  }

  /** シーク。跨ぎ基準をリセット（シーク位置からは発火しない）。 */
  timelineSeek(ms: number): void {
    this.lastPlayheadMs = ms;
  }

  /** 停止。基準を先頭へ。 */
  timelineStop(): void {
    this.lastPlayheadMs = 0;
  }

  addTimelinePoint(showId: string, timecodeMs: number, cueId?: string): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    this.pushUndo();
    if (!show.timeline) show.timeline = { points: [] };
    const point: TimelinePoint = { timecodeMs: Math.max(0, Math.round(timecodeMs)), type: 'go' };
    if (cueId) point.cueId = cueId;
    show.timeline.points.push(point);
    show.timeline.points.sort((a, b) => a.timecodeMs - b.timecodeMs);
    this.notifyProject();
  }

  /** GO ポイントに紐づく CUE を設定/解除する（undefined で順送りに戻す）。 */
  setTimelinePointCue(showId: string, index: number, cueId: string | undefined): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show?.timeline) return;
    const point = show.timeline.points[index];
    if (!point) return;
    this.pushUndo();
    if (cueId) point.cueId = cueId;
    else delete point.cueId;
    this.notifyProject();
  }

  deleteTimelinePoint(showId: string, index: number): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show?.timeline) return;
    if (index < 0 || index >= show.timeline.points.length) return;
    this.pushUndo();
    show.timeline.points.splice(index, 1);
    this.notifyProject();
  }

  /** GO ポイントの時刻を更新（ドラッグ移動）。更新後に昇順ソート。 */
  updateTimelinePoint(showId: string, index: number, timecodeMs: number): void {
    if (!this.editable) return;
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show?.timeline) return;
    if (index < 0 || index >= show.timeline.points.length) return;
    this.pushUndo();
    show.timeline.points[index].timecodeMs = Math.max(0, Math.round(timecodeMs));
    show.timeline.points.sort((a, b) => a.timecodeMs - b.timecodeMs);
    this.notifyProject();
  }

  /** Show に音声ファイル（絶対パス）を設定。 */
  setShowAudio(showId: string, filePath: string): void {
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    show.audio = { filePath };
    this.notifyProject();
  }

  /** Show の音声を解除。 */
  clearShowAudio(showId: string): void {
    const show = this.project.shows.find((s) => s.id === showId);
    if (!show) return;
    delete show.audio;
    this.notifyProject();
  }

  // ===== 内部ヘルパ =====

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
      busking: this.runtime.busking.slice(),
      artnet: { ...this.artnet },
      measuredHz: this.measuredHz,
      mode: this.runtime.mode,
      masterLevel: this.runtime.masterLevel,
      blackout: this.runtime.blackout,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      editingActionId: this.runtime.editingActionId,
      playback:
        show && this.activeShow
          ? {
              mainIndex: show.mainIndex,
              subIndex: show.subIndex,
              fading: !!show.fade,
              ...this.fadeStatus(),
              entryCount: this.activeShow.sequence.length,
            }
          : null,
    };
  }

  /** 進行中フェードの進捗(0..1)と残り時間(ms)。フェード無しは {1, 0}。 */
  private fadeStatus(): { fadeProgress: number; fadeRemainingMs: number } {
    const fade = this.runtime.show?.fade;
    if (!fade) return { fadeProgress: 1, fadeRemainingMs: 0 };
    const now = this.nowFn();
    const total = Math.max(fade.durMs, fade.durOutMs ?? fade.durMs);
    const sinceStart = now - fade.startMs;
    const elapsed = sinceStart - fade.delayMs;
    const progress = total <= 0 ? (elapsed >= 0 ? 1 : 0) : clamp01(elapsed / total);
    const remaining = Math.max(0, fade.delayMs + total - sinceStart);
    return { fadeProgress: progress, fadeRemainingMs: remaining };
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

  /** Edit ドラッグ中の連続編集を間引いて Project 通知する（trailing, ~120ms）。 */
  private scheduleProjectNotify(): void {
    if (this.projectNotifyTimer !== null) return;
    this.projectNotifyTimer = setTimeout(() => {
      this.projectNotifyTimer = null;
      this.notifyProject();
    }, 120);
  }

  // ===== 出力ループ =====

  tick(now: number): void {
    // 自動送りを先に判定（新 cue のフェードを同 tick で反映するため）。
    this.maybeAutoAdvance(now);
    if (this.runtime.show) applyFade(this.runtime.show, now);
    this.advanceFaderFade(now);

    const ctx = contextFromRuntime(this.runtime);
    resolveFrame(ctx, this.runtime.output);
    this.applyMaster(this.runtime.output);

    const packet = encodeArtDmx(this.runtime.output, this.sequence, this.artnet);
    this.sequence = nextSequence(this.sequence);
    this.send(packet);

    this.updateMeasuredHz(now);

    if (this.frameListeners.size > 0) {
      const frame = this.runtime.output;
      for (const cb of this.frameListeners) cb(frame);
    }
  }

  /**
   * 最終段にグランドマスター / ブラックアウトを適用する（破壊的・out を書き換え）。
   * blackout 優先で全 0、それ以外は masterLevel/255 を全 ch に乗算する。
   * ※ 機材モデル（フィクスチャ）が無いため調光以外の ch にも一律に乗る点に注意。
   */
  private applyMaster(out: number[]): void {
    if (this.runtime.blackout) {
      out.fill(0);
      return;
    }
    const m = this.runtime.masterLevel;
    if (m >= 255) return;
    if (m <= 0) {
      out.fill(0);
      return;
    }
    const f = m / 255;
    for (let ch = 0; ch < UNIVERSE_SIZE; ch++) out[ch] = Math.round(out[ch] * f);
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

/** 挿入位置を 0..len にクランプする。 */
function clampInsert(index: number, len: number): number {
  if (!Number.isFinite(index)) return len;
  return Math.max(0, Math.min(Math.round(index), len));
}

/** CUE を新しい id で複製する（values は別オブジェクトに複製）。 */
function cloneCue(cue: Cue): Cue {
  return { ...cue, id: genId(), values: { ...cue.values } };
}

/** GROUP を新しい id で複製する（子 CUE も全て複製）。 */
function cloneGroup(g: Group): Group {
  return { id: genId(), name: g.name, loop: g.loop, cues: g.cues.map(cloneCue) };
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
