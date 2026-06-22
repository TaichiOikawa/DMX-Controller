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
  /**
   * マスター順序リスト。単一の GO ボタンで先頭から順送りに再生する。
   * 各エントリは CUE（単一 look）か GROUP（子 CUE を束ねた入れ子）。
   */
  sequence: SequenceEntry[];
  /** Project フォルダからの相対パス */
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
  /** GROUP 内ループ（末尾 GO で子先頭へ戻る） */
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
}

// ===== Action ボタン =====
export type ActionMode = 'hold-once' | 'hold-loop' | 'press-once';

export interface ActionStep {
  values: Record<number, number>;
  fadeInMs: number;
  /** チェイス時の各ステップ保持時間 */
  holdMs?: number;
}

export interface ActionButton {
  id: string;
  name?: string;
  mode: ActionMode;
  /** once=単一でも可 / loop=チェイス列 */
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
   * 512: この Show が制御する ch（全 cue= 子含む の values キーの和集合）。
   * 非永続。loadShow 時と編集時に再計算する（§6 層3 の制御判定に使う）。
   */
  controlled: boolean[];
}

/**
 * Action 実行時状態（§5.6・非永続）。最優先オーバーライド層（mixer 層1）。
 * 各アクティブ Action が自前の step 進行とフェードを持つ。
 */
export interface ActionRuntime {
  actionId: string;
  /** 再生中の step index。 */
  stepIndex: number;
  /** 現 step のフェード開始時刻（ms）。 */
  stepStartMs: number;
  /** 512: このアクションの現在出力値（フェード適用後）。 */
  values: number[];
  /** 進行中フェード（無ければ null）。 */
  fade: FadeState | null;
  /** 512: このアクションが制御する ch（全 step の和集合＝footprint）。 */
  controlled: boolean[];
  /** hold 系: 押下中か。離されたら解除。 */
  held: boolean;
}

/**
 * 操作モード。
 * - 'edit': show 制御下 ch を触ると現在 CUE を直接編集（capture しない）。編集機能 有効。
 * - 'show': 作成系の編集を全ブロック。show 制御下 ch を触るとプログラマー（capture）。
 */
export type EngineMode = 'edit' | 'show';

export interface EngineRuntime {
  activeShowId: string | null;
  /** 読込中 Show の再生状態（未読込は null）。 */
  show: ShowRuntime | null;
  /** 512 */
  captured: boolean[];
  /** 512: 現在のフェーダー位置 */
  faderLive: number[];
  /** アクティブな Action（最優先層）。 */
  activeActions: ActionRuntime[];
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
    controlled: new Array(UNIVERSE_SIZE).fill(false),
  };
}

/** 新規 ActionButton（1 step、既定 press-once）。 */
export function createAction(name = 'Action', mode: ActionMode = 'press-once'): ActionButton {
  return { id: genId(), name, mode, steps: [] };
}
