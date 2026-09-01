/**
 * 永続化モデル（§7）とエンジン実行時状態（§8）の型定義。
 *
 * このモジュールは main / renderer / engine すべてから共有される。
 * Electron / Node / DOM のいずれにも依存しないこと。
 *
 * 今回のマイルストーン（1〜2）で実際に使うのは Project / ProjectSettings /
 * EngineRuntime のフェーダー部分のみだが、後続マイルストーン
 * （CUE / グループ / Show / Action / Timeline）が差し込めるよう
 * 仕様全体を先に型として定義しておく。
 */

/** 1 ユニバースのチャンネル数。当面 512 固定。 */
export const UNIVERSE_SIZE = 512;

/** DMX チャンネル値域 0–255。 */
export type DmxValue = number;

// ===== Project（最上位・保存単位） =====
export interface Project {
  version: number;
  name: string;
  settings: ProjectSettings;
  /** 512 / 0-255。ベースレイヤーの保存値 */
  faders: number[];
  /** ch ラベル: chIndex(0-511) -> 名前。未設定 ch は省略（疎）。 */
  channelLabels?: Record<number, string>;
  /** バンク(ページ)ラベル: bankIndex(0-15) -> 名前。 */
  bankLabels?: Record<number, string>;
  actions: ActionButton[];
  shows: Show[];
  /**
   * セットリスト（任意・複数）。Show を順序付きで束ね、単一のマスター GO で
   * 1 Show ずつ「読込 + その Show の Timeline 再生」を進める上位の再生リスト。
   */
  setlists?: Setlist[];
  /** Show を整理するフォルダ（任意・単層）。Show.folderId が参照する。 */
  folders?: Folder[];
  /** RGB フィクスチャ定義（任意）。3ch を 1 色として束ねカラーピッカー入力に使う。 */
  fixtures?: RgbFixture[];
}

// ===== RGB フィクスチャ（R/G/B 3ch を 1 色として束ねる定義） =====
export interface RgbFixture {
  id: string;
  name?: string;
  /** R チャンネル index 0-511 */
  r: number;
  /** G チャンネル index 0-511 */
  g: number;
  /** B チャンネル index 0-511 */
  b: number;
}

// ===== Folder（Show を束ねる整理用フォルダ・単層） =====
export interface Folder {
  id: string;
  name: string;
}

// ===== Setlist（Show を順序付きで束ねる上位の再生リスト・複数可） =====
/** セットリストの 1 エントリ。Project.shows の Show を参照する（同一 Show の複数回登場可）。 */
export interface SetlistEntry {
  id: string;
  /** 参照先 Show の id（Project.shows）。 */
  showId: string;
}

/** Show を順序付きで束ねる再生リスト。Show と同じく Project 直下に複数作れる。 */
export interface Setlist {
  id: string;
  name: string;
  /** 順序付き Show 参照列。マスター GO で先頭から 1 つずつ進む。 */
  entries: SetlistEntry[];
}

/**
 * Art-Net(UDP) 送出設定。Project ではなくアプリ自体に永続化する
 * （送信先 IP はマシン・現場に紐づくため。src/shared/appSettings.ts）。
 */
export interface ArtnetSettings {
  /** Art-Net(UDP) 送出の有効/無効。false でも出力ループ自体は回る。 */
  enabled: boolean;
  /** 送信先ノード or ブロードキャストアドレス */
  targetIp: string;
  /** Art-Net universe (0-15) */
  universe: number;
  net: number;
  subnet: number;
  /**
   * 出力ループのリフレッシュレート (~40Hz)。
   * Engine のクロックそのものなので、OpenDMX 出力の更新レートも兼ねる。
   */
  refreshRateHz: number;
}

/**
 * USB 経由の DMX 出力先の種別。
 *
 * - `opendmx`: Enttec Open DMX USB 等の FTDI ベース I/F。マイコンを持たないので、
 *   ホストが 250kbps・8N2 のシリアルで BREAK / MAB / スタートコード込みの
 *   DMX フレームを直接生成する。
 * - `pico`: Raspberry Pi Pico W のネイティブ USB CDC。DMX の物理層は Pico 側が作るので、
 *   ホストは CDC の上に LCS 独自電文（USB_SERIAL_PROTOCOL.md）で値を渡すだけ。
 */
export type DmxDeviceKind = 'opendmx' | 'pico';

/**
 * USB-DMX（OpenDMX / Pico W）の送出設定。
 *
 * 実送出は main プロセスの OpenDmxDriver が担当する（src/main/openDmx.ts）。
 * ポートはマシン固有なので Project ではなくアプリ自体に永続化する
 * （src/shared/appSettings.ts）。
 */
export interface OpenDmxSettings {
  /** USB-DMX 送出の有効/無効。Art-Net とは独立に ON/OFF できる。 */
  enabled: boolean;
  /**
   * シリアルポートのパス（Windows: `COM3` / macOS: `/dev/tty.usbserial-XXXX`）。
   * 空文字は未選択。
   */
  portPath: string;
  /**
   * 出力先の種別。ポートの開き方とフレームの書き方がこれで変わる。
   * 旧 settings.json には無いフィールドなので、未定義は `'opendmx'` へ倒す。
   */
  kind: DmxDeviceKind;
}

/**
 * Project（演目データ）に保存する設定。
 *
 * 出力系（Art-Net / OpenDMX）とリモート操作の設定は **ここには入れない**。
 * それらはマシン・現場に紐づくのでアプリ自体へ保存する（src/shared/appSettings.ts）。
 */
export interface ProjectSettings {
  /** 当面 1 */
  universeCount: number;
  /** リリース時の戻りフェード（デフォルト 0 = 即時 / §11-①） */
  releaseFadeMs: number;
}

// ===== Show =====
export interface Show {
  id: string;
  name: string;
  /** 所属フォルダ id（Project.folders を参照）。未設定はルート直下。 */
  folderId?: string;
  /**
   * マスター順序リスト。単一の GO ボタンで先頭から順送りに再生する。
   * 各エントリは CUE（単一 look）か GROUP（子 CUE を束ねた入れ子）。
   */
  sequence: SequenceEntry[];
  /**
   * メイン音声。filePath はメモリ上は常に絶対パス。保存時、Project ファイルの配下にある場合のみ
   * 相対パス（POSIX 区切り）でディスクへ書き出し、読込時に絶対パスへ戻す（src/main/projectPaths.ts）。
   * volume(0..1)/muted/solo は追加トラックと同じミキサー操作（省略時は volume=1・false）。
   */
  audio?: {
    filePath: string;
    volume?: number;
    muted?: boolean;
    solo?: boolean;
    /** 出力先デバイス（deviceId）。未指定/空 = OS 既定。マシン固有・非可搬。 */
    outputDeviceId?: string;
  };
  timeline?: Timeline;
}

/** マスター列のエントリ。CUE か GROUP の判別共用体。 */
export type SequenceEntry =
  | { kind: 'cue'; cue: Cue }
  | { kind: 'group'; group: Group };

// ===== Group（マスター列に入れ子で並ぶ子 CUE 列） =====
export interface Group {
  id: string;
  name?: string;
  /** 順序付き 子 CUE 列 */
  cues: Cue[];
  /** GROUP 内ループ（自動送りで子先頭へ戻り続ける。GO はループを抜けて次エントリへ） */
  loop: boolean;
}

// ===== Cue =====
export interface Cue {
  id: string;
  name?: string;
  /** この CUE に対応する歌詞・メモ（CUEポイントの目印）。 */
  lyrics?: string;
  /** 操作対象 ch のみ: chIndex(0-511) -> 値(0-255) */
  values: Record<number, number>;
  /** フェードイン時間（値が上がる ch）。 */
  fadeInMs: number;
  /** フェードアウト時間（値が下がる ch）。省略時は fadeInMs と同じ。 */
  fadeOutMs?: number;
  /** フェード前のディレイ */
  delayMs?: number;
  /**
   * 自動送り Delay（ms）。GROUP の子 CUE のみ有効。
   * 設定すると、SHOW モードでこの CUE を発火してから followMs 後に
   * GROUP 内の次の子 CUE へ自動で進む（末尾は loop のときのみ先頭へ）。
   * 省略時は自動送りせず、手動 GO 待ち。
   */
  followMs?: number;
}

// ===== Action ボタン =====
// Action は単一の look（programmer の ch 値スナップショット）。step[0] を look として使う。
export interface ActionStep {
  values: Record<number, number>;
  fadeInMs: number;
  holdMs?: number;
}

export interface ActionButton {
  id: string;
  name?: string;
  /** look 本体。step[0] のみ使用（モード/チェイスは廃止）。 */
  steps: ActionStep[];
}

// ===== Timeline =====
export interface Timeline {
  points: TimelinePoint[];
  /**
   * 追加オーディオトラック（メイン音声 Show.audio とは別）。各トラックに複数クリップを任意位置へ配置できる。
   * 未定義/不足時は読込・編集時に固定 {@link AUDIO_TRACK_COUNT} 本へ補完する（ensureAudioTracks）。
   */
  audioTracks?: AudioTrack[];
}

/** 追加オーディオトラックの本数（メイン音声とは別の固定数）。 */
export const AUDIO_TRACK_COUNT = 3;

/** 追加トラック上の音声クリップ。任意位置へ配置・ドラッグ移動できる。 */
export interface AudioClip {
  id: string;
  /**
   * 音声ファイルパス。メモリ上は常に絶対パス。保存時、Project ファイル配下なら相対（POSIX）で書き出し、
   * 読込時に絶対へ戻す（src/main/projectPaths.ts）。Show.audio と同じ規約。
   */
  filePath: string;
  /** タイムライン上の開始位置（ms）。 */
  startMs: number;
  /** クリップ尺（ms）。デコード/loadedmetadata 時に確定し永続化。ブロック幅算出に使用。 */
  durationMs: number;
}

/** 追加オーディオトラック（複数クリップ + 個別音量/ミュート/ソロ）。 */
export interface AudioTrack {
  id: string;
  name?: string;
  clips: AudioClip[];
  /** 0..1。 */
  volume: number;
  muted: boolean;
  solo: boolean;
  /** 出力先デバイス（enumerateDevices の deviceId）。未指定/空 = OS 既定。マシン固有・非可搬。 */
  outputDeviceId?: string;
}

export interface TimelinePoint {
  /** 音声内の位置 */
  timecodeMs: number;
  /** 指定すればそのグループのみ GO / 省略で全グループ一斉（§11-③） */
  groupId?: string;
  /**
   * 紐づく CUE の id。指定すると跨いだとき**その CUE へ goTo**（頭出し）する。
   * 省略時は従来どおりマスター列を1つ順送り（GO）。
   * 参照先 CUE が削除済みなら順送りにフォールバック。
   */
  cueId?: string;
  type: 'go';
}

// ===== エンジン実行時状態（§8・非永続） =====
/** 進行中フェード。 */
export interface FadeState {
  from: number[];
  to: number[];
  startMs: number;
  /** 上昇(値が増える)方向のフェード時間（ms）。 */
  durMs: number;
  /** 下降(値が減る)方向のフェード時間（ms）。省略時は durMs と同じ。 */
  durOutMs?: number;
  /** フェード開始前のディレイ（ms）。 */
  delayMs: number;
}

/**
 * 読込中 Show の単一プレイヘッド。
 * マスター列を1本の GO で順送りするため、再生状態は1つだけ。
 */
export interface ShowRuntime {
  /** マスター列 index。未 GO は -1。 */
  mainIndex: number;
  /** GROUP 内の子 cue index。CUE エントリでは 0。 */
  subIndex: number;
  /** 512: 現在表示値（これまでの CUE で確定した値）。 */
  tracked: number[];
  /** 進行中フェード（無ければ null）。 */
  fade: FadeState | null;
  /**
   * GROUP 子 CUE の自動送り発火時刻（ms・絶対 now 基準）。無ければ null。
   * playPosition でスケジュールし、tick で now>=この値かつ SHOW モードなら次の子へ進む。
   */
  followAtMs: number | null;
  /**
   * 512: この Show が制御する ch（全 cue= 子含む の values キーの和集合）。
   * 非永続。loadShow 時と編集時に再計算する（§6 層3 の制御判定に使う）。
   */
  controlled: boolean[];
}

/**
 * 操作モード。
 * - 'edit': CUE オーサリング。CUE 選択中ならフェーダー操作を選択 CUE へリアルタイム書き込み。
 *   未選択ならライブ直接出力（保存なし）。編集機能 有効。
 * - 'show': 作成系の編集を全ブロック。フェーダー操作は busking ライブ上書き（保存なし）。
 */
export type EngineMode = 'edit' | 'show';

export interface EngineRuntime {
  activeShowId: string | null;
  /** 読込中 Show の再生状態（未読込は null）。 */
  show: ShowRuntime | null;
  /** 512: SHOW モードの busking ライブ上書き中 ch（保存しない一時オーバーライド）。 */
  busking: boolean[];
  /** 512: 現在のフェーダー位置 */
  faderLive: number[];
  /**
   * Action フェード取り込み中の faderLive 補間（無ければ null・非永続）。
   * tick ごとに from→to を進め、look 対象 ch の faderLive を更新する。
   */
  faderFade: FadeState | null;
  /**
   * EDIT モードで編集対象に選択中の Action id（非永続・既定 null）。
   * 非 null の間、フェーダー操作はその Action の look（step0）へ書き込まれる（CUE 編集と同じ思想）。
   */
  editingActionId: string | null;
  /** 操作モード（非永続・既定 'edit'）。 */
  mode: EngineMode;
  /** グランドマスター（全体調光 0-255・非永続・既定 255）。最終出力に乗算。 */
  masterLevel: number;
  /** ブラックアウト（非永続・既定 false）。true で全 ch を 0 出力。 */
  blackout: boolean;
  /** 512: 直近の計算済みフレーム */
  output: number[];
}

/** デフォルトの Art-Net 設定（既定は無効・ローカルのビジュアライザ/ノード向け）。 */
export function defaultArtnetSettings(): ArtnetSettings {
  return {
    enabled: false,
    targetIp: '127.0.0.1',
    universe: 0,
    net: 0,
    subnet: 0,
    refreshRateHz: 40,
  };
}

/** デフォルトの USB-DMX 設定（既定は無効・ポート未選択・OpenDMX）。 */
export function defaultOpenDmxSettings(): OpenDmxSettings {
  return {
    enabled: false,
    portPath: '',
    kind: 'opendmx',
  };
}

/** 現在の永続化フォーマットのバージョン。 */
export const PROJECT_VERSION = 1;

/** 新規 Project の初期値。 */
export function createDefaultProject(): Project {
  return {
    version: PROJECT_VERSION,
    name: 'Untitled',
    settings: {
      universeCount: 1,
      releaseFadeMs: 0,
    },
    faders: new Array(UNIVERSE_SIZE).fill(0),
    actions: [],
    shows: [],
  };
}

/** Node / ブラウザ双方で使える UUID 生成。 */
export function genId(): string {
  // Electron(renderer/main) も Node 20+ も globalThis.crypto.randomUUID を持つ。
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // フォールバック（テスト環境など）。
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** 新規 Show（空のマスター列）。 */
export function createShow(name = 'Show 1'): Show {
  return { id: genId(), name, sequence: [] };
}

/** 新規 Folder。 */
export function createFolder(name = 'フォルダ'): Folder {
  return { id: genId(), name };
}

/** 新規 Setlist（空の Show 参照列）。 */
export function createSetlist(name = 'Setlist 1'): Setlist {
  return { id: genId(), name, entries: [] };
}

/** Show 参照を 1 エントリに包む。 */
export function createSetlistEntry(showId: string): SetlistEntry {
  return { id: genId(), showId };
}

/** 新規 RGB フィクスチャ。 */
export function createRgbFixture(r: number, g: number, b: number, name?: string): RgbFixture {
  return { id: genId(), name, r, g, b };
}

/** 新規 Group（空の子 CUE 列）。 */
export function createGroup(name = 'Group'): Group {
  return { id: genId(), name, cues: [], loop: false };
}

/** CUE をマスター列エントリに包む。 */
export function createCueEntry(cue: Cue): SequenceEntry {
  return { kind: 'cue', cue };
}

/** 新規 GROUP エントリ。 */
export function createGroupEntry(name = 'Group'): SequenceEntry {
  return { kind: 'group', group: createGroup(name) };
}

/** 新規 ShowRuntime（未 GO・tracked 全 0・制御無し）。 */
export function createShowRuntime(): ShowRuntime {
  return {
    mainIndex: -1,
    subIndex: 0,
    tracked: new Array(UNIVERSE_SIZE).fill(0),
    fade: null,
    followAtMs: null,
    controlled: new Array(UNIVERSE_SIZE).fill(false),
  };
}

/** 新規 ActionButton（空の look）。 */
export function createAction(name = 'Action'): ActionButton {
  return { id: genId(), name, steps: [] };
}
