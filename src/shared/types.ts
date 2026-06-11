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
  groups: Group[];
  /** Project フォルダからの相対パス */
  audio?: { filePath: string };
  timeline?: Timeline;
}

// ===== Group（並列プレイバック / キューリスト） =====
export interface Group {
  id: string;
  name?: string;
  /** 順序付き CUE 列 */
  cues: Cue[];
  /** グループ内ループ */
  loop: boolean;
}

// ===== Cue =====
export interface Cue {
  id: string;
  name?: string;
  /** 操作対象 ch のみ: chIndex(0-511) -> 値(0-255) */
  values: Record<number, number>;
  /** フェード時間 */
  fadeInMs: number;
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
export interface GroupRuntime {
  currentIndex: number;
  /** 512: これまでの CUE で確定した値 */
  tracked: number[];
  /** 進行中フェード（無ければ null） */
  fade: {
    from: number[];
    to: number[];
    startMs: number;
    durMs: number;
  } | null;
}

export interface EngineRuntime {
  activeShowId: string | null;
  groups: Record<string, GroupRuntime>;
  /** 512 */
  captured: boolean[];
  /** 512: 現在のフェーダー位置 */
  faderLive: number[];
  /** 押下中の ActionButton id */
  activeActions: string[];
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

/** 新規 Project の初期値。 */
export function createDefaultProject(): Project {
  return {
    version: 1,
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
