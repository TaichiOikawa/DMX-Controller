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
 *
 * 有効/無効・ポート・PIN はアプリ設定（userData/settings.json）に永続化され、
 * 起動時に configure() で流し込まれる。Project ファイルには保存しない。
 */

import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { StageLayout } from '../shared/types';
import type { RemoteCommand, RemoteInfo, RemoteState } from '../shared/ipc';
import { REMOTE_CLIENT_HTML } from './remoteClient';
import { DEFAULT_REMOTE_PORT, type RemoteSettings } from '../shared/appSettings';

/** リクエストボディの最大長（DoS 抑止）。 */
const MAX_BODY = 4096;

/** PIN 連続失敗がこの回数に達した IP は、クールダウン中の認証を拒否する（総当たり対策）。 */
const AUTH_MAX_FAILURES = 5;
/** 認証クールダウン時間（ms）。4 桁 PIN の全探索を現実的でない時間に引き延ばす。 */
const AUTH_COOLDOWN_MS = 30_000;
/** 失敗記録を持つ IP の上限（メモリ抑止。超えたら古いものから捨てる）。 */
const AUTH_FAILURES_MAX_ENTRIES = 64;
/** 発行済みトークンの上限（超えたら古い順に失効）。 */
const MAX_TOKENS = 32;
/** トークンの有効期限（ms）。使用のたびに延長するスライド方式。 */
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** SSE ハートビート間隔（ms）。切断された接続の検出と中間機器のタイムアウト回避。 */
const SSE_HEARTBEAT_MS = 30_000;

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
  private readonly rendererRoot: URL;

  constructor(rendererRoot = new URL('../dist/', import.meta.url)) {
    this.rendererRoot = rendererRoot;
  }

  private readonly previewClients = new Set<http.ServerResponse>();
  private previewStage: StageLayout | null = null;
  private previewFrame: readonly number[] = [];

  updatePreviewStage(stage: StageLayout): void {
    if (this.previewStage === stage) return;
    this.previewStage = stage;
    this.sendPreview('stage', stage);
  }

  updatePreviewFrame(frame: readonly number[]): void {
    this.previewFrame = frame.slice();
    this.sendPreview('frame', frame);
  }

  private sendPreview(event: string, data: unknown): void {
    if (!this.previewClients.size) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.previewClients) {
      // A slow client reconnects and receives the latest snapshot instead of buffering frames.
      if (res.writableLength > 256 * 1024) { res.destroy(); this.previewClients.delete(res); continue; }
      res.write(payload);
    }
  }

  private server: http.Server | null = null;
  private port = DEFAULT_REMOTE_PORT;
  private pin = genPin();
  private enabled = false;
  /** 設定変更（PIN 採番・有効状態）の永続化フック。EngineHost が AppSettingsStore へ繋ぐ。 */
  private onSettingsChange: ((patch: Partial<RemoteSettings>) => void) | null = null;

  /** 発行済みトークン → 失効時刻（ms）。メモリ保持でプロセス再起動により失効。 */
  private readonly tokens = new Map<string, number>();
  /** IP ごとの認証失敗記録（総当たり対策）。 */
  private readonly authFailures = new Map<string, { count: number; lockUntil: number }>();
  /** 接続中の SSE レスポンス。 */
  private readonly sseClients = new Set<http.ServerResponse>();
  /** SSE ハートビートのタイマー（listen 中のみ動く）。 */
  private sseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 直近のビューモデル（新規接続へ即時送信）。 */
  private lastState: RemoteState | null = null;
  /** 受信コマンドの転送先（EngineHost が主ウィンドウへ送る）。 */
  private forwarder: ((cmd: RemoteCommand) => void) | null = null;

  /** 受信コマンドの転送先を登録する。 */
  setCommandForwarder(cb: (cmd: RemoteCommand) => void): void {
    this.forwarder = cb;
  }

  /** 設定変更の永続化先を登録する（configure より先に呼ぶこと）。 */
  setSettingsPersister(cb: (patch: Partial<RemoteSettings>) => void): void {
    this.onSettingsChange = cb;
  }

  /**
   * 永続化されたリモート設定を適用する（起動時に一度）。
   * PIN 未生成（初回起動）ならここで採番し、保存フックへ書き戻す。
   * enabled=true なら listen まで行う（前回終了時の状態を復元する）。
   */
  async configure(settings: RemoteSettings): Promise<void> {
    this.port = settings.port;
    if (settings.pin) {
      this.pin = settings.pin;
    } else {
      this.onSettingsChange?.({ pin: this.pin });
    }
    if (settings.enabled) await this.setEnabled(true);
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
    // 実際に listen できたかを保存する（失敗時は無効のまま覚える）。
    this.onSettingsChange?.({ enabled: this.enabled });
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
      if (this.sseHeartbeatTimer !== null) {
        clearInterval(this.sseHeartbeatTimer);
        this.sseHeartbeatTimer = null;
      }
      for (const res of this.sseClients) {
        try {
          res.end();
        } catch {
          /* already closed */
        }
      }
      this.sseClients.clear();
      for (const res of this.previewClients) res.end();
      this.previewClients.clear();
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
        // port=0（エフェメラル・テスト用）でも実際に割り当てられたポートを報告できるようにする。
        const addr = srv.address();
        if (addr && typeof addr === 'object') this.port = addr.port;
        this.startSseHeartbeat();
        resolve();
      });
    });
  }

  /**
   * SSE へ定期的にコメント行（: ping）を流す。
   * 黙って切れた接続の検出（write 失敗で除去）と、中間機器のアイドルタイムアウト回避のため。
   */
  private startSseHeartbeat(): void {
    if (this.sseHeartbeatTimer !== null) return;
    this.sseHeartbeatTimer = setInterval(() => {
      for (const res of this.previewClients) res.write(': ping\n\n');
      for (const res of this.sseClients) {
        try {
          res.write(': ping\n\n');
        } catch {
          this.sseClients.delete(res);
        }
      }
    }, SSE_HEARTBEAT_MS);
  }

  /** URL クエリ / ヘッダからトークンを取り出し、有効か判定する（使用のたびに期限を延長）。 */
  private authed(req: http.IncomingMessage, url: URL): boolean {
    const token = url.searchParams.get('token') ?? req.headers['x-token'];
    if (typeof token !== 'string') return false;
    const expiresAt = this.tokens.get(token);
    if (expiresAt === undefined) return false;
    if (Date.now() >= expiresAt) {
      this.tokens.delete(token); // 期限切れは失効
      return false;
    }
    this.tokens.set(token, Date.now() + TOKEN_TTL_MS); // スライド延長
    return true;
  }

  /** 新しいトークンを発行する。上限を超えたら古い順に失効させる。 */
  private issueToken(): string {
    const now = Date.now();
    for (const [t, exp] of this.tokens) {
      if (now >= exp) this.tokens.delete(t); // 期限切れの掃除
    }
    while (this.tokens.size >= MAX_TOKENS) {
      const oldest = this.tokens.keys().next().value;
      if (oldest === undefined) break;
      this.tokens.delete(oldest);
    }
    const token = crypto.randomUUID();
    this.tokens.set(token, now + TOKEN_TTL_MS);
    return token;
  }

  /** この IP が認証クールダウン中か。 */
  private authLocked(ip: string): boolean {
    const rec = this.authFailures.get(ip);
    return !!rec && Date.now() < rec.lockUntil;
  }

  /** 認証失敗を記録し、上限に達したらクールダウンへ入れる。 */
  private recordAuthFailure(ip: string): void {
    // 記録数の上限（古い IP から捨てる）。
    while (this.authFailures.size >= AUTH_FAILURES_MAX_ENTRIES && !this.authFailures.has(ip)) {
      const oldest = this.authFailures.keys().next().value;
      if (oldest === undefined) break;
      this.authFailures.delete(oldest);
    }
    const rec = this.authFailures.get(ip) ?? { count: 0, lockUntil: 0 };
    rec.count += 1;
    if (rec.count >= AUTH_MAX_FAILURES) {
      rec.lockUntil = Date.now() + AUTH_COOLDOWN_MS;
      rec.count = 0; // クールダウン明けは数え直し
    }
    this.authFailures.set(ip, rec);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const path = url.pathname;

    // Only built renderer assets are public; project and output data require PIN authentication.
    if (req.method === 'GET' && (path === '/visualizer' || /^\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path))) {
      const relative = path === '/visualizer' ? 'remote-visualizer.html' : path.slice(1);
      const file = fileURLToPath(new URL(relative, this.rendererRoot));
      void fs.readFile(file).then(content => {
        res.writeHead(200, { 'Content-Type': path === '/visualizer' ? 'text/html; charset=utf-8' : path.endsWith('.css') ? 'text/css' : 'text/javascript' });
        res.end(content);
      }).catch(() => {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('3D プレビューが見つかりません。アプリをビルドしてください。');
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/visualizer/events') {
      if (!this.authed(req, url)) { res.writeHead(401).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      if (this.previewStage) res.write(`event: stage\ndata: ${JSON.stringify(this.previewStage)}\n\n`);
      res.write(`event: frame\ndata: ${JSON.stringify(this.previewFrame)}\n\n`);
      this.previewClients.add(res);
      req.on('close', () => this.previewClients.delete(res));
      return;
    }

    // 操作ページ（/ = 全操作、/actions = Action 専用ビュー。同一 HTML をパスで切替）
    if (req.method === 'GET' && (path === '/' || path === '/index.html' || path === '/actions')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(REMOTE_CLIENT_HTML);
      return;
    }

    // PIN 認証 → トークン発行（連続失敗した IP はクールダウン中 429 で拒否）
    if (req.method === 'POST' && path === '/api/auth') {
      const ip = req.socket.remoteAddress ?? '';
      if (this.authLocked(ip)) {
        res.writeHead(429).end();
        return;
      }
      void this.readJson(req).then((body) => {
        const pin = typeof body?.pin === 'string' ? body.pin : '';
        if (pin !== this.pin) {
          this.recordAuthFailure(ip);
          res.writeHead(401).end();
          return;
        }
        this.authFailures.delete(ip);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: this.issueToken() }));
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
