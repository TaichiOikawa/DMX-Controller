/**
 * IPC 契約（§9）。チャンネル名とペイロード型の単一定義。
 *
 * main / preload / renderer すべてがこの定義を参照することで、
 * 文字列チャンネル名のタイプミスとペイロード型の不一致を防ぐ。
 *
 * 実装済み（マイルストーン1〜4）:
 *   - フェーダー/設定: setFader / updateArtnetSettings / getEngineState
 *   - 再生: loadShow / unloadShow / go / goGroup
 *   - オーサリング: captureCueFromFaders / addGroup / removeGroup /
 *     setGroupLoop / updateCue / deleteCue / moveCue / newShow
 *   - 永続化: newProject / saveProject / loadProject
 *   - Engine → UI: outputFrame / engineState / project
 * 予約（後続）: releaseCapture / action* / timeline* / reportAudioPlayhead
 */

import type { ActionMode, ArtnetSettings, Cue, EngineMode, Project } from './types';

/** UI → Engine（コマンド）チャンネル名。 */
export const Cmd = {
  // --- フェーダー / 設定 ---
  setFader: 'cmd:setFader',
  updateArtnetSettings: 'cmd:updateArtnetSettings',
  getEngineState: 'cmd:getEngineState',
  getProject: 'cmd:getProject',
  setMode: 'cmd:setMode',
  setMasterLevel: 'cmd:setMasterLevel',
  setBlackout: 'cmd:setBlackout',
  setChannelLabel: 'cmd:setChannelLabel',
  setBankLabel: 'cmd:setBankLabel',

  // --- 再生 ---
  loadShow: 'cmd:loadShow',
  unloadShow: 'cmd:unloadShow',
  go: 'cmd:go',
  goBack: 'cmd:goBack',
  goTo: 'cmd:goTo',
  holdFade: 'cmd:holdFade',

  // --- Undo / Redo ---
  undo: 'cmd:undo',
  redo: 'cmd:redo',

  // --- オーサリング（Show / マスター列 / GROUP / Cue 編集） ---
  newShow: 'cmd:newShow',
  recordCue: 'cmd:recordCue',
  addGroupEntry: 'cmd:addGroupEntry',
  setGroupLoop: 'cmd:setGroupLoop',
  updateCue: 'cmd:updateCue',
  deleteEntry: 'cmd:deleteEntry',
  deleteCueFromGroup: 'cmd:deleteCueFromGroup',
  moveEntry: 'cmd:moveEntry',
  moveCueInGroup: 'cmd:moveCueInGroup',
  duplicateEntry: 'cmd:duplicateEntry',
  duplicateCueInGroup: 'cmd:duplicateCueInGroup',

  // --- キャプチャ / リリース（§6） ---
  releaseCapture: 'cmd:releaseCapture',

  // --- Action（§5.6） ---
  actionDown: 'cmd:actionDown',
  actionUp: 'cmd:actionUp',
  addAction: 'cmd:addAction',
  updateAction: 'cmd:updateAction',
  deleteAction: 'cmd:deleteAction',
  addActionStep: 'cmd:addActionStep',
  deleteActionStep: 'cmd:deleteActionStep',

  // --- Timeline（§5.5・内部タイムコード） ---
  reportAudioPlayhead: 'cmd:reportAudioPlayhead',
  timelineSeek: 'cmd:timelineSeek',
  timelineStop: 'cmd:timelineStop',
  addTimelinePoint: 'cmd:addTimelinePoint',
  deleteTimelinePoint: 'cmd:deleteTimelinePoint',
  updateTimelinePoint: 'cmd:updateTimelinePoint',
  pickShowAudio: 'cmd:pickShowAudio',
  clearShowAudio: 'cmd:clearShowAudio',
  readAudioFile: 'cmd:readAudioFile',

  // --- 永続化 ---
  newProject: 'cmd:newProject',
  saveProject: 'cmd:saveProject',
  loadProject: 'cmd:loadProject',
} as const;

/** Engine → UI（イベント）チャンネル名。 */
export const Evt = {
  /** 可視化用の出力フレーム（~30Hz に間引き） */
  outputFrame: 'evt:outputFrame',
  /** 各グループの現在 CUE / captured ch / 再生レート 等 */
  engineState: 'evt:engineState',
  /** Project 構造（編集・読込で更新） */
  project: 'evt:project',
  /** 未保存状態（dirty）と現在のファイルパス */
  dirty: 'evt:dirty',
} as const;

/** 未保存状態の通知ペイロード。 */
export interface DirtyState {
  /** 最後の保存／読込以降に変更があるか。 */
  dirty: boolean;
  /** 現在ひも付くファイルパス（未保存の新規は null）。 */
  filePath: string | null;
}

// ===== ペイロード型 =====

export interface SetFaderPayload {
  /** 0-511 */
  ch: number;
  /** 0-255 */
  value: number;
}

/** recordCue（現在フェーダーから CUE 作成）のオプション。 */
export interface CaptureCueOptions {
  /** 取り込む ch を限定（省略時は非ゼロのフェーダー全て）。 */
  channels?: number[];
  /** 値 0 の ch も含める（既定 false）。 */
  includeZero?: boolean;
  /** 生成する cue の名前。 */
  name?: string;
  /** 生成する cue のフェード時間（ms、既定 1000）。 */
  fadeInMs?: number;
  /** 指定すると、その GROUP の子 CUE として追加（省略時はマスター列末尾へ）。 */
  targetGroupId?: string;
  /** 挿入位置（省略時は末尾へ追加）。 */
  atIndex?: number;
}

/** updateCue で変更可能なフィールド。 */
export interface CuePatch {
  name?: string;
  lyrics?: string;
  fadeInMs?: number;
  fadeOutMs?: number;
  delayMs?: number;
}

/** updateAction で変更可能なフィールド。 */
export interface ActionPatch {
  name?: string;
  mode?: ActionMode;
}

/** 単一プレイヘッドの再生状態（可視化用）。 */
export interface PlaybackStatus {
  /** マスター列 index（-1=未開始）。 */
  mainIndex: number;
  /** GROUP 内の子 cue index。 */
  subIndex: number;
  /** フェード進行中か。 */
  fading: boolean;
  /** 進行中フェードの進捗 0..1（フェード無しは 1）。 */
  fadeProgress: number;
  /** 進行中フェードの残り時間（ms）。 */
  fadeRemainingMs: number;
  /** マスター列のエントリ数。 */
  entryCount: number;
}

/** 可視化用に間引かれた状態スナップショット（§9 `state`）。 */
export interface EngineStateSnapshot {
  activeShowId: string | null;
  /** 512: captured フラグ */
  captured: boolean[];
  artnet: ArtnetSettings;
  /** 実際の送出レート計測値（Hz）。診断用。 */
  measuredHz: number;
  /** 操作モード（'edit' / 'show'）。 */
  mode: EngineMode;
  /** グランドマスター（全体調光 0-255）。 */
  masterLevel: number;
  /** ブラックアウト中か。 */
  blackout: boolean;
  /** Undo 可能か。 */
  canUndo: boolean;
  /** Redo 可能か。 */
  canRedo: boolean;
  /** アクティブな Action の id。 */
  activeActionIds: string[];
  /** 読込中 Show の再生状態（未読込は null）。 */
  playback: PlaybackStatus | null;
}

/**
 * preload が contextBridge 経由で renderer に公開する API の形。
 * renderer 側はこの型で `window.dmx` を参照する。
 */
export interface DmxBridge {
  // フェーダー / 設定
  setFader(ch: number, value: number): void;
  updateArtnetSettings(settings: ArtnetSettings): void;
  getEngineState(): Promise<EngineStateSnapshot>;
  getProject(): Promise<Project>;
  setMode(mode: EngineMode): void;
  setMasterLevel(level: number): void;
  setBlackout(on: boolean): void;
  setChannelLabel(ch: number, label: string): void;
  setBankLabel(bank: number, label: string): void;

  // 再生
  loadShow(showId: string): void;
  unloadShow(): void;
  go(): void;
  goBack(): void;
  goTo(mainIndex: number, subIndex: number): void;
  holdFade(): void;
  undo(): void;
  redo(): void;

  // オーサリング
  newShow(name?: string): void;
  recordCue(showId: string, opts?: CaptureCueOptions): void;
  addGroupEntry(showId: string, name?: string): void;
  setGroupLoop(groupId: string, loop: boolean): void;
  updateCue(cueId: string, patch: CuePatch): void;
  deleteEntry(showId: string, entryId: string): void;
  deleteCueFromGroup(groupId: string, cueId: string): void;
  moveEntry(showId: string, entryId: string, toIndex: number): void;
  moveCueInGroup(groupId: string, cueId: string, toIndex: number): void;
  duplicateEntry(showId: string, entryId: string): void;
  duplicateCueInGroup(groupId: string, cueId: string): void;

  // キャプチャ / リリース（§6）
  releaseCapture(channels?: number[]): void;

  // Action（§5.6）
  actionDown(actionId: string): void;
  actionUp(actionId: string): void;
  addAction(name?: string): void;
  updateAction(actionId: string, patch: ActionPatch): void;
  deleteAction(actionId: string): void;
  addActionStep(actionId: string, fadeInMs?: number, holdMs?: number): void;
  deleteActionStep(actionId: string, stepIndex: number): void;

  // Timeline（§5.5）
  reportAudioPlayhead(ms: number): void;
  timelineSeek(ms: number): void;
  timelineStop(): void;
  addTimelinePoint(showId: string, timecodeMs: number): void;
  deleteTimelinePoint(showId: string, index: number): void;
  updateTimelinePoint(showId: string, index: number, timecodeMs: number): void;
  /** 音声ファイルをダイアログで選び、Show に絶対パスを設定。 */
  pickShowAudio(showId: string): Promise<{ ok: boolean; path?: string }>;
  /** Show の音声を解除。 */
  clearShowAudio(showId: string): void;
  /** 音声ファイルのバイト列を読み出す（Blob URL 化して再生/波形に使う）。 */
  readAudioFile(filePath: string): Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }>;

  // 永続化（main が結果を project イベントで返す）
  newProject(): void;
  saveProject(): Promise<{ ok: boolean; path?: string; error?: string }>;
  loadProject(): Promise<{ ok: boolean; path?: string; error?: string }>;

  // 購読（解除関数を返す）
  onOutputFrame(cb: (frame: number[]) => void): () => void;
  onEngineState(cb: (state: EngineStateSnapshot) => void): () => void;
  onProject(cb: (project: Project) => void): () => void;
  onDirty(cb: (state: DirtyState) => void): () => void;
}

/** Cue 単体を export 型として再公開（preload/renderer の利便のため）。 */
export type { Cue };
