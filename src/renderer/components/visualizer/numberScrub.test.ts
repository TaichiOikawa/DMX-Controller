import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNumberScrub, NUMBER_SCRUB_HOLD_MS } from './numberScrub';

describe('long-press number editing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('waits for a hold, then increases rightward and decreases leftward', () => {
    const onActivate = vi.fn();
    const scrub = createNumberScrub({ x: 100, value: 2.5, step: 0.1, onActivate });
    vi.advanceTimersByTime(NUMBER_SCRUB_HOLD_MS - 1);
    expect(scrub.move(102)).toBeNull();
    expect(onActivate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(scrub.move(140)).toBe(3);
    expect(scrub.move(60)).toBe(2);
    expect(scrub.move(140, true)).toBe(2.55);
    scrub.stop();
    expect(scrub.move(180)).toBeNull();
  });
  it('leaves ordinary click-and-select gestures alone', () => {
    const onActivate = vi.fn();
    const scrub = createNumberScrub({ x: 100, value: 0, step: 1, onActivate });
    expect(scrub.move(120)).toBeNull();
    vi.advanceTimersByTime(NUMBER_SCRUB_HOLD_MS + 1);
    expect(onActivate).not.toHaveBeenCalled();
    expect(scrub.move(180)).toBeNull();
  });
  it('cancels a pending hold on release or unmount', () => {
    const onActivate = vi.fn();
    const scrub = createNumberScrub({ x: 0, value: 0, step: 1, onActivate });
    scrub.stop(); vi.advanceTimersByTime(NUMBER_SCRUB_HOLD_MS + 1);
    expect(onActivate).not.toHaveBeenCalled();
  });
  it('respects bounds and preserves integer channels during fine adjustment', () => {
    const scrub = createNumberScrub({ x: 0, value: 10, step: 1, min: 1, max: 510, integer: true, onActivate() {} });
    vi.advanceTimersByTime(NUMBER_SCRUB_HOLD_MS);
    expect(scrub.move(-1000)).toBe(1);
    expect(scrub.move(10000)).toBe(510);
    expect(Number.isInteger(scrub.move(40, true))).toBe(true);
    scrub.stop();
  });
});
