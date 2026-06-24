import { describe, it, expect } from 'vitest';
import { Engine } from './Engine';
import type { Show } from '../shared/types';

/** 取り込み対象の Show（CUE・GROUP・Timeline 付き）。 */
function importable(name = 'Imported'): Show {
  return {
    id: 's-old',
    name,
    folderId: 'f-old',
    sequence: [
      { kind: 'cue', cue: { id: 'c1-old', values: { 0: 255 }, fadeInMs: 1000 } },
      {
        kind: 'group',
        group: {
          id: 'g1-old',
          name: 'Chase',
          loop: false,
          cues: [{ id: 'c2-old', values: { 1: 128 }, fadeInMs: 500 }],
        },
      },
    ],
    timeline: {
      points: [
        { timecodeMs: 1000, cueId: 'c1-old', type: 'go' },
        { timecodeMs: 2000, groupId: 'g1-old', type: 'go' },
        { timecodeMs: 3000, cueId: 'ghost', type: 'go' },
      ],
    },
  };
}

describe('Engine.importShow', () => {
  it('regenerates all ids and drops folderId', () => {
    const engine = new Engine({ send: () => {} });
    engine.importShow(importable());
    const show = engine.getProject().shows[0];

    expect(show.id).not.toBe('s-old');
    expect(show.folderId).toBeUndefined();
    const cueEntry = show.sequence[0];
    const groupEntry = show.sequence[1];
    if (cueEntry.kind === 'cue') expect(cueEntry.cue.id).not.toBe('c1-old');
    if (groupEntry.kind === 'group') {
      expect(groupEntry.group.id).not.toBe('g1-old');
      expect(groupEntry.group.cues[0].id).not.toBe('c2-old');
    }
  });

  it('rewrites timeline cueId / groupId to the new ids and drops dangling refs', () => {
    const engine = new Engine({ send: () => {} });
    engine.importShow(importable());
    const show = engine.getProject().shows[0];

    const cueEntry = show.sequence[0];
    const groupEntry = show.sequence[1];
    const newCueId = cueEntry.kind === 'cue' ? cueEntry.cue.id : '';
    const newGroupId = groupEntry.kind === 'group' ? groupEntry.group.id : '';
    const pts = show.timeline?.points ?? [];

    expect(pts[0].cueId).toBe(newCueId);
    expect(pts[1].groupId).toBe(newGroupId);
    // 対応の無い 'ghost' 参照は外れる（順送りにフォールバック）。
    expect(pts[2].cueId).toBeUndefined();
  });

  it('uniquifies a name that collides with an existing show', () => {
    const engine = new Engine({ send: () => {} });
    engine.newShow('Act 1');
    engine.importShow(importable('Act 1'));
    const names = engine.getProject().shows.map((s) => s.name);
    expect(names).toContain('Act 1');
    expect(names).toContain('Act 1 (取り込み)');
  });

  it('is a no-op when not editable (show mode)', () => {
    const engine = new Engine({ send: () => {} });
    engine.setMode('show');
    engine.importShow(importable());
    expect(engine.getProject().shows).toHaveLength(0);
  });
});
