import { describe, it, expect } from 'vitest';
import { allocDmxFrame, writeDmxFrame } from './openDmx';
import { UNIVERSE_SIZE } from '../shared/types';

describe('writeDmxFrame', () => {
  it('prefixes the null start code and keeps all 512 channels', () => {
    const frame = writeDmxFrame(new Array(UNIVERSE_SIZE).fill(7), allocDmxFrame());
    expect(frame).toHaveLength(1 + UNIVERSE_SIZE);
    expect(frame[0]).toBe(0x00);
    expect(frame[1]).toBe(7);
    expect(frame[UNIVERSE_SIZE]).toBe(7);
  });

  it('maps channel n to byte n+1 (start code shifts everything by one)', () => {
    const channels = new Array(UNIVERSE_SIZE).fill(0);
    channels[0] = 11;
    channels[511] = 22;
    const frame = writeDmxFrame(channels, allocDmxFrame());
    expect(frame[1]).toBe(11);
    expect(frame[512]).toBe(22);
  });

  it('clamps out-of-range values and floors fractions', () => {
    const channels = new Array(UNIVERSE_SIZE).fill(0);
    channels[0] = 300;
    channels[1] = -5;
    channels[2] = 127.9;
    channels[3] = Number.NaN;
    const frame = writeDmxFrame(channels, allocDmxFrame());
    expect(frame[1]).toBe(255);
    expect(frame[2]).toBe(0);
    expect(frame[3]).toBe(127);
    expect(frame[4]).toBe(0);
  });

  it('zero-fills channels missing from a short input array', () => {
    const frame = writeDmxFrame([255, 255], allocDmxFrame());
    expect(frame[1]).toBe(255);
    expect(frame[2]).toBe(255);
    expect(frame[3]).toBe(0);
    expect(frame[UNIVERSE_SIZE]).toBe(0);
  });

  it('clears channels that dropped to zero when reusing a buffer', () => {
    // 送出ループは同じ Buffer を使い回すので、前フレームの残りが出てはいけない。
    const buf = allocDmxFrame();
    writeDmxFrame(new Array(UNIVERSE_SIZE).fill(200), buf);
    writeDmxFrame(new Array(UNIVERSE_SIZE).fill(0), buf);
    expect(buf.subarray(1).every((v) => v === 0)).toBe(true);
  });
});
