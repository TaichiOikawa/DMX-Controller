import { describe, it, expect } from 'vitest';
import { Clock } from './clock';

/**
 * 手動フェイクスケジューラ。setTimeout/now を差し替えて Clock を決定論的に駆動する。
 */
class FakeScheduler {
  now = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; cb: () => void }>();

  setTimeout = (cb: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + ms, cb });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  clearTimeout = (handle: ReturnType<typeof setTimeout>): void => {
    this.timers.delete(handle as unknown as number);
  };

  nowFn = (): number => this.now;

  /** 指定時刻まで進め、その間に期限が来たタイマーを順に発火する。 */
  advanceTo(target: number): void {
    // 無限ループ防止のため上限を設ける。
    for (let guard = 0; guard < 100000; guard++) {
      let next: { id: number; at: number } | null = null;
      for (const [id, t] of this.timers) {
        if (t.at <= target && (next === null || t.at < next.at)) {
          next = { id, at: t.at };
        }
      }
      if (next === null) break;
      const timer = this.timers.get(next.id)!;
      this.timers.delete(next.id);
      this.now = timer.at;
      timer.cb();
    }
    this.now = target;
  }
}

describe('Clock', () => {
  it('fires at ~40Hz (every 25ms)', () => {
    const sched = new FakeScheduler();
    const ticks: number[] = [];
    const clock = new Clock({
      hz: 40,
      onTick: (now) => ticks.push(now),
      setTimeoutFn: sched.setTimeout,
      clearTimeoutFn: sched.clearTimeout,
      nowFn: sched.nowFn,
    });

    clock.start();
    sched.advanceTo(1000); // 1 秒
    clock.stop();

    // 25ms 間隔 → 1 秒で 40 ティック前後。
    expect(ticks.length).toBe(40);
    expect(ticks[0]).toBe(25);
    expect(ticks[ticks.length - 1]).toBe(1000);
  });

  it('corrects drift: a slow tick does not shift subsequent target times', () => {
    const sched = new FakeScheduler();
    const ticks: number[] = [];
    const clock = new Clock({
      hz: 40,
      onTick: (now) => {
        ticks.push(now);
        // 最初のティックで処理が 10ms 遅延したと仮定して時計を進める。
        if (ticks.length === 1) sched.now += 10;
      },
      setTimeoutFn: sched.setTimeout,
      clearTimeoutFn: sched.clearTimeout,
      nowFn: sched.nowFn,
    });

    clock.start();
    sched.advanceTo(200);
    clock.stop();

    // 1 回目: 25ms に発火し、コールバック内で now=35 へ。
    // ドリフト補正により 2 回目の目標は 50ms（35+25 ではなく元の格子 50）。
    expect(ticks[0]).toBe(25);
    expect(ticks[1]).toBe(50);
    expect(ticks[2]).toBe(75);
  });

  it('stop prevents further ticks', () => {
    const sched = new FakeScheduler();
    let count = 0;
    const clock = new Clock({
      hz: 40,
      onTick: () => count++,
      setTimeoutFn: sched.setTimeout,
      clearTimeoutFn: sched.clearTimeout,
      nowFn: sched.nowFn,
    });
    clock.start();
    sched.advanceTo(100);
    const atStop = count;
    clock.stop();
    sched.advanceTo(500);
    expect(count).toBe(atStop);
  });
});
