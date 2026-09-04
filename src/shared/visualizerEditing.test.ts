import { describe, expect, it } from 'vitest';
import { createDefaultStageLayout } from './types';
import { createInitialVisualizerProfiles } from './visualizer';
import {
  addProjectVisualizerProfile,
  addVisualizerFixture,
  deleteProjectVisualizerProfile,
  duplicateVisualizerFixture,
  profileUsageCount,
  replaceProjectVisualizerProfile,
} from './visualizerEditing';

function stageWithProfiles() {
  return { ...createDefaultStageLayout(), profiles: createInitialVisualizerProfiles() };
}

describe('Stage Layout editing operations', () => {
  it('creates and duplicates 3D Fixtures with expected defaults and independent state', () => {
    const initial = stageWithProfiles();
    const created = addVisualizerFixture(initial, initial.profiles[0].id, 10);
    const duplicated = duplicateVisualizerFixture(created, created.fixtures[0].id);

    expect(created.fixtures[0]).toMatchObject({ name: 'Dimmer 1ch #1', startChannel: 10 });
    expect(duplicated.fixtures[1]).toMatchObject({ name: 'Dimmer 1ch #2', startChannel: 10 });
    expect(duplicated.fixtures[1].positionM.x).toBe(created.fixtures[0].positionM.x + 0.5);
    duplicated.fixtures[1].staticParameters.red = 0;
    expect(created.fixtures[0].staticParameters.red).toBe(1);
  });

  it('rejects a start channel whose profile footprint crosses CH512', () => {
    const stage = stageWithProfiles();
    expect(addVisualizerFixture(stage, stage.profiles[3].id, 504)).toBe(stage);
    expect(addVisualizerFixture(stage, stage.profiles[3].id, 503).fixtures).toHaveLength(1);
  });

  it('copies a common profile into the Project with a fresh independent id', () => {
    const stage = stageWithProfiles();
    const source = stage.profiles[0];
    const next = addProjectVisualizerProfile(stage, source, 'Copy');
    expect(next.profiles.at(-1)).toMatchObject({ name: 'Copy', bindings: source.bindings });
    expect(next.profiles.at(-1)?.id).not.toBe(source.id);
  });

  it('blocks deletion of a used Project profile and reports usage', () => {
    let stage = stageWithProfiles();
    stage = addVisualizerFixture(stage, stage.profiles[0].id, 0);
    expect(profileUsageCount(stage, stage.profiles[0].id)).toBe(1);
    expect(deleteProjectVisualizerProfile(stage, stage.profiles[0].id)).toBe(stage);
  });

  it('rejects profile edits that would overflow an existing fixture footprint', () => {
    let stage = stageWithProfiles();
    stage = addVisualizerFixture(stage, stage.profiles[0].id, 511);
    const profile = structuredClone(stage.profiles[0]);
    profile.bindings.zoom = { resolution: '8bit', coarseOffset: 1 };
    expect(replaceProjectVisualizerProfile(stage, profile)).toBe(stage);
  });
});
