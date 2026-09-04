import { describe, expect, it } from 'vitest';
import { createDefaultStageLayout } from '../shared/types';
import { Engine } from './Engine';

function makeEngine() {
  return new Engine({ send: () => {} });
}

describe('Engine Stage Layout editing history', () => {
  it('starts with empty history, records confirmed edits, and clears history on end', () => {
    const engine = makeEngine();
    engine.beginStageLayoutEdit();
    expect(engine.getState()).toMatchObject({
      visualizerEditing: true,
      canStageLayoutUndo: false,
      canStageLayoutRedo: false,
    });

    engine.setStageLayout({ ...createDefaultStageLayout(), widthM: 12 });
    expect(engine.getProject().stageLayout?.widthM).toBe(12);
    expect(engine.getState().canStageLayoutUndo).toBe(true);

    engine.endStageLayoutEdit();
    expect(engine.getState()).toMatchObject({
      visualizerEditing: false,
      canStageLayoutUndo: false,
      canStageLayoutRedo: false,
    });
  });

  it('undoes and redoes only Stage Layout and drops redo after a new edit', () => {
    const engine = makeEngine();
    engine.setChannelLabel(0, 'Front');
    engine.beginStageLayoutEdit();
    engine.setStageLayout({ ...createDefaultStageLayout(), widthM: 11 });
    engine.setStageLayout({ ...createDefaultStageLayout(), widthM: 12 });

    engine.stageLayoutUndo();
    expect(engine.getProject().stageLayout?.widthM).toBe(11);
    expect(engine.getProject().channelLabels).toEqual({ 0: 'Front' });
    expect(engine.getState().canStageLayoutRedo).toBe(true);

    engine.setStageLayout({ ...createDefaultStageLayout(), widthM: 13 });
    expect(engine.getState().canStageLayoutRedo).toBe(false);
    engine.stageLayoutRedo();
    expect(engine.getProject().stageLayout?.widthM).toBe(13);
  });

  it('preserves the current Stage Layout when using existing Project undo/redo', () => {
    const engine = makeEngine();
    engine.beginStageLayoutEdit();
    engine.setStageLayout({ ...createDefaultStageLayout(), widthM: 14 });
    engine.setChannelLabel(0, 'Front');
    engine.setStageLayout({ ...createDefaultStageLayout(), widthM: 15 });

    engine.undo();
    expect(engine.getProject().channelLabels).toBeUndefined();
    expect(engine.getProject().stageLayout?.widthM).toBe(15);
    engine.redo();
    expect(engine.getProject().channelLabels).toEqual({ 0: 'Front' });
    expect(engine.getProject().stageLayout?.widthM).toBe(15);
  });

  it('ignores Stage Layout updates outside an editing session', () => {
    const engine = makeEngine();
    engine.setStageLayout({ ...createDefaultStageLayout(), widthM: 99 });
    expect(engine.getProject().stageLayout?.widthM).toBe(10);
  });

  it('caps dedicated history at 100 entries', () => {
    const engine = makeEngine();
    engine.beginStageLayoutEdit();
    for (let widthM = 11; widthM <= 111; widthM += 1) {
      engine.setStageLayout({ ...createDefaultStageLayout(), widthM });
    }
    for (let i = 0; i < 100; i += 1) engine.stageLayoutUndo();

    expect(engine.getProject().stageLayout?.widthM).toBe(11);
    expect(engine.getState().canStageLayoutUndo).toBe(false);
  });

  it('discards dedicated history when a different Project is loaded', () => {
    const engine = makeEngine();
    engine.beginStageLayoutEdit();
    engine.setStageLayout({ ...createDefaultStageLayout(), widthM: 20 });
    engine.loadProject(engine.getProject());
    expect(engine.getState()).toMatchObject({
      visualizerEditing: false,
      canStageLayoutUndo: false,
      canStageLayoutRedo: false,
    });
  });
});
