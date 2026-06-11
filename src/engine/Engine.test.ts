import { describe, it, expect, vi } from 'vitest';
import { Engine } from './Engine';

describe('Engine', () => {
  it('reflects setFader into the composed output on tick', () => {
    const sent: Buffer[] = [];
    const engine = new Engine({ send: (p) => sent.push(p) });

    engine.setFader(0, 255);
    engine.setFader(1, 100);
    engine.tick(0);

    const out = engine.getOutput();
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(100);
    expect(out[2]).toBe(0);

    // 送出された ArtDMX のデータ部に反映されている。
    expect(sent).toHaveLength(1);
    expect(sent[0].readUInt8(18 + 0)).toBe(255);
    expect(sent[0].readUInt8(18 + 1)).toBe(100);
  });

  it('clamps fader values to 0-255 and ignores out-of-range channels', () => {
    const engine = new Engine({ send: () => {} });
    engine.setFader(0, 999);
    engine.setFader(1, -50);
    engine.setFader(999, 200); // 範囲外 ch は無視
    engine.tick(0);
    const out = engine.getOutput();
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
  });

  it('increments the ArtDMX sequence each tick, skipping 0', () => {
    const sent: Buffer[] = [];
    const engine = new Engine({ send: (p) => sent.push(p) });
    for (let i = 0; i < 3; i++) engine.tick(i);
    expect(sent[0].readUInt8(12)).toBe(1);
    expect(sent[1].readUInt8(12)).toBe(2);
    expect(sent[2].readUInt8(12)).toBe(3);
  });

  it('notifies frame listeners on each tick', () => {
    const engine = new Engine({ send: () => {} });
    const cb = vi.fn();
    engine.onFrame(cb);
    engine.setFader(5, 42);
    engine.tick(0);
    expect(cb).toHaveBeenCalledTimes(1);
    const frame = cb.mock.calls[0][0] as number[];
    expect(frame[5]).toBe(42);
  });

  it('measures the output rate over a 1s window', () => {
    const engine = new Engine({ send: () => {} });
    // 25ms 間隔で 1 秒ぶんのティックを供給。
    for (let t = 0; t <= 1000; t += 25) engine.tick(t);
    const state = engine.getState();
    // 直近 1 秒に入るティック数（おおよそ 40）。
    expect(state.measuredHz).toBeGreaterThanOrEqual(39);
    expect(state.measuredHz).toBeLessThanOrEqual(41);
  });
});
