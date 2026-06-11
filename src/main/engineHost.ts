/**
 * エンジンの I/O 層（§3）。Electron / Node 依存はここに閉じる。
 *
 * - Engine を生成し、UDP(dgram) で ArtDMX を送出する `send` を注入
 * - ipcMain で UI からのコマンドを受けて Engine に渡す
 * - Engine の出力フレームを ~30Hz に間引いて renderer へ転送（IPC 氾濫防止 §3）
 */

import dgram from 'node:dgram';
import { ipcMain, type WebContents } from 'electron';
import { Engine } from '../engine/Engine';
import { Cmd, Evt, type SetFaderPayload } from '../shared/ipc';
import { type ArtnetSettings, defaultArtnetSettings } from '../shared/types';

/** Art-Net の標準 UDP ポート。 */
const ARTNET_PORT = 6454;

/** renderer への outputFrame 転送間隔（ms）。33ms ≒ 30Hz。 */
const FRAME_FORWARD_INTERVAL_MS = 33;
/** engineState 転送間隔（ms）。状態は低頻度で十分。 */
const STATE_FORWARD_INTERVAL_MS = 250;

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
    // ブロードキャスト送信先（255.x）にも対応できるよう有効化。
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
    this.engine.onState((state) => this.forwardState(state));
  }

  /** renderer の WebContents を登録（ウィンドウ生成後に呼ぶ）。 */
  attach(webContents: WebContents): void {
    this.webContents = webContents;
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
    ipcMain.on(Cmd.setFader, (_e, payload: SetFaderPayload) => {
      this.engine.setFader(payload.ch, payload.value);
    });

    ipcMain.on(Cmd.updateArtnetSettings, (_e, settings: ArtnetSettings) => {
      this.artnet = { ...settings };
      this.engine.updateArtnetSettings(settings);
      this.engine.emitState();
    });

    ipcMain.handle(Cmd.getEngineState, () => this.engine.getState());
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

    // 状態（measuredHz / captured）も低頻度で相乗りさせる。
    if (now - this.lastStateSentAt >= STATE_FORWARD_INTERVAL_MS) {
      this.lastStateSentAt = now;
      this.webContents?.send(Evt.engineState, this.engine.getState());
    }
  }

  private forwardState(state: ReturnType<Engine['getState']>): void {
    this.webContents?.send(Evt.engineState, state);
  }
}
