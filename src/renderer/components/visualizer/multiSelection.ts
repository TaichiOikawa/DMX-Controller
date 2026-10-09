import { Euler, Quaternion, Vector3, type Camera } from 'three';
import type { StageLayout, VisualizerFixture, VisualizerParameter } from '../../../shared/types';
import { duplicateVisualizerFixture } from '../../../shared/visualizerEditing';
import { isVisualizerStartChannelValid } from '../../../shared/visualizer';

/** Validate the entire selection before applying a patch, so invalid ranges never partially update it. */
export function patchSelectedFixtureDmx(stage: StageLayout, ids: readonly string[], patch: { profileId: string } | { startChannel: number | undefined }): StageLayout | null {
  let changed = false;
  let valid = true;
  const fixtures = stage.fixtures.map(fixture => {
    if (!ids.includes(fixture.id)) return fixture;
    const next = { ...fixture, ...patch };
    const profile = stage.profiles.find(item => item.id === next.profileId);
    if (!profile || (next.startChannel !== undefined && next.startChannel > 511) || !isVisualizerStartChannelValid(next.startChannel, profile)) valid = false;
    if (next.profileId === fixture.profileId && next.startChannel === fixture.startChannel) return fixture;
    changed = true;
    return next;
  });
  return !valid ? null : changed ? { ...stage, fixtures } : stage;
}

export function duplicateSelectedFixtures(stage: StageLayout, ids: readonly string[]): StageLayout {
  const selected = stage.fixtures.filter(fixture => ids.includes(fixture.id));
  if (!selected.length || stage.fixtures.length + selected.length > 170 || selected.some(fixture => !stage.profiles.some(profile => profile.id === fixture.profileId))) return stage;
  return selected.reduce((next, fixture) => duplicateVisualizerFixture(next, fixture.id), stage);
}

export function editSelectedFixtureVector(stage: StageLayout, ids: readonly string[], field: 'positionM' | 'mountRotationDeg', axis: 'x' | 'y' | 'z', value: number, delta?: number): StageLayout {
  if (!Number.isFinite(value) || (delta !== undefined && !Number.isFinite(delta))) return stage;
  let changed = false;
  const fixtures = stage.fixtures.map(fixture => {
    if (!ids.includes(fixture.id)) return fixture;
    const next = delta === undefined ? value : Number((fixture[field][axis] + delta).toFixed(6));
    if (next === fixture[field][axis]) return fixture;
    changed = true;
    return { ...fixture, [field]: { ...fixture[field], [axis]: next } };
  });
  return changed ? { ...stage, fixtures } : stage;
}

export function setSelectedFixtureParameter(stage: StageLayout, ids: readonly string[], parameter: VisualizerParameter, value: number, delta?: number): StageLayout {
  if (!Number.isFinite(value)) return stage;
  let changed = false;
  const fixtures = stage.fixtures.map(fixture => {
    if (!ids.includes(fixture.id)) return fixture;
    const next = delta === undefined ? value : Number((fixture.staticParameters[parameter] + delta).toFixed(6));
    if (fixture.staticParameters[parameter] === next) return fixture;
    changed = true;
    return { ...fixture, staticParameters: { ...fixture.staticParameters, [parameter]: next } };
  });
  return changed ? { ...stage, fixtures } : stage;
}

export type ArrangementAxis = 'x' | 'y' | 'z';
export type ArrangementMode = 'align' | 'distribute';

export function arrangeSelectedFixtures(stage: StageLayout, ids: readonly string[], axis: ArrangementAxis, mode: ArrangementMode): StageLayout {
  const selected = stage.fixtures.filter(fixture => ids.includes(fixture.id))
    .sort((a, b) => a.positionM[axis] - b.positionM[axis]);
  if (selected.length < (mode === 'align' ? 2 : 3)) return stage;
  const min = selected[0].positionM[axis];
  const max = selected[selected.length - 1].positionM[axis];
  const positions = new Map(selected.map((fixture, index) => [fixture.id,
    mode === 'align' ? (min + max) / 2 : index === selected.length - 1 ? max : min + (max - min) * index / (selected.length - 1)]));
  let changed = false;
  const fixtures = stage.fixtures.map(fixture => {
    const value = positions.get(fixture.id);
    if (value === undefined || value === fixture.positionM[axis]) return fixture;
    changed = true;
    return { ...fixture, positionM: { ...fixture.positionM, [axis]: value } };
  });
  return changed ? { ...stage, fixtures } : stage;
}

export function selectFixtureFromList(order: readonly string[], selected: readonly string[], anchor: string | null, clicked: string, modifiers: { shift: boolean; toggle: boolean }) {
  const current = selected.filter(id => order.includes(id));
  if (modifiers.shift) {
    const startId = anchor && order.includes(anchor) ? anchor : current[0] ?? clicked;
    const start = order.indexOf(startId);
    const end = order.indexOf(clicked);
    const range = order.slice(Math.min(start, end), Math.max(start, end) + 1);
    return { ids: modifiers.toggle ? [...new Set([...current, ...range])] : range, anchor: startId };
  }
  return { ids: modifiers.toggle ? current.includes(clicked) ? current.filter(id => id !== clicked) : [...current, clicked] : [clicked], anchor: clicked };
}

export function fixturesInRectangle(fixtures: readonly VisualizerFixture[], camera: Camera, rect: { left: number; top: number; right: number; bottom: number }, width: number, height: number) {
  camera.updateMatrixWorld();
  return fixtures.filter(fixture => {
    const point = new Vector3(fixture.positionM.x, fixture.positionM.y, fixture.positionM.z).project(camera);
    const x = (point.x + 1) * width / 2;
    const y = (1 - point.y) * height / 2;
    return point.z >= -1 && point.z <= 1 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }).map(fixture => fixture.id);
}

export function transformSelectedFixtures(stage: StageLayout, ids: readonly string[], anchorId: string, transform: Pick<VisualizerFixture, 'positionM' | 'mountRotationDeg'>): StageLayout {
  const anchor = stage.fixtures.find(fixture => fixture.id === anchorId);
  if (!anchor) return stage;
  const radians = Math.PI / 180;
  const rotation = (value: VisualizerFixture['mountRotationDeg']) => new Quaternion().setFromEuler(new Euler(value.x * radians, value.y * radians, value.z * radians));
  const delta = rotation(transform.mountRotationDeg).multiply(rotation(anchor.mountRotationDeg).invert());
  const origin = new Vector3(anchor.positionM.x, anchor.positionM.y, anchor.positionM.z);
  const destination = new Vector3(transform.positionM.x, transform.positionM.y, transform.positionM.z);
  return { ...stage, fixtures: stage.fixtures.map(fixture => {
    if (fixture.id === anchorId) return { ...fixture, ...transform };
    if (!ids.includes(fixture.id)) return fixture;
    const position = new Vector3(fixture.positionM.x, fixture.positionM.y, fixture.positionM.z).sub(origin).applyQuaternion(delta).add(destination);
    const angles = new Euler().setFromQuaternion(delta.clone().multiply(rotation(fixture.mountRotationDeg)));
    return { ...fixture, positionM: { x: position.x, y: position.y, z: position.z }, mountRotationDeg: { x: angles.x / radians, y: angles.y / radians, z: angles.z / radians } };
  }) };
}
