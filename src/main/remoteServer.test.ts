import { describe, it, expect, afterEach } from 'vitest';
import { RemoteServer } from './remoteServer';
import { createDefaultStageLayout } from '../shared/types';

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
  it('3D プレビューは認証後に初期状態と更新を受信し、再接続時にも最新状態を受信する', async () => {
    const { base, pin } = await startServer();
    expect((await fetch(`${base}/api/visualizer/events`)).status).toBe(401);
    const { token } = await (await auth(base, pin)).json() as { token: string };
    const stage = createDefaultStageLayout();
    server!.updatePreviewStage(stage);
    server!.updatePreviewFrame([10, 20, 30]);
    const response = await fetch(`${base}/api/visualizer/events?token=${token}`);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes('event: frame')) received += decoder.decode((await reader.read()).value);
    expect(received).toContain(`event: stage\ndata: ${JSON.stringify(stage)}`);
    expect(received).toContain('event: frame\ndata: [10,20,30]');
    server!.updatePreviewFrame([0, 0, 0]);
    expect(decoder.decode((await reader.read()).value)).toContain('event: frame\ndata: [0,0,0]');
    await reader.cancel();
    const reconnect = await fetch(`${base}/api/visualizer/events?token=${token}`);
    const nextReader = reconnect.body!.getReader();
    expect(decoder.decode((await nextReader.read()).value)).toContain('event: frame\ndata: [0,0,0]');
    await nextReader.cancel();
  });

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
