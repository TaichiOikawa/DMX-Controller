import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { createDefaultStageLayout, createDefaultStaticFixtureParameters, type VisualizerFixture } from '../../../shared/types';
import { arrangeSelectedFixtures, fixturesInRectangle, selectFixtureFromList, setSelectedFixtureParameter, transformSelectedFixtures } from './multiSelection';

const fixture = (id: string, x: number, z = 0): VisualizerFixture => ({ id, name: id, profileId: 'profile', positionM: { x, y: 0, z }, mountRotationDeg: { x: 0, y: 0, z: 0 }, staticParameters: createDefaultStaticFixtureParameters() });

describe('range selection', () => {
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
