import { describe, it, expect } from 'vitest';
import { resolveChannel, resolveFrame, type MixContext } from './mixer';
import { UNIVERSE_SIZE } from '../shared/types';

function baseCtx(overrides: Partial<MixContext> = {}): MixContext {
  return {
    faderLive: new Array(UNIVERSE_SIZE).fill(0),
    busking: new Array(UNIVERSE_SIZE).fill(false),
    ...overrides,
  };
}

describe('resolveChannel priority stack (§6)', () => {
  it('falls back to fader layer when nothing else controls the channel', () => {
    const ctx = baseCtx();
    ctx.faderLive[10] = 200;
    expect(resolveChannel(ctx, 10)).toBe(200);
  });

  it('busking channel outputs the fader value (HTP ignored, can go down)', () => {
    const ctx = baseCtx({
      showControls: () => true,
      showValue: () => 255,
    });
    ctx.faderLive[3] = 40;
    ctx.busking[3] = true;
    // busking 層が show 層より優先 → 40（下げれば下がる）。
    expect(resolveChannel(ctx, 3)).toBe(40);
  });

  it('show layer applies when the show controls the channel and not busking', () => {
    const ctx = baseCtx({
      showControls: (ch) => ch === 5,
      showValue: () => 180,
    });
    ctx.faderLive[5] = 10;
    expect(resolveChannel(ctx, 5)).toBe(180);
  });
});

describe('resolveFrame', () => {
  it('fills all 512 channels from the fader layer', () => {
    const ctx = baseCtx();
    ctx.faderLive[0] = 1;
    ctx.faderLive[511] = 255;
    const out = new Array(UNIVERSE_SIZE).fill(-1);
    resolveFrame(ctx, out);
    expect(out.length).toBe(UNIVERSE_SIZE);
    expect(out[0]).toBe(1);
    expect(out[511]).toBe(255);
    expect(out[256]).toBe(0);
  });
});
