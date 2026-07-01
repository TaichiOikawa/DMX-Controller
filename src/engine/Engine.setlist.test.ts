import { describe, it, expect } from 'vitest';
import { Engine } from './Engine';
import { createDefaultProject, type Project } from '../shared/types';

function projectWithShows(): Project {
  const p = createDefaultProject();
  p.shows = [
    { id: 's1', name: 'A', sequence: [] },
    { id: 's2', name: 'B', sequence: [] },
    { id: 's3', name: 'C', sequence: [] },
  ];
  return p;
}

function makeEngine(project = projectWithShows()) {
  const engine = new Engine({ send: () => {} });
  engine.loadProject(project);
  return engine;
}

/** アクティブなセットリスト（1本目）の entries を取り出す小ヘルパ。 */
function entries(engine: Engine) {
  return engine.getProject().setlists?.[0]?.entries ?? [];
}

describe('Engine setlist authoring', () => {
  it('creates, renames and deletes setlists', () => {
    const engine = makeEngine();
    engine.createSetlist('本番');
    expect(engine.getProject().setlists).toHaveLength(1);
    expect(engine.getProject().setlists?.[0].name).toBe('本番');

    const id = engine.getProject().setlists![0].id;
    engine.renameSetlist(id, 'リハ');
    expect(engine.getProject().setlists?.[0].name).toBe('リハ');

    engine.deleteSetlist(id);
    // 空になったら setlists フィールド自体を落とす。
    expect(engine.getProject().setlists).toBeUndefined();
  });

  it('adds/removes/moves show references (existing shows only)', () => {
    const engine = makeEngine();
    engine.createSetlist();
    const id = engine.getProject().setlists![0].id;

    engine.addToSetlist(id, 's1');
    engine.addToSetlist(id, 's2');
    engine.addToSetlist(id, 'ghost'); // 実在しない → 無視
    expect(entries(engine).map((e) => e.showId)).toEqual(['s1', 's2']);

    // 並び替え: s2 を先頭へ
    const e2 = entries(engine).find((e) => e.showId === 's2')!;
    engine.moveSetlistEntry(id, e2.id, 0);
    expect(entries(engine).map((e) => e.showId)).toEqual(['s2', 's1']);

    // 削除
    engine.removeFromSetlist(id, e2.id);
    expect(entries(engine).map((e) => e.showId)).toEqual(['s1']);
  });

  it('allows the same show to appear multiple times', () => {
    const engine = makeEngine();
    engine.createSetlist();
    const id = engine.getProject().setlists![0].id;
    engine.addToSetlist(id, 's1');
    engine.addToSetlist(id, 's1');
    expect(entries(engine).map((e) => e.showId)).toEqual(['s1', 's1']);
  });

  it('prunes setlist entries when a referenced show is deleted', () => {
    const engine = makeEngine();
    engine.createSetlist();
    const id = engine.getProject().setlists![0].id;
    engine.addToSetlist(id, 's1');
    engine.addToSetlist(id, 's2');
    engine.addToSetlist(id, 's1');

    engine.deleteShow('s1');
    expect(entries(engine).map((e) => e.showId)).toEqual(['s2']);
  });

  it('supports undo across setlist edits', () => {
    const engine = makeEngine();
    engine.createSetlist();
    const id = engine.getProject().setlists![0].id;
    engine.addToSetlist(id, 's1');
    expect(entries(engine)).toHaveLength(1);

    engine.undo(); // undo addToSetlist
    expect(engine.getProject().setlists?.[0].entries).toHaveLength(0);

    engine.undo(); // undo createSetlist
    expect(engine.getProject().setlists).toBeUndefined();
  });
});
