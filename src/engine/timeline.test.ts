import { describe, it, expect } from 'vitest';
import { pointsCrossed } from './timeline';
import type { TimelinePoint } from '../shared/types';

function pts(...ms: number[]): TimelinePoint[] {
  return ms.map((timecodeMs) => ({ timecodeMs, type: 'go' as const }));
}

describe('pointsCrossed', () => {
  const points = pts(1000, 2000, 3000);

  it('returns points strictly after last and at/before now (ascending)', () => {
    expect(pointsCrossed(points, 500, 2000)).toEqual([0, 1]);
  });

  it('is exclusive of last, inclusive of now', () => {
    expect(pointsCrossed(points, 1000, 2000)).toEqual([1]); // 1000 already fired, 2000 now
  });

  it('fires nothing when not advancing', () => {
    expect(pointsCrossed(points, 2000, 2000)).toEqual([]);
    expect(pointsCrossed(points, 2000, 1500)).toEqual([]); // backwards (seek)
  });

  it('fires multiple when jumping past several', () => {
    expect(pointsCrossed(points, 0, 3000)).toEqual([0, 1, 2]);
  });

  it('orders by timecode regardless of array order', () => {
    const unordered = pts(3000, 1000, 2000);
    expect(pointsCrossed(unordered, 0, 3000)).toEqual([1, 2, 0]);
  });
});
