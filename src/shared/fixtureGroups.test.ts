import { describe, expect, it } from 'vitest';
import { Engine } from '../engine/Engine';
import { expandFixtureGroups, groupFixtures, normalizeFixtureGroups, ungroupFixtures } from './fixtureGroups';
import { deserializeProject, normalizeStageLayout, serializeProject } from './persistence';
import { createDefaultProject } from './types';
import { deleteVisualizerFixture } from './visualizerEditing';

const stage = () => normalizeStageLayout({ fixtures: ['a', 'b', 'c', 'd'].map(id => ({ id, profileId: 'missing' })) });

describe('fixture groups', () => {
  it('groups unique existing fixtures, expands selection and ungroups without changing fixtures', () => {
    const initial = stage();
    const grouped = groupFixtures(initial, ['a', 'a', 'b', 'missing']);
    expect(grouped.groups?.[0].fixtureIds).toEqual(['a', 'b']);
    expect(grouped.fixtures).toBe(initial.fixtures);
    expect(expandFixtureGroups(grouped, ['b', 'c'])).toEqual(['b', 'c', 'a']);
    expect(groupFixtures(grouped, ['b', 'a'])).toBe(grouped);
    expect(ungroupFixtures(grouped, grouped.groups![0].id).groups).toEqual([]);
    expect(groupFixtures(initial, ['a'])).toBe(initial);
  });
  it('moves members out of previous groups and dissolves groups with fewer than two members', () => {
    const grouped = groupFixtures(groupFixtures(stage(), ['a', 'b']), ['c', 'd']);
    const regrouped = groupFixtures(grouped, ['b', 'c']);
    expect(regrouped.groups).toHaveLength(1);
    expect(regrouped.groups![0].fixtureIds).toEqual(['b', 'c']);
    expect(deleteVisualizerFixture(regrouped, 'b').groups).toEqual([]);
  });
  it('rejects invalid, duplicate and overlapping memberships', () => {
    expect(normalizeFixtureGroups([
      null, { id: 'bad', fixtureIds: ['missing', 'a'] },
      { id: 'g', name: 'Front', fixtureIds: ['a', 'a', 'b', 'missing'] },
      { id: 'g', fixtureIds: ['c', 'd'] },
      { id: 'h', fixtureIds: ['b', 'c', 'd'] },
    ], ['a', 'b', 'c', 'd'])).toEqual([
      { id: 'g', name: 'Front', fixtureIds: ['a', 'b'] },
      { id: 'h', name: 'グループ', fixtureIds: ['c', 'd'] },
    ]);
  });
  it('preserves groups through project serialization and stage undo/redo', () => {
    const grouped = groupFixtures(stage(), ['a', 'b']);
    grouped.groups![0].name = '前方照明';
    const project = { ...createDefaultProject(), stageLayout: grouped };
    expect(deserializeProject(serializeProject(project)).stageLayout).toEqual(grouped);
    const engine = new Engine({ send: () => {} });
    engine.beginStageLayoutEdit();
    engine.setStageLayout(grouped);
    expect(engine.getProject().stageLayout?.groups).toEqual(grouped.groups);
    engine.stageLayoutUndo();
    expect(engine.getProject().stageLayout?.groups ?? []).toEqual([]);
    engine.stageLayoutRedo();
    expect(engine.getProject().stageLayout?.groups).toEqual(grouped.groups);
  });
});
