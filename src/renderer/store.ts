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
  type AudioTrack,
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
  /** 追加トラック・クリップ音源の読込状態（filePath 単位）。UI の欠損表示に使う。 */
  audioFileStatus: Record<string, 'loading' | 'ready' | 'missing'>;
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
  /**
   * アクティブ Show の追加トラック音源を同期する（クリップのデコード + トラック音量/ミュート/ソロ反映）。
   * project / activeShowId が変化したら呼ぶ。
   */
  syncShowAudio: () => void;
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

  audioFileStatus: {},

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

  setProject: (project) => {
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
    });
    // クリップのデコード・トラック音量を最新の Project へ追従させる。
    get().syncShowAudio();
  },

  setEngineState: (state) => {
    const prevShowId = get().activeShowId;
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
    });
    // アクティブ Show が変わったら追加トラック音源を切り替える。
    if (prevShowId !== state.activeShowId) get().syncShowAudio();
  },

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
      const faders = new Array(s.faders.length).fill(0);
      for (let ch = 0; ch < faders.length; ch++) {
        const v = cueValues[ch];
        faders[ch] = v !== undefined ? v : s.busking[ch] ? s.faders[ch] : 0;
      }
      return { faders };
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
      if (hasAudioContent()) {
        scheduleAll(startOffsetSec);
        startAudioRaf();
      } else {
        startClock();
      }
      return { transport: { ...s.transport, playing: true } };
    }),

  transportPause: () =>
    set((s) => {
      if (audioPlaying) {
        // 現在位置を確定してから停止（次回再生はここから）。
        startOffsetSec = currentPositionMs() / 1000;
        stopAllSources();
        stopAudioRaf();
        sendZeroLevels();
      } else {
        stopClock();
      }
      return { transport: { ...s.transport, playing: false } };
    }),

  transportStop: () =>
    set((s) => {
      if (audioPlaying) {
        stopAllSources();
        stopAudioRaf();
        sendZeroLevels();
      } else {
        stopClock();
      }
      startOffsetSec = 0;
      window.dmx.timelineStop();
      return { transport: { ...s.transport, playing: false, playheadMs: 0 } };
    }),

  transportSeek: (ms) =>
    set((s) => {
      const playheadMs = Math.max(0, Math.min(s.transport.durationMs, ms));
      startOffsetSec = playheadMs / 1000;
      // AudioBufferSourceNode は再利用不可。音声クロックで再生中なら全ソースを作り直す。
      if (s.transport.playing && audioPlaying) {
        stopAllSources();
        scheduleAll(startOffsetSec);
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
    // 既存メイン音源だけ破棄（クリップ・クロックは触らない）。
    stopMainSource();
    mainBuffer = null;
    // ファイルを一度だけ PCM デコードし、メインの時間軸・再生源にする。
    // （<audio>.currentTime は VBR 等で非線形・不正確になるため使わない。）
    const ctx = ensureAudioCtx();
    ensureGraph();
    // 生成直後の mainGain に現在のメインミキサー値（音量/ミュート/ソロ）を反映する。
    applyTrackGains();
    void ctx.decodeAudioData(arrayBuffer).then((buf) => {
      mainBuffer = buf;
      const ms = Math.round(buf.duration * 1000);
      if (Number.isFinite(ms) && ms > 0) {
        // 音声長を保持し、再生上限へ反映（以後の setProject でも維持される）。
        set((s) => ({
          audioDurationMs: ms,
          transport: { ...s.transport, durationMs: Math.max(s.transport.durationMs, ms) },
        }));
      }
      // 再生中にメインを後から読み込んだ場合は、現在位置から鳴らし始める。
      if (audioPlaying && mainGain) {
        mainSource = scheduleSource(mainBuffer, mainGain, 0, currentPositionMs() / 1000);
      }
    }).catch(() => {});
  },

  unloadAudio: () => {
    stopMainSource();
    mainBuffer = null;
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
      stopAllSources();
      startOffsetSec = dur / 1000;
      stopAudioRaf();
      window.dmx.reportAudioPlayhead(dur);
      sendZeroLevels();
      set({ transport: { ...s.transport, playheadMs: dur, playing: false } });
      return;
    }
    window.dmx.reportAudioPlayhead(absMs);
    set({ transport: { ...s.transport, playheadMs: absMs } });
  },

  syncShowAudio: () => {
    const s = get();
    const show = s.project?.shows.find((sh) => sh.id === s.activeShowId) ?? null;
    reconcileShowAudio(show?.timeline?.audioTracks ?? [], {
      volume: show?.audio?.volume ?? 1,
      muted: show?.audio?.muted ?? false,
      solo: show?.audio?.solo ?? false,
      outputDeviceId: show?.audio?.outputDeviceId,
    });
  },
}));

// ===== Timeline 内部クロック + マルチソース・オーディオエンジン =====
// 音声（メイン or クリップ）がある場合は Web Audio（AudioContext.currentTime）を
// クロック源にし、無い場合は setInterval で進める。
// <audio>.currentTime は VBR 等の圧縮音源で非線形・不正確になり、波形・プレイヘッドと
// 実音がずれるため使わない。デコード済み AudioBuffer を唯一の正確な時間軸とする。
//
// グラフ: 各ソース → trackGain/mainGain ─┬─► meterBus → splitter → analyserL/R（解析のみ）
//                                        └─► （既定）masterGain → destination
//                                            （指定）deviceOutputs[id].dest → <audio sinkId=id>
// トラックごとに出力デバイスを変えられるよう、出力先を gain 単位で差し替える（routeGain）。
let clockHandle: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let audioRaf: number | null = null;
let lastLevelSentAt = 0;

// Web Audio エンジン状態。
let audioCtx: AudioContext | null = null;
/** 既定デバイス出力（→ ctx.destination）。 */
let masterGain: GainNode | null = null;
/** メータリング用バス（全ソースが常時ここへも分岐。destination へは無音で接続して描画を保証）。 */
let meterBus: GainNode | null = null;
let analyserL: AnalyserNode | null = null;
let analyserR: AnalyserNode | null = null;
let levelBufL: Float32Array<ArrayBuffer> | null = null;
let levelBufR: Float32Array<ArrayBuffer> | null = null;

// 出力デバイス別の終端（deviceId → MediaStreamDest + 隠し <audio>.setSinkId）。
const deviceOutputs = new Map<string, { dest: MediaStreamAudioDestinationNode; el: HTMLAudioElement }>();
/** 各 gain の現在の出力先ノード（差し替え時に disconnect する対象）。 */
const trackOutNode = new Map<string, AudioNode>();
let mainOutNode: AudioNode | null = null;

// メイン音声（Show.audio）。
let mainBuffer: AudioBuffer | null = null;
let mainGain: GainNode | null = null;
let mainSource: AudioBufferSourceNode | null = null;

// 追加トラック。クリップは filePath 単位でデコードをキャッシュ（同一ファイル共有）。
const trackGains = new Map<string, GainNode>();
const clipBuffers = new Map<string, AudioBuffer>();
const decodingFiles = new Set<string>();
let activeClipNodes: AudioBufferSourceNode[] = [];
/** 直近 reconcile したトラック定義（スケジュール・ゲイン適用に使う最新スナップショット）。 */
let currentTracks: AudioTrack[] = [];
/** メイン音声のミキサー値（追加トラックと同じ扱い。ソロ判定にも参加）。 */
let currentMainProps: { volume: number; muted: boolean; solo: boolean; outputDeviceId?: string } = {
  volume: 1,
  muted: false,
  solo: false,
};

/** 再生中フラグ（音声クロック使用時のみ true）。 */
let audioPlaying = false;
/** 再生開始時の audioCtx.currentTime（秒）。 */
let startCtxTime = 0;
/** 再生開始時のタイムライン位置（秒）。停止中の現在位置でもある。 */
let startOffsetSec = 0;

/** AudioContext を遅延生成して再利用（ブラウザの生成数制限に配慮）。 */
function ensureAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** 出力バス（masterGain）・メーターバス・メイン用 gain を生成（冪等）。 */
function ensureGraph(): void {
  const ctx = ensureAudioCtx();
  if (!masterGain) {
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
  }
  if (!meterBus) {
    meterBus = ctx.createGain();
    meterBus.gain.value = 1;
    // ステレオのメータータップ。
    const splitter = ctx.createChannelSplitter(2);
    meterBus.connect(splitter);
    analyserL = ctx.createAnalyser();
    analyserR = ctx.createAnalyser();
    analyserL.fftSize = 1024;
    analyserR.fftSize = 1024;
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    levelBufL = new Float32Array(analyserL.fftSize);
    levelBufR = new Float32Array(analyserR.fftSize);
    // メーターバスを無音(0)で destination へ繋ぎ、解析が確実にレンダリングされるようにする。
    const silent = ctx.createGain();
    silent.gain.value = 0;
    meterBus.connect(silent);
    silent.connect(ctx.destination);
  }
  if (!mainGain) {
    mainGain = ctx.createGain();
    mainGain.gain.value = 1;
    mainGain.connect(meterBus); // メーターには常時分岐（出力先は routeGain で別途）。
  }
}

/** 出力デバイス（deviceId）の終端を遅延生成。空文字は使わない（既定は masterGain）。 */
function ensureDeviceOutput(deviceId: string): { dest: MediaStreamAudioDestinationNode; el: HTMLAudioElement } {
  let out = deviceOutputs.get(deviceId);
  if (!out) {
    const ctx = ensureAudioCtx();
    const dest = ctx.createMediaStreamDestination();
    const el = new Audio();
    el.srcObject = dest.stream;
    void el.setSinkId(deviceId).catch(() => {});
    void el.play().catch(() => {});
    out = { dest, el };
    deviceOutputs.set(deviceId, out);
  }
  return out;
}

/** deviceId（空=既定）に対応する出力先ノードを返す。 */
function outputNodeFor(deviceId: string): AudioNode {
  if (!deviceId) {
    ensureGraph();
    return masterGain!;
  }
  return ensureDeviceOutput(deviceId).dest;
}

/** gain の出力先を deviceId のノードへ差し替える。前の接続のみ切り、メーター分岐は維持。 */
function routeGain(gain: GainNode, prev: AudioNode | null, deviceId: string): AudioNode {
  const next = outputNodeFor(deviceId);
  if (prev === next) return next;
  if (prev) {
    try {
      gain.disconnect(prev);
    } catch {
      // 既に切れている等は無視。
    }
  }
  gain.connect(next);
  return next;
}

/** いずれかの音声（メイン or クリップ定義）が存在するか＝音声クロックを使うか。 */
function hasAudioContent(): boolean {
  if (mainBuffer) return true;
  for (const t of currentTracks) if (t.clips.length > 0) return true;
  return false;
}

/** 現在の再生位置（ms）。再生中は AudioContext クロック、停止中はオフセット。 */
function currentPositionMs(): number {
  if (audioPlaying && audioCtx) {
    return (startOffsetSec + (audioCtx.currentTime - startCtxTime)) * 1000;
  }
  return startOffsetSec * 1000;
}

/**
 * 1 つのバッファを clipStartSec（タイムライン上の開始秒）で鳴らすソースを生成・開始する。
 * playheadSec が既にクリップ末尾を過ぎていれば生成しない（null）。
 */
function scheduleSource(
  buffer: AudioBuffer | null,
  destNode: AudioNode | null,
  clipStartSec: number,
  playheadSec: number,
): AudioBufferSourceNode | null {
  if (!buffer || !destNode) return null;
  const ctx = ensureAudioCtx();
  const endSec = clipStartSec + buffer.duration;
  if (playheadSec >= endSec) return null;
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.connect(destNode);
  let when: number;
  let offset: number;
  if (playheadSec <= clipStartSec) {
    when = startCtxTime + (clipStartSec - playheadSec);
    offset = 0;
  } else {
    when = startCtxTime;
    offset = playheadSec - clipStartSec;
  }
  if (when < ctx.currentTime) when = ctx.currentTime;
  node.start(when, offset);
  return node;
}

/** メイン + 全クリップを playheadSec 基準でスケジュールする。 */
function scheduleAll(playheadSec: number): void {
  const ctx = ensureAudioCtx();
  void ctx.resume().catch(() => {});
  ensureGraph();
  startCtxTime = ctx.currentTime;
  startOffsetSec = playheadSec;
  audioPlaying = true;
  if (mainBuffer) mainSource = scheduleSource(mainBuffer, mainGain, 0, playheadSec);
  applyTrackGains();
  // デバイス出力 <audio> は autoplay 制限で停止していることがあるため、再生開始（ユーザ操作）で再開する。
  for (const { el } of deviceOutputs.values()) void el.play().catch(() => {});
  for (const track of currentTracks) {
    const gain = trackGains.get(track.id);
    if (!gain) continue;
    for (const clip of track.clips) {
      const node = scheduleSource(clipBuffers.get(clip.filePath) ?? null, gain, clip.startMs / 1000, playheadSec);
      if (node) activeClipNodes.push(node);
    }
  }
}

/** メイン音源のみ停止・破棄。 */
function stopMainSource(): void {
  if (mainSource) {
    try {
      mainSource.onended = null;
      mainSource.stop();
    } catch {
      // 未開始ノードの stop 等は無視。
    }
    mainSource.disconnect();
    mainSource = null;
  }
}

/** 再生中の全ソース（メイン + クリップ）を停止・破棄する。 */
function stopAllSources(): void {
  audioPlaying = false;
  stopMainSource();
  for (const node of activeClipNodes) {
    try {
      node.stop();
    } catch {
      // 無視。
    }
    node.disconnect();
  }
  activeClipNodes = [];
}

/**
 * ソロ/ミュート/音量からメイン + 各トラックの実効ゲインを反映する（必要なら gain を生成）。
 * ソロはメインと追加トラックを横断して判定する（どれかソロなら非ソロは無音）。
 */
function applyTrackGains(): void {
  ensureGraph();
  const ctx = ensureAudioCtx();
  const anySolo = currentMainProps.solo || currentTracks.some((t) => t.solo);
  // メイン音声。
  if (mainGain) {
    const m = currentMainProps;
    mainGain.gain.value = m.muted || (anySolo && !m.solo) ? 0 : m.volume;
    mainOutNode = routeGain(mainGain, mainOutNode, m.outputDeviceId ?? '');
  }
  // 追加トラック。
  for (const t of currentTracks) {
    let g = trackGains.get(t.id);
    if (!g) {
      g = ctx.createGain();
      g.connect(meterBus!); // メーターには常時分岐。
      trackGains.set(t.id, g);
    }
    g.gain.value = t.muted || (anySolo && !t.solo) ? 0 : t.volume;
    trackOutNode.set(t.id, routeGain(g, trackOutNode.get(t.id) ?? null, t.outputDeviceId ?? ''));
  }
}

/** アクティブ Show のメイン音声 + トラック群へ追従（クリップのデコード + 音量反映）。 */
function reconcileShowAudio(
  tracks: AudioTrack[],
  main: { volume: number; muted: boolean; solo: boolean; outputDeviceId?: string },
): void {
  currentTracks = tracks;
  currentMainProps = main;
  const hasClips = tracks.some((t) => t.clips.length > 0);
  // グラフ未生成かつクリップも無い Show では AudioContext を作らない（無音 GO のみのとき）。
  if (hasClips || masterGain) applyTrackGains();
  if (hasClips) {
    for (const t of tracks) for (const c of t.clips) decodeClipFile(c.filePath);
  }
}

/** クリップ音源を読み込み・デコードしてキャッシュ（filePath 単位・状態を store へ反映）。 */
function decodeClipFile(filePath: string): void {
  if (clipBuffers.has(filePath) || decodingFiles.has(filePath)) return;
  decodingFiles.add(filePath);
  setFileStatus(filePath, 'loading');
  window.dmx
    .readAudioFile(filePath)
    .then((res) => {
      if (!res.ok || !res.data) {
        decodingFiles.delete(filePath);
        setFileStatus(filePath, 'missing');
        return;
      }
      ensureAudioCtx()
        .decodeAudioData(res.data)
        .then((buf) => {
          clipBuffers.set(filePath, buf);
          decodingFiles.delete(filePath);
          setFileStatus(filePath, 'ready');
        })
        .catch(() => {
          decodingFiles.delete(filePath);
          setFileStatus(filePath, 'missing');
        });
    })
    .catch(() => {
      decodingFiles.delete(filePath);
      setFileStatus(filePath, 'missing');
    });
}

function setFileStatus(filePath: string, status: 'loading' | 'ready' | 'missing'): void {
  useDmxStore.setState((s) => ({
    audioFileStatus: { ...s.audioFileStatus, [filePath]: status },
  }));
}

/** analyser からステレオの peak/RMS（0..1）を読み出し main へ送る（モニターへ中継）。 */
function emitLevels(): void {
  if (!analyserL || !analyserR || !levelBufL || !levelBufR) return;
  const l = readLevel(analyserL, levelBufL);
  const r = readLevel(analyserR, levelBufR);
  window.dmx.reportAudioLevels({ peakL: l.peak, peakR: r.peak, rmsL: l.rms, rmsR: r.rms });
}

function readLevel(analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): { peak: number; rms: number } {
  analyser.getFloatTimeDomainData(buf);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sum += v * v;
  }
  return { peak, rms: Math.sqrt(sum / buf.length) };
}

function sendZeroLevels(): void {
  window.dmx.reportAudioLevels({ peakL: 0, peakR: 0, rmsL: 0, rmsR: 0 });
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
    if (!audioPlaying) {
      audioRaf = null;
      return;
    }
    // 視覚更新は rAF ペースだが、位置の真値は AudioContext クロック由来。
    useDmxStore.getState().reportPlayhead(currentPositionMs());
    const now = performance.now();
    if (now - lastLevelSentAt >= 33) {
      lastLevelSentAt = now;
      emitLevels();
    }
    audioRaf = audioPlaying ? requestAnimationFrame(tick) : null;
  };
  audioRaf = requestAnimationFrame(tick);
}

function stopAudioRaf(): void {
  if (audioRaf !== null) {
    cancelAnimationFrame(audioRaf);
    audioRaf = null;
  }
}
