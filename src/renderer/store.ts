/**
 * renderer 側 UI 状態（Zustand）。
 *
 * エンジンが「単一の真実」なので、ここは UI ミラー:
 *   - faders: フェーダー位置（楽観的に即時反映 + エンジンへ送信）
 *   - captured: プログラマー＝キャプチャ中 ch（ハイライト。エンジン由来＋楽観更新）
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
import type { DirtyState, EngineStateSnapshot, PlaybackStatus } from '../shared/ipc';
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
  captured: boolean[];
  artnet: ArtnetSettings;
  measuredHz: number;
  bank: number;
  /** フェーダーバンクを折りたたんでいるか（UI のみ）。 */
  fadersCollapsed: boolean;
  /** 左サイド（Project/Show ツリー）を折りたたんでいるか（UI のみ）。 */
  sidebarCollapsed: boolean;
  /** 環境設定モーダルを開いているか（UI のみ）。 */
  prefsOpen: boolean;
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
  /** 音声 Blob URL を再生用 <audio> として読込（クロック源になる）。 */
  loadAudio: (url: string) => void;
  /** 音声を解除（内部クロックへ戻す）。 */
  unloadAudio: () => void;
  /** 絶対位置で playhead を反映しエンジンへ報告（音声クロックから・私用）。 */
  reportPlayhead: (absMs: number) => void;
}

export const FADERS_PER_BANK = 32;
export const BANK_COUNT = UNIVERSE_SIZE / FADERS_PER_BANK; // 16

const DEFAULT_DURATION_MS = 60_000;

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
  captured: new Array(UNIVERSE_SIZE).fill(false),
  artnet: defaultArtnetSettings(),
  measuredHz: 0,
  bank: 0,
  fadersCollapsed: false,
  sidebarCollapsed: false,
  prefsOpen: false,
  showSort: 'manual',

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
      // Show モードかつ show 読込中のみ楽観的にキャプチャ表示。Edit は制御下 ch を capture
      // しないため楽観更新せず engineState で反映。解放中(未読込)は capture 概念を持たない。
      if (s.mode !== 'show' || s.activeShowId === null) return { faders };
      let captured = s.captured;
      if (!captured[ch]) {
        captured = captured.slice();
        captured[ch] = true;
      }
      return { faders, captured };
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

  setShowSort: (sort) => set({ showSort: sort }),

  setProject: (project) =>
    set((s) => {
      const stillExists = project.shows.some((sh) => sh.id === s.selectedShowId);
      const selectedShowId = stillExists
        ? s.selectedShowId
        : (project.shows[0]?.id ?? null);
      return {
        project,
        faders: project.faders.slice(),
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
      captured: state.captured,
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
      const captured = s.captured.slice();
      captured[ch] = false;
      return { faders, captured };
    }),

  releaseAll: () =>
    set((s) => {
      window.dmx.releaseCapture();
      const faders = s.faders.slice();
      for (let ch = 0; ch < faders.length; ch++) if (s.captured[ch]) faders[ch] = 0;
      return { faders, captured: new Array(faders.length).fill(false) };
    }),

  syncFadersToCue: (cueValues) =>
    set((s) => {
      if (!cueValues) return {};
      const faders = new Array(s.faders.length).fill(0);
      for (let ch = 0; ch < faders.length; ch++) {
        const v = cueValues[ch];
        faders[ch] = v !== undefined ? v : s.captured[ch] ? s.faders[ch] : 0;
      }
      return { faders };
    }),

  deleteCueChannel: (cueId, ch) =>
    set((s) => {
      window.dmx.deleteCueChannel(cueId, ch);
      const faders = s.faders.slice();
      faders[ch] = 0;
      const captured = s.captured.slice();
      captured[ch] = false;
      return { faders, captured };
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
        if (!s.captured[ch]) faders[ch] = 0;
      }
      return { faders };
    }),

  transportPlay: () =>
    set((s) => {
      if (audioEl) {
        void audioEl.play().catch(() => {});
        startAudioRaf();
      } else {
        startClock();
      }
      return { transport: { ...s.transport, playing: true } };
    }),

  transportPause: () =>
    set((s) => {
      if (audioEl) {
        audioEl.pause();
        stopAudioRaf();
      } else {
        stopClock();
      }
      return { transport: { ...s.transport, playing: false } };
    }),

  transportStop: () =>
    set((s) => {
      if (audioEl) {
        audioEl.pause();
        audioEl.currentTime = 0;
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
      if (audioEl) audioEl.currentTime = playheadMs / 1000;
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

  loadAudio: (url) => {
    if (audioEl) audioEl.pause();
    stopAudioRaf();
    const el = new Audio(url);
    audioEl = el;
    el.addEventListener('loadedmetadata', () => {
      const ms = Math.round(el.duration * 1000);
      if (Number.isFinite(ms) && ms > 0) {
        // 音声長を保持し、再生上限へ反映（以後の setProject でも維持される）。
        set((s) => ({
          audioDurationMs: ms,
          transport: { ...s.transport, durationMs: Math.max(s.transport.durationMs, ms) },
        }));
      }
    });
    el.addEventListener('ended', () => {
      stopAudioRaf();
      set((s) => ({ transport: { ...s.transport, playing: false } }));
    });
  },

  unloadAudio: () => {
    if (audioEl) {
      audioEl.pause();
      audioEl = null;
    }
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
      if (audioEl) audioEl.pause();
      stopAudioRaf();
      window.dmx.reportAudioPlayhead(dur);
      set({ transport: { ...s.transport, playheadMs: dur, playing: false } });
      return;
    }
    window.dmx.reportAudioPlayhead(absMs);
    set({ transport: { ...s.transport, playheadMs: absMs } });
  },
}));

// ===== Timeline 内部クロック（~33ms） =====
// 音声が読み込まれている場合は <audio> をクロック源にし、無い場合は setInterval で進める。
let clockHandle: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let audioEl: HTMLAudioElement | null = null;
let audioRaf: number | null = null;

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
    if (audioEl) useDmxStore.getState().reportPlayhead(audioEl.currentTime * 1000);
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
