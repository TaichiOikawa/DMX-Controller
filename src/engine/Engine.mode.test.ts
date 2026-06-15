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
  it('editing a show-controlled ch writes the current cue (no capture)', () => {
    const engine = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.loadShow('show1');
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);

    engine.setFader(0, 200); // edit mode + controlled -> edit cue
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200); // live
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values[0]).toBe(200); // persisted
    expect(engine.getState().captured[0]).toBe(false); // not captured
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

  it('a non-controlled ch still captures (programmer for new cues)', () => {
    const engine = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.loadShow('show1');
    engine.go();
    engine.setFader(10, 200); // not in footprint -> capture
    engine.tick(0);
    expect(engine.getOutput()[10]).toBe(200);
    expect(engine.getState().captured[10]).toBe(true);
  });
});

describe('Show mode', () => {
  it('touching a show-controlled ch captures (overrides), does not edit the cue', () => {
    const engine = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.loadShow('show1');
    engine.go();
    engine.setMode('show');
    engine.setFader(0, 200);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200); // captured override
    expect(engine.getState().captured[0]).toBe(true);
    const entry = engine.getProject().shows[0].sequence[0];
    if (entry.kind === 'cue') expect(entry.cue.values[0]).toBe(50); // cue unchanged
  });

  it('blocks creation/editing commands', () => {
    const engine = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.setMode('show');

    engine.recordCue('show1');
    engine.addGroupEntry('show1');
    engine.newShow();
    engine.addAction();
    engine.addTimelinePoint('show1', 1000);

    const p = engine.getProject();
    expect(p.shows).toHaveLength(1); // newShow blocked
    expect(p.shows[0].sequence).toHaveLength(1); // recordCue/addGroupEntry blocked
    expect(p.actions).toHaveLength(0); // addAction blocked
    expect(p.shows[0].timeline).toBeUndefined(); // addTimelinePoint blocked

    engine.newProject(); // blocked -> show stays
    expect(engine.getProject().shows).toHaveLength(1);
  });

  it('still allows playback (GO) and capture/release', () => {
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
