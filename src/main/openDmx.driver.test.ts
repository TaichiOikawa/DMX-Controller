/**
 * OpenDmxDriver の送出プロトコルと接続ライフサイクルのテスト。
 *
 * 実機を使わず、DmxSerialPort を差し替えて「何をどの順で叩いたか」を検証する。
 */

import { describe, it, expect } from 'vitest';
import { OpenDmxDriver, type DmxSerialPort } from './openDmx';
import type { OpenDmxStatus } from '../shared/ipc';
import { UNIVERSE_SIZE } from '../shared/types';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 呼ばれた操作を順に記録する偽ポート。 */
class FakePort implements DmxSerialPort {
  isOpen = true;
  /** 'brk:on' / 'brk:off' / 'write' / 'drain' の呼び出し順。 */
  readonly calls: string[] = [];
  readonly writes: Buffer[] = [];
  closed = false;
  private listeners = new Map<string, ((err?: Error) => void)[]>();

  set(options: { brk: boolean }, callback: (err: Error | null) => void): void {
    this.calls.push(options.brk ? 'brk:on' : 'brk:off');
    callback(null);
  }

  write(data: Buffer, callback: (err?: Error | null) => void): void {
    this.calls.push('write');
    // 呼び出し元は同じ Buffer を使い回すので、検証用に複製して残す。
    this.writes.push(Buffer.from(data));
    callback(null);
  }

  drain(callback: (err?: Error | null) => void): void {
    this.calls.push('drain');
    callback(null);
  }

  close(callback?: (err?: Error | null) => void): void {
    this.closed = true;
    this.isOpen = false;
    callback?.(null);
  }

  on(event: 'error' | 'close', listener: (err?: Error) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  /** ポート側からの切断/エラーを模擬する。 */
  emit(event: 'error' | 'close', err?: Error): void {
    for (const l of this.listeners.get(event) ?? []) l(err);
  }
}

/** driver / 記録された status / 開かれた FakePort をまとめて用意する。 */
function makeDriver(onOpen?: (path: string) => Promise<DmxSerialPort>) {
  const statuses: OpenDmxStatus[] = [];
  const ports: FakePort[] = [];
  const driver = new OpenDmxDriver({
    onStatus: (s) => statuses.push(s),
    openPort: async (path) => {
      if (onOpen) return onOpen(path);
      const p = new FakePort();
      ports.push(p);
      return p;
    },
  });
  return { driver, statuses, ports };
}

const stateSeq = (statuses: OpenDmxStatus[]) => statuses.map((s) => s.state);

describe('OpenDmxDriver: 送出プロトコル', () => {
  it('BREAK → MAB → スタートコード+512ch → drain の順で 1 フレームを送る', async () => {
    const { driver, ports } = makeDriver();
    driver.setFrame(new Array(UNIVERSE_SIZE).fill(0));
    driver.apply({ enabled: true, portPath: 'COM_FAKE' });
    await wait(80);
    await driver.stop();

    const port = ports[0];
    expect(port).toBeDefined();
    // 最初の 4 手が 1 フレーム分。以降は同じ並びの繰り返し。
    expect(port.calls.slice(0, 4)).toEqual(['brk:on', 'brk:off', 'write', 'drain']);
    expect(port.writes[0]).toHaveLength(1 + UNIVERSE_SIZE);
    expect(port.writes[0][0]).toBe(0x00);
  });

  it('送出するのは常に最新フレーム（積み残しを作らない）', async () => {
    const { driver, ports } = makeDriver();
    driver.setFrame(new Array(UNIVERSE_SIZE).fill(10));
    driver.apply({ enabled: true, portPath: 'COM_FAKE' });
    await wait(40);
    driver.setFrame(new Array(UNIVERSE_SIZE).fill(200));
    await wait(120);
    await driver.stop();

    const writes = ports[0].writes;
    expect(writes.length).toBeGreaterThan(1);
    expect(writes[0][1]).toBe(10);
    // 更新後は 10 のフレームがもう出てこない（古いフレームが溜まっていない）。
    expect(writes[writes.length - 1][1]).toBe(200);
  });

  it('物理上限（約 40Hz）を超えて送らない', async () => {
    const { driver, ports } = makeDriver();
    driver.apply({ enabled: true, portPath: 'COM_FAKE' });
    await wait(300);
    await driver.stop();
    // 300ms なら最大 12 フレーム程度。偽ポートは即応答なので上限で頭打ちになるはず。
    expect(ports[0].writes.length).toBeLessThanOrEqual(14);
  });
});

describe('OpenDmxDriver: 状態通知', () => {
  it('実測 Hz は onStatus で通知せず、getStatus() から読める', async () => {
    // 毎秒何度も変わる値を push すると、512 要素を含む state 配信が IPC を溢れさせる。
    // 通知は接続/切断/エラーの遷移だけに絞る契約。
    const { driver, statuses } = makeDriver();
    driver.apply({ enabled: true, portPath: 'COM_FAKE' });
    await wait(300);

    expect(driver.getStatus().measuredHz).toBeGreaterThan(0);
    // 送出が何フレームも進んでいるのに、通知は opening → open の 2 回だけ。
    expect(stateSeq(statuses)).toEqual(['opening', 'open']);
    await driver.stop();
  });
});

describe('OpenDmxDriver: 接続ライフサイクル', () => {
  it('無効化するとポートを閉じ、状態を disabled にする', async () => {
    const { driver, statuses, ports } = makeDriver();
    driver.apply({ enabled: true, portPath: 'COM_FAKE' });
    await wait(60);
    driver.apply({ enabled: false, portPath: 'COM_FAKE' });
    await wait(60);

    expect(ports[0].closed).toBe(true);
    expect(stateSeq(statuses)).toContain('open');
    expect(statuses[statuses.length - 1].state).toBe('disabled');
    const writesAfterDisable = ports[0].writes.length;
    await wait(80);
    expect(ports[0].writes.length).toBe(writesAfterDisable);
    await driver.stop();
  });

  it('有効だがポート未選択なら closed のまま何も開かない', async () => {
    const { driver, statuses, ports } = makeDriver();
    driver.apply({ enabled: true, portPath: '' });
    await wait(40);
    expect(ports).toHaveLength(0);
    expect(statuses[statuses.length - 1].state).toBe('closed');
    await driver.stop();
  });

  it('ポートを変更すると開き直す', async () => {
    const { driver, ports } = makeDriver();
    driver.apply({ enabled: true, portPath: 'COM_A' });
    await wait(60);
    driver.apply({ enabled: true, portPath: 'COM_B' });
    await wait(60);
    await driver.stop();

    expect(ports).toHaveLength(2);
    expect(ports[0].closed).toBe(true);
    expect(ports[1].writes.length).toBeGreaterThan(0);
  });

  it('オープン失敗を error として報告し、アプリを落とさない', async () => {
    const { driver, statuses } = makeDriver(async () => {
      throw new Error('File not found');
    });
    driver.apply({ enabled: true, portPath: 'COM_MISSING' });
    await wait(60);
    await driver.stop();

    const last = statuses[statuses.length - 1];
    expect(last.state).toBe('error');
    expect(last.error).toContain('File not found');
    expect(last.portPath).toBe('COM_MISSING');
  });

  it('本番中に抜線されたら error にして再接続を試みる', async () => {
    const { driver, statuses, ports } = makeDriver();
    driver.apply({ enabled: true, portPath: 'COM_FAKE' });
    await wait(60);
    ports[0].emit('close');
    await wait(60);
    expect(statuses.some((s) => s.state === 'error')).toBe(true);

    // RECONNECT_INTERVAL_MS(2s) 後に開き直す。
    await wait(2200);
    expect(ports.length).toBeGreaterThan(1);
    expect(stateSeq(statuses).lastIndexOf('open')).toBeGreaterThan(
      stateSeq(statuses).indexOf('error'),
    );
    await driver.stop();
  }, 15000);

  it('stop 後は再接続しない', async () => {
    const { driver, ports } = makeDriver();
    driver.apply({ enabled: true, portPath: 'COM_FAKE' });
    await wait(60);
    await driver.stop();
    ports[0].emit('close');
    await wait(2200);
    expect(ports).toHaveLength(1);
  }, 15000);
});
