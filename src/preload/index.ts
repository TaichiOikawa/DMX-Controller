/**
 * preload スクリプト。contextBridge 経由で型付き API `window.dmx` を公開する。
 * contextIsolation 下で renderer に Node/ipcRenderer を直接露出させない。
 *
 * vite.config.ts の設定により CommonJS(.cjs) として出力される。
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  Cmd,
  Evt,
  type ActionPatch,
  type CaptureCueOptions,
  type CuePatch,
  type DmxBridge,
  type EngineStateSnapshot,
} from '../shared/ipc';
import type { ArtnetSettings, Project } from '../shared/types';

/** Evt 購読の共通ヘルパ。解除関数を返す。 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api: DmxBridge = {
  // フェーダー / 設定
  setFader(ch, value) {
    ipcRenderer.send(Cmd.setFader, { ch, value });
  },
  updateArtnetSettings(settings: ArtnetSettings) {
    ipcRenderer.send(Cmd.updateArtnetSettings, settings);
  },
  getEngineState() {
    return ipcRenderer.invoke(Cmd.getEngineState) as Promise<EngineStateSnapshot>;
  },
  getProject() {
    return ipcRenderer.invoke(Cmd.getProject) as Promise<Project>;
  },
  setMode(mode) {
    ipcRenderer.send(Cmd.setMode, mode);
  },

  // 再生
  loadShow(showId) {
    ipcRenderer.send(Cmd.loadShow, showId);
  },
  unloadShow() {
    ipcRenderer.send(Cmd.unloadShow);
  },
  go() {
    ipcRenderer.send(Cmd.go);
  },
  goTo(mainIndex, subIndex) {
    ipcRenderer.send(Cmd.goTo, mainIndex, subIndex);
  },

  // オーサリング
  newShow(name) {
    ipcRenderer.send(Cmd.newShow, name);
  },
  recordCue(showId, opts?: CaptureCueOptions) {
    ipcRenderer.send(Cmd.recordCue, showId, opts);
  },
  addGroupEntry(showId, name) {
    ipcRenderer.send(Cmd.addGroupEntry, showId, name);
  },
  setGroupLoop(groupId, loop) {
    ipcRenderer.send(Cmd.setGroupLoop, groupId, loop);
  },
  updateCue(cueId, patch: CuePatch) {
    ipcRenderer.send(Cmd.updateCue, cueId, patch);
  },
  deleteEntry(showId, entryId) {
    ipcRenderer.send(Cmd.deleteEntry, showId, entryId);
  },
  deleteCueFromGroup(groupId, cueId) {
    ipcRenderer.send(Cmd.deleteCueFromGroup, groupId, cueId);
  },
  moveEntry(showId, entryId, toIndex) {
    ipcRenderer.send(Cmd.moveEntry, showId, entryId, toIndex);
  },
  moveCueInGroup(groupId, cueId, toIndex) {
    ipcRenderer.send(Cmd.moveCueInGroup, groupId, cueId, toIndex);
  },

  // キャプチャ / リリース
  releaseCapture(channels?: number[]) {
    ipcRenderer.send(Cmd.releaseCapture, channels);
  },

  // Action
  actionDown(actionId) {
    ipcRenderer.send(Cmd.actionDown, actionId);
  },
  actionUp(actionId) {
    ipcRenderer.send(Cmd.actionUp, actionId);
  },
  addAction(name) {
    ipcRenderer.send(Cmd.addAction, name);
  },
  updateAction(actionId, patch: ActionPatch) {
    ipcRenderer.send(Cmd.updateAction, actionId, patch);
  },
  deleteAction(actionId) {
    ipcRenderer.send(Cmd.deleteAction, actionId);
  },
  addActionStep(actionId, fadeInMs, holdMs) {
    ipcRenderer.send(Cmd.addActionStep, actionId, fadeInMs, holdMs);
  },
  deleteActionStep(actionId, stepIndex) {
    ipcRenderer.send(Cmd.deleteActionStep, actionId, stepIndex);
  },

  // Timeline
  reportAudioPlayhead(ms) {
    ipcRenderer.send(Cmd.reportAudioPlayhead, ms);
  },
  timelineSeek(ms) {
    ipcRenderer.send(Cmd.timelineSeek, ms);
  },
  timelineStop() {
    ipcRenderer.send(Cmd.timelineStop);
  },
  addTimelinePoint(showId, timecodeMs) {
    ipcRenderer.send(Cmd.addTimelinePoint, showId, timecodeMs);
  },
  deleteTimelinePoint(showId, index) {
    ipcRenderer.send(Cmd.deleteTimelinePoint, showId, index);
  },

  // 永続化
  newProject() {
    ipcRenderer.send(Cmd.newProject);
  },
  saveProject() {
    return ipcRenderer.invoke(Cmd.saveProject) as ReturnType<DmxBridge['saveProject']>;
  },
  loadProject() {
    return ipcRenderer.invoke(Cmd.loadProject) as ReturnType<DmxBridge['loadProject']>;
  },

  // 購読
  onOutputFrame(cb) {
    return subscribe<number[]>(Evt.outputFrame, cb);
  },
  onEngineState(cb) {
    return subscribe<EngineStateSnapshot>(Evt.engineState, cb);
  },
  onProject(cb) {
    return subscribe<Project>(Evt.project, cb);
  },
};

contextBridge.exposeInMainWorld('dmx', api);
