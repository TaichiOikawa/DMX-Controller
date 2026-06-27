import { describe, it, expect } from 'vitest';
import { Engine } from './Engine';
import { createDefaultProject, type Cue, type Project, type SequenceEntry } from '../shared/types';

function cue(id: string, values: Record<number, number>, fadeInMs = 0): Cue {
  return { id, values, fadeInMs };
}
const cueEntry = (c: Cue): SequenceEntry => ({ kind: 'cue', cue: c });

function projectWithSequence(sequence: SequenceEntry[]): Project {
  const p = createDefaultProject();
  p.shows = [{ id: 'show1', name: 'Show 1', sequence }];
  return p;
}

function makeEngine() {
  const engine = new Engine({ send: () => {}, nowFn: () => 0 });
  return engine;
}

describe('mode', () => {
  it('defaults to edit and toggles via setMode', () => {
    const engine = makeEngine();
    expect(engine.getState().mode).toBe('edit');
    engine.setMode('show');
    expect(engine.getState().mode).toBe('show');
  });
});

describe('Edit mode', () => {
  it('editing a show-controlled ch writes the selected cue (no busking)', () => {
    const engine = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.loadShow('show1');
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);

    engine.setFader(0, 200); // edit mode + cue selected -> edit cue
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200); // live
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values[0]).toBe(200); // persisted
    expect(engine.getState().busking[0]).toBe(false); // not busking
  });

  it('editing a tracked ch (not in current cue) adds it to the current cue', () => {
    const engine = makeEngine();
    engine.loadProject(
      projectWithSequence([cueEntry(cue('c0', { 0: 100 })), cueEntry(cue('c1', { 5: 200 }))]),
    );
    engine.loadShow('show1');
    engine.go(); // cue0 (ch0=100 tracked)
    engine.go(); // cue1 (current; does not set ch0)
    engine.setFader(0, 77); // edit -> add ch0 to current cue (c1)
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(77);
    const c1 = engine.getProject().shows[0].sequence[1];
    if (c1.kind === 'cue') expect(c1.cue.values[0]).toBe(77);
  });

  it('a non-controlled ch is added to the selected cue (no busking in edit)', () => {
    const engine = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.loadShow('show1');
    engine.go(); // select c1
    engine.setFader(10, 200); // edit + selected -> add ch10 to c1
    engine.tick(0);
    expect(engine.getOutput()[10]).toBe(200);
    expect(engine.getState().busking[10]).toBe(false);
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values[10]).toBe(200); // persisted into cue
  });

  it('edits do not persist when no cue is selected (live preview only)', () => {
    const engine = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.loadShow('show1'); // mainIndex = -1（未 GO）
    engine.setFader(3, 120); // CUE 未選択 -> ライブ出力のみ
    engine.tick(0);
    expect(engine.getOutput()[3]).toBe(120); // live
    expect(engine.getState().busking[3]).toBe(false);
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values[3]).toBeUndefined(); // 保存されない
  });
});

describe('Show mode', () => {
  it('touching a show-controlled ch busks (overrides), does not edit the cue', () => {
    const engine = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.loadShow('show1');
    engine.go();
    engine.setMode('show');
    engine.setFader(0, 200);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200); // busking override
    expect(engine.getState().busking[0]).toBe(true);
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values[0]).toBe(50); // cue unchanged
  });

  it('blocks creation/editing commands', () => {
    const engine = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.setMode('show');

    engine.addCue('show1');
    engine.addGroupEntry('show1');
    engine.newShow();
    engine.addAction();
    engine.addTimelinePoint('show1', 1000);

    const p = engine.getProject();
    expect(p.shows).toHaveLength(1); // newShow blocked
    expect(p.shows[0].sequence).toHaveLength(1); // addCue/addGroupEntry blocked
    expect(p.actions).toHaveLength(0); // addAction blocked
    expect(p.shows[0].timeline).toBeUndefined(); // addTimelinePoint blocked

    engine.newProject(); // blocked -> show stays
    expect(engine.getProject().shows).toHaveLength(1);
  });

  it('still allows playback (GO) and busking/release', () => {
    const engine = makeEngine();
    engine.loadProject(
      projectWithSequence([cueEntry(cue('c0', { 0: 10 })), cueEntry(cue('c1', { 0: 20 }))]),
    );
    engine.loadShow('show1');
    engine.setMode('show');
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(20);
    engine.releaseCapture();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(20); // still cue value
  });
});
