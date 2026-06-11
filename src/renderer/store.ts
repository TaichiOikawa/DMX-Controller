/**
 * renderer 側 UI 状態（Zustand）。
 *
 * エンジンが「単一の真実」なので、ここは UI ミラー:
 *   - faders: フェーダー位置（楽観的に即時反映 + エンジンへ送信）
 *   - output: エンジンの実出力（可視化用）
 *   - project: Show/Group/Cue 構造（編集対象、エンジンから受信）
 *   - groups: 各グループの再生状態（currentIndex 等、エンジンから受信）
 *   - artnet / measuredHz: 設定と診断
 */

import { create } from 'zustand';
import {
  UNIVERSE_SIZE,
  type ArtnetSettings,
  type Project,
  defaultArtnetSettings,
} from '../shared/types';
import type { EngineStateSnapshot, PlaybackStatus } from '../shared/ipc';

interface DmxState {
  faders: number[];
  output: number[];
  artnet: ArtnetSettings;
  measuredHz: number;
  bank: number;

  project: Project | null;
  /** 読込中 Show の単一プレイヘッド状態（未読込は null）。 */
  playback: PlaybackStatus | null;
  activeShowId: string | null;
  /** 編集対象として選択中の Show（ドロップダウン用）。 */
  selectedShowId: string | null;

  setFader: (ch: number, value: number) => void;
  setOutput: (frame: number[]) => void;
  setArtnet: (settings: ArtnetSettings) => void;
  setBank: (bank: number) => void;
  setProject: (project: Project) => void;
  setEngineState: (state: EngineStateSnapshot) => void;
  selectShow: (showId: string) => void;
}

export const FADERS_PER_BANK = 32;
export const BANK_COUNT = UNIVERSE_SIZE / FADERS_PER_BANK; // 16

export const useDmxStore = create<DmxState>((set) => ({
  faders: new Array(UNIVERSE_SIZE).fill(0),
  output: new Array(UNIVERSE_SIZE).fill(0),
  artnet: defaultArtnetSettings(),
  measuredHz: 0,
  bank: 0,

  project: null,
  playback: null,
  activeShowId: null,
  selectedShowId: null,

  setFader: (ch, value) =>
    set((s) => {
      const faders = s.faders.slice();
      faders[ch] = value;
      window.dmx.setFader(ch, value);
      return { faders };
    }),

  setOutput: (frame) => set({ output: frame }),

  setArtnet: (settings) =>
    set(() => {
      window.dmx.updateArtnetSettings(settings);
      return { artnet: settings };
    }),

  setBank: (bank) => set({ bank }),

  setProject: (project) =>
    set((s) => {
      // 選択中 Show が消えていたら先頭へ寄せる。
      const stillExists = project.shows.some((sh) => sh.id === s.selectedShowId);
      const selectedShowId = stillExists
        ? s.selectedShowId
        : (project.shows[0]?.id ?? null);
      return {
        project,
        // Project にはフェーダー基準値が含まれる（読込時に反映）。
        faders: project.faders.slice(),
        artnet: project.settings.artnet,
        selectedShowId,
      };
    }),

  setEngineState: (state) =>
    set({
      measuredHz: state.measuredHz,
      playback: state.playback,
      activeShowId: state.activeShowId,
    }),

  selectShow: (showId) => set({ selectedShowId: showId }),
}));
