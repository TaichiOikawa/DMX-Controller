/**
 * renderer 側 UI 状態（Zustand）。
 *
 * エンジンが「単一の真実」なので、ここはあくまで UI ミラー:
 *   - faders: ユーザーが操作したフェーダー位置（楽観的に即時反映）
 *   - output: エンジンから受け取った実出力（可視化用）
 *   - artnet / measuredHz: 設定と診断
 *
 * フェーダー操作は store を更新しつつ window.dmx.setFader でエンジンへ送る。
 */

import { create } from 'zustand';
import { UNIVERSE_SIZE, type ArtnetSettings, defaultArtnetSettings } from '../shared/types';

interface DmxState {
  /** UI 上のフェーダー位置（0-255）。 */
  faders: number[];
  /** エンジン由来の実出力（0-255）。 */
  output: number[];
  artnet: ArtnetSettings;
  measuredHz: number;
  /** 表示中のバンク（ページ）番号。 */
  bank: number;

  setFader: (ch: number, value: number) => void;
  setOutput: (frame: number[]) => void;
  setArtnet: (settings: ArtnetSettings) => void;
  setMeasuredHz: (hz: number) => void;
  setBank: (bank: number) => void;
}

export const FADERS_PER_BANK = 32;
export const BANK_COUNT = UNIVERSE_SIZE / FADERS_PER_BANK; // 16

export const useDmxStore = create<DmxState>((set) => ({
  faders: new Array(UNIVERSE_SIZE).fill(0),
  output: new Array(UNIVERSE_SIZE).fill(0),
  artnet: defaultArtnetSettings(),
  measuredHz: 0,
  bank: 0,

  setFader: (ch, value) =>
    set((s) => {
      const faders = s.faders.slice();
      faders[ch] = value;
      // エンジンへ意図を送る（§3: UI は意図のみを IPC で送る）。
      window.dmx.setFader(ch, value);
      return { faders };
    }),

  setOutput: (frame) => set({ output: frame }),

  setArtnet: (settings) =>
    set(() => {
      window.dmx.updateArtnetSettings(settings);
      return { artnet: settings };
    }),

  setMeasuredHz: (hz) => set({ measuredHz: hz }),
  setBank: (bank) => set({ bank }),
}));
