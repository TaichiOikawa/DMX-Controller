import { describe, it, expect, afterEach } from 'vitest';
import { RemoteServer } from './remoteServer';

let server: RemoteServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

/** エフェメラルポート（0）で listen し、接続先 URL と PIN を返す。 */
async function startServer(): Promise<{ base: string; pin: string }> {
  const srv = new RemoteServer();
  server = srv;
  await srv.configure({ enabled: true, port: 0, pin: '1234' });
  const info = srv.getInfo();
  expect(info.enabled).toBe(true);
  expect(info.port).toBeGreaterThan(0); // 実際に割り当てられたポートが報告される
  return { base: `http://127.0.0.1:${info.port}`, pin: info.pin };
}

function auth(base: string, pin: string): Promise<Response> {
  return fetch(`${base}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}

describe('RemoteServer 認証', () => {
  it('正しい PIN でトークンを発行し、そのトークンで ping が 200 になる', async () => {
    const { base, pin } = await startServer();
    const res = await auth(base, pin);
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(token).toBeTruthy();

    expect((await fetch(`${base}/api/ping?token=${token}`)).status).toBe(200);
    expect((await fetch(`${base}/api/ping?token=bad`)).status).toBe(401);
    expect((await fetch(`${base}/api/ping`)).status).toBe(401);
  });

  it('PIN 連続失敗でクールダウンに入り、正しい PIN でも 429 になる（総当たり対策）', async () => {
    const { base, pin } = await startServer();
    for (let i = 0; i < 5; i++) {
      expect((await auth(base, '0000')).status).toBe(401);
    }
    // ロック中は正しい PIN でも拒否される。
    expect((await auth(base, pin)).status).toBe(429);
  });

  it('認証前のコマンド・イベント購読は 401 になる', async () => {
    const { base } = await startServer();
    const cmd = await fetch(`${base}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'go' }),
    });
    expect(cmd.status).toBe(401);
  });
});
