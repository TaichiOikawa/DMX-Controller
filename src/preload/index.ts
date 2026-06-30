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
  type AddCueOptions,
  type CuePatch,
  type AudioLevels,
  type DirtyState,
  type DmxBridge,
  type EngineStateSnapshot,
  type MenuAction,
  type UiState,
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
  setMasterLevel(level) {
    ipcRenderer.send(Cmd.setMasterLevel, level);
  },
  setBlackout(on) {
    ipcRenderer.send(Cmd.setBlackout, on);
  },
  setChannelLabel(ch, label) {
    ipcRenderer.send(Cmd.setChannelLabel, ch, label);
  },
  setBankLabel(bank, label) {
    ipcRenderer.send(Cmd.setBankLabel, bank, label);
  },
  addFixture(init) {
    ipcRenderer.send(Cmd.addFixture, init);
  },
  updateFixture(id, patch) {
    ipcRenderer.send(Cmd.updateFixture, id, patch);
  },
  deleteFixture(id) {
    ipcRenderer.send(Cmd.deleteFixture, id);
  },
  openColorPicker() {
    ipcRenderer.send(Cmd.openColorPicker);
  },
  openMonitor() {
    ipcRenderer.send(Cmd.openMonitor);
  },
  notifyUiState(state: UiState) {
    ipcRenderer.send(Cmd.uiState, state);
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
  goBack() {
    ipcRenderer.send(Cmd.goBack);
  },
  goTo(mainIndex, subIndex) {
    ipcRenderer.send(Cmd.goTo, mainIndex, subIndex);
  },
  deselectCue() {
    ipcRenderer.send(Cmd.deselectCue);
  },
  holdFade() {
    ipcRenderer.send(Cmd.holdFade);
  },
  undo() {
    ipcRenderer.send(Cmd.undo);
  },
  redo() {
    ipcRenderer.send(Cmd.redo);
  },

  // オーサリング
  newShow(name) {
    ipcRenderer.send(Cmd.newShow, name);
  },
  renameShow(showId, name) {
    ipcRenderer.send(Cmd.renameShow, showId, name);
  },
  deleteShow(showId) {
    ipcRenderer.send(Cmd.deleteShow, showId);
  },
  addFolder(name) {
    ipcRenderer.send(Cmd.addFolder, name);
  },
  renameFolder(folderId, name) {
    ipcRenderer.send(Cmd.renameFolder, folderId, name);
  },
  deleteFolder(folderId) {
    ipcRenderer.send(Cmd.deleteFolder, folderId);
  },
  setShowFolder(showId, folderId) {
    ipcRenderer.send(Cmd.setShowFolder, showId, folderId);
  },
  addCue(showId, opts?: AddCueOptions) {
    ipcRenderer.send(Cmd.addCue, showId, opts);
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
  deleteCueChannel(cueId, ch) {
    ipcRenderer.send(Cmd.deleteCueChannel, cueId, ch);
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
  duplicateEntry(showId, entryId) {
    ipcRenderer.send(Cmd.duplicateEntry, showId, entryId);
  },
  duplicateCueInGroup(groupId, cueId) {
    ipcRenderer.send(Cmd.duplicateCueInGroup, groupId, cueId);
  },

  // キャプチャ / リリース
  releaseCapture(channels?: number[]) {
    ipcRenderer.send(Cmd.releaseCapture, channels);
  },

  // Action
  actionDown(actionId, fadeMs) {
    ipcRenderer.send(Cmd.actionDown, actionId, fadeMs);
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
  overwriteAction(actionId) {
    ipcRenderer.send(Cmd.overwriteAction, actionId);
  },
  selectActionForEdit(actionId) {
    ipcRenderer.send(Cmd.selectActionForEdit, actionId);
  },
  deselectAction() {
    ipcRenderer.send(Cmd.deselectAction);
  },
  captureAction(actionId, fadeMs) {
    ipcRenderer.send(Cmd.captureAction, actionId, fadeMs);
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
  addTimelinePoint(showId, timecodeMs, cueId) {
    ipcRenderer.send(Cmd.addTimelinePoint, showId, timecodeMs, cueId);
  },
  deleteTimelinePoint(showId, index) {
    ipcRenderer.send(Cmd.deleteTimelinePoint, showId, index);
  },
  updateTimelinePoint(showId, index, timecodeMs) {
    ipcRenderer.send(Cmd.updateTimelinePoint, showId, index, timecodeMs);
  },
  setTimelinePointCue(showId, index, cueId) {
    ipcRenderer.send(Cmd.setTimelinePointCue, showId, index, cueId);
  },
  pickShowAudio(showId) {
    return ipcRenderer.invoke(Cmd.pickShowAudio, showId) as ReturnType<DmxBridge['pickShowAudio']>;
  },
  clearShowAudio(showId) {
    ipcRenderer.send(Cmd.clearShowAudio, showId);
  },
  setMainAudioProps(showId, props) {
    ipcRenderer.send(Cmd.setMainAudioProps, showId, props);
  },
  readAudioFile(filePath) {
    return ipcRenderer.invoke(Cmd.readAudioFile, filePath) as ReturnType<DmxBridge['readAudioFile']>;
  },
  relinkAudioFromFolder() {
    return ipcRenderer.invoke(Cmd.relinkAudioFromFolder) as ReturnType<
      DmxBridge['relinkAudioFromFolder']
    >;
  },
  checkMissingFiles() {
    return ipcRenderer.invoke(Cmd.checkMissingFiles) as ReturnType<
      DmxBridge['checkMissingFiles']
    >;
  },

  // 追加オーディオトラック / クリップ
  pickAudioClip() {
    return ipcRenderer.invoke(Cmd.pickAudioClip) as ReturnType<DmxBridge['pickAudioClip']>;
  },
  addAudioClip(showId, trackIndex, filePath, startMs, durationMs) {
    ipcRenderer.send(Cmd.addAudioClip, showId, trackIndex, filePath, startMs, durationMs);
  },
  moveAudioClip(showId, trackIndex, clipId, startMs) {
    ipcRenderer.send(Cmd.moveAudioClip, showId, trackIndex, clipId, startMs);
  },
  removeAudioClip(showId, trackIndex, clipId) {
    ipcRenderer.send(Cmd.removeAudioClip, showId, trackIndex, clipId);
  },
  clearAudioTrack(showId, trackIndex) {
    ipcRenderer.send(Cmd.clearAudioTrack, showId, trackIndex);
  },
  setAudioTrackProps(showId, trackIndex, props) {
    ipcRenderer.send(Cmd.setAudioTrackProps, showId, trackIndex, props);
  },
  reportAudioLevels(levels) {
    ipcRenderer.send(Cmd.reportAudioLevels, levels);
  },

  // 永続化
  newProject() {
    ipcRenderer.send(Cmd.newProject);
  },
  saveProject() {
    return ipcRenderer.invoke(Cmd.saveProject) as ReturnType<DmxBridge['saveProject']>;
  },
  saveProjectOverwrite() {
    return ipcRenderer.invoke(
      Cmd.saveProjectOverwrite,
    ) as ReturnType<DmxBridge['saveProjectOverwrite']>;
  },
  loadProject() {
    return ipcRenderer.invoke(Cmd.loadProject) as ReturnType<DmxBridge['loadProject']>;
  },

  // Show 単体の書き出し / 読み込み
  exportShow(showId) {
    return ipcRenderer.invoke(Cmd.exportShow, showId) as ReturnType<DmxBridge['exportShow']>;
  },
  pickShowFile() {
    return ipcRenderer.invoke(Cmd.pickShowFile) as ReturnType<DmxBridge['pickShowFile']>;
  },
  importShow(show) {
    ipcRenderer.send(Cmd.importShow, show);
  },
  exportLyrics(showId) {
    return ipcRenderer.invoke(Cmd.exportLyrics, showId) as ReturnType<DmxBridge['exportLyrics']>;
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
  onDirty(cb) {
    return subscribe<DirtyState>(Evt.dirty, cb);
  },
  onMenuAction(cb) {
    return subscribe<MenuAction>(Evt.menuAction, cb);
  },
  onAudioLevels(cb) {
    return subscribe<AudioLevels>(Evt.audioLevels, cb);
  },
};

contextBridge.exposeInMainWorld('dmx', api);
