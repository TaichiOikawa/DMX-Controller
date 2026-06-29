/**
 * renderer 側 UI 状態（Zustand）。
 *
 * エンジンが「単一の真実」なので、ここは UI ミラー:
 *   - faders: フェーダー位置（楽観的に即時反映 + エンジンへ送信）
 *   - busking: SHOW モードのライブ上書き中 ch（purple ハイライト。エンジン由来＋楽観更新）
 *   - output: エンジンの実出力（可視化用）
 *   - project: Show/マスター列/Action 構造（編集対象、エンジンから受信）
 *   - playback / activeActionIds: 再生・Action の状態（エンジンから受信）
 *   - transport: Timeline の内部タイムコード（renderer が回す）
 */

import { create } from 'zustand';
import {
  UNIVERSE_SIZE,
  type ArtnetSettings,
  type EngineMode,
  type Project,
  defaultArtnetSettings,
} from '../shared/types';
import type {
  DirtyState,
  EngineStateSnapshot,
  MissingFile,
  PlaybackStatus,
  ShowFilePayload,
} from '../shared/ipc';
import { cueAt } from '../engine/playback';

interface TransportState {
  playing: boolean;
  playheadMs: number;
  durationMs: number;
}

/** 左パネルの Show/フォルダ並び順（表示専用・非永続）。 */
export type ShowSort = 'manual' | 'name-asc' | 'name-desc';

interface DmxState {
  faders: number[];
  output: number[];
  busking: boolean[];
  artnet: ArtnetSettings;
  measuredHz: number;
  bank: number;
  /** フェーダーバンクを折りたたんでいるか（UI のみ）。 */
  fadersCollapsed: boolean;
  /** 左サイド（Project/Show ツリー）を折りたたんでいるか（UI のみ）。 */
  sidebarCollapsed: boolean;
  /** 環境設定モーダルを開いているか（UI のみ）。 */
  prefsOpen: boolean;
  /** Show 読込パッチモーダルの入力（非 null で表示・UI のみ）。 */
  showImport: ShowFilePayload | null;
  /** Project 読込時に見つからなかった音声ファイル一覧（非 null で再リンクモーダル表示・UI のみ）。 */
  missingFiles: MissingFile[] | null;
  /** 左パネルの並び順（UI のみ・非永続）。 */
  showSort: ShowSort;

  project: Project | null;
  playback: PlaybackStatus | null;
  activeShowId: string | null;
  selectedShowId: string | null;
  activeActionIds: string[];
  transport: TransportState;
  /** 読込中音声の長さ（ms）。Timeline の再生上限に反映（0=未読込）。 */
  audioDurationMs: number;
  /** 操作モード（'edit' / 'show'）。 */
  mode: EngineMode;
  /** グランドマスター（全体調光 0-255）。 */
  masterLevel: number;
  /** ブラックアウト中か。 */
  blackout: boolean;
  /** 未保存の変更があるか。 */
  dirty: boolean;
  /** 現在ひも付くプロジェクトファイルのパス（未保存の新規は null）。 */
  projectPath: string | null;
  /** Undo / Redo 可能か。 */
  canUndo: boolean;
  canRedo: boolean;

  setFader: (ch: number, value: number) => void;
  setOutput: (frame: number[]) => void;
  setArtnet: (settings: ArtnetSettings) => void;
  setBank: (bank: number) => void;
  /** フェーダーバンクの折りたたみを切り替える。 */
  toggleFadersCollapsed: () => void;
  /** 左サイドバーの折りたたみを切り替える。 */
  toggleSidebarCollapsed: () => void;
  /** 環境設定モーダルの開閉を設定する。 */
  setPrefsOpen: (open: boolean) => void;
  /** Show 読込パッチモーダルの入力を設定する（null で閉じる）。 */
  setShowImport: (payload: ShowFilePayload | null) => void;
  /** 欠損音声の再リンクモーダルを設定する（null で閉じる）。 */
  setMissingFiles: (files: MissingFile[] | null) => void;
  /** 左パネルの並び順を設定する。 */
  setShowSort: (sort: ShowSort) => void;
  setProject: (project: Project) => void;
  setEngineState: (state: EngineStateSnapshot) => void;
  selectShow: (showId: string) => void;
  setMode: (mode: EngineMode) => void;
  setMasterLevel: (level: number) => void;
  setBlackout: (on: boolean) => void;
  setDirty: (state: DirtyState) => void;

  /** キャプチャ解除（その ch を 0 に戻し、CUE/0 へ復帰）。 */
  releaseChannel: (ch: number) => void;
  /** 全キャプチャ解除。 */
  releaseAll: () => void;

  /**
   * 表示専用：選択中（current）CUE の値をフェーダー位置へ反映する（エンジンへは送らない）。
   * CUE の ch はその値、キャプチャ中 ch は現状維持、それ以外は 0。null で何もしない。
   */
  syncFadersToCue: (cueValues: Record<number, number> | null) => void;
  /** 選択中 CUE からこの ch を削除し、ローカルのフェーダー/キャプチャ表示も落とす。 */
  deleteCueChannel: (cueId: string, ch: number) => void;
  /** CUE 選択を解除（プレイヘッドを未 GO へ）。選択中 CUE の ch 表示も 0 に戻す。 */
  deselectCue: () => void;

  // Timeline トランスポート（内部タイムコード）
  transportPlay: () => void;
  transportPause: () => void;
  transportStop: () => void;
  transportSeek: (ms: number) => void;
  /** 内部クロックからの前進（私用）。 */
  advancePlayhead: (deltaMs: number) => void;
  /**
   * 音声を読込（Web Audio のクロック源になる）。
   * url は WaveSurfer 波形表示用の Blob URL、arrayBuffer は再生・時間軸用に decode する実体。
   */
  loadAudio: (url: string, arrayBuffer: ArrayBuffer) => void;
  /** 音声を解除（内部クロックへ戻す）。 */
  unloadAudio: () => void;
  /** 絶対位置で playhead を反映しエンジンへ報告（音声クロックから・私用）。 */
  reportPlayhead: (absMs: number) => void;
}

export const FADERS_PER_BANK = 32;
export const BANK_COUNT = UNIVERSE_SIZE / FADERS_PER_BANK; // 16

const DEFAULT_DURATION_MS = 60_000;

/**
 * 選択中 CUE の値からフェーダー表示位置を作る（表示専用）。
 * CUE が持つ ch はその値、busking 中 ch は現状維持、それ以外は 0。
 */
function fadersFromCue(
  cueValues: Record<number, number>,
  current: number[],
  busking: boolean[],
): number[] {
  const faders = new Array(current.length).fill(0);
  for (let ch = 0; ch < faders.length; ch++) {
    const v = cueValues[ch];
    faders[ch] = v !== undefined ? v : busking[ch] ? current[ch] : 0;
  }
  return faders;
}

function durationForProject(
  project: Project,
  activeShowId: string | null,
  audioDurationMs: number,
): number {
  const show = project.shows.find((s) => s.id === activeShowId);
  const points = show?.timeline?.points ?? [];
  const max = points.reduce((m, p) => Math.max(m, p.timecodeMs), 0);
  // GO 点の最後 +10s、音声長、既定 60s のうち最大を再生上限とする。
  return Math.max(DEFAULT_DURATION_MS, max + 10_000, audioDurationMs);
}

export const useDmxStore = create<DmxState>((set, get) => ({
  faders: new Array(UNIVERSE_SIZE).fill(0),
  output: new Array(UNIVERSE_SIZE).fill(0),
  busking: new Array(UNIVERSE_SIZE).fill(false),
  artnet: defaultArtnetSettings(),
  measuredHz: 0,
  bank: 0,
  fadersCollapsed: false,
  sidebarCollapsed: false,
  prefsOpen: false,
  showImport: null,
  missingFiles: null,
  showSort: 'name-asc',

  project: null,
  playback: null,
  activeShowId: null,
  selectedShowId: null,
  activeActionIds: [],
  transport: { playing: false, playheadMs: 0, durationMs: DEFAULT_DURATION_MS },
  audioDurationMs: 0,
  mode: 'edit',
  masterLevel: 255,
  blackout: false,
  dirty: false,
  projectPath: null,
  canUndo: false,
  canRedo: false,

  setFader: (ch, value) =>
    set((s) => {
      const faders = s.faders.slice();
      faders[ch] = value;
      window.dmx.setFader(ch, value);
      // SHOW モードかつ show 読込中のみ楽観的に busking 表示。EDIT は CUE への書き込みが
      // engineState/project 経由で反映されるため楽観更新しない。解放中(未読込)は busking 無し。
      if (s.mode !== 'show' || s.activeShowId === null) return { faders };
      let busking = s.busking;
      if (!busking[ch]) {
        busking = busking.slice();
        busking[ch] = true;
      }
      return { faders, busking };
    }),

  setOutput: (frame) => set({ output: frame }),

  setArtnet: (settings) =>
    set(() => {
      window.dmx.updateArtnetSettings(settings);
      return { artnet: settings };
    }),

  setBank: (bank) => set({ bank }),

  toggleFadersCollapsed: () => set((s) => ({ fadersCollapsed: !s.fadersCollapsed })),

  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setPrefsOpen: (open) => set({ prefsOpen: open }),

  setShowImport: (payload) => set({ showImport: payload }),

  setMissingFiles: (files) => set({ missingFiles: files }),

  setShowSort: (sort) => set({ showSort: sort }),

  setProject: (project) =>
    set((s) => {
      const stillExists = project.shows.some((sh) => sh.id === s.selectedShowId);
      const selectedShowId = stillExists
        ? s.selectedShowId
        : (project.shows[0]?.id ?? null);

      // EDIT × CUE 選択中は、フェーダー表示の真実は選択 CUE 値（syncFadersToCue 由来）。
      // ここで project.faders(=faderLive) を採用すると、別 CUE 編集で残った faderLive へ
      // 非選択 ch が飛ぶ（編集中ブロードキャスト毎に他フェーダーが動く）。CUE から作り直す。
      const activeShow = project.shows.find((sh) => sh.id === s.activeShowId) ?? null;
      const mainIndex = s.playback?.mainIndex ?? -1;
      const subIndex = s.playback?.subIndex ?? 0;
      const selectedCue =
        s.mode === 'edit' && activeShow && mainIndex >= 0
          ? cueAt(activeShow.sequence, { main: mainIndex, sub: subIndex })
          : null;
      const faders = selectedCue
        ? fadersFromCue(selectedCue.values, s.faders, s.busking)
        : project.faders.slice();

      return {
        project,
        faders,
        artnet: project.settings.artnet,
        selectedShowId,
        transport: {
          ...s.transport,
          durationMs: durationForProject(project, s.activeShowId, s.audioDurationMs),
        },
      };
    }),

  setEngineState: (state) =>
    set({
      measuredHz: state.measuredHz,
      playback: state.playback,
      activeShowId: state.activeShowId,
      activeActionIds: state.activeActionIds,
      busking: state.busking,
      mode: state.mode,
      masterLevel: state.masterLevel,
      blackout: state.blackout,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
    }),

  selectShow: (showId) => set({ selectedShowId: showId }),

  setMode: (mode) =>
    set(() => {
      window.dmx.setMode(mode);
      return { mode };
    }),

  setMasterLevel: (level) =>
    set(() => {
      const masterLevel = Math.max(0, Math.min(255, Math.round(level)));
      window.dmx.setMasterLevel(masterLevel);
      return { masterLevel };
    }),

  setBlackout: (on) =>
    set(() => {
      window.dmx.setBlackout(on);
      return { blackout: on };
    }),

  setDirty: (state) => set({ dirty: state.dirty, projectPath: state.filePath }),

  releaseChannel: (ch) =>
    set((s) => {
      window.dmx.releaseCapture([ch]);
      const faders = s.faders.slice();
      faders[ch] = 0;
      const busking = s.busking.slice();
      busking[ch] = false;
      return { faders, busking };
    }),

  releaseAll: () =>
    set((s) => {
      window.dmx.releaseCapture();
      const faders = s.faders.slice();
      for (let ch = 0; ch < faders.length; ch++) if (s.busking[ch]) faders[ch] = 0;
      return { faders, busking: new Array(faders.length).fill(false) };
    }),

  syncFadersToCue: (cueValues) =>
    set((s) => {
      if (!cueValues) return {};
      return { faders: fadersFromCue(cueValues, s.faders, s.busking) };
    }),

  deleteCueChannel: (cueId, ch) =>
    set((s) => {
      window.dmx.deleteCueChannel(cueId, ch);
      const faders = s.faders.slice();
      faders[ch] = 0;
      const busking = s.busking.slice();
      busking[ch] = false;
      return { faders, busking };
    }),

  deselectCue: () =>
    set((s) => {
      window.dmx.deselectCue();
      // 解除した CUE の（非キャプチャ）ch の表示は 0 に戻す（古い CUE 値を残さない）。
      const show = s.project?.shows.find((sh) => sh.id === s.activeShowId);
      const main = s.playback?.mainIndex ?? -1;
      const cue = show && main >= 0 ? cueAt(show.sequence, { main, sub: s.playback?.subIndex ?? 0 }) : null;
      if (!cue) return {};
      const faders = s.faders.slice();
      for (const k of Object.keys(cue.values)) {
        const ch = Number(k);
        if (!s.busking[ch]) faders[ch] = 0;
      }
      return { faders };
    }),

  transportPlay: () =>
    set((s) => {
      if (audioBuffer) {
        startSource(startOffsetSec);
        startAudioRaf();
      } else {
        startClock();
      }
      return { transport: { ...s.transport, playing: true } };
    }),

  transportPause: () =>
    set((s) => {
      if (audioBuffer) {
        // 現在位置を確定してから停止（次回再生はここから）。
        startOffsetSec = currentPositionMs() / 1000;
        stopSource();
        stopAudioRaf();
      } else {
        stopClock();
      }
      return { transport: { ...s.transport, playing: false } };
    }),

  transportStop: () =>
    set((s) => {
      if (audioBuffer) {
        stopSource();
        startOffsetSec = 0;
        stopAudioRaf();
      } else {
        stopClock();
      }
      window.dmx.timelineStop();
      return { transport: { ...s.transport, playing: false, playheadMs: 0 } };
    }),

  transportSeek: (ms) =>
    set((s) => {
      const playheadMs = Math.max(0, Math.min(s.transport.durationMs, ms));
      if (audioBuffer) {
        startOffsetSec = playheadMs / 1000;
        // AudioBufferSourceNode は再利用不可。再生中なら新オフセットで作り直す。
        if (s.transport.playing) startSource(startOffsetSec);
      }
      window.dmx.timelineSeek(playheadMs);
      return { transport: { ...s.transport, playheadMs } };
    }),

  advancePlayhead: (deltaMs) => {
    const s = get();
    if (!s.transport.playing) return;
    const next = s.transport.playheadMs + deltaMs;
    if (next >= s.transport.durationMs) {
      stopClock();
      window.dmx.reportAudioPlayhead(s.transport.durationMs);
      set({ transport: { ...s.transport, playheadMs: s.transport.durationMs, playing: false } });
      return;
    }
    window.dmx.reportAudioPlayhead(next);
    set({ transport: { ...s.transport, playheadMs: next } });
  },

  loadAudio: (_url, arrayBuffer) => {
    stopSource();
    stopAudioRaf();
    audioBuffer = null;
    startOffsetSec = 0;
    // ファイルを一度だけ PCM デコードし、これを唯一の時間軸・再生源にする。
    // （<audio>.currentTime は VBR 等で非線形・不正確になるため使わない。）
    const ctx = ensureAudioCtx();
    void ctx.decodeAudioData(arrayBuffer).then((buf) => {
      audioBuffer = buf;
      const ms = Math.round(buf.duration * 1000);
      if (Number.isFinite(ms) && ms > 0) {
        // 音声長を保持し、再生上限へ反映（以後の setProject でも維持される）。
        set((s) => ({
          audioDurationMs: ms,
          transport: { ...s.transport, durationMs: Math.max(s.transport.durationMs, ms) },
        }));
      }
    }).catch(() => {});
  },

  unloadAudio: () => {
    stopSource();
    audioBuffer = null;
    startOffsetSec = 0;
    stopAudioRaf();
    // 音声長をクリアし、再生上限を GO 点ベースへ戻す。
    set((s) => ({
      audioDurationMs: 0,
      transport: {
        ...s.transport,
        durationMs: s.project
          ? durationForProject(s.project, s.activeShowId, 0)
          : DEFAULT_DURATION_MS,
      },
    }));
  },

  reportPlayhead: (absMs) => {
    const s = get();
    const dur = s.transport.durationMs;
    if (absMs >= dur) {
      stopSource();
      startOffsetSec = dur / 1000;
      stopAudioRaf();
      window.dmx.reportAudioPlayhead(dur);
      set({ transport: { ...s.transport, playheadMs: dur, playing: false } });
      return;
    }
    window.dmx.reportAudioPlayhead(absMs);
    set({ transport: { ...s.transport, playheadMs: absMs } });
  },
}));

// ===== Timeline 内部クロック =====
// 音声がある場合は Web Audio（AudioBufferSourceNode + AudioContext.currentTime）を
// クロック源にし、無い場合は setInterval で進める。
// <audio>.currentTime は VBR 等の圧縮音源で非線形・不正確になり、波形・プレイヘッドと
// 実音がずれるため使わない。デコード済み AudioBuffer を唯一の正確な時間軸とする。
let clockHandle: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let audioRaf: number | null = null;

// Web Audio 再生エンジン状態。
let audioCtx: AudioContext | null = null;
let audioBuffer: AudioBuffer | null = null;
let sourceNode: AudioBufferSourceNode | null = null;
/** 再生開始時の audioCtx.currentTime（秒）。 */
let startCtxTime = 0;
/** 再生開始時のバッファ内オフセット（秒）。停止中の現在位置でもある。 */
let startOffsetSec = 0;
/** 自前 stop と自然終了を onended で区別するフラグ。 */
let endedByUs = false;

/** AudioContext を遅延生成して再利用（ブラウザの生成数制限に配慮）。 */
function ensureAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** 現在の再生位置（ms）。再生中は AudioContext クロック、停止中はオフセット。 */
function currentPositionMs(): number {
  if (audioCtx && sourceNode) {
    return (startOffsetSec + (audioCtx.currentTime - startCtxTime)) * 1000;
  }
  return startOffsetSec * 1000;
}

/** 指定オフセット（秒）から新しいソースノードで再生開始。 */
function startSource(offsetSec: number): void {
  if (!audioBuffer) return;
  const ctx = ensureAudioCtx();
  stopSource();
  void ctx.resume().catch(() => {});
  const node = ctx.createBufferSource();
  node.buffer = audioBuffer;
  node.connect(ctx.destination);
  node.onended = () => {
    // 自前で stop した場合は無視。自然終了のみ終端処理。
    if (endedByUs) return;
    stopAudioRaf();
    const dur = useDmxStore.getState().transport.durationMs;
    startOffsetSec = dur / 1000;
    window.dmx.reportAudioPlayhead(dur);
    useDmxStore.setState((s) => ({
      transport: { ...s.transport, playheadMs: dur, playing: false },
    }));
  };
  startCtxTime = ctx.currentTime;
  startOffsetSec = offsetSec;
  endedByUs = false;
  node.start(0, offsetSec);
  sourceNode = node;
}

/** 再生中のソースノードを停止・破棄（onended の終端処理は走らせない）。 */
function stopSource(): void {
  if (sourceNode) {
    endedByUs = true;
    try {
      sourceNode.onended = null;
      sourceNode.stop();
    } catch {
      // 未開始ノードの stop 等は無視。
    }
    sourceNode.disconnect();
    sourceNode = null;
  }
}

function startClock(): void {
  if (clockHandle !== null) return;
  lastTickAt = performance.now();
  clockHandle = setInterval(() => {
    const now = performance.now();
    const delta = now - lastTickAt;
    lastTickAt = now;
    useDmxStore.getState().advancePlayhead(delta);
  }, 33);
}

function stopClock(): void {
  if (clockHandle !== null) {
    clearInterval(clockHandle);
    clockHandle = null;
  }
}

function startAudioRaf(): void {
  if (audioRaf !== null) return;
  const tick = (): void => {
    // 視覚更新は rAF ペースだが、位置の真値は AudioContext クロック由来。
    if (sourceNode) useDmxStore.getState().reportPlayhead(currentPositionMs());
    audioRaf = requestAnimationFrame(tick);
  };
  audioRaf = requestAnimationFrame(tick);
}

function stopAudioRaf(): void {
  if (audioRaf !== null) {
    cancelAnimationFrame(audioRaf);
    audioRaf = null;
  }
}
