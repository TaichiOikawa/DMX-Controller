import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { createDefaultStageLayout, createDefaultStaticFixtureParameters, type VisualizerFixture } from '../../../shared/types';
import { arrangeSelectedFixtures, fixturesInRectangle, selectFixtureFromList, setSelectedFixtureParameter, transformSelectedFixtures } from './multiSelection';
import { duplicateSelectedFixtures, editSelectedFixtureVector, patchSelectedFixtureDmx } from './multiSelection';
import { createInitialVisualizerProfiles } from '../../../shared/visualizer';

const fixture = (id: string, x: number, z = 0): VisualizerFixture => ({ id, name: id, profileId: 'profile', positionM: { x, y: 0, z }, mountRotationDeg: { x: 0, y: 0, z: 0 }, staticParameters: createDefaultStaticFixtureParameters() });

describe('bulk fixture DMX editing', () => {
  const profiles = createInitialVisualizerProfiles().slice(0, 2).map((profile, index) => ({ ...profile, id: `p${index}`, bindings: { dimmer: { resolution: '8bit' as const, coarseOffset: index * 9 } } }));
  const stage = { ...createDefaultStageLayout(), profiles, fixtures: [
    { ...fixture('a', 1), profileId: 'p0', startChannel: 0 },
    { ...fixture('b', 2), profileId: 'p1', startChannel: 20 },
    { ...fixture('c', 3), profileId: 'p0', startChannel: 511 },
  ] };
  it('changes mixed profiles and channels only on selected fixtures, preserving other properties', () => {
    const result = patchSelectedFixtureDmx(stage, ['a', 'b'], { profileId: 'p1' })!;
    expect(result.fixtures[0]).toEqual({ ...stage.fixtures[0], profileId: 'p1' });
    expect(result.fixtures[1]).toBe(stage.fixtures[1]);
    expect(result.fixtures[2]).toBe(stage.fixtures[2]);
    const patched = patchSelectedFixtureDmx(result, ['a', 'b'], { startChannel: 502 })!;
    expect(patched.fixtures.map(item => item.startChannel)).toEqual([502, 502, 511]);
    expect(stage.fixtures[0].startChannel).toBe(0);
    expect(patchSelectedFixtureDmx(patched, ['a', 'b'], { startChannel: 502 })).toBe(patched);
    expect(patchSelectedFixtureDmx(patched, ['a', 'b'], { startChannel: undefined })!.fixtures.map(item => item.startChannel)).toEqual([undefined, undefined, 511]);
  });
  it('rejects the whole edit if any selected fixture would be invalid', () => {
    expect(patchSelectedFixtureDmx(stage, ['a', 'c'], { profileId: 'p1' })).toBeNull();
    expect(patchSelectedFixtureDmx(stage, ['a', 'b'], { profileId: 'missing' })).toBeNull();
    for (const startChannel of [-1, 503, 512, 1.5, NaN]) {
      expect(patchSelectedFixtureDmx(stage, ['a', 'b'], { startChannel })).toBeNull();
    }
    expect(stage.fixtures.map(item => item.startChannel)).toEqual([0, 20, 511]);
  });
});

describe('range selection', () => {
  it.each(['positionM', 'mountRotationDeg'] as const)('sets absolute %s values and applies relative increments without flattening differences', field => {
    const stage = { ...createDefaultStageLayout(), fixtures: [fixture('a', 0), fixture('b', 0), fixture('c', 0)].map((item, i) => ({ ...item, [field]: { x: i * 2, y: 7, z: 8 } })) };
    const relative = editSelectedFixtureVector(stage, ['a', 'b'], field, 'x', 0.1, 0.1);
    expect(relative.fixtures.map(item => item[field].x)).toEqual([0.1, 2.1, 4]);
    const absolute = editSelectedFixtureVector(relative, ['a', 'b'], field, 'x', 5);
    expect(absolute.fixtures.map(item => item[field])).toEqual([{ x: 5, y: 7, z: 8 }, { x: 5, y: 7, z: 8 }, { x: 4, y: 7, z: 8 }]);
    expect(stage.fixtures[1][field].x).toBe(2);
  });
  it('duplicates each selected fixture once, with independent IDs and settings, and rejects exceeding the limit', () => {
    const base = { ...createDefaultStageLayout(), profiles: createInitialVisualizerProfiles() };
    const stage = { ...base, fixtures: [fixture('a', 1), fixture('b', 3), fixture('c', 5)].map(item => ({ ...item, profileId: base.profiles[0].id })) };
    const result = duplicateSelectedFixtures(stage, ['a', 'b', 'a']);
    expect(result.fixtures).toHaveLength(5);
    expect(new Set(result.fixtures.map(item => item.id)).size).toBe(5);
    expect(result.fixtures.slice(3).map(item => item.positionM.x)).toEqual([1.5, 3.5]);
    expect(result.fixtures[3].staticParameters).not.toBe(stage.fixtures[0].staticParameters);
    const full = { ...stage, fixtures: Array.from({ length: 169 }, (_, i) => ({ ...stage.fixtures[0], id: String(i) })) };
    expect(duplicateSelectedFixtures(full, ['0', '1'])).toBe(full);
  });
  it('updates only the chosen parameter on selected fixtures, preserving mixed unrelated values', () => {
    const a = fixture('a', 1);
    const b = { ...fixture('b', 3), profileId: 'other-profile', staticParameters: { ...a.staticParameters, dimmer: 0.3, pan: 90 } };
    const stage = { ...createDefaultStageLayout(), fixtures: [a, b, fixture('c', 5)] };
    const result = setSelectedFixtureParameter(stage, ['a', 'b'], 'dimmer', 0.5);
    expect(result.fixtures[0]).toEqual({ ...a, staticParameters: { ...a.staticParameters, dimmer: 0.5 } });
    expect(result.fixtures[1]).toEqual({ ...b, staticParameters: { ...b.staticParameters, dimmer: 0.5 } });
    expect(result.fixtures[2]).toBe(stage.fixtures[2]);
    expect(b.staticParameters.dimmer).toBe(0.3);
    expect(setSelectedFixtureParameter(result, ['a', 'b'], 'dimmer', 0.5)).toBe(result);
    expect(setSelectedFixtureParameter(stage, ['a'], 'dimmer', NaN)).toBe(stage);
  });
  it.each(['x', 'y', 'z'] as const)('aligns and distributes along %s without changing other properties', axis => {
    const fixtures = [fixture('max', 10), fixture('outside', 99), fixture('min', -2), fixture('middle', 0)]
      .map(item => ({ ...item, positionM: { x: 3, y: 4, z: 5, [axis]: item.positionM.x } }));
    const stage = { ...createDefaultStageLayout(), fixtures };
    const ids = ['middle', 'max', 'min'];
    const aligned = arrangeSelectedFixtures(stage, ids, axis, 'align');
    const distributed = arrangeSelectedFixtures(stage, ids, axis, 'distribute');
    expect(aligned.fixtures.map(item => item.positionM[axis])).toEqual([4, 99, 4, 4]);
    expect(distributed.fixtures.map(item => item.positionM[axis])).toEqual([10, 99, -2, 4]);
    expect(distributed.fixtures[0]).toBe(fixtures[0]);
    expect(distributed.fixtures[1]).toBe(fixtures[1]);
    expect(distributed.fixtures[2]).toBe(fixtures[2]);
    expect(distributed.fixtures[3]).toEqual({ ...fixtures[3], positionM: { ...fixtures[3].positionM, [axis]: 4 } });
    expect(stage.fixtures[3].positionM[axis]).toBe(0);
  });
  it('ignores missing selections and avoids commits for insufficient or unchanged positions', () => {
    const stage = { ...createDefaultStageLayout(), fixtures: [fixture('a', 0), fixture('b', 0), fixture('c', 0)] };
    expect(arrangeSelectedFixtures(stage, ['a', 'missing'], 'x', 'align')).toBe(stage);
    expect(arrangeSelectedFixtures(stage, ['a', 'b'], 'x', 'distribute')).toBe(stage);
    expect(arrangeSelectedFixtures(stage, ['a', 'b', 'c'], 'x', 'distribute')).toBe(stage);
  });
  it('toggles individual list items with Ctrl and selects one without modifiers', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(selectFixtureFromList(order, ['a'], 'a', 'c', { toggle: true, shift: false }).ids).toEqual(['a', 'c']);
    expect(selectFixtureFromList(order, ['a', 'c'], 'c', 'a', { toggle: true, shift: false }).ids).toEqual(['c']);
    expect(selectFixtureFromList(order, ['a', 'c'], 'c', 'b', { toggle: false, shift: false }).ids).toEqual(['b']);
  });
  it('keeps a stable Shift anchor and supports backwards and additive ranges', () => {
    const order = ['a', 'b', 'c', 'd'];
    const first = selectFixtureFromList(order, ['b'], 'b', 'd', { toggle: false, shift: true });
    expect(first).toEqual({ ids: ['b', 'c', 'd'], anchor: 'b' });
    expect(selectFixtureFromList(order, first.ids, first.anchor, 'a', { toggle: false, shift: true }).ids).toEqual(['a', 'b']);
    expect(selectFixtureFromList(order, ['d'], 'a', 'b', { toggle: true, shift: true }).ids).toEqual(['d', 'a', 'b']);
    expect(selectFixtureFromList(order, [], 'deleted', 'c', { toggle: false, shift: true }).ids).toEqual(['c']);
  });
  it('selects projected centres inside the rectangle and excludes lights behind the camera', () => {
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
    expect(fixturesInRectangle([fixture('a', 0), fixture('b', 1), fixture('outside', 5), fixture('behind', 0, 20)], camera,
      { left: 40, top: 40, right: 65, bottom: 60 }, 100, 100)).toEqual(['a', 'b']);
  });
  it('moves only the selected fixtures, preserving offsets', () => {
    const stage = { ...createDefaultStageLayout(), fixtures: [fixture('a', 0), fixture('b', 2), fixture('c', 4)] };
    const result = transformSelectedFixtures(stage, ['a', 'b'], 'a', { positionM: { x: 3, y: 1, z: 0 }, mountRotationDeg: { x: 0, y: 0, z: 0 } });
    expect(result.fixtures[1].positionM).toEqual({ x: 5, y: 1, z: 0 });
    expect(result.fixtures[2]).toBe(stage.fixtures[2]);
    expect(stage.fixtures[0].positionM.x).toBe(0);
  });
  it('rotates the arrangement and orientations around the primary fixture', () => {
    const stage = { ...createDefaultStageLayout(), fixtures: [fixture('a', 1), fixture('b', 3)] };
    const result = transformSelectedFixtures(stage, ['a', 'b'], 'a', { positionM: { x: 1, y: 0, z: 0 }, mountRotationDeg: { x: 0, y: 0, z: 90 } });
    expect(result.fixtures[1].positionM.x).toBeCloseTo(1);
    expect(result.fixtures[1].positionM.y).toBeCloseTo(2);
    expect(result.fixtures[1].mountRotationDeg.z).toBeCloseTo(90);
  });
});
