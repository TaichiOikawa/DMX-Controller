import { describe, it, expect } from 'vitest';
import { resolveChannel, resolveFrame, type MixContext } from './mixer';
import { UNIVERSE_SIZE } from '../shared/types';

function baseCtx(overrides: Partial<MixContext> = {}): MixContext {
  return {
    faderLive: new Array(UNIVERSE_SIZE).fill(0),
    captured: new Array(UNIVERSE_SIZE).fill(false),
    ...overrides,
  };
}

describe('resolveChannel priority stack (§6)', () => {
  it('falls back to fader layer when nothing else controls the channel', () => {
    const ctx = baseCtx();
    ctx.faderLive[10] = 200;
    expect(resolveChannel(ctx, 10)).toBe(200);
  });

  it('captured channel outputs the fader value (HTP ignored, can go down)', () => {
    const ctx = baseCtx({
      anyGroupControls: () => true,
      htpOverGroups: () => 255,
    });
    ctx.faderLive[3] = 40;
    ctx.captured[3] = true;
    // captured 層が show(HTP) 層より優先 → 40（下げれば下がる）。
    expect(resolveChannel(ctx, 3)).toBe(40);
  });

  it('show layer HTP applies when a group controls the channel and not captured', () => {
    const ctx = baseCtx({
      anyGroupControls: (ch) => ch === 5,
      htpOverGroups: () => 180,
    });
    ctx.faderLive[5] = 10;
    expect(resolveChannel(ctx, 5)).toBe(180);
  });

  it('action layer overrides everything', () => {
    const ctx = baseCtx({
      actionControls: (ch) => ch === 7,
      actionValue: () => 99,
      anyGroupControls: () => true,
      htpOverGroups: () => 255,
    });
    ctx.faderLive[7] = 5;
    ctx.captured[7] = true;
    expect(resolveChannel(ctx, 7)).toBe(99);
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
