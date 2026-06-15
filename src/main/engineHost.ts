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
import { dialog, ipcMain, type WebContents } from 'electron';
import { Engine } from '../engine/Engine';
import {
  Cmd,
  Evt,
  type ActionPatch,
  type CaptureCueOptions,
  type CuePatch,
  type SetFaderPayload,
} from '../shared/ipc';
import { type ArtnetSettings, defaultArtnetSettings } from '../shared/types';
import { deserializeProject, serializeProject } from '../shared/persistence';

/** Art-Net の標準 UDP ポート。 */
const ARTNET_PORT = 6454;

/** renderer への outputFrame 転送間隔（ms）。33ms ≒ 30Hz。 */
const FRAME_FORWARD_INTERVAL_MS = 33;
/** engineState 転送間隔（ms）。状態は低頻度で十分。 */
const STATE_FORWARD_INTERVAL_MS = 250;

const PROJECT_FILTERS = [
  { name: 'DMX Project', extensions: ['dmxproj', 'json'] },
  { name: 'All Files', extensions: ['*'] },
];

type SaveLoadResult = { ok: boolean; path?: string; error?: string };

export class EngineHost {
  private readonly engine: Engine;
  private readonly socket: dgram.Socket;
  private artnet: ArtnetSettings;

  private webContents: WebContents | null = null;
  private lastFrameSentAt = 0;
  private lastStateSentAt = 0;

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
      this.webContents?.send(Evt.engineState, state);
    });
    this.engine.onProject((project) => {
      this.webContents?.send(Evt.project, project);
    });
  }

  /** renderer の WebContents を登録し、現在の Project / 状態を初期送信する。 */
  attach(webContents: WebContents): void {
    this.webContents = webContents;
    webContents.send(Evt.project, this.engine.getProject());
    webContents.send(Evt.engineState, this.engine.getState());
  }

  start(): void {
    this.engine.start();
  }

  stop(): void {
    this.engine.stop();
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

    // --- 再生 ---
    ipcMain.on(Cmd.loadShow, (_e, showId: string) => this.engine.loadShow(showId));
    ipcMain.on(Cmd.unloadShow, () => this.engine.unloadShow());
    ipcMain.on(Cmd.go, () => this.engine.go());
    ipcMain.on(Cmd.goTo, (_e, mainIndex: number, subIndex: number) =>
      this.engine.goTo(mainIndex, subIndex),
    );

    // --- オーサリング ---
    ipcMain.on(Cmd.newShow, (_e, name?: string) => this.engine.newShow(name));
    ipcMain.on(Cmd.recordCue, (_e, showId: string, opts?: CaptureCueOptions) =>
      this.engine.recordCue(showId, opts),
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
    ipcMain.on(Cmd.addTimelinePoint, (_e, showId: string, ms: number) =>
      this.engine.addTimelinePoint(showId, ms),
    );
    ipcMain.on(Cmd.deleteTimelinePoint, (_e, showId: string, index: number) =>
      this.engine.deleteTimelinePoint(showId, index),
    );

    // --- 永続化 ---
    ipcMain.on(Cmd.newProject, () => this.engine.newProject());
    ipcMain.handle(Cmd.saveProject, () => this.saveProject());
    ipcMain.handle(Cmd.loadProject, () => this.loadProject());
  }

  private async saveProject(): Promise<SaveLoadResult> {
    const res = await dialog.showSaveDialog({
      title: 'Project を保存',
      defaultPath: 'project.dmxproj',
      filters: PROJECT_FILTERS,
    });
    if (res.canceled || !res.filePath) return { ok: false };
    try {
      await fs.writeFile(res.filePath, serializeProject(this.engine.getProject()), 'utf-8');
      return { ok: true, path: res.filePath };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  private async loadProject(): Promise<SaveLoadResult> {
    const res = await dialog.showOpenDialog({
      title: 'Project を開く',
      properties: ['openFile'],
      filters: PROJECT_FILTERS,
    });
    if (res.canceled || res.filePaths.length === 0) return { ok: false };
    try {
      const text = await fs.readFile(res.filePaths[0], 'utf-8');
      this.engine.loadProject(deserializeProject(text));
      return { ok: true, path: res.filePaths[0] };
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
    this.webContents?.send(Evt.outputFrame, frame.slice());

    if (now - this.lastStateSentAt >= STATE_FORWARD_INTERVAL_MS) {
      this.lastStateSentAt = now;
      this.webContents?.send(Evt.engineState, this.engine.getState());
    }
  }
}
