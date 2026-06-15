import { describe, it, expect } from 'vitest';
import { Engine } from './Engine';
import {
  createDefaultProject,
  type ActionButton,
  type Cue,
  type Project,
  type SequenceEntry,
} from '../shared/types';

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
  const clock = { now: 0 };
  const engine = new Engine({ send: () => {}, nowFn: () => clock.now });
  return { engine, clock };
}

describe('capture / release (§6.1/6.2)', () => {
  it('a touched fader captures and overrides the cue (can go below)', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 200 }))]));
    engine.loadShow('show1');
    engine.setMode('show'); // capture-on-touch は Show モードの挙動
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200);

    engine.setFader(0, 50); // capture, below cue
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);
  });

  it('releaseCapture returns the channel to the cue value', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([cueEntry(cue('c1', { 0: 200 }))]));
    engine.loadShow('show1');
    engine.setMode('show');
    engine.go();
    engine.setFader(0, 50);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);

    engine.releaseCapture([0]);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200); // back to cue (faderLive ignored)
  });

  it('GO releases capture for channels the new cue specifies (§6.2)', () => {
    const { engine } = makeEngine();
    engine.loadProject(
      projectWithSequence([cueEntry(cue('c0', { 0: 100 })), cueEntry(cue('c1', { 0: 200 }))]),
    );
    engine.loadShow('show1');
    engine.setMode('show');
    engine.go();
    engine.setFader(0, 50);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(50);

    engine.go(); // cue1 includes ch0 -> capture released
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(200);
  });

  it('recordCue saves the captured (programmer) channels including zeros', () => {
    const { engine } = makeEngine();
    engine.loadProject(projectWithSequence([]));
    engine.setFader(5, 0); // captured at 0
    engine.setFader(6, 100);
    engine.recordCue('show1');
    const entry = engine.getProject().shows[0].sequence[0];
    expect(entry.kind).toBe('cue');
    if (entry.kind === 'cue') expect(entry.cue.values).toEqual({ 5: 0, 6: 100 });
  });
});

function actionButton(mode: ActionButton['mode'], values: Record<number, number>, holdMs = 1000): ActionButton {
  return { id: 'act', name: 'A', mode, steps: [{ values, fadeInMs: 0, holdMs }] };
}

describe('Action layer (§5.6, layer 1)', () => {
  it('hold action overrides cue and capture; release returns to cue', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c1', { 0: 100 }))]);
    p.actions = [actionButton('hold-once', { 0: 255 })];
    engine.loadProject(p);
    engine.loadShow('show1');
    engine.go();
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(100);

    engine.actionDown('act');
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(255); // action overrides

    engine.actionUp('act');
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(100); // back to cue
  });

  it('press-once auto-releases after its hold time', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([]);
    p.actions = [actionButton('press-once', { 0: 255 }, 100)];
    engine.loadProject(p);
    engine.actionDown('act');
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(255);
    expect(engine.getState().activeActionIds).toEqual(['act']);

    engine.tick(100); // hold elapsed -> auto release
    expect(engine.getOutput()[0]).toBe(0);
    expect(engine.getState().activeActionIds).toEqual([]);
  });
});

describe('Timeline auto-GO (§5.5, internal timecode)', () => {
  it('fires GO when the playhead crosses points', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c0', { 0: 10 })), cueEntry(cue('c1', { 0: 20 }))]);
    p.shows[0].timeline = {
      points: [
        { timecodeMs: 1000, type: 'go' },
        { timecodeMs: 2000, type: 'go' },
      ],
    };
    engine.loadProject(p);
    engine.loadShow('show1');

    engine.reportAudioPlayhead(500);
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(0); // not started

    engine.reportAudioPlayhead(1000); // cross point 0 -> GO -> cue0
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);

    engine.reportAudioPlayhead(2500); // cross point 1 -> GO -> cue1
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(20);
  });

  it('seek backward does not re-fire', () => {
    const { engine } = makeEngine();
    const p = projectWithSequence([cueEntry(cue('c0', { 0: 10 }))]);
    p.shows[0].timeline = { points: [{ timecodeMs: 1000, type: 'go' }] };
    engine.loadProject(p);
    engine.loadShow('show1');

    engine.reportAudioPlayhead(1500); // fires once -> cue0
    engine.tick(0);
    expect(engine.getOutput()[0]).toBe(10);

    engine.timelineSeek(0); // reset baseline
    engine.reportAudioPlayhead(500); // 1000 not crossed (500 < 1000)
    // mainIndex stays 0; no extra GO (would be no-op at end anyway)
    expect(engine.getState().playback?.mainIndex).toBe(0);
  });
});
