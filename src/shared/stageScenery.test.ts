import { describe, expect, it } from 'vitest';
import { normalizeStageLayout, deserializeProject, serializeProject } from './persistence';
import { createDefaultProject } from './types';
import { Engine } from '../engine/Engine';

const obstacle = { id: 'platform', name: '平台', positionM: { x: 0, y: 0.5, z: 4 }, sizeM: { x: 2, y: 1, z: 2 } };

describe('scenery persistence and edit history', () => {
  it('round-trips scenery and retains orphan fixtures for repair', () => {
    const project = createDefaultProject();
    project.stageLayout = normalizeStageLayout({ obstacles: [obstacle], fixtures: [{ id: 'orphan', profileId: 'missing', startChannel: 511 }] });
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.stageLayout).toEqual(project.stageLayout);
    expect(loaded.stageLayout?.fixtures[0]).toMatchObject({ id: 'orphan', profileId: 'missing', startChannel: 511 });
    expect(loaded.stageLayout?.profiles).toEqual([]);
  });
  it('rejects malformed dimensions, deduplicates IDs and limits scenery count', () => {
    expect(normalizeStageLayout({ obstacles: [obstacle, obstacle, { ...obstacle, id: 'bad', sizeM: { x: NaN, y: -1, z: 0 } }] }).obstacles).toEqual([obstacle]);
    expect(normalizeStageLayout({ obstacles: Array.from({ length: 80 }, (_, i) => ({ ...obstacle, id: `${i}` })) }).obstacles).toHaveLength(64);
  });
  it('restores scenery through dedicated undo and redo', () => {
    const engine = new Engine({ send: () => {} });
    engine.beginStageLayoutEdit();
    engine.setStageLayout(normalizeStageLayout({ obstacles: [obstacle] }));
    expect(engine.getProject().stageLayout?.obstacles).toEqual([obstacle]);
    engine.stageLayoutUndo();
    expect(engine.getProject().stageLayout?.obstacles ?? []).toEqual([]);
    engine.stageLayoutRedo();
    expect(engine.getProject().stageLayout?.obstacles).toEqual([obstacle]);
  });
});
