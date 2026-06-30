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

export interface ArtnetSettings {
  /** 送信先ノード or ブロードキャストアドレス */
  targetIp: string;
  /** Art-Net universe (0-15) */
  universe: number;
  net: number;
  subnet: number;
  /** 出力ループのリフレッシュレート (~40Hz) */
  refreshRateHz: number;
}

export interface ProjectSettings {
  /** 当面 1 */
  universeCount: number;
  artnet: ArtnetSettings;
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
   * 音声ファイルパス。メモリ上は常に絶対パス。保存時、Project ファイルの配下にある場合のみ
   * 相対パス（POSIX 区切り）でディスクへ書き出し、読込時に絶対パスへ戻す（src/main/projectPaths.ts）。
   */
  audio?: { filePath: string };
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

/** デフォルトの Art-Net 設定（ローカルのビジュアライザ/ノード向け）。 */
export function defaultArtnetSettings(): ArtnetSettings {
  return {
    targetIp: '127.0.0.1',
    universe: 0,
    net: 0,
    subnet: 0,
    refreshRateHz: 40,
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
      artnet: defaultArtnetSettings(),
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
