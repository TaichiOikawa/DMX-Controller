import { describe, expect, it, vi } from 'vitest';
import { Engine } from '../../../engine/Engine';
import { createDefaultStageLayout } from '../../../shared/types';
import { createStageGesture } from './stageGesture';
import { createNumberScrub, NUMBER_SCRUB_HOLD_MS } from './numberScrub';
import { editSelectedFixtureVector, duplicateSelectedFixtures } from './multiSelection';
import { addVisualizerFixture } from '../../../shared/visualizerEditing';
import { createInitialVisualizerProfiles } from '../../../shared/visualizer';

describe('numeric drag history', () => {
  it.each(['positionM', 'mountRotationDeg'] as const)('preserves each selected %s offset through a held drag and one undo/redo', field => {
    vi.useFakeTimers();
    try {
      const engine = new Engine({ send: () => {} });
      const base = { ...createDefaultStageLayout(), profiles: createInitialVisualizerProfiles() };
      const single = addVisualizerFixture(base, base.profiles[0].id);
      const pair = duplicateSelectedFixtures(single, [single.fixtures[0].id]);
      const initial = { ...pair, fixtures: pair.fixtures.map((fixture, i) => ({ ...fixture, [field]: { x: 1 + i * 2, y: 0, z: 0 } })) };
      engine.beginStageLayoutEdit();
      engine.setStageLayout(initial);
      engine.endStageLayoutEdit();
      engine.beginStageLayoutEdit();
      let visible = initial;
      const ids = initial.fixtures.map(fixture => fixture.id);
      const edit = createStageGesture(next => { visible = next; }, next => engine.setStageLayout(next));
      const scrub = createNumberScrub({ x: 100, value: 1, step: 0.1, onActivate: () => edit.begin(visible) });
      vi.advanceTimersByTime(NUMBER_SCRUB_HOLD_MS);
      let previous = 1;
      for (const x of [108, 116, 124, 132]) {
        const next = scrub.move(x)!;
        edit.update(editSelectedFixtureVector(visible, ids, field, 'x', next, next - previous));
        previous = next;
      }
      expect(visible.fixtures.map(fixture => fixture[field].x)).toEqual([1.4, 3.4]);
      expect(engine.getState().canStageLayoutUndo).toBe(false);
      scrub.stop(); edit.finish(); edit.finish();
      engine.stageLayoutUndo();
      expect(engine.getProject().stageLayout?.fixtures.map(fixture => fixture[field].x)).toEqual([1, 3]);
      expect(engine.getState().canStageLayoutUndo).toBe(false);
      engine.stageLayoutRedo();
      expect(engine.getProject().stageLayout?.fixtures.map(fixture => fixture[field].x)).toEqual([1.4, 3.4]);
    } finally { vi.useRealTimers(); }
  });
  it('previews every increment but undoes and redoes the whole gesture once', () => {
    const engine = new Engine({ send: () => {} });
    engine.beginStageLayoutEdit();
    const initial = createDefaultStageLayout();
    let visible = initial;
    const edit = createStageGesture(stage => { visible = stage; }, stage => engine.setStageLayout(stage));
    edit.begin(initial);
    for (const widthM of [10.1, 10.2, 10.3]) edit.update({ ...initial, widthM });
    expect(visible.widthM).toBe(10.3);
    edit.finish();
    engine.stageLayoutUndo();
    expect(engine.getProject().stageLayout?.widthM).toBe(10);
    expect(engine.getState().canStageLayoutUndo).toBe(false);
    engine.stageLayoutRedo();
    expect(engine.getProject().stageLayout?.widthM).toBe(10.3);
  });

  it('does not record a gesture that returns to its starting value', () => {
    const engine = new Engine({ send: () => {} });
    engine.beginStageLayoutEdit();
    const initial = createDefaultStageLayout();
    const edit = createStageGesture(() => {}, stage => engine.setStageLayout(stage));
    edit.begin(initial);
    edit.update({ ...initial, widthM: 10.1 });
    edit.update({ ...initial });
    edit.finish();
    edit.finish();
    expect(engine.getState().canStageLayoutUndo).toBe(false);
  });
});
