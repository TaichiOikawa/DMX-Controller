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
  type Project,
  defaultArtnetSettings,
} from '../shared/types';
import type { EngineStateSnapshot, PlaybackStatus } from '../shared/ipc';

interface TransportState {
  playing: boolean;
  playheadMs: number;
  durationMs: number;
}

interface DmxState {
  faders: number[];
  output: number[];
  captured: boolean[];
  artnet: ArtnetSettings;
  measuredHz: number;
  bank: number;

  project: Project | null;
  playback: PlaybackStatus | null;
  activeShowId: string | null;
  selectedShowId: string | null;
  activeActionIds: string[];
  transport: TransportState;

  setFader: (ch: number, value: number) => void;
  setOutput: (frame: number[]) => void;
  setArtnet: (settings: ArtnetSettings) => void;
  setBank: (bank: number) => void;
  setProject: (project: Project) => void;
  setEngineState: (state: EngineStateSnapshot) => void;
  selectShow: (showId: string) => void;

  /** キャプチャ解除（その ch を 0 に戻し、CUE/0 へ復帰）。 */
  releaseChannel: (ch: number) => void;
  /** 全キャプチャ解除。 */
  releaseAll: () => void;

  // Timeline トランスポート（内部タイムコード）
  transportPlay: () => void;
  transportPause: () => void;
  transportStop: () => void;
  transportSeek: (ms: number) => void;
  /** 内部クロックからの前進（私用）。 */
  advancePlayhead: (deltaMs: number) => void;
}

export const FADERS_PER_BANK = 32;
export const BANK_COUNT = UNIVERSE_SIZE / FADERS_PER_BANK; // 16

const DEFAULT_DURATION_MS = 60_000;

function durationForProject(project: Project, activeShowId: string | null): number {
  const show = project.shows.find((s) => s.id === activeShowId);
  const points = show?.timeline?.points ?? [];
  const max = points.reduce((m, p) => Math.max(m, p.timecodeMs), 0);
  return Math.max(DEFAULT_DURATION_MS, max + 10_000);
}

export const useDmxStore = create<DmxState>((set, get) => ({
  faders: new Array(UNIVERSE_SIZE).fill(0),
  output: new Array(UNIVERSE_SIZE).fill(0),
  captured: new Array(UNIVERSE_SIZE).fill(false),
  artnet: defaultArtnetSettings(),
  measuredHz: 0,
  bank: 0,

  project: null,
  playback: null,
  activeShowId: null,
  selectedShowId: null,
  activeActionIds: [],
  transport: { playing: false, playheadMs: 0, durationMs: DEFAULT_DURATION_MS },

  setFader: (ch, value) =>
    set((s) => {
      const faders = s.faders.slice();
      faders[ch] = value;
      window.dmx.setFader(ch, value);
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
          durationMs: durationForProject(project, s.activeShowId),
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
    }),

  selectShow: (showId) => set({ selectedShowId: showId }),

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

  transportPlay: () =>
    set((s) => {
      startClock();
      return { transport: { ...s.transport, playing: true } };
    }),

  transportPause: () =>
    set((s) => {
      stopClock();
      return { transport: { ...s.transport, playing: false } };
    }),

  transportStop: () =>
    set((s) => {
      stopClock();
      window.dmx.timelineStop();
      return { transport: { ...s.transport, playing: false, playheadMs: 0 } };
    }),

  transportSeek: (ms) =>
    set((s) => {
      const playheadMs = Math.max(0, Math.min(s.transport.durationMs, ms));
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
}));

// ===== Timeline 内部クロック（~33ms） =====
let clockHandle: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;

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
