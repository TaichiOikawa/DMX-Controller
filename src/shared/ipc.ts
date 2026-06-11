/**
 * IPC 契約（§9）。チャンネル名とペイロード型の単一定義。
 *
 * main / preload / renderer すべてがこの定義を参照することで、
 * 文字列チャンネル名のタイプミスとペイロード型の不一致を防ぐ。
 *
 * 今回のマイルストーンで実際に配線するのは
 *   - UI → Engine: setFader / updateArtnetSettings
 *   - Engine → UI: outputFrame / engineState
 * のみ。残りの §9 コマンドはチャンネル名だけ予約しておき、
 * 後続マイルストーンで実装する。
 */

import type { ArtnetSettings } from './types';

/** UI → Engine（コマンド）チャンネル名。 */
export const Cmd = {
  // --- 今回実装 ---
  setFader: 'cmd:setFader',
  updateArtnetSettings: 'cmd:updateArtnetSettings',
  getEngineState: 'cmd:getEngineState',

  // --- 予約（後続マイルストーン） ---
  loadShow: 'cmd:loadShow',
  unloadShow: 'cmd:unloadShow',
  go: 'cmd:go',
  goGroup: 'cmd:goGroup',
  releaseCapture: 'cmd:releaseCapture',
  actionDown: 'cmd:actionDown',
  actionUp: 'cmd:actionUp',
  timelinePlay: 'cmd:timelinePlay',
  timelinePause: 'cmd:timelinePause',
  timelineStop: 'cmd:timelineStop',
  timelineSeek: 'cmd:timelineSeek',
  reportAudioPlayhead: 'cmd:reportAudioPlayhead',
  captureCueFromFaders: 'cmd:captureCueFromFaders',
  saveProject: 'cmd:saveProject',
  loadProject: 'cmd:loadProject',
} as const;

/** Engine → UI（イベント）チャンネル名。 */
export const Evt = {
  /** 可視化用の出力フレーム（~30Hz に間引き） */
  outputFrame: 'evt:outputFrame',
  /** 各グループの現在 CUE / captured ch / timeline 再生位置 等 */
  engineState: 'evt:engineState',
} as const;

// ===== ペイロード型 =====

export interface SetFaderPayload {
  /** 0-511 */
  ch: number;
  /** 0-255 */
  value: number;
}

/** 可視化用に間引かれた状態スナップショット（§9 `state`）。 */
export interface EngineStateSnapshot {
  activeShowId: string | null;
  /** 512: captured フラグ */
  captured: boolean[];
  artnet: ArtnetSettings;
  /** 実際の送出レート計測値（Hz）。診断用。 */
  measuredHz: number;
}

/**
 * preload が contextBridge 経由で renderer に公開する API の形。
 * renderer 側はこの型で `window.dmx` を参照する。
 */
export interface DmxBridge {
  setFader(ch: number, value: number): void;
  updateArtnetSettings(settings: ArtnetSettings): void;
  getEngineState(): Promise<EngineStateSnapshot>;
  /** outputFrame 購読。解除関数を返す。 */
  onOutputFrame(cb: (frame: number[]) => void): () => void;
  /** engineState 購読。解除関数を返す。 */
  onEngineState(cb: (state: EngineStateSnapshot) => void): () => void;
}
