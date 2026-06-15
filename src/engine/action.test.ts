import { describe, it, expect } from 'vitest';
import {
  advanceAction,
  applyActionFade,
  createActionRuntime,
  footprintOfSteps,
  startActionStep,
  stepTarget,
} from './action';
import { UNIVERSE_SIZE, type ActionButton, type ActionMode, type ActionStep } from '../shared/types';

function step(values: Record<number, number>, fadeInMs = 0, holdMs = 50): ActionStep {
  return { values, fadeInMs, holdMs };
}
function action(mode: ActionMode, steps: ActionStep[]): ActionButton {
  return { id: 'a', name: 'A', mode, steps };
}

describe('footprintOfSteps / stepTarget', () => {
  it('footprint is the union of step channels', () => {
    const fp = footprintOfSteps([step({ 0: 1 }), step({ 3: 1, 5: 1 })]);
    expect(fp[0] && fp[3] && fp[5]).toBe(true);
    expect(fp[1]).toBe(false);
  });
  it('stepTarget yields absolute values (others 0)', () => {
    const t = stepTarget(step({ 2: 200, 4: 99 }));
    expect(t[2]).toBe(200);
    expect(t[4]).toBe(99);
    expect(t[0]).toBe(0);
  });
});

describe('applyActionFade', () => {
  it('interpolates and clears on completion', () => {
    const rt = createActionRuntime(action('press-once', [step({ 0: 200 }, 100)]));
    startActionStep(rt, step({ 0: 200 }, 100), 0, 0);
    applyActionFade(rt, 50);
    expect(rt.values[0]).toBe(100);
    applyActionFade(rt, 100);
    expect(rt.values[0]).toBe(200);
    expect(rt.fade).toBeNull();
  });
});

describe('advanceAction modes', () => {
  it('press-once plays once then auto-releases', () => {
    const a = action('press-once', [step({ 0: 200 }, 0, 100)]);
    const rt = createActionRuntime(a);
    expect(advanceAction(a, rt, 0)).toBe(false); // starts step0
    advanceAction(a, rt, 0); // applies fade -> 200
    expect(rt.values[0]).toBe(200);
    expect(advanceAction(a, rt, 99)).toBe(false); // still holding
    expect(advanceAction(a, rt, 100)).toBe(true); // done -> release
  });

  it('hold-once holds at the last step (never auto-releases)', () => {
    const a = action('hold-once', [step({ 0: 50 }, 0, 50)]);
    const rt = createActionRuntime(a);
    advanceAction(a, rt, 0);
    advanceAction(a, rt, 0);
    expect(advanceAction(a, rt, 1000)).toBe(false); // holds, not done
    expect(rt.values[0]).toBe(50);
  });

  it('hold-loop chases through steps and loops', () => {
    const a = action('hold-loop', [step({ 0: 10 }, 0, 50), step({ 0: 20 }, 0, 50)]);
    const rt = createActionRuntime(a);
    advanceAction(a, rt, 0); // start step0
    advanceAction(a, rt, 0); // apply -> 10
    expect(rt.values[0]).toBe(10);
    advanceAction(a, rt, 50); // -> step1
    advanceAction(a, rt, 50); // apply -> 20
    expect(rt.values[0]).toBe(20);
    advanceAction(a, rt, 100); // end -> loop to step0
    advanceAction(a, rt, 100); // apply -> 10
    expect(rt.values[0]).toBe(10);
    expect(rt.stepIndex).toBe(0);
  });

  it('empty action is immediately done', () => {
    const a = action('press-once', []);
    const rt = createActionRuntime(a);
    expect(advanceAction(a, rt, 0)).toBe(true);
  });
});

it('universe size sanity', () => {
  expect(UNIVERSE_SIZE).toBe(512);
});
