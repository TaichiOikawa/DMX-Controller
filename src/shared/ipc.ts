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

import type {
  ArtnetSettings,
  Cue,
  DmxDeviceKind,
  EngineMode,
  OpenDmxSettings,
  Project,
  StageLayout,
  Show,
} from './types';
import type { VisualizerProfileLibrary } from './visualizerProfiles';

/** UI → Engine（コマンド）チャンネル名。 */
export const Cmd = {
  // --- フェーダー / 設定 ---
  setFader: 'cmd:setFader',
  updateArtnetSettings: 'cmd:updateArtnetSettings',
  /** OpenDMX(USB-DMX) 設定の更新。ポート変更/有効化で main が再接続する。 */
  updateOpenDmxSettings: 'cmd:updateOpenDmxSettings',
  /** 接続可能なシリアルポートの一覧を取得する（OpenDMX のポート選択用）。 */
  listSerialPorts: 'cmd:listSerialPorts',
  getEngineState: 'cmd:getEngineState',
  getProject: 'cmd:getProject',
  getVisualizerProfileLibrary: 'cmd:getVisualizerProfileLibrary',
  setVisualizerProfileLibrary: 'cmd:setVisualizerProfileLibrary',
  setMode: 'cmd:setMode',
  setMasterLevel: 'cmd:setMasterLevel',
  setBlackout: 'cmd:setBlackout',
  setChannelLabel: 'cmd:setChannelLabel',
  setBankLabel: 'cmd:setBankLabel',
  addFixture: 'cmd:addFixture',
  updateFixture: 'cmd:updateFixture',
  deleteFixture: 'cmd:deleteFixture',
  /** RGB カラーピッカーを別ウィンドウで開く（main がウィンドウを生成）。 */
  openColorPicker: 'cmd:openColorPicker',
  /** 3D Fixture Visualizerを別ウィンドウで開く。 */
  openVisualizer: 'cmd:openVisualizer',
  openMonitor: 'cmd:openMonitor',
  /** renderer 専用 UI 状態（タブ・パネル開閉）を main へ同期し、メニューのチェック反映に使う。 */
  uiState: 'cmd:uiState',

  // --- 再生 ---
  loadShow: 'cmd:loadShow',
  unloadShow: 'cmd:unloadShow',
  go: 'cmd:go',
  goBack: 'cmd:goBack',
  goTo: 'cmd:goTo',
  deselectCue: 'cmd:deselectCue',
  holdFade: 'cmd:holdFade',

  // --- Undo / Redo ---
  undo: 'cmd:undo',
  redo: 'cmd:redo',
  beginStageLayoutEdit: 'cmd:beginStageLayoutEdit',
  endStageLayoutEdit: 'cmd:endStageLayoutEdit',
  setStageLayout: 'cmd:setStageLayout',
  stageLayoutUndo: 'cmd:stageLayoutUndo',
  stageLayoutRedo: 'cmd:stageLayoutRedo',

  // --- オーサリング（Show / マスター列 / GROUP / Cue 編集） ---
  newShow: 'cmd:newShow',
  renameShow: 'cmd:renameShow',
  deleteShow: 'cmd:deleteShow',
  addFolder: 'cmd:addFolder',
  renameFolder: 'cmd:renameFolder',
  deleteFolder: 'cmd:deleteFolder',
  setShowFolder: 'cmd:setShowFolder',
  createSetlist: 'cmd:createSetlist',
  renameSetlist: 'cmd:renameSetlist',
  deleteSetlist: 'cmd:deleteSetlist',
  addToSetlist: 'cmd:addToSetlist',
  removeFromSetlist: 'cmd:removeFromSetlist',
  moveSetlistEntry: 'cmd:moveSetlistEntry',
  addCue: 'cmd:addCue',
  addGroupEntry: 'cmd:addGroupEntry',
  setGroupLoop: 'cmd:setGroupLoop',
  updateCue: 'cmd:updateCue',
  deleteCueChannel: 'cmd:deleteCueChannel',
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
  addAction: 'cmd:addAction',
  updateAction: 'cmd:updateAction',
  deleteAction: 'cmd:deleteAction',
  /** 既存 Action の look を現在のフェーダーで上書き（SHOW 中も可）。 */
  overwriteAction: 'cmd:overwriteAction',
  /** Action を編集対象に選択（EDIT・フェーダーで look を作り込む）。 */
  selectActionForEdit: 'cmd:selectActionForEdit',
  /** Action 編集選択を解除。 */
  deselectAction: 'cmd:deselectAction',
  /** Action の look を programmer（フェーダー）へ取り込む（キャプチャ）。 */
  captureAction: 'cmd:captureAction',

  // --- Timeline（§5.5・内部タイムコード） ---
  reportAudioPlayhead: 'cmd:reportAudioPlayhead',
  timelineSeek: 'cmd:timelineSeek',
  timelineStop: 'cmd:timelineStop',
  addTimelinePoint: 'cmd:addTimelinePoint',
  deleteTimelinePoint: 'cmd:deleteTimelinePoint',
  updateTimelinePoint: 'cmd:updateTimelinePoint',
  setTimelinePointCue: 'cmd:setTimelinePointCue',
  pickShowAudio: 'cmd:pickShowAudio',
  clearShowAudio: 'cmd:clearShowAudio',
  setMainAudioProps: 'cmd:setMainAudioProps',
  readAudioFile: 'cmd:readAudioFile',
  relinkAudioFromFolder: 'cmd:relinkAudioFromFolder',
  checkMissingFiles: 'cmd:checkMissingFiles',

  // --- 追加オーディオトラック / クリップ ---
  pickAudioClip: 'cmd:pickAudioClip',
  addAudioClip: 'cmd:addAudioClip',
  moveAudioClip: 'cmd:moveAudioClip',
  removeAudioClip: 'cmd:removeAudioClip',
  clearAudioTrack: 'cmd:clearAudioTrack',
  setAudioTrackProps: 'cmd:setAudioTrackProps',
  reportAudioLevels: 'cmd:reportAudioLevels',

  // --- リモート操作（スマホ等からの遠隔操作） ---
  /** renderer が組み立てたモニター用ビューモデルを main（RemoteServer）へ報告する。 */
  reportRemoteState: 'cmd:reportRemoteState',
  /** リモートサーバーの接続情報（URL / PIN / 有効状態）を取得する。 */
  getRemoteInfo: 'cmd:getRemoteInfo',
  /** リモートサーバーの有効/無効を切り替える（切替後の接続情報を返す）。 */
  setRemoteEnabled: 'cmd:setRemoteEnabled',

  // --- 永続化 ---
  newProject: 'cmd:newProject',
  saveProject: 'cmd:saveProject',
  saveProjectOverwrite: 'cmd:saveProjectOverwrite',
  loadProject: 'cmd:loadProject',
  /** パス指定で Project を開く（ファイル関連付けからの起動・ドロップ用。ダイアログを出さない）。 */
  loadProjectFromPath: 'cmd:loadProjectFromPath',
  /** OS から渡された「開くべきファイル」を 1 件取り出す（取り出すと main 側からは消える）。 */
  consumePendingOpenFile: 'cmd:consumePendingOpenFile',

  // --- Show 単体の書き出し / 読み込み（.dmxshow） ---
  exportShow: 'cmd:exportShow',
  pickShowFile: 'cmd:pickShowFile',
  importShow: 'cmd:importShow',

  // --- 歌詞シートの書き出し（.txt） ---
  exportLyrics: 'cmd:exportLyrics',
} as const;

/** Engine → UI（イベント）チャンネル名。 */
export const Evt = {
  /** 可視化用の出力フレーム（~30Hz に間引き） */
  outputFrame: 'evt:outputFrame',
  /** 現在 CUE / busking ch / 再生レート 等 */
  engineState: 'evt:engineState',
  /** Project 構造（編集・読込で更新） */
  project: 'evt:project',
  /** 未保存状態（dirty）と現在のファイルパス */
  dirty: 'evt:dirty',
  /** アプリメニューからのアクション（main → renderer） */
  menuAction: 'evt:menuAction',
  /** ミックス済みオーディオ出力レベル（メイン renderer → main → 全ウインドウ） */
  audioLevels: 'evt:audioLevels',
  /** リモート（スマホ等）からのコマンド（main → 主ウィンドウ renderer） */
  remoteCommand: 'evt:remoteCommand',
  /** OS から開くよう指示されたファイルが届いた合図（main → 主ウィンドウ renderer。ペイロードなし） */
  pendingOpenFile: 'evt:pendingOpenFile',
} as const;

/**
 * アプリメニュー項目に対応するアクション識別子（main → renderer）。
 * renderer 側で既存ロジック（window.dmx / store / 確認ダイアログ）へディスパッチする。
 */
export type MenuAction =
  // ファイル
  | 'file:new'
  | 'file:open'
  | 'file:save'
  | 'file:saveAs'
  | 'file:relink'
  // 編集
  | 'edit:undo'
  | 'edit:redo'
  | 'edit:prefs'
  // 表示
  | 'view:tabCue'
  | 'view:tabTimeline'
  | 'view:toggleSidebar'
  | 'view:toggleFaders'
  | 'view:resetLayout'
  | 'view:visualizer'
  // ショー
  | 'show:go'
  | 'show:goBack'
  | 'show:modeEdit'
  | 'show:modeShow'
  | 'show:blackoutToggle'
  | 'show:gmFull';

/** renderer → main の UI 状態同期ペイロード（メニューのチェック反映用）。 */
export interface UiState {
  tab: 'cue' | 'timeline';
  sidebarCollapsed: boolean;
  fadersCollapsed: boolean;
}

/** 未保存状態の通知ペイロード。 */
export interface DirtyState {
  /** 最後の保存／読込以降に変更があるか。 */
  dirty: boolean;
  /** 現在ひも付くファイルパス（未保存の新規は null）。 */
  filePath: string | null;
}

// ===== ペイロード型 =====

/** ミックス済みオーディオ出力のステレオレベル（0..1、ピーク+RMS）。 */
export interface AudioLevels {
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
}

export interface SetFaderPayload {
  /** 0-511 */
  ch: number;
  /** 0-255 */
  value: number;
}

// ===== リモート操作（スマホ等からの遠隔操作） =====

/** リモート画面に表示する CUE（現在 / 次）。 */
export interface RemoteCue {
  name: string;
  lyrics: string;
}

/** リモート画面のセットリスト状態（読込中のみ非 null）。 */
export interface RemoteSetlist {
  name: string;
  /** 現在エントリ index（未開始は -1）。 */
  index: number;
  /** エントリ総数。 */
  total: number;
  /** 各エントリの Show 名（一覧描画・頭出し用）。 */
  entries: { name: string }[];
}

/** リモート画面の Timeline トランスポート状態（Show 読込中のみ非 null）。 */
export interface RemoteTransport {
  hasAudio: boolean;
  playing: boolean;
  /** 現在の再生位置（ms・100ms 粒度に丸め）。 */
  positionMs: number;
  /** タイムラインの長さ（ms）。 */
  durationMs: number;
}

/**
 * スマホ等のリモート画面へ配信するビューモデル（renderer が組み立て、main が中継）。
 * 現在/次 CUE・歌詞、モード、ブラックアウト、マスター、セットリスト位置などを反映する。
 */
export interface RemoteState {
  mode: EngineMode;
  blackout: boolean;
  /** グランドマスター（0-255）。 */
  masterLevel: number;
  /** 読込中 Show 名（未読込は null）。 */
  showName: string | null;
  /** 読込中（アクティブ）Show の id（未読込は null。読込リストのハイライト用）。 */
  activeShowId: string | null;
  /** 読み込める Show の一覧（スマホから loadShow するため）。 */
  shows: { id: string; name: string }[];
  setlist: RemoteSetlist | null;
  now: RemoteCue | null;
  next: RemoteCue | null;
  transport: RemoteTransport | null;
  /** 発火できる Action（プロジェクト共通・全 Show で共有）。 */
  actions: { id: string; name: string }[];
  /** フェード発火の既定時間（ms・ラベル表示に使う）。 */
  actionFadeMs: number;
}

/** リモート画面 → 本体への操作コマンド。 */
export interface RemoteCommand {
  action:
    | 'go'
    | 'back'
    | 'hold'
    | 'blackout'
    | 'master'
    | 'setlistGoTo'
    | 'action'
    | 'modeShow'
    | 'loadShow'
    | 'unloadShow'
    | 'timelineToggle'
    | 'timelinePlay'
    | 'timelinePause'
    | 'timelineStop';
  /** master の値（0-255）や setlistGoTo の行 index。 */
  value?: number;
  /** action 発火の対象 Action id、または loadShow の Show id。 */
  id?: string;
  /** action 発火でフェードするか（true なら actionFadeMs でフェード）。 */
  fade?: boolean;
}

/** 設定画面へ返すリモートサーバーの接続情報。 */
export interface RemoteInfo {
  enabled: boolean;
  port: number;
  /** 接続 PIN（4 桁）。アプリ設定に永続化され、再起動しても変わらない。 */
  pin: string;
  /** LAN 上の接続 URL 一覧（複数 NIC 対応）。 */
  urls: string[];
}

/** addCue（空の CUE を追加）のオプション。 */
export interface AddCueOptions {
  /** 生成する cue の名前。 */
  name?: string;
  /** 生成する cue のフェード時間（ms、既定 0）。 */
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
  /** フェードアウト時間（ms）。null で解除（In と同じに戻す）。 */
  fadeOutMs?: number | null;
  delayMs?: number;
  /** 自動送り Delay（ms）。null で解除（自動送りオフ＝手動 GO 待ち）。 */
  followMs?: number | null;
}

/** addFixture で渡す初期値（id はエンジンが採番）。 */
export interface FixtureInit {
  name?: string;
  /** R/G/B チャンネル index 0-511 */
  r: number;
  g: number;
  b: number;
}

/** updateFixture で変更可能なフィールド。 */
export interface FixturePatch {
  name?: string;
  r?: number;
  g?: number;
  b?: number;
}

/** updateAction で変更可能なフィールド。 */
export interface ActionPatch {
  name?: string;
}

/** .dmxshow 読込時に main → renderer へ返す解析結果（パッチ画面の入力）。 */
export interface ShowFilePayload {
  /** 取り込む Show 本体（id はそのまま。取り込み時に Engine が再採番する）。 */
  show: Show;
  /** 書き出し元 ch ラベル（使用 ch のみ・表示専用）。 */
  sourceLabels?: Record<number, string>;
}

/** Project 読込時に存在確認して見つからなかった参照ファイル（現状は Show の音声）。 */
export interface MissingFile {
  /** 参照元 Show の id。 */
  showId: string;
  /** 参照元 Show の名前（表示用）。 */
  showName: string;
  /** 見つからなかった絶対パス。 */
  filePath: string;
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

/** 選択候補として UI に出すシリアルポート 1 件（listSerialPorts の戻り）。 */
export interface SerialPortInfo {
  /** ポートのパス（Windows: `COM3` / macOS: `/dev/tty.usbserial-XXXX`）。 */
  path: string;
  /** OS が返す表示名（Windows のみ返ることが多い）。 */
  friendlyName?: string;
  manufacturer?: string;
  vendorId?: string;
  productId?: string;
  /** FTDI(VID 0403) / Pico(VID 2e8a) 等、DMX I/F として尤もらしいポートか。UI の並べ替えに使う。 */
  likelyDmx: boolean;
  /**
   * VID から推定した出力先の種別。UI でポートを選んだ瞬間に種別を自動で合わせるのに使う。
   * 判別できないポートでは undefined。
   */
  kindHint?: DmxDeviceKind;
}

/** OpenDMX 接続の実行時状態。設定（OpenDmxSettings）とは別で、非永続。 */
export interface OpenDmxStatus {
  /**
   * - `disabled`: 設定で無効
   * - `closed`  : 有効だがポート未選択／切断済み
   * - `opening` : オープン試行中
   * - `open`    : 送出中
   * - `error`   : オープン失敗 or 送出中に切断（`error` に理由）
   */
  state: 'disabled' | 'closed' | 'opening' | 'open' | 'error';
  /** 実際に開いている（開こうとした）ポート。未選択は null。 */
  portPath: string | null;
  /** state==='error' のときの理由（UI 表示用）。 */
  error?: string;
  /** 実測のフレーム送出レート（Hz）。診断用。0 は未送出。 */
  measuredHz: number;
}

/** 可視化用に間引かれた状態スナップショット（§9 `state`）。 */
export interface EngineStateSnapshot {
  activeShowId: string | null;
  /** 512: busking（SHOW モードのライブ上書き）中フラグ */
  busking: boolean[];
  artnet: ArtnetSettings;
  /** OpenDMX 出力設定（Project 由来）。 */
  openDmx: OpenDmxSettings;
  /** OpenDMX 接続の実行時状態。Engine ではなく main の Driver が真実。 */
  openDmxStatus: OpenDmxStatus;
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
  /** Stage Layout専用の編集セッション中か。 */
  visualizerEditing: boolean;
  /** Stage Layout専用Undoが可能か。 */
  canStageLayoutUndo: boolean;
  /** Stage Layout専用Redoが可能か。 */
  canStageLayoutRedo: boolean;
  /** EDIT モードで編集対象に選択中の Action id（未選択は null）。 */
  editingActionId: string | null;
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
  /** OpenDMX 設定を更新する（main が必要に応じてポートを開き直す）。 */
  updateOpenDmxSettings(settings: OpenDmxSettings): void;
  /** 接続可能なシリアルポートを列挙する（OpenDMX らしいポートが先頭）。 */
  listSerialPorts(): Promise<SerialPortInfo[]>;
  getEngineState(): Promise<EngineStateSnapshot>;
  getProject(): Promise<Project>;
  /** 端末共通の3D Fixture Profileライブラリを取得する。 */
  getVisualizerProfileLibrary(): Promise<VisualizerProfileLibrary>;
  /** 端末共通ライブラリ全体を検証・保存し、保存結果を返す。 */
  setVisualizerProfileLibrary(
    library: VisualizerProfileLibrary,
  ): Promise<VisualizerProfileLibrary>;
  setMode(mode: EngineMode): void;
  setMasterLevel(level: number): void;
  setBlackout(on: boolean): void;
  setChannelLabel(ch: number, label: string): void;
  setBankLabel(bank: number, label: string): void;
  /** RGB フィクスチャを追加する（id はエンジンが採番）。 */
  addFixture(init: FixtureInit): void;
  /** RGB フィクスチャを更新する（指定フィールドのみ）。 */
  updateFixture(id: string, patch: FixturePatch): void;
  /** RGB フィクスチャを削除する。 */
  deleteFixture(id: string): void;
  /** RGB カラーピッカーを別ウィンドウで開く（既に開いていれば前面化）。 */
  openColorPicker(): void;
  /** 3D Fixture Visualizerを別ウィンドウで開く（既に開いていれば前面化）。 */
  openVisualizer(): void;
  /** renderer の UI 状態（タブ・パネル開閉）を main へ通知する。 */
  notifyUiState(state: UiState): void;

  // 再生
  loadShow(showId: string): void;
  unloadShow(): void;
  go(): void;
  goBack(): void;
  goTo(mainIndex: number, subIndex: number): void;
  /** CUE 選択を解除し、プレイヘッドを未 GO（-1）へ戻す。 */
  deselectCue(): void;
  holdFade(): void;
  undo(): void;
  redo(): void;
  beginStageLayoutEdit(): void;
  endStageLayoutEdit(): void;
  /** 1回の確定操作としてStage Layout全体を置換する。 */
  setStageLayout(stageLayout: StageLayout): void;
  stageLayoutUndo(): void;
  stageLayoutRedo(): void;

  // オーサリング
  newShow(name?: string): void;
  /** Show 名を変更（空文字は既定名へ）。 */
  renameShow(showId: string, name: string): void;
  /** Show を削除する（読込中なら解放してから削除）。 */
  deleteShow(showId: string): void;
  /** フォルダを追加する。 */
  addFolder(name?: string): void;
  /** フォルダ名を変更する（空文字は無視）。 */
  renameFolder(folderId: string, name: string): void;
  /** フォルダを削除する（中の Show はルートへ移動）。 */
  deleteFolder(folderId: string): void;
  /** Show の所属フォルダを設定/解除する（null でルートへ）。 */
  setShowFolder(showId: string, folderId: string | null): void;
  /** セットリストを作成する。 */
  createSetlist(name?: string): void;
  /** セットリスト名を変更する（空文字は無視）。 */
  renameSetlist(setlistId: string, name: string): void;
  /** セットリストを削除する。 */
  deleteSetlist(setlistId: string): void;
  /** Show 参照をセットリスト末尾に追加する（実在する Show のみ）。 */
  addToSetlist(setlistId: string, showId: string): void;
  /** セットリストからエントリを削除する。 */
  removeFromSetlist(setlistId: string, entryId: string): void;
  /** セットリスト内のエントリを並び替える。 */
  moveSetlistEntry(setlistId: string, entryId: string, toIndex: number): void;
  addCue(showId: string, opts?: AddCueOptions): void;
  addGroupEntry(showId: string, name?: string): void;
  setGroupLoop(groupId: string, loop: boolean): void;
  updateCue(cueId: string, patch: CuePatch): void;
  /** 選択中（current）CUE からこの ch を削除する（cue.values からキー削除）。 */
  deleteCueChannel(cueId: string, ch: number): void;
  deleteEntry(showId: string, entryId: string): void;
  deleteCueFromGroup(groupId: string, cueId: string): void;
  moveEntry(showId: string, entryId: string, toIndex: number): void;
  moveCueInGroup(groupId: string, cueId: string, toIndex: number): void;
  duplicateEntry(showId: string, entryId: string): void;
  duplicateCueInGroup(groupId: string, cueId: string): void;

  // キャプチャ / リリース（§6）
  releaseCapture(channels?: number[]): void;

  // Action（§5.6）
  /** Action 発火: look を programmer（フェーダー）へ取り込んで保持する。fadeMs>0 でフェード。 */
  actionDown(actionId: string, fadeMs?: number): void;
  addAction(name?: string): void;
  updateAction(actionId: string, patch: ActionPatch): void;
  deleteAction(actionId: string): void;
  /** 既存 Action の look を現在のフェーダー位置で上書きする（SHOW モード中も可）。 */
  overwriteAction(actionId: string): void;
  /** Action を編集対象に選択する（EDIT・フェーダー操作がその look へ書き込まれる）。 */
  selectActionForEdit(actionId: string): void;
  /** Action 編集選択を解除する。 */
  deselectAction(): void;
  /** Action の look を programmer（フェーダー）へ取り込む（Show 読込中は busking）。fadeMs>0 でフェード。 */
  captureAction(actionId: string, fadeMs?: number): void;

  // Timeline（§5.5）
  reportAudioPlayhead(ms: number): void;
  timelineSeek(ms: number): void;
  timelineStop(): void;
  addTimelinePoint(showId: string, timecodeMs: number, cueId?: string): void;
  deleteTimelinePoint(showId: string, pointId: string): void;
  updateTimelinePoint(showId: string, pointId: string, timecodeMs: number): void;
  /** GO ポイントに紐づく CUE を設定/解除（undefined で順送りに戻す）。 */
  setTimelinePointCue(showId: string, pointId: string, cueId: string | undefined): void;
  /** 音声ファイルをダイアログで選び、Show に絶対パスを設定。 */
  pickShowAudio(showId: string): Promise<{ ok: boolean; path?: string }>;
  /** Show の音声を解除。 */
  clearShowAudio(showId: string): void;
  /** メイン音声の音量(0..1)/ミュート/ソロを更新。 */
  setMainAudioProps(
    showId: string,
    props: { volume?: number; muted?: boolean; solo?: boolean; outputDeviceId?: string | null },
  ): void;
  /** 音声ファイルのバイト列を読み出す（Blob URL 化して再生/波形に使う）。 */
  readAudioFile(filePath: string): Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }>;
  /**
   * フォルダをダイアログで選び、欠損中の各音声を同名ファイルで一括再リンクする。
   * resolved は再リンクできた件数。結果は project イベントで反映される。
   */
  relinkAudioFromFolder(): Promise<{ ok: boolean; resolved?: number; error?: string }>;
  /** 現在の Project が参照する音声ファイルの存在確認を行い、見つからない一覧を返す。 */
  checkMissingFiles(): Promise<MissingFile[]>;

  // 追加オーディオトラック / クリップ
  /** 音声ファイルをダイアログで選び、絶対パスを返す（Project は変更しない。尺取得は renderer 側）。 */
  pickAudioClip(): Promise<{ ok: boolean; path?: string }>;
  /** トラック（index 0..2）へクリップを追加（開始位置・尺は ms）。 */
  addAudioClip(
    showId: string,
    trackIndex: number,
    filePath: string,
    startMs: number,
    durationMs: number,
  ): void;
  /** クリップの開始位置を更新（ドラッグ移動）。 */
  moveAudioClip(showId: string, trackIndex: number, clipId: string, startMs: number): void;
  /** クリップを削除。 */
  removeAudioClip(showId: string, trackIndex: number, clipId: string): void;
  /** トラック（index 0..2）の全クリップを削除。 */
  clearAudioTrack(showId: string, trackIndex: number): void;
  /** トラック（index 0..2）の音量(0..1)/ミュート/ソロを更新。 */
  setAudioTrackProps(
    showId: string,
    trackIndex: number,
    props: { volume?: number; muted?: boolean; solo?: boolean; outputDeviceId?: string | null },
  ): void;
  /** ミックス済みオーディオ出力レベルを main へ送る（main が全ウインドウへ中継）。 */
  reportAudioLevels(levels: AudioLevels): void;
  /** 音量モニターを別ウインドウで開く。 */
  openMonitor(): void;

  // 永続化（main が結果を project イベントで返す）
  newProject(): void;
  saveProject(): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** 既存ファイルへ確認なしで上書き保存。未保存（パス未確定）なら保存ダイアログを開く。 */
  saveProjectOverwrite(): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** Project を開く。読込後、参照ファイル（音声）の存在確認結果 missingFiles も返す。 */
  loadProject(): Promise<{
    ok: boolean;
    path?: string;
    error?: string;
    missingFiles?: MissingFile[];
  }>;
  /** パス指定で Project を開く（ダイアログなし。ファイル関連付けからの起動用）。 */
  loadProjectFromPath(filePath: string): Promise<{
    ok: boolean;
    path?: string;
    error?: string;
    missingFiles?: MissingFile[];
  }>;
  /** OS から渡された「開くべきファイル」を 1 件取り出す（無ければ null）。 */
  consumePendingOpenFile(): Promise<string | null>;

  // Show 単体の書き出し / 読み込み（.dmxshow）
  /** 指定 Show を .dmxshow として書き出す（保存ダイアログ）。 */
  exportShow(showId: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** .dmxshow を選んで解析だけ行う（Project は変更しない）。パッチ画面の入力を返す。 */
  pickShowFile(): Promise<{
    ok: boolean;
    path?: string;
    payload?: ShowFilePayload;
    error?: string;
  }>;
  /** パッチ済み Show を現在の Project に取り込む（id は Engine が再採番）。 */
  importShow(show: Show): void;

  /** 指定 Show の CUE 歌詞をテキスト（歌詞シート）として書き出す（保存ダイアログ）。 */
  exportLyrics(showId: string): Promise<{ ok: boolean; path?: string; error?: string }>;

  // リモート操作（スマホ等からの遠隔操作）
  /** モニター用ビューモデルを main（RemoteServer）へ報告する（スマホへ中継される）。 */
  reportRemoteState(state: RemoteState): void;
  /** リモートサーバーの接続情報（URL / PIN / 有効状態）を取得する。 */
  getRemoteInfo(): Promise<RemoteInfo>;
  /** リモートサーバーの有効/無効を切り替える（切替後の接続情報を返す）。 */
  setRemoteEnabled(on: boolean): Promise<RemoteInfo>;
  /** リモートからのコマンドを購読する（解除関数を返す）。 */
  onRemoteCommand(cb: (cmd: RemoteCommand) => void): () => void;

  // 購読（解除関数を返す）
  onOutputFrame(cb: (frame: number[]) => void): () => void;
  onEngineState(cb: (state: EngineStateSnapshot) => void): () => void;
  onProject(cb: (project: Project) => void): () => void;
  onDirty(cb: (state: DirtyState) => void): () => void;
  /** アプリメニューからのアクションを購読する（解除関数を返す）。 */
  onMenuAction(cb: (action: MenuAction) => void): () => void;
  /** ミックス済みオーディオ出力レベルを購読する（解除関数を返す）。 */
  onAudioLevels(cb: (levels: AudioLevels) => void): () => void;
  /** OS から開くよう指示されたファイルが届いた合図を購読する（解除関数を返す）。 */
  onPendingOpenFile(cb: () => void): () => void;
}

/** Cue 単体を export 型として再公開（preload/renderer の利便のため）。 */
export type { Cue };
