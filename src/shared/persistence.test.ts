import { describe, it, expect } from 'vitest';
import { deserializeProject, migrateProject, serializeProject } from './persistence';
import { PROJECT_VERSION, UNIVERSE_SIZE, createDefaultProject } from './types';

describe('serialize/deserialize round-trip', () => {
  it('preserves a master sequence with cue and group entries', () => {
    const p = createDefaultProject();
    p.name = 'My Show';
    p.faders[0] = 255;
    p.shows = [
      {
        id: 's1',
        name: 'Act 1',
        sequence: [
          { kind: 'cue', cue: { id: 'c1', name: 'Blue', values: { 0: 255, 5: 128 }, fadeInMs: 3000 } },
          {
            kind: 'group',
            group: {
              id: 'g1',
              name: 'Chase',
              loop: true,
              cues: [
                { id: 'c2', values: { 0: 0 }, fadeInMs: 1500, delayMs: 200 },
                { id: 'c3', values: { 1: 200 }, fadeInMs: 500 },
              ],
            },
          },
          { kind: 'cue', cue: { id: 'c4', values: { 2: 64 }, fadeInMs: 0 } },
        ],
      },
    ];

    const restored = deserializeProject(serializeProject(p));
    expect(restored).toEqual(p);
  });

  it('preserves channel and bank labels', () => {
    const p = createDefaultProject();
    p.channelLabels = { 0: 'Front R', 5: 'Back Wash' };
    p.bankLabels = { 0: 'フロント列' };
    const restored = deserializeProject(serializeProject(p));
    expect(restored.channelLabels).toEqual({ 0: 'Front R', 5: 'Back Wash' });
    expect(restored.bankLabels).toEqual({ 0: 'フロント列' });
  });
});

describe('migrateProject (tolerant loading)', () => {
  it('fills defaults for an empty / malformed object', () => {
    const p = migrateProject({});
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.faders).toHaveLength(UNIVERSE_SIZE);
    expect(p.shows).toEqual([]);
  });

  it('migrates legacy parallel groups[] into group entries', () => {
    const p = migrateProject({
      shows: [
        {
          id: 's',
          name: 'Legacy',
          groups: [
            { id: 'g1', name: 'A', loop: false, cues: [{ id: 'c1', values: { 0: 10 }, fadeInMs: 0 }] },
            { id: 'g2', name: 'B', loop: true, cues: [{ id: 'c2', values: { 1: 20 }, fadeInMs: 0 }] },
          ],
        },
      ],
    });
    const seq = p.shows[0].sequence;
    expect(seq).toHaveLength(2);
    expect(seq.every((e) => e.kind === 'group')).toBe(true);
    if (seq[0].kind === 'group') expect(seq[0].group.id).toBe('g1');
    if (seq[1].kind === 'group') expect(seq[1].group.loop).toBe(true);
  });

  it('clamps out-of-range values and drops unknown channels', () => {
    const p = migrateProject({
      faders: [999, -10],
      shows: [
        {
          id: 's',
          name: 'S',
          sequence: [
            { kind: 'cue', cue: { id: 'c', values: { 0: 999, 1: -1, 512: 5 }, fadeInMs: -5 } },
          ],
        },
      ],
    });
    expect(p.faders[0]).toBe(255);
    expect(p.faders[1]).toBe(0);
    const entry = p.shows[0].sequence[0];
    if (entry.kind === 'cue') {
      expect(entry.cue.values[0]).toBe(255);
      expect(entry.cue.values[1]).toBe(0);
      expect(entry.cue.values[512]).toBeUndefined();
      expect(entry.cue.fadeInMs).toBe(0);
    }
  });

  it('drops out-of-range and empty labels', () => {
    const p = migrateProject({
      channelLabels: { 0: 'ok', 512: 'oob', 3: '  ', 7: 42 },
      bankLabels: { 0: 'page', 99: 'oob' },
    });
    expect(p.channelLabels).toEqual({ 0: 'ok' });
    expect(p.bankLabels).toEqual({ 0: 'page' });
  });

  it('drops malformed sequence entries', () => {
    const p = migrateProject({
      shows: [{ id: 's', name: 'S', sequence: [{ kind: 'bogus' }, { kind: 'cue' }, 42] }],
    });
    expect(p.shows[0].sequence).toEqual([]);
  });
});
