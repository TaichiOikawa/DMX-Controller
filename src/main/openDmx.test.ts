import { describe, it, expect } from 'vitest';
import { allocDmxFrame, encodeLcsPacket, writeDmxFrame } from './openDmx';
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

/** payload の XOR に type / len を混ぜた、仕様どおりのチェックサム。 */
const cksumOf = (packet: Buffer) =>
  packet.subarray(2, packet.length - 1).reduce((a, b) => a ^ b, 0);

describe('encodeLcsPacket', () => {
  it('SOF + type + len(LE) + payload + cksum の枠に入れる', () => {
    const packet = encodeLcsPacket(0x01, Uint8Array.from([0x10, 0x20, 0x30]));
    expect(packet).toHaveLength(6 + 3);
    expect([...packet.subarray(0, 5)]).toEqual([0xa5, 0x5a, 0x01, 0x03, 0x00]);
    expect([...packet.subarray(5, 8)]).toEqual([0x10, 0x20, 0x30]);
    expect(packet[8]).toBe(cksumOf(packet));
  });

  it('長さをリトルエンディアンで書く（512ch なら 00 02）', () => {
    const packet = encodeLcsPacket(0x01, new Uint8Array(UNIVERSE_SIZE));
    expect([...packet.subarray(0, 5)]).toEqual([0xa5, 0x5a, 0x01, 0x00, 0x02]);
    expect(packet).toHaveLength(6 + UNIVERSE_SIZE);
  });

  it('空 payload（PING / BLACKOUT）は 6 バイトになる', () => {
    const packet = encodeLcsPacket(0x02, new Uint8Array(0));
    expect([...packet]).toEqual([0xa5, 0x5a, 0x02, 0x00, 0x00, 0x02]);
  });

  it('cksum は type / len / payload 全部の XOR', () => {
    // 0xA5 が payload に出てもスタッフィングしない（長さで区切るため）。
    const packet = encodeLcsPacket(0x01, Uint8Array.from([0xa5, 0x5a, 0xff]));
    expect(packet).toHaveLength(6 + 3);
    expect(packet[packet.length - 1]).toBe(0x01 ^ 0x03 ^ 0x00 ^ 0xa5 ^ 0x5a ^ 0xff);
  });
});
