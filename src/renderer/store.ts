/**
 * renderer 側 UI 状態（Zustand）。
 *
 * エンジンが「単一の真実」なので、ここは UI ミラー:
 *   - faders: フェーダー位置（楽観的に即時反映 + エンジンへ送信）
 *   - busking: SHOW モードのライブ上書き中 ch（purple ハイライト。エンジン由来＋楽観更新）
 *   - output: エンジンの実出力（可視化用）
 *   - project: Show/マスター列/Action 構造（編集対象、エンジンから受信）
 *   - playback / editingActionId: 再生・Action 編集選択の状態（エンジンから受信）
 *   - transport: Timeline の内部タイムコード（renderer が回す）
 */

import { create } from 'zustand';
import { cueAt } from '../engine/playback';
import type {
  DirtyState,
  EngineStateSnapshot,
  MissingFile,
  OpenDmxStatus,
  PlaybackStatus,
  ShowFilePayload,
} from '../shared/ipc';
import {
  defaultArtnetSettings,
  defaultOpenDmxSettings,
  UNIVERSE_SIZE,
  type ArtnetSettings,
  type AudioTrack,
  type EngineMode,
  type OpenDmxSettings,
  type Project,
} from '../shared/types';

interface TransportState {
  playing: boolean;
  playheadMs: number;
  durationMs: number;
}

/** 左パネルの Show/フォルダ並び順（表示専用・非永続）。 */
export type ShowSort = 'manual' | 'name-asc' | 'name-desc';

/** パネル開閉状態（Action / フェーダー）。true=折りたたみ。 */
interface PanelCollapse {
  actions: boolean;
  faders: boolean;
}
/** EDIT / SHOW モード別のパネル開閉状態（Show 読込時に使用）。 */
export interface PanelCollapsePrefs {
  edit: PanelCollapse;
  show: PanelCollapse;
}

const PANEL_COLLAPSE_KEY = 'dmx.panelCollapse';

/** 既定: EDIT は Action 折りたたみ、SHOW はフェーダー折りたたみ。 */
function defaultPanelCollapse(): PanelCollapsePrefs {
  return {
    edit: { actions: true, faders: false },
    show: { actions: false, faders: true },
  };
}

/** localStorage から復元（壊れていれば既定）。 */
function loadPanelCollapse(): PanelCollapsePrefs {
  const def = defaultPanelCollapse();
  try {
    const raw = localStorage.getItem(PANEL_COLLAPSE_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<PanelCollapsePrefs>;
    const pick = (m: PanelCollapse | undefined, d: PanelCollapse): PanelCollapse => ({
      actions: typeof m?.actions === 'boolean' ? m.actions : d.actions,
      faders: typeof m?.faders === 'boolean' ? m.faders : d.faders,
    });
    return { edit: pick(p.edit, def.edit), show: pick(p.show, def.show) };
  } catch {
    return def;
  }
}

function savePanelCollapse(prefs: PanelCollapsePrefs): void {
  try {
    localStorage.setItem(PANEL_COLLAPSE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 不可時は無視（永続化のみスキップ）。
  }
}

/**
 * パネル開閉トグルの反映。Show 読込中は現モード（EDIT/SHOW）の状態として
 * panelCollapse に保存し localStorage へ永続化する。未読込時は live のみ更新。
 */
function persistPanelToggle(
  s: DmxState,
  patch: { actionsCollapsed?: boolean; fadersCollapsed?: boolean },
): Partial<DmxState> {
  const actionsCollapsed = patch.actionsCollapsed ?? s.actionsCollapsed;
  const fadersCollapsed = patch.fadersCollapsed ?? s.fadersCollapsed;
  if (s.activeShowId === null) return { actionsCollapsed, fadersCollapsed };
  const panelCollapse: PanelCollapsePrefs = {
    ...s.panelCollapse,
    [s.mode]: { actions: actionsCollapsed, faders: fadersCollapsed },
  };
  savePanelCollapse(panelCollapse);
  return { actionsCollapsed, fadersCollapsed, panelCollapse };
}

/**
 * 可変レイアウトの寸法（ソフト本体＝localStorage に永続化）。
 * 比率は「その領域を分け合う 2 パネルのうち先頭側の取り分」を表す（0-1）。
 */
export interface PanelLayout {
  /** 左サイドバー幅（px）。 */
  sidebarWidth: number;
  /** 中央（CUE/Timeline・Action 大）と フェーダーバンク の縦分割比。 */
  centerRatio: number;
  /** セットリスト表示時の 左(セットリスト) と 右(CUE/Timeline) の横分割比。 */
  setlistRatio: number;
  /** 出力モニターのバー高さ（px）。 */
  meterHeight: number;
}

const PANEL_LAYOUT_KEY = 'dmx.panelLayout';

/** 既定の寸法（従来の固定レイアウト相当: w-60 / flex-2:flex-3 / 半々 / h-16）。 */
export const DEFAULT_PANEL_LAYOUT: PanelLayout = {
  sidebarWidth: 240,
  centerRatio: 0.4,
  setlistRatio: 0.5,
  meterHeight: 64,
};

/** 各寸法の下限・上限（潰れて操作不能になるのを防ぐ）。 */
const PANEL_LAYOUT_RANGE: Record<keyof PanelLayout, [number, number]> = {
  sidebarWidth: [160, 640],
  centerRatio: [0.15, 0.85],
  setlistRatio: [0.2, 0.8],
  meterHeight: [32, 320],
};

function clampLayoutValue(key: keyof PanelLayout, value: number): number {
  const [min, max] = PANEL_LAYOUT_RANGE[key];
  if (!Number.isFinite(value)) return DEFAULT_PANEL_LAYOUT[key];
  return Math.min(max, Math.max(min, value));
}

/** localStorage から復元（壊れていれば既定）。 */
function loadPanelLayout(): PanelLayout {
  const def = { ...DEFAULT_PANEL_LAYOUT };
  try {
    const raw = localStorage.getItem(PANEL_LAYOUT_KEY);
    if (!raw) return def;
    const p = JSON.parse(raw) as Partial<PanelLayout>;
    for (const key of Object.keys(def) as (keyof PanelLayout)[]) {
      const v = p[key];
      if (typeof v === 'number') def[key] = clampLayoutValue(key, v);
    }
    return def;
  } catch {
    return def;
  }
}

function savePanelLayout(layout: PanelLayout): void {
  try {
    localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    // localStorage 不可時は無視（永続化のみスキップ）。
  }
}

interface DmxState {
  faders: number[];
  output: number[];
  busking: boolean[];
  artnet: ArtnetSettings;
  /** OpenDMX(USB-DMX) 出力設定。 */
  openDmx: OpenDmxSettings;
  /** OpenDMX の接続状態（main の Driver 由来・読み取り専用）。 */
  openDmxStatus: OpenDmxStatus;
  measuredHz: number;
  bank: number;
  /** フェーダーバンクを折りたたんでいるか（UI のみ）。 */
  fadersCollapsed: boolean;
  /** Action パネルを折りたたんでいるか（UI のみ）。 */
  actionsCollapsed: boolean;
  /**
   * Show 読込時の EDIT / SHOW 別パネル開閉状態（ソフト本体＝localStorage に永続化）。
   * モード切替・再起動時にこの値から復元する。Show 未読込時は使わない。
   */
  panelCollapse: PanelCollapsePrefs;
  /** Action フェードボタンの取り込み時間（ms・UI のみ）。 */
  actionFadeMs: number;
  /** 左サイド（Project/Show ツリー）を折りたたんでいるか（UI のみ）。 */
  sidebarCollapsed: boolean;
  /** 可変レイアウトの寸法（スプリッタで変更・localStorage へ永続化）。 */
  panelLayout: PanelLayout;
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
  /** 読込中（アクティブ）のセットリスト id（未読込は null・非永続）。読込中は中央パネルを切替。 */
  activeSetlistId: string | null;
  /** サイドバーで選択中のセットリスト id（編集フォーカス・非永続）。 */
  selectedSetlistId: string | null;
  /** アクティブセットリストの現在エントリ index（未開始は -1・非永続）。 */
  setlistIndex: number;
  /** マスター GO で loadShow 済みだが音声準備待ちの showId（準備完了で再生開始・非永続）。 */
  pendingPlayShowId: string | null;
  /** EDIT モードで編集対象に選択中の Action id（未選択は null）。フェーダーがこの look を編集。 */
  editingActionId: string | null;
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
  setOpenDmx: (settings: OpenDmxSettings) => void;
  setBank: (bank: number) => void;
  /** フェーダーバンクの折りたたみを切り替える（Show 読込時は現モードへ永続化）。 */
  toggleFadersCollapsed: () => void;
  /** Action パネルの折りたたみを切り替える（Show 読込時は現モードへ永続化）。 */
  toggleActionsCollapsed: () => void;
  /**
   * 現在の文脈（Show 読込有無・モード）に応じてパネル開閉状態を反映する。
   * Show 読込中は永続化済みの EDIT/SHOW 別状態から、未読込時は大表示レイアウトへ。
   */
  applyPanelLayoutForContext: () => void;
  /** Action フェード取り込み時間（ms）を設定する。 */
  setActionFadeMs: (ms: number) => void;
  /** 左サイドバーの折りたたみを切り替える。 */
  toggleSidebarCollapsed: () => void;
  /** 可変レイアウトの寸法を部分更新する（範囲内へ丸めて永続化）。 */
  setPanelLayout: (patch: Partial<PanelLayout>) => void;
  /** 指定した寸法（省略時は全て）を既定へ戻す。 */
  resetPanelLayout: (key?: keyof PanelLayout) => void;
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
  /** サイドバーでセットリストを選択する（編集フォーカス）。 */
  selectSetlist: (setlistId: string | null) => void;
  /** セットリストを読込む（中央パネルをセットリスト表示へ切替・頭出し前）。 */
  loadSetlist: (setlistId: string) => void;
  /** セットリストを解放する（子 Show もアンロードし中央を戻す）。 */
  unloadSetlist: () => void;
  /** マスター GO: 次のエントリの Show をロードし、その Timeline を頭から再生する。末尾は no-op。 */
  setlistGo: () => void;
  /** 任意エントリへジャンプして再生（行クリック）。 */
  setlistGoTo: (index: number) => void;
  /** 頭出し前（未開始）へ戻す。読込は維持。 */
  setlistReset: () => void;
  /** オペレーター GO：セットリスト読込中は次エントリへ、それ以外は CUE を進める。 */
  operatorGo: () => void;
  /** オペレーター BACK：セットリスト読込中は前エントリへ、それ以外は CUE を戻す。 */
  operatorBack: () => void;
  /**
   * Action を適用する（キーボード/リモート/UI 共通）。
   * SHOW × Show 読込中は発火（actionDown）、それ以外は programmer へ取り込み（captureAction）。
   */
  applyAction: (actionId: string, fadeMs: number) => void;
  /** マスター GO 後、対象 Show の音声準備が整ったら Timeline を頭から再生する（私用・冪等）。 */
  resolvePendingPlay: () => void;
  /**
   * 指定 Show のメイン音声を先読み（ファイル読込 + デコード）してキャッシュする。
   * セットリストで次に GO される Show を事前に用意し、GO 時のロード待ち（先頭の欠落）を無くす。
   * 既にキャッシュ済み/先読み中なら何もしない（冪等・非再生）。
   */
  prefetchShowAudio: (showId: string) => void;
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
  loadAudio: (url: string, arrayBuffer: ArrayBuffer, filePath?: string | null) => void;
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
  openDmx: defaultOpenDmxSettings(),
  openDmxStatus: { state: 'disabled', portPath: null, measuredHz: 0 },
  measuredHz: 0,
  bank: 0,
  fadersCollapsed: false,
  actionsCollapsed: false,
  panelCollapse: loadPanelCollapse(),
  actionFadeMs: 2000,
  sidebarCollapsed: false,
  panelLayout: loadPanelLayout(),
  prefsOpen: false,
  showImport: null,
  missingFiles: null,
  showSort: 'name-asc',

  audioFileStatus: {},

  project: null,
  playback: null,
  activeShowId: null,
  selectedShowId: null,
  activeSetlistId: null,
  selectedSetlistId: null,
  setlistIndex: -1,
  pendingPlayShowId: null,
  editingActionId: null,
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

  setOpenDmx: (settings) =>
    set(() => {
      window.dmx.updateOpenDmxSettings(settings);
      return { openDmx: settings };
    }),

  setBank: (bank) => set({ bank }),

  toggleFadersCollapsed: () =>
    set((s) => persistPanelToggle(s, { fadersCollapsed: !s.fadersCollapsed })),

  toggleActionsCollapsed: () =>
    set((s) => persistPanelToggle(s, { actionsCollapsed: !s.actionsCollapsed })),

  applyPanelLayoutForContext: () =>
    set((s) => {
      // Show 未読込: Action 大表示・フェーダー表示（永続化対象外）。
      if (s.activeShowId === null) return { actionsCollapsed: false, fadersCollapsed: false };
      const pref = s.panelCollapse[s.mode];
      return { actionsCollapsed: pref.actions, fadersCollapsed: pref.faders };
    }),

  setActionFadeMs: (ms) => set({ actionFadeMs: Math.max(0, Math.round(ms)) }),

  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setPanelLayout: (patch) =>
    set((s) => {
      const next = { ...s.panelLayout };
      for (const [key, value] of Object.entries(patch) as [keyof PanelLayout, number][]) {
        if (typeof value === 'number') next[key] = clampLayoutValue(key, value);
      }
      savePanelLayout(next);
      return { panelLayout: next };
    }),

  resetPanelLayout: (key) =>
    set((s) => {
      const next = key
        ? { ...s.panelLayout, [key]: DEFAULT_PANEL_LAYOUT[key] }
        : { ...DEFAULT_PANEL_LAYOUT };
      savePanelLayout(next);
      return { panelLayout: next };
    }),

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
      // EDIT × Action 編集中は、フェーダー表示の真実は編集中 Action の look（step0）。
      const editingAction =
        s.mode === 'edit' && s.editingActionId
          ? (project.actions.find((a) => a.id === s.editingActionId) ?? null)
          : null;
      const editValues = editingAction?.steps[0]?.values ?? null;
      const faders = editValues
        ? fadersFromCue(editValues, s.faders, s.busking)
        : selectedCue
          ? fadersFromCue(selectedCue.values, s.faders, s.busking)
          : project.faders.slice();

      // アクティブ/選択中のセットリストが削除された（or 別 Project 読込）なら選択を落とす。
      const activeSetlistExists = project.setlists?.some((sl) => sl.id === s.activeSetlistId) ?? false;
      const selectedSetlistExists =
        project.setlists?.some((sl) => sl.id === s.selectedSetlistId) ?? false;

      return {
        project,
        faders,
        selectedShowId,
        selectedSetlistId: selectedSetlistExists ? s.selectedSetlistId : null,
        ...(s.activeSetlistId && !activeSetlistExists
          ? { activeSetlistId: null, setlistIndex: -1, pendingPlayShowId: null }
          : null),
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
      // 出力設定は Project ではなくアプリ設定の持ち物。engine state が唯一の反映経路。
      artnet: state.artnet,
      openDmx: state.openDmx,
      openDmxStatus: state.openDmxStatus,
      playback: state.playback,
      activeShowId: state.activeShowId,
      editingActionId: state.editingActionId,
      busking: state.busking,
      mode: state.mode,
      masterLevel: state.masterLevel,
      blackout: state.blackout,
      canUndo: state.canUndo,
      canRedo: state.canRedo,
    });
    // アクティブ Show が変わったら追加トラック音源を切り替える。
    if (prevShowId !== state.activeShowId) get().syncShowAudio();
    // マスター GO の遅延再生: 対象 Show がアクティブになり、かつメイン音声が
    // 変わらない（= 非同期デコード待ちが起きない）なら即座に再生開始する。
    // 音声が変わる場合は loadAudio / unloadAudio の完了で resolvePendingPlay が呼ばれる。
    const s = get();
    if (s.pendingPlayShowId && s.pendingPlayShowId === state.activeShowId) {
      const prevPath =
        s.project?.shows.find((sh) => sh.id === prevShowId)?.audio?.filePath ?? null;
      const newPath =
        s.project?.shows.find((sh) => sh.id === state.activeShowId)?.audio?.filePath ?? null;
      if (newPath === prevPath) get().resolvePendingPlay();
    }
  },

  selectShow: (showId) => set({ selectedShowId: showId }),

  selectSetlist: (setlistId) => set({ selectedSetlistId: setlistId }),

  loadSetlist: (setlistId) => {
    const s = get();
    if (s.activeShowId) window.dmx.unloadShow();
    s.transportStop();
    set({ activeSetlistId: setlistId, setlistIndex: -1, pendingPlayShowId: null });
    // 最初の GO 対象（先頭エントリ）を先読みし、1 回目の GO も即時再生にする。
    const setlist = s.project?.setlists?.find((sl) => sl.id === setlistId);
    const first = setlist?.entries[0];
    if (first) get().prefetchShowAudio(first.showId);
  },

  unloadSetlist: () => {
    const s = get();
    if (s.activeShowId) window.dmx.unloadShow();
    s.transportStop();
    set({ activeSetlistId: null, setlistIndex: -1, pendingPlayShowId: null });
  },

  setlistGo: () => {
    const s = get();
    const setlist = s.project?.setlists?.find((sl) => sl.id === s.activeSetlistId);
    if (!setlist) return;
    const next = s.setlistIndex + 1;
    if (next >= setlist.entries.length) return; // 末尾は no-op（手動のみ・ループなし）
    get().setlistGoTo(next);
  },

  setlistGoTo: (index) => {
    const s = get();
    const setlist = s.project?.setlists?.find((sl) => sl.id === s.activeSetlistId);
    if (!setlist) return;
    if (index < 0 || index >= setlist.entries.length) return;
    const showId = setlist.entries[index].showId;
    if (s.mode !== 'show') s.setMode('show'); // 本番再生として SHOW モードへ
    window.dmx.loadShow(showId); // エンジンでアクティブ化（setEngineState で戻る）
    s.transportStop(); // playhead 0・跨ぎ基準リセット
    set({ setlistIndex: index, pendingPlayShowId: showId });
    // 次のエントリを先読みして、続く GO を（デコード待ちなく）即時再生にする。
    const nextEntry = setlist.entries[index + 1];
    if (nextEntry) get().prefetchShowAudio(nextEntry.showId);
  },

  setlistReset: () => {
    get().transportStop();
    set({ setlistIndex: -1, pendingPlayShowId: null });
  },

  operatorGo: () => {
    const s = get();
    if (s.activeSetlistId) s.setlistGo();
    else window.dmx.go();
  },

  operatorBack: () => {
    const s = get();
    if (s.activeSetlistId) s.setlistGoTo(s.setlistIndex - 1);
    else window.dmx.goBack();
  },

  applyAction: (actionId, fadeMs) => {
    const s = get();
    // SHOW × Show 読込時のみ発火、ほかは programmer（フェーダー）へキャプチャ（ActionCard と同じ）。
    const triggerMode = s.mode === 'show' && s.activeShowId !== null;
    if (triggerMode) window.dmx.actionDown(actionId, fadeMs);
    else window.dmx.captureAction(actionId, fadeMs);
  },

  resolvePendingPlay: () => {
    const s = get();
    if (!s.pendingPlayShowId || s.pendingPlayShowId !== s.activeShowId) return;
    set({ pendingPlayShowId: null });
    s.transportSeek(0);
    s.transportPlay();
  },

  prefetchShowAudio: (showId) => {
    const s = get();
    const show = s.project?.shows.find((sh) => sh.id === showId);
    const fp = show?.audio?.filePath;
    if (!fp) return; // 音声なしの Show は先読み不要（無音 GO）。
    if (mainBufferCache.has(fp) || prefetchingFiles.has(fp)) return; // 済み/進行中。
    prefetchingFiles.add(fp);
    window.dmx
      .readAudioFile(fp)
      .then((res) => {
        if (!res.ok || !res.data) {
          prefetchingFiles.delete(fp);
          return; // 欠損は GO 時の通常経路（再リンク）に委ねる。
        }
        ensureAudioCtx()
          .decodeAudioData(res.data)
          .then((buf) => {
            prefetchingFiles.delete(fp);
            cacheMainBuffer(fp, buf);
          })
          .catch(() => prefetchingFiles.delete(fp));
      })
      .catch(() => prefetchingFiles.delete(fp));
  },

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

  loadAudio: (_url, arrayBuffer, filePath) => {
    console.debug('[loadAudio] called');
    // 既存メイン音源だけ破棄（クリップ・クロックは触らない）。
    stopMainSource();
    // 先読み済みならデコードを待たず即座に再生できる（セットリスト GO の先頭欠落を防ぐ）。
    const cached = filePath ? mainBufferCache.get(filePath) : undefined;
    if (cached) {
      console.debug('[loadAudio] cache hit durationMs=', Math.round(cached.duration * 1000));
      mainBuffer = cached;
      cacheMainBuffer(filePath!, cached); // recency 更新 & live として保護
      ensureGraph(); // グラフ（既定バス + メイン gain）を用意。デコードは不要。
      applyTrackGains();
      const ms = Math.round(cached.duration * 1000);
      if (Number.isFinite(ms) && ms > 0) {
        set((s) => ({
          audioDurationMs: ms,
          transport: { ...s.transport, durationMs: Math.max(s.transport.durationMs, ms) },
        }));
      }
      // 再生中に差し替わった場合は現在位置から鳴らし直す。
      if (audioPlaying && mainGainEntry) {
        const bus = ensureBus(mainGainEntry.deviceId);
        mainSource = scheduleSource(cached, bus, mainGainEntry.gain, 0, currentPositionMs() / 1000);
      }
      // マスター GO の遅延再生: 音声が整っているので即再生開始。
      get().resolvePendingPlay();
      return;
    }
    mainBuffer = null;
    // ファイルを一度だけ PCM デコードし、メインの時間軸・再生源にする。
    // （<audio>.currentTime は VBR 等で非線形・不正確になるため使わない。）
    const ctx = ensureAudioCtx();
    ensureGraph();
    // 生成直後の gain に現在のメインミキサー値（音量/ミュート/ソロ）を反映する。
    applyTrackGains();
    console.debug('[loadAudio] start decode bytes=', arrayBuffer.byteLength, 'ctxState=', ctx.state);
    void ctx.decodeAudioData(arrayBuffer).then((buf) => {
      console.debug('[loadAudio] decode ok durationMs=', Math.round(buf.duration * 1000));
      mainBuffer = buf;
      if (filePath) cacheMainBuffer(filePath, buf);
      const ms = Math.round(buf.duration * 1000);
      if (Number.isFinite(ms) && ms > 0) {
        // 音声長を保持し、再生上限へ反映（以後の setProject でも維持される）。
        set((s) => ({
          audioDurationMs: ms,
          transport: { ...s.transport, durationMs: Math.max(s.transport.durationMs, ms) },
        }));
      }
      // 再生中にメインを後から読み込んだ場合は、現在位置から鳴らし始める。
      if (audioPlaying && mainGainEntry) {
        const bus = ensureBus(mainGainEntry.deviceId);
        mainSource = scheduleSource(mainBuffer, bus, mainGainEntry.gain, 0, currentPositionMs() / 1000);
      }
      // マスター GO の遅延再生: 新 Show のメイン音声デコードが整ったので再生開始。
      get().resolvePendingPlay();
    }).catch((e) => {
      console.error('[loadAudio] decode FAILED', e);
    });
  },

  unloadAudio: () => {
    console.debug('[unloadAudio] called');
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
    // マスター GO の遅延再生: メイン音声なしの Show はここで再生開始（クロック駆動）。
    get().resolvePendingPlay();
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
// 出力デバイスごとに独立した AudioContext（OutputBus）を持ち、AudioContext.setSinkId で
// デバイスへ直結する。MediaStream 経由（MediaStreamAudioDestinationNode + <audio>.setSinkId）
// だと、ストリームが既定デバイスのサンプルレートで固定され、ネイティブレートの異なる
// デバイスへ流したとき再生速度・ピッチがずれるため、これを避ける。
// 既定デバイス（deviceId=''）のバスがクロック源（audioCtx）。デコード済みバッファは
// 各 context で共有でき、ソースノードが各 context のレートへ自動リサンプリングする。
//
// グラフ（各バス内）: 各ソース → trackGain/mainGain ─┬─► meterBus → splitter → analyserL/R（解析のみ）
//                                                     └─► masterGain → ctx.destination
// メーターは全バスの analyser を合成（peak/rms は最大）してマスターメーターに反映する。
let clockHandle: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let audioRaf: number | null = null;
let lastLevelSentAt = 0;

// Web Audio エンジン状態。
/** 出力デバイス1つ分の AudioContext とメーター系。 */
interface OutputBus {
  deviceId: string; // '' = OS 既定。
  ctx: AudioContext;
  masterGain: GainNode; // → ctx.destination（このデバイスへの可聴出力）。
  meterBus: GainNode; // → splitter → analyserL/R（解析のみ。無音で destination へも接続）。
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
  bufL: Float32Array<ArrayBuffer>;
  bufR: Float32Array<ArrayBuffer>;
  /** 再生開始時の ctx.currentTime（秒）。このバス上のスケジュール基準。 */
  startCtxTime: number;
}

/** deviceId → OutputBus（'' は既定＝クロック源）。 */
const buses = new Map<string, OutputBus>();

// メイン音声（Show.audio）。
let mainBuffer: AudioBuffer | null = null;
/** メイン用 gain と現在の出力デバイス（どのバスにいるかの判定用）。 */
let mainGainEntry: { gain: GainNode; deviceId: string } | null = null;
let mainSource: AudioBufferSourceNode | null = null;

// メイン音声のデコード済みバッファを filePath 単位でキャッシュ（セットリスト先読み用）。
// AudioBuffer は 1 曲で数十 MB になり得るため、直近数件だけ保持する（LRU 風）。
const MAIN_BUFFER_CACHE_MAX = 3;
const mainBufferCache = new Map<string, AudioBuffer>();
/** 先読みデコード進行中の filePath（二重デコード防止）。 */
const prefetchingFiles = new Set<string>();

/**
 * デコード済みメインバッファをキャッシュへ入れ、上限超過分を古い順に破棄する。
 * 再挿入で recency を更新し、現在再生中（mainBuffer）のファイルは破棄しない。
 */
function cacheMainBuffer(filePath: string, buf: AudioBuffer): void {
  mainBufferCache.delete(filePath); // 末尾（最新）へ入れ直す。
  mainBufferCache.set(filePath, buf);
  while (mainBufferCache.size > MAIN_BUFFER_CACHE_MAX) {
    let removed = false;
    for (const [fp, b] of mainBufferCache) {
      if (b === mainBuffer) continue; // 再生中のバッファは残す。
      mainBufferCache.delete(fp);
      removed = true;
      break;
    }
    if (!removed) break; // 残りが全て再生中バッファなら打ち切り。
  }
}

// 追加トラック。クリップは filePath 単位でデコードをキャッシュ（同一ファイル共有）。
/** trackId → gain と現在の出力デバイス。 */
const trackGainEntries = new Map<string, { gain: GainNode; deviceId: string }>();
const clipBuffers = new Map<string, AudioBuffer>();
const decodingFiles = new Set<string>();
/** trackId → 再生中のクリップソース（デバイス変更時の張り替えに使う）。 */
const activeClipNodes = new Map<string, AudioBufferSourceNode[]>();
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
/** 再生開始時のタイムライン位置（秒）。停止中の現在位置でもある。 */
let startOffsetSec = 0;

/** deviceId のバス（AudioContext + メーター系）を遅延生成。'' は既定＝クロック源。 */
function ensureBus(deviceId: string): OutputBus {
  const existing = buses.get(deviceId);
  if (existing) return existing;
  const ctx = new AudioContext();
  // 既定以外はデバイスへ直結（MediaStream 経由のレート不整合＝速度ズレを避ける要）。
  if (deviceId !== '') {
    const sinkable = ctx as unknown as { setSinkId?: (id: string) => Promise<void> };
    void sinkable.setSinkId?.(deviceId).catch(() => {});
  }
  const masterGain = ctx.createGain();
  masterGain.gain.value = 1;
  masterGain.connect(ctx.destination);

  // メーターバス。無音(0)で destination へも繋ぎ、解析が確実にレンダリングされるようにする。
  const meterBus = ctx.createGain();
  meterBus.gain.value = 1;
  const splitter = ctx.createChannelSplitter(2);
  meterBus.connect(splitter);
  const analyserL = ctx.createAnalyser();
  const analyserR = ctx.createAnalyser();
  analyserL.fftSize = 1024;
  analyserR.fftSize = 1024;
  splitter.connect(analyserL, 0);
  splitter.connect(analyserR, 1);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  meterBus.connect(silent);
  silent.connect(ctx.destination);

  const bus: OutputBus = {
    deviceId,
    ctx,
    masterGain,
    meterBus,
    analyserL,
    analyserR,
    bufL: new Float32Array(analyserL.fftSize),
    bufR: new Float32Array(analyserR.fftSize),
    startCtxTime: 0,
  };
  buses.set(deviceId, bus);
  // 再生中に作られたバス（デバイス変更等）はクロック基準を現在位置へ揃える。
  if (audioPlaying) {
    void ctx.resume().catch(() => {});
    bus.startCtxTime = ctx.currentTime - (currentPositionMs() / 1000 - startOffsetSec);
  }
  return bus;
}

/** 既定バスの AudioContext（クロック源）を遅延生成。 */
function ensureAudioCtx(): AudioContext {
  return ensureBus('').ctx;
}

/** 既定バス + メイン用 gain を生成（冪等）。 */
function ensureGraph(): void {
  ensureBus('');
  if (!mainGainEntry) mainGainEntry = gainForDevice(null, '');
}

/**
 * deviceId のバス上に gain を用意する。current が別デバイスなら作り直す（古い gain は切断）。
 * gain は「メーターバス」と「masterGain（可聴出力）」の双方へ接続する。
 */
function gainForDevice(
  current: { gain: GainNode; deviceId: string } | null,
  deviceId: string,
): { gain: GainNode; deviceId: string } {
  if (current && current.deviceId === deviceId) return current;
  const bus = ensureBus(deviceId);
  const gain = bus.ctx.createGain();
  gain.connect(bus.meterBus); // メーターへ常時分岐（無音タップ経由でレンダリング）。
  gain.connect(bus.masterGain); // 当該デバイスへの可聴出力。
  if (current) {
    try {
      current.gain.disconnect();
    } catch {
      // 既に切れている等は無視。
    }
  }
  return { gain, deviceId };
}

/** いずれかの音声（メイン or クリップ定義）が存在するか＝音声クロックを使うか。 */
function hasAudioContent(): boolean {
  if (mainBuffer) return true;
  for (const t of currentTracks) if (t.clips.length > 0) return true;
  return false;
}

/** 現在の再生位置（ms）。再生中は既定バスの AudioContext クロック、停止中はオフセット。 */
function currentPositionMs(): number {
  const def = buses.get('');
  if (audioPlaying && def) {
    return (startOffsetSec + (def.ctx.currentTime - def.startCtxTime)) * 1000;
  }
  return startOffsetSec * 1000;
}

/**
 * 1 つのバッファを clipStartSec（タイムライン上の開始秒）で、指定バス上の gain へ鳴らす
 * ソースを生成・開始する。playheadSec が既にクリップ末尾を過ぎていれば生成しない（null）。
 * when はそのバス自身のクロック（bus.startCtxTime）基準で算出する。
 */
function scheduleSource(
  buffer: AudioBuffer | null,
  bus: OutputBus,
  gain: GainNode,
  clipStartSec: number,
  playheadSec: number,
): AudioBufferSourceNode | null {
  if (!buffer) return null;
  const endSec = clipStartSec + buffer.duration;
  if (playheadSec >= endSec) return null;
  const node = bus.ctx.createBufferSource();
  node.buffer = buffer;
  node.connect(gain);
  let when: number;
  let offset: number;
  if (playheadSec <= clipStartSec) {
    when = bus.startCtxTime + (clipStartSec - playheadSec);
    offset = 0;
  } else {
    when = bus.startCtxTime;
    offset = playheadSec - clipStartSec;
  }
  if (when < bus.ctx.currentTime) when = bus.ctx.currentTime;
  node.start(when, offset);
  return node;
}

/** メイン + 全クリップを playheadSec 基準でスケジュールする。 */
function scheduleAll(playheadSec: number): void {
  ensureGraph();
  startOffsetSec = playheadSec;
  // 先に gain（＝各トラックの所属バス）を確定させる。audioPlaying はまだ false にしておき、
  // applyTrackGains 内の「デバイス変更による張り替え」が初回スケジュールと二重に走らないようにする。
  applyTrackGains();
  audioPlaying = true;
  // 全バスのクロック基準を揃える。
  for (const bus of buses.values()) {
    void bus.ctx.resume().catch(() => {});
    bus.startCtxTime = bus.ctx.currentTime;
  }
  if (mainBuffer && mainGainEntry) {
    const bus = ensureBus(mainGainEntry.deviceId);
    mainSource = scheduleSource(mainBuffer, bus, mainGainEntry.gain, 0, playheadSec);
  }
  for (const track of currentTracks) {
    const entry = trackGainEntries.get(track.id);
    if (!entry) continue;
    const bus = ensureBus(entry.deviceId);
    const nodes: AudioBufferSourceNode[] = [];
    for (const clip of track.clips) {
      const node = scheduleSource(clipBuffers.get(clip.filePath) ?? null, bus, entry.gain, clip.startMs / 1000, playheadSec);
      if (node) nodes.push(node);
    }
    if (nodes.length > 0) activeClipNodes.set(track.id, nodes);
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
  for (const nodes of activeClipNodes.values()) {
    for (const node of nodes) {
      try {
        node.stop();
      } catch {
        // 無視。
      }
      node.disconnect();
    }
  }
  activeClipNodes.clear();
}

/**
 * ソロ/ミュート/音量からメイン + 各トラックの実効ゲインを反映する（必要なら gain を生成）。
 * ソロはメインと追加トラックを横断して判定する（どれかソロなら非ソロは無音）。
 */
function applyTrackGains(): void {
  ensureGraph();
  const anySolo = currentMainProps.solo || currentTracks.some((t) => t.solo);

  // メイン音声。出力デバイスが変わっていたら gain を別バスへ作り直す。
  const m = currentMainProps;
  const mainDev = m.outputDeviceId ?? '';
  const mainPrev = mainGainEntry;
  mainGainEntry = gainForDevice(mainGainEntry, mainDev);
  mainGainEntry.gain.gain.value = m.muted || (anySolo && !m.solo) ? 0 : m.volume;
  // 再生中にデバイスが変わったメインは、現在位置から新バスへ張り替える。
  if (mainPrev && mainPrev.deviceId !== mainDev && audioPlaying && mainBuffer) {
    stopMainSource();
    const bus = ensureBus(mainDev);
    mainSource = scheduleSource(mainBuffer, bus, mainGainEntry.gain, 0, currentPositionMs() / 1000);
  }

  // 追加トラック。
  for (const t of currentTracks) {
    const dev = t.outputDeviceId ?? '';
    const prev = trackGainEntries.get(t.id) ?? null;
    const entry = gainForDevice(prev, dev);
    entry.gain.gain.value = t.muted || (anySolo && !t.solo) ? 0 : t.volume;
    trackGainEntries.set(t.id, entry);
    // 再生中にデバイスが変わったトラックは、現在位置から新バスへ張り替える。
    if (prev && prev.deviceId !== dev && audioPlaying) rescheduleTrack(t, entry);
  }
}

/** 1 トラックのクリップ群を、現在位置から entry のバスへ張り替える（デバイス変更時）。 */
function rescheduleTrack(track: AudioTrack, entry: { gain: GainNode; deviceId: string }): void {
  const old = activeClipNodes.get(track.id);
  if (old) {
    for (const n of old) {
      try {
        n.stop();
      } catch {
        // 無視。
      }
      n.disconnect();
    }
  }
  const bus = ensureBus(entry.deviceId);
  const playhead = currentPositionMs() / 1000;
  const nodes: AudioBufferSourceNode[] = [];
  for (const clip of track.clips) {
    const node = scheduleSource(clipBuffers.get(clip.filePath) ?? null, bus, entry.gain, clip.startMs / 1000, playhead);
    if (node) nodes.push(node);
  }
  activeClipNodes.set(track.id, nodes);
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
  if (hasClips || buses.size > 0) applyTrackGains();
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
  // 全バス（出力デバイス別）の analyser を合成してマスターメーターへ反映（peak/rms は最大）。
  let peakL = 0;
  let peakR = 0;
  let rmsL = 0;
  let rmsR = 0;
  for (const bus of buses.values()) {
    const l = readLevel(bus.analyserL, bus.bufL);
    const r = readLevel(bus.analyserR, bus.bufR);
    if (l.peak > peakL) peakL = l.peak;
    if (r.peak > peakR) peakR = r.peak;
    if (l.rms > rmsL) rmsL = l.rms;
    if (r.rms > rmsR) rmsR = r.rms;
  }
  window.dmx.reportAudioLevels({ peakL, peakR, rmsL, rmsR });
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
