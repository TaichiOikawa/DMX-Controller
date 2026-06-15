import { describe, it, expect } from 'vitest';
import { Engine } from './Engine';
import {
  createDefaultProject,
  type Cue,
  type Project,
  type SequenceEntry,
} from '../shared/types';

function cue(id: string, values: Record<number, number>, fadeInMs = 0): Cue {
  return { id, values, fadeInMs };
}
const cueEntry = (c: Cue): SequenceEntry => ({ kind: 'cue', cue: c });
function groupEntry(id: string, cues: Cue[], loop = false): SequenceEntry {
  return { kind: 'group', group: { id, name: id, cues, loop } };
}

function projectWithSequence(sequence: SequenceEntry[]): Project {
  const p = createDefaultProject();
  p.shows = [{ id: 'show1', name: 'Show 1', sequence }];
  return p;
}

function makeEngine() {
  const clock = { now: 0 };
  const engine = new Engine({ send: () => {}, nowFn: () => clock.now });
  return { engine, clock };
}

describe('master-sequence GO', () => {
  it('walks cues in order on each GO', () => {
    const { engine } = makeEngine();
    engine.loadProject(
      projectWithSequence([
        cueEntry(cue('1', { 0: 10 })),
        cueEntry(cue('2', { 0: 20 })),
        cueEntry(cue('3', { 0: 30 })),
      ]),
    );
    engine.loadShow('show1');

    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(20);
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(30);
    engine.go(); // 末尾 no-op
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(30);
  });

  it('steps into a group, through its children, then exits', () => {
    const { engine } = makeEngine();
    engine.loadProject(
      projectWithSequence([
        cueEntry(cue('1', { 0: 10 })),
        groupEntry('g', [cue('4a', { 0: 40 }), cue('4b', { 0: 41 })]),
        cueEntry(cue('5', { 0: 50 })),
      ]),
    );
    engine.loadShow('show1');

    engine.go(); // CUE1
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);

    engine.go(); // GROUP child 4a
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(40);
    expect(engine.getState().playback).toMatchObject({ mainIndex: 1, subIndex: 0 });

    engine.go(); // GROUP child 4b
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(41);
    expect(engine.getState().playback).toMatchObject({ mainIndex: 1, subIndex: 1 });

    engine.go(); // exit to CUE5
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);
    expect(engine.getState().playback).toMatchObject({ mainIndex: 2, subIndex: 0 });
  });

  it('loops within a loop-group at the end', () => {
    const { engine } = makeEngine();
    engine.loadProject(
      projectWithSequence([groupEntry('g', [cue('a', { 0: 10 }), cue('b', { 0: 20 })], true)]),
    );
    engine.loadShow('show1');

    engine.go(); // a
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);
    engine.go(); // b
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(20);
    engine.go(); // loop -> a
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);
    expect(engine.getState().playback).toMatchObject({ mainIndex: 0, subIndex: 0 });
  });

  it('goTo jumps to an arbitrary position (loop exit / cueing)', () => {
    const { engine } = makeEngine();
    engine.loadProject(
      projectWithSequence([
        groupEntry('g', [cue('a', { 0: 10 })], true),
        cueEntry(cue('5', { 0: 50 })),
      ]),
    );
    engine.loadShow('show1');
    engine.go(); // into group
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);

    engine.goTo(1, 0); // jump out to CUE5
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);
  });

  it('crossfades over fadeInMs', () => {
    const { engine, clock } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('1', { 0: 200 }, 100))]));
    engine.loadShow('show1');
    clock.now = 0;
    engine.go();
    engine.tick(50);
    expect(engine.getOutput()[0]).toBe(100);
    engine.tick(100);
    expect(engine.getOutput()[0]).toBe(200);
  });

  it('tracks unspecified channels across the walk', () => {
    const { engine } = makeEngine();
    engine.loadProject(
      projectWithSequence([cueEntry(cue('1', { 0: 255 })), cueEntry(cue('2', { 1: 128 }))]),
    );
    engine.loadShow('show1');
    engine.go();
    engine.tick(0);
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(255); // tracked
    expect(engine.getOutput()[1]).toBe(128);
  });
});

describe('fader vs show composition (§6)', () => {
  it('touching a show-controlled ch captures and overrides; uncontrolled ch shows the fader', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('1', { 0: 50 }))]));
    engine.loadShow('show1');
    engine.go();
    engine.setFader(0, 200); // captures -> overrides cue (§6.1)
    engine.setFader(10, 200); // uncontrolled -> fader passes (layer 4)
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200);
    expect(engine.getOutput()[10]).toBe(200);
  });

  it('before any GO, the fader passes through even for footprint channels', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('1', { 0: 50 }))]));
    engine.loadShow('show1');
    engine.setFader(0, 123);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(123);
  });
});

describe('authoring', () => {
  it('records a cue from faders to the master list', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.setFader(0, 255);
    engine.setFader(3, 128);
    engine.recordCue('show1');

    const seq = engine.getProject().shows[0].sequence;
    expect(seq).toHaveLength(1);
    expect(seq[0].kind).toBe('cue');
    if (seq[0].kind === 'cue') expect(seq[0].cue.values).toEqual({ 0: 255, 3: 128 });
  });

  it('records a cue into a target group', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([groupEntry('g', [])]));
    engine.setFader(5, 99);
    engine.recordCue('show1', { targetGroupId: 'g' });

    const entry = engine.getProject().shows[0].sequence[0];
    expect(entry.kind).toBe('group');
    if (entry.kind === 'group') {
      expect(entry.group.cues).toHaveLength(1);
      expect(entry.group.cues[0].values).toEqual({ 5: 99 });
    }
  });

  it('records and plays back an authored cue end-to-end', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.setFader(7, 99);
    engine.recordCue('show1', { fadeInMs: 0 });
    engine.loadShow('show1');
    engine.setFader(7, 0);
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[7]).toBe(99);
  });

  it('addGroupEntry then setGroupLoop', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.addGroupEntry('show1', 'Chase');
    const entry = engine.getProject().shows[0].sequence[0];
    expect(entry.kind).toBe('group');
    if (entry.kind === 'group') {
      engine.setGroupLoop(entry.group.id, true);
      const after = engine.getProject().shows[0].sequence[0];
      if (after.kind === 'group') expect(after.group.loop).toBe(true);
    }
  });

  it('deleteEntry removes a master entry and updates the footprint', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 50 }))]));
    engine.loadShow('show1');
    engine.deleteEntry('show1', 'c1');
    expect(engine.getProject().shows[0].sequence).toHaveLength(0);
    engine.setFader(0, 77);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(77); // footprint cleared -> fader passes
  });
});

describe('engine state snapshot', () => {
  it('reports the single playhead position', () => {
    const { engine } = makeEngine();
    engine.loadProject(
      projectWithSequence([cueEntry(cue('1', { 0: 1 })), cueEntry(cue('2', { 0: 2 }))]),
    );
    engine.loadShow('show1');
    engine.go();
    const st = engine.getState();
    expect(st.activeShowId).toBe('show1');
    expect(st.playback).toMatchObject({ mainIndex: 0, subIndex: 0, entryCount: 2 });
  });

  it('clears playback on unloadShow', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('1', { 0: 1 }))]));
    engine.loadShow('show1');
    engine.unloadShow();
    expect(engine.getState().playback).toBeNull();
    expect(engine.getState().activeShowId).toBeNull();
  });
});
