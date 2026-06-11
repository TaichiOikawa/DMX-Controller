/**
 * preload スクリプト。contextBridge 経由で型付き API `window.dmx` を公開する。
 * contextIsolation 下で renderer に Node/ipcRenderer を直接露出させない。
 *
 * vite.config.ts の設定により CommonJS(.cjs) として出力される。
 */

import { contextBridge, ipcRenderer } from 'electron';
import { Cmd, Evt, type DmxBridge, type EngineStateSnapshot } from '../shared/ipc';
import type { ArtnetSettings } from '../shared/types';

const api: DmxBridge = {
  setFader(ch, value) {
    ipcRenderer.send(Cmd.setFader, { ch, value });
  },
  updateArtnetSettings(settings: ArtnetSettings) {
    ipcRenderer.send(Cmd.updateArtnetSettings, settings);
  },
  getEngineState() {
    return ipcRenderer.invoke(Cmd.getEngineState) as Promise<EngineStateSnapshot>;
  },
  onOutputFrame(cb) {
    const listener = (_e: unknown, frame: number[]) => cb(frame);
    ipcRenderer.on(Evt.outputFrame, listener);
    return () => ipcRenderer.removeListener(Evt.outputFrame, listener);
  },
  onEngineState(cb) {
    const listener = (_e: unknown, state: EngineStateSnapshot) => cb(state);
    ipcRenderer.on(Evt.engineState, listener);
    return () => ipcRenderer.removeListener(Evt.engineState, listener);
  },
};

contextBridge.exposeInMainWorld('dmx', api);
