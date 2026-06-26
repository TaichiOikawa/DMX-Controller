import { describe, it, expect } from 'vitest';
import {
  applyFade,
  computeTarget,
  cueAt,
  currentTarget,
  flattenCues,
  footprintOf,
  nextPosition,
  prevPosition,
  startFade,
} from './playback';
import {
  UNIVERSE_SIZE,
  createShowRuntime,
  type Cue,
  type SequenceEntry,
} from '../shared/types';

function cue(id: string, values: Record<number, number>, fadeInMs = 0, delayMs?: number): Cue {
  return { id, values, fadeInMs, ...(delayMs !== undefined ? { delayMs } : {}) };
}
const cueEntry = (c: Cue): SequenceEntry => ({ kind: 'cue', cue: c });
function groupEntry(id: string, cues: Cue[], loop = false): SequenceEntry {
  return { kind: 'group', group: { id, cues, loop } };
}

describe('computeTarget (tracking)', () => {
  it('overlays only the channels the cue specifies, keeps the rest', () => {
    const prev = new Array(UNIVERSE_SIZE).fill(0);
    prev[0] = 100;
    prev[1] = 50;
    const to = computeTarget(prev, cue('c', { 1: 200, 5: 255 }));
    expect(to[0]).toBe(100);
    expect(to[1]).toBe(200);
    expect(to[5]).toBe(255);
  });
});

describe('flattenCues / footprintOf', () => {
  it('flattens cue entries and group children', () => {
    const seq = [
      cueEntry(cue('a', { 0: 1 })),
      groupEntry('g', [cue('b', { 2: 1 }), cue('c', { 7: 1 })]),
      cueEntry(cue('d', { 10: 1 })),
    ];
    const flat = flattenCues(seq);
    expect(flat.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    const fp = footprintOf(flat);
    expect(fp[0] && fp[2] && fp[7] && fp[10]).toBe(true);
    expect(fp[1]).toBe(false);
  });
});

describe('cueAt', () => {
  const seq = [
    cueEntry(cue('a', {})),
    groupEntry('g', [cue('b', {}), cue('c', {})]),
  ];
  it('reads a top-level cue', () => {
    expect(cueAt(seq, { main: 0, sub: 0 })?.id).toBe('a');
  });
  it('reads a group child by sub index', () => {
    expect(cueAt(seq, { main: 1, sub: 1 })?.id).toBe('c');
  });
  it('returns null for out-of-range', () => {
    expect(cueAt(seq, { main: 5, sub: 0 })).toBeNull();
    expect(cueAt(seq, { main: 1, sub: 9 })).toBeNull();
  });
});

describe('nextPosition (master-sequence walk)', () => {
  const seq = [
    cueEntry(cue('1', {})),
    cueEntry(cue('2', {})),
    groupEntry('g', [cue('4a', {}), cue('4b', {})]),
    cueEntry(cue('5', {})),
  ];

  it('starts at the first playable entry', () => {
    expect(nextPosition(seq, -1, 0)).toEqual({ main: 0, sub: 0 });
  });
  it('advances cue -> cue', () => {
    expect(nextPosition(seq, 0, 0)).toEqual({ main: 1, sub: 0 });
  });
  it('enters a group at its first child', () => {
    expect(nextPosition(seq, 1, 0)).toEqual({ main: 2, sub: 0 });
  });
  it('steps within a group', () => {
    expect(nextPosition(seq, 2, 0)).toEqual({ main: 2, sub: 1 });
  });
  it('exits a non-loop group to the next entry', () => {
    expect(nextPosition(seq, 2, 1)).toEqual({ main: 3, sub: 0 });
  });
  it('returns null at the end', () => {
    expect(nextPosition(seq, 3, 0)).toBeNull();
  });

  it('exits a loop group on GO (loop continues via auto-advance)', () => {
    const looped = [
      groupEntry('g', [cue('a', {}), cue('b', {})], true),
      cueEntry(cue('after', {})),
    ];
    // GO は子の途中・末尾どちらでもループを抜けて次のマスターエントリへ。
    expect(nextPosition(looped, 0, 0)).toEqual({ main: 1, sub: 0 });
    expect(nextPosition(looped, 0, 1)).toEqual({ main: 1, sub: 0 });
    // 末尾の loop GROUP（次が無い）は GO で終端。
    const onlyLoop = [groupEntry('g', [cue('a', {}), cue('b', {})], true)];
    expect(nextPosition(onlyLoop, 0, 1)).toBeNull();
  });

  it('skips empty groups', () => {
    const withEmpty = [cueEntry(cue('1', {})), groupEntry('empty', []), cueEntry(cue('3', {}))];
    expect(nextPosition(withEmpty, 0, 0)).toEqual({ main: 2, sub: 0 });
  });
});

describe('prevPosition (GO BACK)', () => {
  const seq = [
    cueEntry(cue('1', {})),
    cueEntry(cue('2', {})),
    groupEntry('g', [cue('4a', {}), cue('4b', {})]),
    cueEntry(cue('5', {})),
  ];

  it('returns null when not started', () => {
    expect(prevPosition(seq, -1, 0)).toBeNull();
  });
  it('returns null at the first entry (no-op before start)', () => {
    expect(prevPosition(seq, 0, 0)).toBeNull();
  });
  it('steps back cue -> cue', () => {
    expect(prevPosition(seq, 1, 0)).toEqual({ main: 0, sub: 0 });
  });
  it('steps back within a group', () => {
    expect(prevPosition(seq, 2, 1)).toEqual({ main: 2, sub: 0 });
  });
  it('enters the previous group at its last child', () => {
    expect(prevPosition(seq, 3, 0)).toEqual({ main: 2, sub: 1 });
  });
  it('exits a group from its first child to the previous entry', () => {
    expect(prevPosition(seq, 2, 0)).toEqual({ main: 1, sub: 0 });
  });
  it('skips empty groups going back', () => {
    const withEmpty = [cueEntry(cue('1', {})), groupEntry('empty', []), cueEntry(cue('3', {}))];
    expect(prevPosition(withEmpty, 2, 0)).toEqual({ main: 0, sub: 0 });
  });
});

describe('applyFade', () => {
  it('interpolates linearly and clears on completion', () => {
    const rt = createShowRuntime();
    const target = new Array(UNIVERSE_SIZE).fill(0);
    target[0] = 200;
    startFade(rt, target, 0, 100, 0);
    applyFade(rt, 50);
    expect(rt.tracked[0]).toBe(100);
    applyFade(rt, 100);
    expect(rt.tracked[0]).toBe(200);
    expect(rt.fade).toBeNull();
  });

  it('uses durMs for rising channels and durOutMs for falling channels', () => {
    const rt = createShowRuntime();
    rt.tracked[0] = 0; // 上昇する ch
    rt.tracked[1] = 200; // 下降する ch
    const target = new Array(UNIVERSE_SIZE).fill(0);
    target[0] = 200; // up
    target[1] = 0; // down
    // In=100ms, Out=400ms
    startFade(rt, target, 0, 100, 0, 400);

    applyFade(rt, 100);
    expect(rt.tracked[0]).toBe(200); // 上昇は In=100ms で完了
    expect(rt.tracked[1]).toBe(150); // 下降は Out=400ms の 25%（200->150）
    expect(rt.fade).not.toBeNull(); // 下降がまだなので継続

    applyFade(rt, 400);
    expect(rt.tracked[1]).toBe(0); // 下降完了
    expect(rt.fade).toBeNull();
  });

  it('snaps instantly when fadeInMs is 0', () => {
    const rt = createShowRuntime();
    const target = new Array(UNIVERSE_SIZE).fill(0);
    target[3] = 255;
    startFade(rt, target, 0, 0, 0);
    applyFade(rt, 0);
    expect(rt.tracked[3]).toBe(255);
    expect(rt.fade).toBeNull();
  });

  it('holds during delay', () => {
    const rt = createShowRuntime();
    rt.tracked[0] = 30;
    const target = new Array(UNIVERSE_SIZE).fill(0);
    target[0] = 230;
    startFade(rt, target, 0, 100, 50);
    applyFade(rt, 40);
    expect(rt.tracked[0]).toBe(30);
    applyFade(rt, 100);
    expect(rt.tracked[0]).toBe(130);
  });
});

describe('currentTarget', () => {
  it('returns fade target while fading, else tracked', () => {
    const rt = createShowRuntime();
    rt.tracked[0] = 10;
    expect(currentTarget(rt)[0]).toBe(10);
    const target = new Array(UNIVERSE_SIZE).fill(0);
    target[0] = 99;
    startFade(rt, target, 0, 100, 0);
    expect(currentTarget(rt)[0]).toBe(99);
  });
});
