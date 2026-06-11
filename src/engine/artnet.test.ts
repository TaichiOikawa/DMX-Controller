import { describe, it, expect } from 'vitest';
import { clampDmx, encodeArtDmx, nextSequence, portAddress } from './artnet';
import { UNIVERSE_SIZE } from '../shared/types';

describe('clampDmx', () => {
  it('clamps to 0-255 and floors', () => {
    expect(clampDmx(-5)).toBe(0);
    expect(clampDmx(0)).toBe(0);
    expect(clampDmx(127.9)).toBe(127);
    expect(clampDmx(255)).toBe(255);
    expect(clampDmx(999)).toBe(255);
    expect(clampDmx(NaN)).toBe(0);
  });
});

describe('nextSequence', () => {
  it('cycles 1..255 skipping 0', () => {
    expect(nextSequence(1)).toBe(2);
    expect(nextSequence(254)).toBe(255);
    expect(nextSequence(255)).toBe(1);
  });
});

describe('portAddress', () => {
  it('packs subnet+universe into subUni and net separately', () => {
    expect(portAddress({ universe: 0, net: 0, subnet: 0 })).toEqual({ subUni: 0, net: 0 });
    expect(portAddress({ universe: 5, net: 0, subnet: 0 })).toEqual({ subUni: 5, net: 0 });
    expect(portAddress({ universe: 1, net: 2, subnet: 3 })).toEqual({
      subUni: (3 << 4) | 1,
      net: 2,
    });
  });
});

describe('encodeArtDmx', () => {
  const addr = { universe: 0, net: 0, subnet: 0 };

  it('produces a header + 512 data bytes', () => {
    const channels = new Array(UNIVERSE_SIZE).fill(0);
    const pkt = encodeArtDmx(channels, 1, addr);
    expect(pkt.length).toBe(18 + 512);
  });

  it('writes the Art-Net id, opcode, protocol version and length', () => {
    const pkt = encodeArtDmx(new Array(UNIVERSE_SIZE).fill(0), 7, addr);
    expect(pkt.toString('latin1', 0, 8)).toBe('Art-Net\0');
    expect(pkt.readUInt16LE(8)).toBe(0x5000); // OpOutput, little-endian
    expect(pkt.readUInt8(10)).toBe(0); // ProtVerHi
    expect(pkt.readUInt8(11)).toBe(14); // ProtVerLo
    expect(pkt.readUInt8(12)).toBe(7); // sequence
    expect(pkt.readUInt16BE(16)).toBe(512); // length, big-endian
  });

  it('writes channel values, clamped, at the right offset', () => {
    const channels = new Array(UNIVERSE_SIZE).fill(0);
    channels[0] = 255;
    channels[1] = 128;
    channels[511] = 300; // -> clamped to 255
    const pkt = encodeArtDmx(channels, 1, addr);
    expect(pkt.readUInt8(18 + 0)).toBe(255);
    expect(pkt.readUInt8(18 + 1)).toBe(128);
    expect(pkt.readUInt8(18 + 511)).toBe(255);
  });

  it('encodes universe/net into the address bytes', () => {
    const pkt = encodeArtDmx(new Array(UNIVERSE_SIZE).fill(0), 1, {
      universe: 1,
      net: 2,
      subnet: 3,
    });
    expect(pkt.readUInt8(14)).toBe((3 << 4) | 1); // SubUni
    expect(pkt.readUInt8(15)).toBe(2); // Net
  });
});
