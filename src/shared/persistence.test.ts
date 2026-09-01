import { describe, it, expect } from 'vitest';
import {
  collectShowChannels,
  deserializeProject,
  deserializeShow,
  extractLegacyOutputSettings,
  migrateProject,
  remapShowChannels,
  serializeLyrics,
  serializeProject,
  serializeShow,
} from './persistence';
import { PROJECT_VERSION, UNIVERSE_SIZE, createDefaultProject, type Show } from './types';

/** テスト用の Show（CUE・GROUP・Timeline・audio を含む）。 */
function sampleShow(): Show {
  return {
    id: 's1',
    name: 'Act 1',
    folderId: 'f1',
    audio: { filePath: '/tmp/song.mp3' },
    sequence: [
      { kind: 'cue', cue: { id: 'c1', name: 'Blue', values: { 0: 255, 5: 128 }, fadeInMs: 3000 } },
      {
        kind: 'group',
        group: {
          id: 'g1',
          name: 'Chase',
          loop: true,
          cues: [
            { id: 'c2', values: { 5: 0, 10: 64 }, fadeInMs: 1500 },
            { id: 'c3', values: { 11: 200 }, fadeInMs: 500 },
          ],
        },
      },
    ],
    timeline: { points: [{ timecodeMs: 1000, cueId: 'c1', groupId: 'g1', type: 'go' }] },
  };
}

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

  it('preserves RGB fixtures', () => {
    const p = createDefaultProject();
    p.fixtures = [
      { id: 'fx1', name: 'Par L', r: 0, g: 1, b: 2 },
      { id: 'fx2', r: 10, g: 11, b: 12 },
    ];
    const restored = deserializeProject(serializeProject(p));
    expect(restored.fixtures).toEqual([
      { id: 'fx1', name: 'Par L', r: 0, g: 1, b: 2 },
      { id: 'fx2', r: 10, g: 11, b: 12 },
    ]);
  });

  it('preserves folders and a show folderId', () => {
    const p = createDefaultProject();
    p.folders = [{ id: 'f1', name: 'Act 1' }];
    p.shows = [{ id: 's1', name: 'Opening', folderId: 'f1', sequence: [] }];
    const restored = deserializeProject(serializeProject(p));
    expect(restored.folders).toEqual([{ id: 'f1', name: 'Act 1' }]);
    expect(restored.shows[0].folderId).toBe('f1');
  });

  it('drops a folderId that references no existing folder', () => {
    const p = migrateProject({
      shows: [{ id: 's1', name: 'Orphan', folderId: 'ghost', sequence: [] }],
    });
    expect(p.shows[0].folderId).toBeUndefined();
    expect(p.folders).toBeUndefined();
  });

  it('preserves setlists and their ordered show references', () => {
    const p = createDefaultProject();
    p.shows = [
      { id: 's1', name: 'A', sequence: [] },
      { id: 's2', name: 'B', sequence: [] },
    ];
    p.setlists = [
      {
        id: 'sl1',
        name: '本番',
        entries: [
          { id: 'e1', showId: 's2' },
          { id: 'e2', showId: 's1' },
          { id: 'e3', showId: 's2' }, // 同一 Show の複数回登場
        ],
      },
    ];
    const restored = deserializeProject(serializeProject(p));
    expect(restored.setlists).toEqual(p.setlists);
  });
});

describe('migrateProject (tolerant loading)', () => {
  it('fills defaults for an empty / malformed object', () => {
    const p = migrateProject({});
    expect(p.version).toBe(PROJECT_VERSION);
    expect(p.faders).toHaveLength(UNIVERSE_SIZE);
    expect(p.shows).toEqual([]);
  });

  it('drops output settings from a legacy project (they live in app settings now)', () => {
    const p = migrateProject({
      settings: {
        universeCount: 1,
        releaseFadeMs: 120,
        artnet: { targetIp: '10.0.0.5', universe: 3 },
        openDmx: { enabled: true, portPath: 'COM7' },
      },
    });
    expect(p.settings).toEqual({ universeCount: 1, releaseFadeMs: 120 });
    // 書き出しにも混入しない（Project を配っても他マシンの出力設定を壊さない）。
    expect(serializeProject(p)).not.toContain('artnet');
    expect(deserializeProject(serializeProject(p)).settings).toEqual({
      universeCount: 1,
      releaseFadeMs: 120,
    });
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

  it('drops fixtures with out-of-range or missing channels', () => {
    const p = migrateProject({
      fixtures: [
        { id: 'ok', name: 'Good', r: 0, g: 1, b: 2 },
        { id: 'oob', r: 0, g: 1, b: 512 }, // b 範囲外
        { id: 'missing', r: 3, g: 4 }, // b 欠落
        { r: 5, g: 6, b: 7 }, // id 欠落 → fallbackId 採番
        42,
      ],
    });
    expect(p.fixtures).toHaveLength(2);
    expect(p.fixtures?.[0]).toEqual({ id: 'ok', name: 'Good', r: 0, g: 1, b: 2 });
    expect(p.fixtures?.[1]).toMatchObject({ r: 5, g: 6, b: 7 });
    expect(typeof p.fixtures?.[1].id).toBe('string');
  });

  it('drops malformed sequence entries', () => {
    const p = migrateProject({
      shows: [{ id: 's', name: 'S', sequence: [{ kind: 'bogus' }, { kind: 'cue' }, 42] }],
    });
    expect(p.shows[0].sequence).toEqual([]);
  });

  it('drops setlist entries that reference no existing show, keeping the (empty) setlist', () => {
    const p = migrateProject({
      shows: [{ id: 's1', name: 'A', sequence: [] }],
      setlists: [
        {
          id: 'sl1',
          name: 'L',
          entries: [
            { id: 'e1', showId: 's1' },
            { id: 'e2', showId: 'ghost' }, // 参照先なし → 除去
            { id: 'e3' }, // showId 欠落 → 除去
            42,
          ],
        },
        { id: 'sl2', name: 'Empty', entries: [{ id: 'e4', showId: 'ghost' }] },
      ],
    });
    expect(p.setlists).toHaveLength(2);
    expect(p.setlists?.[0].entries).toEqual([{ id: 'e1', showId: 's1' }]);
    // 全エントリがダングリングでも Setlist 自体は残す（空になるだけ）。
    expect(p.setlists?.[1].entries).toEqual([]);
  });

  it('omits setlists when none are present', () => {
    const p = migrateProject({ shows: [] });
    expect(p.setlists).toBeUndefined();
  });
});

describe('serializeShow / deserializeShow (.dmxshow)', () => {
  it('round-trips sequence / cue / group / timeline / audio and drops folderId', () => {
    const { show } = deserializeShow(serializeShow(sampleShow()));
    const expected = sampleShow();
    delete expected.folderId; // 書き出しで落ちる
    expect(show).toEqual(expected);
  });

  it('embeds sourceLabels for used channels only', () => {
    const labels = { 0: 'Front', 5: 'Wash', 99: 'Unused' };
    const { sourceLabels } = deserializeShow(serializeShow(sampleShow(), labels));
    // sampleShow が使う ch は 0,5,10,11 → ラベルがあるのは 0,5 のみ。
    expect(sourceLabels).toEqual({ 0: 'Front', 5: 'Wash' });
  });

  it('omits sourceLabels when no channelLabels are provided', () => {
    const { sourceLabels } = deserializeShow(serializeShow(sampleShow()));
    expect(sourceLabels).toBeUndefined();
  });

  it('throws on wrong kind or broken JSON', () => {
    expect(() => deserializeShow(JSON.stringify({ kind: 'dmxproj', show: {} }))).toThrow();
    expect(() => deserializeShow('{ not json')).toThrow();
  });
});

describe('collectShowChannels', () => {
  it('returns the sorted union across cues and group cues', () => {
    expect(collectShowChannels(sampleShow())).toEqual([0, 5, 10, 11]);
  });
});

describe('remapShowChannels', () => {
  it('remaps cue value keys, leaves unmapped channels, and drops out-of-range targets', () => {
    const out = remapShowChannels(sampleShow(), { 0: 100, 5: 200, 11: 600 });
    const cue = out.sequence[0];
    if (cue.kind === 'cue') {
      expect(cue.cue.values).toEqual({ 100: 255, 200: 128 });
    }
    const group = out.sequence[1];
    if (group.kind === 'group') {
      // 5→200, 10 は据え置き
      expect(group.group.cues[0].values).toEqual({ 200: 0, 10: 64 });
      // 11→600 は範囲外なので除外
      expect(group.group.cues[1].values).toEqual({});
    }
  });

  it('does not mutate the input show', () => {
    const input = sampleShow();
    remapShowChannels(input, { 0: 100 });
    const cue = input.sequence[0];
    if (cue.kind === 'cue') expect(cue.cue.values).toEqual({ 0: 255, 5: 128 });
  });

  it('last write wins on target collision', () => {
    const show: Show = {
      id: 's',
      name: 'S',
      sequence: [{ kind: 'cue', cue: { id: 'c', values: { 0: 10, 1: 20 }, fadeInMs: 0 } }],
    };
    const out = remapShowChannels(show, { 0: 7, 1: 7 });
    const cue = out.sequence[0];
    if (cue.kind === 'cue') expect(cue.cue.values).toEqual({ 7: 20 });
  });
});

describe('serializeLyrics', () => {
  it('lists lyric-bearing cues in master order with "1" / "2.1" numbering', () => {
    const show: Show = {
      id: 's1',
      name: 'Act 1',
      sequence: [
        { kind: 'cue', cue: { id: 'c1', lyrics: '君の名を呼ぶ', values: {}, fadeInMs: 0 } },
        {
          kind: 'group',
          group: {
            id: 'g1',
            loop: false,
            cues: [
              { id: 'c2', values: {}, fadeInMs: 0 }, // 歌詞なし → 出力されない
              { id: 'c3', lyrics: '空を見上げて', values: {}, fadeInMs: 0 },
            ],
          },
        },
      ],
    };
    expect(serializeLyrics(show)).toBe('# Act 1 歌詞\n\n1\t君の名を呼ぶ\n2.2\t空を見上げて\n');
  });

  it('trims whitespace and notes when no lyrics are present', () => {
    const show: Show = {
      id: 's1',
      name: 'Empty',
      sequence: [{ kind: 'cue', cue: { id: 'c1', lyrics: '  ', values: {}, fadeInMs: 0 } }],
    };
    expect(serializeLyrics(show)).toBe('# Empty 歌詞\n\n（歌詞が登録された CUE はありません）\n');
  });
});

describe('extractLegacyOutputSettings (旧 Project からのアプリ設定移行)', () => {
  it('picks up output settings stored in an old project file', () => {
    const legacy = JSON.stringify({
      settings: {
        artnet: { enabled: false, targetIp: '10.0.0.5', universe: 3 },
        openDmx: { enabled: true, portPath: 'COM7' },
      },
    });
    const out = extractLegacyOutputSettings(legacy);
    expect(out.artnet).toMatchObject({ enabled: false, targetIp: '10.0.0.5', universe: 3 });
    // 旧 Project に kind は無いので、従来どおりの opendmx に倒す。
    expect(out.openDmx).toEqual({ enabled: true, portPath: 'COM7', kind: 'opendmx' });
  });

  it('returns nothing for a current-format project or broken text', () => {
    expect(extractLegacyOutputSettings(serializeProject(createDefaultProject()))).toEqual({});
    expect(extractLegacyOutputSettings('not json')).toEqual({});
  });
});
