/**
 * リモート操作サーバー（スマホ等・§ 遠隔操作）。
 *
 * 同一 LAN のブラウザから操作ページを配信し、PIN 認証のうえで
 *   - 状態配信: Server-Sent Events（`GET /api/events`）
 *   - コマンド: `POST /api/command`
 * を仲介する。WebSocket ライブラリは使わず Node 標準（http / os / crypto）のみで実装する。
 *
 * 注意（セキュリティ）: 平文 HTTP・4 桁 PIN の簡易認証。信頼できる LAN 内での利用を前提とし、
 * 既定では無効。設定で明示的に有効化したときだけ listen する。
 */

import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import type { RemoteCommand, RemoteInfo, RemoteState } from '../shared/ipc';
import { REMOTE_CLIENT_HTML } from './remoteClient';

/** リモート操作サーバーの待受ポート。 */
const DEFAULT_PORT = 3939;
/** リクエストボディの最大長（DoS 抑止）。 */
const MAX_BODY = 4096;

/** 4 桁 PIN を生成する（先頭ゼロ許容）。 */
function genPin(): string {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

/** LAN 上の IPv4 から接続 URL 一覧を組み立てる。 */
function localUrls(port: number): string[] {
  const urls: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${port}`);
    }
  }
  return urls;
}

export class RemoteServer {
  private server: http.Server | null = null;
  private port = DEFAULT_PORT;
  private pin = genPin();
  private enabled = false;

  /** 発行済みトークン（メモリ保持。プロセス再起動で失効）。 */
  private readonly tokens = new Set<string>();
  /** 接続中の SSE レスポンス。 */
  private readonly sseClients = new Set<http.ServerResponse>();
  /** 直近のビューモデル（新規接続へ即時送信）。 */
  private lastState: RemoteState | null = null;
  /** 受信コマンドの転送先（EngineHost が主ウィンドウへ送る）。 */
  private forwarder: ((cmd: RemoteCommand) => void) | null = null;

  /** 受信コマンドの転送先を登録する。 */
  setCommandForwarder(cb: (cmd: RemoteCommand) => void): void {
    this.forwarder = cb;
  }

  /** モニター用ビューモデルを更新し、全 SSE クライアントへ push する。 */
  updateState(vm: RemoteState): void {
    this.lastState = vm;
    if (this.sseClients.size === 0) return;
    const payload = `data: ${JSON.stringify(vm)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  /** 有効/無効を切り替え、切替後の接続情報を返す。 */
  async setEnabled(on: boolean): Promise<RemoteInfo> {
    try {
      if (on && !this.server) await this.listen();
      else if (!on && this.server) await this.close();
    } catch (e) {
      // ポート使用中などで listen 失敗 → 無効のまま接続情報を返す（UI 側でトグルが戻る）。
      console.error('[remote] setEnabled failed:', e);
    }
    return this.getInfo();
  }

  /** 設定画面へ返す接続情報（URL / PIN / 有効状態）。 */
  getInfo(): RemoteInfo {
    return {
      enabled: this.enabled,
      port: this.port,
      pin: this.pin,
      urls: this.enabled ? localUrls(this.port) : [],
    };
  }

  /** サーバーを停止し、接続を破棄する（アプリ終了時にも呼ぶ）。 */
  close(): Promise<void> {
    return new Promise((resolve) => {
      for (const res of this.sseClients) {
        try {
          res.end();
        } catch {
          /* already closed */
        }
      }
      this.sseClients.clear();
      this.tokens.clear();
      this.enabled = false;
      const srv = this.server;
      this.server = null;
      if (!srv) return resolve();
      srv.close(() => resolve());
    });
  }

  private listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => this.handle(req, res));
      srv.on('error', (err) => {
        this.server = null;
        this.enabled = false;
        reject(err);
      });
      srv.listen(this.port, () => {
        this.server = srv;
        this.enabled = true;
        resolve();
      });
    });
  }

  /** URL クエリ / ヘッダからトークンを取り出し、有効か判定する。 */
  private authed(req: http.IncomingMessage, url: URL): boolean {
    const token = url.searchParams.get('token') ?? req.headers['x-token'];
    return typeof token === 'string' && this.tokens.has(token);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    // 操作ページ（/ = 全操作、/actions = Action 専用ビュー。同一 HTML をパスで切替）
    if (req.method === 'GET' && (path === '/' || path === '/index.html' || path === '/actions')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(REMOTE_CLIENT_HTML);
      return;
    }

    // PIN 認証 → トークン発行
    if (req.method === 'POST' && path === '/api/auth') {
      void this.readJson(req).then((body) => {
        const pin = typeof body?.pin === 'string' ? body.pin : '';
        if (pin !== this.pin) {
          res.writeHead(401).end();
          return;
        }
        const token = crypto.randomUUID();
        this.tokens.add(token);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token }));
      });
      return;
    }

    // トークン有効性チェック（クライアントの再接続判定用）
    if (req.method === 'GET' && path === '/api/ping') {
      res.writeHead(this.authed(req, url) ? 200 : 401).end();
      return;
    }

    // 状態配信（SSE）
    if (req.method === 'GET' && path === '/api/events') {
      if (!this.authed(req, url)) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 3000\n\n');
      if (this.lastState) res.write(`data: ${JSON.stringify(this.lastState)}\n\n`);
      this.sseClients.add(res);
      req.on('close', () => this.sseClients.delete(res));
      return;
    }

    // コマンド受信
    if (req.method === 'POST' && path === '/api/command') {
      if (!this.authed(req, url)) {
        res.writeHead(401).end();
        return;
      }
      void this.readJson(req).then((body) => {
        const action = body?.action;
        if (typeof action === 'string') {
          const cmd: RemoteCommand = { action } as RemoteCommand;
          if (typeof body?.value === 'number') cmd.value = body.value;
          if (typeof body?.id === 'string') cmd.id = body.id;
          if (typeof body?.fade === 'boolean') cmd.fade = body.fade;
          this.forwarder?.(cmd);
        }
        res.writeHead(204).end();
      });
      return;
    }

    res.writeHead(404).end();
  }

  /** リクエストボディを JSON として読み取る（上限超過・不正時は null）。 */
  private readJson(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      let raw = '';
      let aborted = false;
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > MAX_BODY) {
          aborted = true;
          req.destroy();
          resolve(null);
        }
      });
      req.on('end', () => {
        if (aborted) return;
        try {
          resolve(JSON.parse(raw || '{}'));
        } catch {
          resolve(null);
        }
      });
      req.on('error', () => resolve(null));
    });
  }
}
