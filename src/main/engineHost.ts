/**
 * エンジンの I/O 層（§3）。Electron / Node 依存はここに閉じる。
 *
 * - Engine を生成し、UDP(dgram) で ArtDMX を送出する `send` を注入
 * - ipcMain で UI からのコマンド（フェーダー/再生/オーサリング/永続化）を Engine へ
 * - 出力フレームを ~30Hz に間引いて renderer へ転送（IPC 氾濫防止 §3）
 * - Project 変更・状態を renderer へ転送
 * - Project の保存/読込（dialog + fs）
 */

import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app, dialog, ipcMain, type WebContents } from 'electron';
import { Engine } from '../engine/Engine';
import {
  Cmd,
  Evt,
  type ActionPatch,
  type AddCueOptions,
  type AudioLevels,
  type CuePatch,
  type EngineStateSnapshot,
  type FixtureInit,
  type FixturePatch,
  type MissingFile,
  type SetFaderPayload,
  type UiState,
} from '../shared/ipc';
import { type ArtnetSettings, type Show, defaultArtnetSettings } from '../shared/types';
import {
  deserializeProject,
  deserializeShow,
  serializeProject,
  serializeShow,
} from '../shared/persistence';
import { resolveProjectAudioPaths, toPortableProject } from './projectPaths';

/** Art-Net の標準 UDP ポート。 */
const ARTNET_PORT = 6454;

/** renderer への outputFrame 転送間隔（ms）。33ms ≒ 30Hz。 */
const FRAME_FORWARD_INTERVAL_MS = 33;
/** engineState 転送間隔（ms）。状態は低頻度で十分。 */
const STATE_FORWARD_INTERVAL_MS = 250;
/** 自動バックアップ間隔（ms）。未保存変更があるときのみ書き出す。 */
const AUTOSAVE_INTERVAL_MS = 20_000;

const PROJECT_FILTERS = [
  { name: 'DMX Project', extensions: ['dmxproj', 'json'] },
  { name: 'All Files', extensions: ['*'] },
];

const AUDIO_FILTERS = [
  { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'] },
  { name: 'All Files', extensions: ['*'] },
];

const SHOW_FILTERS = [
  { name: 'DMX Show', extensions: ['dmxshow', 'json'] },
  { name: 'All Files', extensions: ['*'] },
];

type SaveLoadResult = { ok: boolean; path?: string; error?: string };

export class EngineHost {
  private readonly engine: Engine;
  private readonly socket: dgram.Socket;
  private artnet: ArtnetSettings;

  /** イベント配信先（メインウィンドウ + 別ウィンドウのカラーピッカー等）。 */
  private clients = new Set<WebContents>();
  private lastFrameSentAt = 0;
  private lastStateSentAt = 0;

  /** engine state 変化を main（メニュー再構築）へ通知するリスナ。 */
  private engineStateListener: ((state: EngineStateSnapshot) => void) | null = null;
  /** renderer から同期された UI 状態（タブ・パネル開閉）を main へ通知するリスナ。 */
  private uiStateListener: ((state: UiState) => void) | null = null;

  /** 未保存状態の追跡。最後の保存／読込時点の JSON と比較して判定する。 */
  private dirty = false;
  private lastSavedJson: string;
  private currentFilePath: string | null = null;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.artnet = defaultArtnetSettings();
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (err) => {
      console.error('[artnet] socket error:', err);
    });
    this.socket.bind(() => {
      try {
        this.socket.setBroadcast(true);
      } catch {
        /* 一部環境では bind 前/権限で失敗するが致命的ではない */
      }
    });

    this.engine = new Engine({
      artnet: this.artnet,
      send: (packet) => this.sendPacket(packet),
    });

    this.engine.onFrame((frame) => this.forwardFrame(frame));
    this.engine.onState((state) => {
      // 送信先 IP 等は Engine 側が真実（loadProject で変わりうる）。常に追従。
      this.artnet = state.artnet;
      this.broadcast(Evt.engineState, state);
      this.engineStateListener?.(state);
    });
    this.engine.onProject((project) => {
      this.broadcast(Evt.project, project);
      this.recomputeDirty();
    });

    // 起動直後の Project を「保存済み（クリーン）」の基準にする。
    this.lastSavedJson = serializeProject(this.engine.getProject());
  }

  // ===== 未保存（dirty）状態の管理 =====

  /** 現在の Project を最後の保存状態と比較し、変化があれば renderer へ通知する。 */
  private recomputeDirty(): void {
    const json = serializeProject(this.engine.getProject());
    const dirty = json !== this.lastSavedJson;
    if (dirty !== this.dirty) {
      this.dirty = dirty;
      this.emitDirty();
    }
  }

  /** 現在の Project を「保存済み」基準に更新し、dirty=false にする。 */
  private markClean(): void {
    this.lastSavedJson = serializeProject(this.engine.getProject());
    this.dirty = false;
    this.emitDirty();
  }

  private emitDirty(): void {
    this.broadcast(Evt.dirty, { dirty: this.dirty, filePath: this.currentFilePath });
  }

  /** 全クライアントへイベントを配信する（破棄済み webContents は除外）。 */
  private broadcast(channel: string, payload: unknown): void {
    for (const wc of this.clients) {
      if (wc.isDestroyed()) this.clients.delete(wc);
      else wc.send(channel, payload);
    }
  }

  /** main プロセス（ウィンドウ終了処理）から参照する。 */
  isDirty(): boolean {
    return this.dirty;
  }

  /** engine state 変化の通知先を登録する（メニュー再構築用）。 */
  setEngineStateListener(cb: (state: EngineStateSnapshot) => void): void {
    this.engineStateListener = cb;
  }

  /** renderer からの UI 状態同期の通知先を登録する（メニュー再構築用）。 */
  setUiStateListener(cb: (state: UiState) => void): void {
    this.uiStateListener = cb;
  }

  /** メニュー初期構築のために現在の engine state を返す。 */
  getEngineState(): EngineStateSnapshot {
    return this.engine.getState();
  }

  /** メインウィンドウの WebContents を登録し、現在の Project / 状態を初期送信する。 */
  attach(webContents: WebContents): void {
    this.addClient(webContents);
  }

  /**
   * イベント配信先を追加し、現在の Project / 状態を初期送信する。
   * 別ウィンドウ（カラーピッカー）の WebContents 登録にも使う。
   */
  addClient(webContents: WebContents): void {
    this.clients.add(webContents);
    webContents.once('destroyed', () => this.clients.delete(webContents));
    webContents.send(Evt.project, this.engine.getProject());
    webContents.send(Evt.engineState, this.engine.getState());
    webContents.send(Evt.dirty, { dirty: this.dirty, filePath: this.currentFilePath });
  }

  /** イベント配信先を解除する。 */
  removeClient(webContents: WebContents): void {
    this.clients.delete(webContents);
  }

  start(): void {
    this.engine.start();
    if (this.autosaveTimer === null) {
      this.autosaveTimer = setInterval(() => void this.autosaveBackup(), AUTOSAVE_INTERVAL_MS);
    }
  }

  stop(): void {
    this.engine.stop();
    if (this.autosaveTimer !== null) {
      clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
  }

  /** ipcMain ハンドラを登録する。 */
  registerIpc(): void {
    // --- フェーダー / 設定 ---
    ipcMain.on(Cmd.setFader, (_e, p: SetFaderPayload) => this.engine.setFader(p.ch, p.value));
    ipcMain.on(Cmd.updateArtnetSettings, (_e, s: ArtnetSettings) =>
      this.engine.updateArtnetSettings(s),
    );
    ipcMain.handle(Cmd.getEngineState, () => this.engine.getState());
    ipcMain.handle(Cmd.getProject, () => this.engine.getProject());
    ipcMain.on(Cmd.setMode, (_e, mode: 'edit' | 'show') => this.engine.setMode(mode));
    ipcMain.on(Cmd.setMasterLevel, (_e, level: number) => this.engine.setMasterLevel(level));
    ipcMain.on(Cmd.setBlackout, (_e, on: boolean) => this.engine.setBlackout(on));
    ipcMain.on(Cmd.setChannelLabel, (_e, ch: number, label: string) =>
      this.engine.setChannelLabel(ch, label),
    );
    ipcMain.on(Cmd.setBankLabel, (_e, bank: number, label: string) =>
      this.engine.setBankLabel(bank, label),
    );
    ipcMain.on(Cmd.addFixture, (_e, init: FixtureInit) => this.engine.addFixture(init));
    ipcMain.on(Cmd.updateFixture, (_e, id: string, patch: FixturePatch) =>
      this.engine.updateFixture(id, patch),
    );
    ipcMain.on(Cmd.deleteFixture, (_e, id: string) => this.engine.deleteFixture(id));
    ipcMain.on(Cmd.uiState, (_e, state: UiState) => this.uiStateListener?.(state));

    // --- 再生 ---
    ipcMain.on(Cmd.loadShow, (_e, showId: string) => this.engine.loadShow(showId));
    ipcMain.on(Cmd.unloadShow, () => this.engine.unloadShow());
    ipcMain.on(Cmd.go, () => this.engine.go());
    ipcMain.on(Cmd.goBack, () => this.engine.goBack());
    ipcMain.on(Cmd.goTo, (_e, mainIndex: number, subIndex: number) =>
      this.engine.goTo(mainIndex, subIndex),
    );
    ipcMain.on(Cmd.deselectCue, () => this.engine.deselectCue());
    ipcMain.on(Cmd.holdFade, () => this.engine.holdFade());

    // --- Undo / Redo ---
    ipcMain.on(Cmd.undo, () => this.engine.undo());
    ipcMain.on(Cmd.redo, () => this.engine.redo());

    // --- オーサリング ---
    ipcMain.on(Cmd.newShow, (_e, name?: string) => this.engine.newShow(name));
    ipcMain.on(Cmd.renameShow, (_e, showId: string, name: string) =>
      this.engine.renameShow(showId, name),
    );
    ipcMain.on(Cmd.deleteShow, (_e, showId: string) => this.engine.deleteShow(showId));
    ipcMain.on(Cmd.addFolder, (_e, name?: string) => this.engine.addFolder(name));
    ipcMain.on(Cmd.renameFolder, (_e, folderId: string, name: string) =>
      this.engine.renameFolder(folderId, name),
    );
    ipcMain.on(Cmd.deleteFolder, (_e, folderId: string) => this.engine.deleteFolder(folderId));
    ipcMain.on(Cmd.setShowFolder, (_e, showId: string, folderId: string | null) =>
      this.engine.setShowFolder(showId, folderId),
    );
    ipcMain.on(Cmd.addCue, (_e, showId: string, opts?: AddCueOptions) =>
      this.engine.addCue(showId, opts),
    );
    ipcMain.on(Cmd.addGroupEntry, (_e, showId: string, name?: string) =>
      this.engine.addGroupEntry(showId, name),
    );
    ipcMain.on(Cmd.setGroupLoop, (_e, groupId: string, loop: boolean) =>
      this.engine.setGroupLoop(groupId, loop),
    );
    ipcMain.on(Cmd.updateCue, (_e, cueId: string, patch: CuePatch) =>
      this.engine.updateCue(cueId, patch),
    );
    ipcMain.on(Cmd.deleteCueChannel, (_e, cueId: string, ch: number) =>
      this.engine.deleteCueChannel(cueId, ch),
    );
    ipcMain.on(Cmd.deleteEntry, (_e, showId: string, entryId: string) =>
      this.engine.deleteEntry(showId, entryId),
    );
    ipcMain.on(Cmd.deleteCueFromGroup, (_e, groupId: string, cueId: string) =>
      this.engine.deleteCueFromGroup(groupId, cueId),
    );
    ipcMain.on(Cmd.moveEntry, (_e, showId: string, entryId: string, toIndex: number) =>
      this.engine.moveEntry(showId, entryId, toIndex),
    );
    ipcMain.on(Cmd.moveCueInGroup, (_e, groupId: string, cueId: string, toIndex: number) =>
      this.engine.moveCueInGroup(groupId, cueId, toIndex),
    );
    ipcMain.on(Cmd.duplicateEntry, (_e, showId: string, entryId: string) =>
      this.engine.duplicateEntry(showId, entryId),
    );
    ipcMain.on(Cmd.duplicateCueInGroup, (_e, groupId: string, cueId: string) =>
      this.engine.duplicateCueInGroup(groupId, cueId),
    );

    // --- キャプチャ / リリース ---
    ipcMain.on(Cmd.releaseCapture, (_e, channels?: number[]) =>
      this.engine.releaseCapture(channels),
    );

    // --- Action ---
    ipcMain.on(Cmd.actionDown, (_e, id: string) => this.engine.actionDown(id));
    ipcMain.on(Cmd.actionUp, (_e, id: string) => this.engine.actionUp(id));
    ipcMain.on(Cmd.addAction, (_e, name?: string) => this.engine.addAction(name));
    ipcMain.on(Cmd.updateAction, (_e, id: string, patch: ActionPatch) =>
      this.engine.updateAction(id, patch),
    );
    ipcMain.on(Cmd.deleteAction, (_e, id: string) => this.engine.deleteAction(id));
    ipcMain.on(Cmd.addActionStep, (_e, id: string, fadeInMs?: number, holdMs?: number) =>
      this.engine.addActionStep(id, fadeInMs, holdMs),
    );
    ipcMain.on(Cmd.deleteActionStep, (_e, id: string, stepIndex: number) =>
      this.engine.deleteActionStep(id, stepIndex),
    );

    // --- Timeline ---
    ipcMain.on(Cmd.reportAudioPlayhead, (_e, ms: number) => this.engine.reportAudioPlayhead(ms));
    ipcMain.on(Cmd.timelineSeek, (_e, ms: number) => this.engine.timelineSeek(ms));
    ipcMain.on(Cmd.timelineStop, () => this.engine.timelineStop());
    ipcMain.on(Cmd.addTimelinePoint, (_e, showId: string, ms: number, cueId?: string) =>
      this.engine.addTimelinePoint(showId, ms, cueId),
    );
    ipcMain.on(Cmd.deleteTimelinePoint, (_e, showId: string, index: number) =>
      this.engine.deleteTimelinePoint(showId, index),
    );
    ipcMain.on(Cmd.updateTimelinePoint, (_e, showId: string, index: number, ms: number) =>
      this.engine.updateTimelinePoint(showId, index, ms),
    );
    ipcMain.on(
      Cmd.setTimelinePointCue,
      (_e, showId: string, index: number, cueId: string | undefined) =>
        this.engine.setTimelinePointCue(showId, index, cueId),
    );
    ipcMain.handle(Cmd.pickShowAudio, (_e, showId: string) => this.pickShowAudio(showId));
    ipcMain.on(Cmd.clearShowAudio, (_e, showId: string) => this.engine.clearShowAudio(showId));
    ipcMain.on(
      Cmd.setMainAudioProps,
      (_e, showId: string, props: { volume?: number; muted?: boolean; solo?: boolean; outputDeviceId?: string | null }) =>
        this.engine.setMainAudioProps(showId, props),
    );
    ipcMain.handle(Cmd.readAudioFile, (_e, filePath: string) => this.readAudioFile(filePath));
    ipcMain.handle(Cmd.relinkAudioFromFolder, () => this.relinkAudioFromFolder());
    ipcMain.handle(Cmd.checkMissingFiles, () => this.findMissingFiles());

    // --- 追加オーディオトラック / クリップ ---
    ipcMain.handle(Cmd.pickAudioClip, () => this.pickAudioClip());
    ipcMain.on(
      Cmd.addAudioClip,
      (_e, showId: string, trackIndex: number, filePath: string, startMs: number, durationMs: number) =>
        this.engine.addAudioClip(showId, trackIndex, filePath, startMs, durationMs),
    );
    ipcMain.on(Cmd.moveAudioClip, (_e, showId: string, trackIndex: number, clipId: string, startMs: number) =>
      this.engine.moveAudioClip(showId, trackIndex, clipId, startMs),
    );
    ipcMain.on(Cmd.removeAudioClip, (_e, showId: string, trackIndex: number, clipId: string) =>
      this.engine.removeAudioClip(showId, trackIndex, clipId),
    );
    ipcMain.on(Cmd.clearAudioTrack, (_e, showId: string, trackIndex: number) =>
      this.engine.clearAudioTrack(showId, trackIndex),
    );
    ipcMain.on(
      Cmd.setAudioTrackProps,
      (_e, showId: string, trackIndex: number, props: { volume?: number; muted?: boolean; solo?: boolean; outputDeviceId?: string | null }) =>
        this.engine.setAudioTrackProps(showId, trackIndex, props),
    );
    // メイン renderer のミックスレベルを全ウインドウ（モニター）へ中継。
    ipcMain.on(Cmd.reportAudioLevels, (_e, levels: AudioLevels) =>
      this.broadcast(Evt.audioLevels, levels),
    );

    // --- 永続化 ---
    ipcMain.on(Cmd.newProject, () => {
      this.engine.newProject();
      this.currentFilePath = null;
      this.markClean();
    });
    ipcMain.handle(Cmd.saveProject, () => this.saveProject());
    ipcMain.handle(Cmd.saveProjectOverwrite, () => this.saveProjectOverwrite());
    ipcMain.handle(Cmd.loadProject, () => this.loadProject());

    // --- Show 単体の書き出し / 読み込み ---
    ipcMain.handle(Cmd.exportShow, (_e, showId: string) => this.exportShow(showId));
    ipcMain.handle(Cmd.pickShowFile, () => this.pickShowFile());
    ipcMain.on(Cmd.importShow, (_e, show: Show) => this.engine.importShow(show));
  }

  /** 指定パスへ Project を書き出し、保存済み基準を更新する。 */
  private async writeProject(filePath: string): Promise<SaveLoadResult> {
    try {
      // 配下の音声は相対パスで書き出す（ポータブル化）。メモリ上は絶対パスのまま。
      const portable = toPortableProject(this.engine.getProject(), path.dirname(filePath));
      await fs.writeFile(filePath, serializeProject(portable), 'utf-8');
      this.currentFilePath = filePath;
      this.markClean();
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  private async saveProject(): Promise<SaveLoadResult> {
    const res = await dialog.showSaveDialog({
      title: 'Project を保存',
      defaultPath: this.currentFilePath ?? 'project.dmxproj',
      filters: PROJECT_FILTERS,
    });
    if (res.canceled || !res.filePath) return { ok: false };
    return this.writeProject(res.filePath);
  }

  /**
   * 上書き保存（Ctrl+S）。既存ファイルがあれば確認なしで上書き、
   * 無ければ保存ダイアログ（名前を付けて保存）にフォールバックする。
   */
  private async saveProjectOverwrite(): Promise<SaveLoadResult> {
    if (this.currentFilePath) return this.writeProject(this.currentFilePath);
    return this.saveProject();
  }

  /**
   * 終了時に未保存変更を保存する。既存ファイルがあれば確認なしで上書き、
   * 無ければ保存ダイアログを開く。
   */
  async saveActiveForClose(): Promise<SaveLoadResult> {
    return this.saveProjectOverwrite();
  }

  private async loadProject(): Promise<SaveLoadResult & { missingFiles?: MissingFile[] }> {
    const res = await dialog.showOpenDialog({
      title: 'Project を開く',
      properties: ['openFile'],
      filters: PROJECT_FILTERS,
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false };
    try {
      const text = await fs.readFile(res.filePaths[0], 'utf-8');
      const project = deserializeProject(text);
      // 相対パスで保存された音声を絶対パスへ戻す（以降のメモリ処理は絶対パス前提）。
      resolveProjectAudioPaths(project, path.dirname(res.filePaths[0]));
      this.engine.loadProject(project);
      this.currentFilePath = res.filePaths[0];
      this.markClean();
      const missingFiles = await this.findMissingFiles();
      return { ok: true, path: res.filePaths[0], missingFiles };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /**
   * 読込済み Project が参照する外部ファイル（現状は各 Show の音声）の存在確認を行い、
   * 見つからなかったものを返す。プロジェクトの移動・音声の改名/削除を開いた直後に検知する。
   */
  private async findMissingFiles(): Promise<MissingFile[]> {
    const missing: MissingFile[] = [];
    for (const show of this.engine.getProject().shows) {
      const filePath = show.audio?.filePath;
      if (!filePath) continue;
      try {
        await fs.access(filePath);
      } catch {
        missing.push({ showId: show.id, showName: show.name, filePath });
      }
    }
    return missing;
  }

  /**
   * フォルダを選び、欠損中の各音声を「同じファイル名」で探して一括再リンクする。
   * フォルダごと移動した一般的なケースを一度の選択でまとめて解消する。
   * （直下のみを走査。ファイル名が変わったものは個別 pickShowAudio で対応する。）
   */
  private async relinkAudioFromFolder(): Promise<{
    ok: boolean;
    resolved?: number;
    error?: string;
  }> {
    const missing = await this.findMissingFiles();
    if (missing.length === 0) return { ok: true, resolved: 0 };
    const res = await dialog.showOpenDialog({
      title: '音声フォルダを選択（同名ファイルを自動で再リンク）',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false };
    const dir = res.filePaths[0];
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch (e) {
      return { ok: false, error: String(e) };
    }
    // ファイル名（小文字）→ 実ファイル名。大文字小文字の差を吸収する。
    const byName = new Map<string, string>();
    for (const name of entries) byName.set(name.toLowerCase(), name);
    let resolved = 0;
    for (const m of missing) {
      const hit = byName.get(path.basename(m.filePath).toLowerCase());
      if (!hit) continue;
      this.engine.setShowAudio(m.showId, path.join(dir, hit));
      resolved++;
    }
    return { ok: true, resolved };
  }

  /** 指定 Show を .dmxshow として書き出す。Project の dirty / パスは変更しない。 */
  private async exportShow(showId: string): Promise<SaveLoadResult> {
    const project = this.engine.getProject();
    const show = project.shows.find((s) => s.id === showId);
    if (!show) return { ok: false, error: 'Show が見つかりません。' };
    const res = await dialog.showSaveDialog({
      title: 'Show を書き出し',
      defaultPath: `${show.name || 'show'}.dmxshow`,
      filters: SHOW_FILTERS,
    });
    if (res.canceled || !res.filePath) return { ok: false };
    try {
      await fs.writeFile(res.filePath, serializeShow(show, project.channelLabels), 'utf-8');
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** .dmxshow を選んで解析だけ行う（Engine は変更しない）。パッチ画面の入力を返す。 */
  private async pickShowFile(): Promise<{
    ok: boolean;
    path?: string;
    payload?: ReturnType<typeof deserializeShow>;
    error?: string;
  }> {
    const res = await dialog.showOpenDialog({
      title: 'Show を読み込み',
      properties: ['openFile'],
      filters: SHOW_FILTERS,
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false };
    try {
      const text = await fs.readFile(res.filePaths[0], 'utf-8');
      return { ok: true, path: res.filePaths[0], payload: deserializeShow(text) };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /** 未保存変更があるとき、定期的にバックアップを書き出す（クラッシュ/誤クローズ対策）。 */
  private async autosaveBackup(): Promise<void> {
    if (!this.dirty) return;
    const target = this.currentFilePath
      ? `${this.currentFilePath}.bak`
      : path.join(app.getPath('userData'), 'recovery.dmxproj');
    try {
      // 本保存と同様に、対象ファイル位置を基準に配下の音声を相対化する。
      const portable = toPortableProject(this.engine.getProject(), path.dirname(target));
      await fs.writeFile(target, serializeProject(portable), 'utf-8');
    } catch (e) {
      console.error('[autosave] failed:', e);
    }
  }

  /** 音声ファイルをダイアログで選び、Show に絶対パスを設定する。 */
  private async pickShowAudio(showId: string): Promise<{ ok: boolean; path?: string }> {
    const res = await dialog.showOpenDialog({
      title: '音声ファイルを選択',
      properties: ['openFile'],
      filters: AUDIO_FILTERS,
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false };
    this.engine.setShowAudio(showId, res.filePaths[0]);
    return { ok: true, path: res.filePaths[0] };
  }

  /** 追加トラック用の音声ファイルをダイアログで選ぶ（Project は変更しない。尺取得は renderer 側）。 */
  private async pickAudioClip(): Promise<{ ok: boolean; path?: string }> {
    const res = await dialog.showOpenDialog({
      title: '音声ファイルを選択',
      properties: ['openFile'],
      filters: AUDIO_FILTERS,
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false };
    return { ok: true, path: res.filePaths[0] };
  }

  /** 音声ファイルのバイト列を読み出す。renderer 側で Blob URL 化する。 */
  private async readAudioFile(
    filePath: string,
  ): Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }> {
    try {
      const buf = await fs.readFile(filePath);
      // Node Buffer の該当領域を ArrayBuffer として返す（IPC で構造化複製される）。
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      return { ok: true, data: ab };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  private sendPacket(packet: Buffer): void {
    this.socket.send(packet, ARTNET_PORT, this.artnet.targetIp, (err) => {
      if (err) console.error('[artnet] send error:', err);
    });
  }

  private forwardFrame(frame: number[]): void {
    const now = Date.now();
    if (now - this.lastFrameSentAt < FRAME_FORWARD_INTERVAL_MS) return;
    this.lastFrameSentAt = now;
    // frame は Engine が再利用するバッファなので、送る前にコピーする。
    this.broadcast(Evt.outputFrame, frame.slice());

    if (now - this.lastStateSentAt >= STATE_FORWARD_INTERVAL_MS) {
      this.lastStateSentAt = now;
      this.broadcast(Evt.engineState, this.engine.getState());
    }
  }
}
