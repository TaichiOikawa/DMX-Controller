import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultStageLayout, createDefaultStaticFixtureParameters } from '../../../shared/types';
import { createInitialVisualizerProfiles } from '../../../shared/visualizer';
import { updateVisualizerInstances } from './sceneInstances';
import { createFixturePointerDownHandler, renderableFixtures } from './fixtureSelection';
import { createStageSurfaces } from './stageGeometry';

describe('scenery instance rendering', () => {
  it('extends the beam to receivers beyond the centre-ray intersection', () => {
    const stage = createDefaultStageLayout();
    const profile = createInitialVisualizerProfiles()[0];
    const fixture = { id: 'beam', name: 'beam', profileId: profile.id,
      positionM: { x: 0, y: 3.5, z: 0 }, mountRotationDeg: { x: -60, y: 0, z: 0 },
      staticParameters: { ...createDefaultStaticFixtureParameters(), zoom: 25 } };
    const surfaces = createStageSurfaces(stage);
    const meshes = Array.from({ length: 3 }, () => new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), surfaces.length));
    updateVisualizerInstances(fixture, profile, [], 0, stage, meshes[0], meshes[1], meshes[2], new Matrix4(), new Color(), 0, surfaces);
    const matrix = new Matrix4(); meshes[1].getMatrixAt(0, matrix);
    const farEdgeDistance = stage.depthM / Math.sin(72.5 * Math.PI / 180);
    const requiredAxialLength = farEdgeDistance * Math.cos(12.5 * Math.PI / 180);
    expect(new Vector3().setFromMatrixScale(matrix).y).toBeGreaterThanOrEqual(requiredAxialLength);
    for (const mesh of meshes) { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); mesh.dispose(); }
  });
  it.each([{ height: 3.5, tilt: -67 }, { height: 3.5, tilt: -60 }, { height: 1, tilt: -85 }])(
    'illuminates both floor and wall across their junction at %o', ({ height, tilt }) => {
    const stage = createDefaultStageLayout();
    const profile = createInitialVisualizerProfiles()[0];
    const fixture = { id: 'corner', name: 'corner', profileId: profile.id,
      positionM: { x: 0, y: height, z: 0 }, mountRotationDeg: { x: tilt, y: 0, z: 0 },
      staticParameters: { ...createDefaultStaticFixtureParameters(), zoom: 25 } };
    const surfaces = createStageSurfaces(stage);
    const meshes = Array.from({ length: 3 }, () => new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), surfaces.length));
    // Zero unused instances so this also detects the old single-receiver path.
    for (let i = 0; i < surfaces.length; i++) meshes[2].setMatrixAt(i, new Matrix4().makeScale(0, 0, 0));
    updateVisualizerInstances(fixture, profile, [], 0, stage, meshes[0], meshes[1], meshes[2], new Matrix4(), new Color(), 0, surfaces);
    const normals: Vector3[] = [];
    for (let i = 0; i < surfaces.length; i++) {
      const matrix = new Matrix4(); meshes[2].getMatrixAt(i, matrix);
      if (new Vector3().setFromMatrixScale(matrix).length() > 0) normals.push(new Vector3(0, 0, 1).transformDirection(matrix));
    }
    expect(normals.some(normal => normal.y > 0.99), 'floor receives the lower part of the cone').toBe(true);
    expect(normals.some(normal => normal.z < -0.99), 'wall receives the upper part of the cone').toBe(true);
    for (const mesh of meshes) { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); mesh.dispose(); }
  });
  it.each(['wall', 'platform'])('projects onto the nearest %s while leaving beam clipping to the shader', receiver => {
    const stage = createDefaultStageLayout();
    const profile = createInitialVisualizerProfiles()[0];
    const fixture = { id: 'light', name: 'light', profileId: profile.id, positionM: { x: 0, y: 4, z: 3 }, mountRotationDeg: { x: receiver === 'wall' ? -90 : 0, y: 0, z: 0 }, staticParameters: createDefaultStaticFixtureParameters() };
    if (receiver === 'platform') stage.obstacles = [{ id: 'p', name: 'p', positionM: { x: 0, y: 0.5, z: 3 }, sizeM: { x: 3, y: 1, z: 3 } }];
    const meshes = Array.from({ length: 3 }, () => new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), createStageSurfaces(stage).length));
    updateVisualizerInstances(fixture, profile, [], 0, stage, meshes[0], meshes[1], meshes[2], new Matrix4(), new Color());
    const beam = new Matrix4(); const marker = new Matrix4();
    meshes[1].getMatrixAt(0, beam); meshes[2].getMatrixAt(0, marker);
    expect(new Vector3().setFromMatrixScale(beam).y).toBeGreaterThanOrEqual(receiver === 'wall' ? 5 : 3);
    const point = new Vector3().setFromMatrixPosition(marker);
    expect(receiver === 'wall' ? point.z : point.y).toBeCloseTo(receiver === 'wall' ? 7.988 : 1.012);
    const normal = new Vector3(0, 0, 1).transformDirection(marker);
    expect(receiver === 'wall' ? normal.z : normal.y).toBeCloseTo(receiver === 'wall' ? -1 : 1);
    expect(meshes[2].geometry.getAttribute('surfaceMin')).toBeDefined();
    for (const mesh of meshes) { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); mesh.dispose(); }
  });
  it('compacts instances after profile loss, preserving pointer mapping and repair', () => {
    const stage = createDefaultStageLayout(); stage.profiles = createInitialVisualizerProfiles();
    stage.fixtures = stage.profiles.slice(0, 2).map((profile, i) => ({ id: `fixture-${i}`, name: 'fixture', profileId: profile.id, positionM: { x: i, y: 4, z: 3 }, mountRotationDeg: { x: 0, y: 0, z: 0 }, staticParameters: createDefaultStaticFixtureParameters() }));
    const removed = stage.profiles.shift()!;
    const visible = renderableFixtures(stage);
    expect(visible.map(f => f.id)).toEqual(['fixture-1']);
    const select = vi.fn();
    createFixturePointerDownHandler(visible, select)({ instanceId: 0, stopPropagation() {} });
    expect(select).toHaveBeenCalledWith('fixture-1');
    stage.profiles.push(removed);
    expect(renderableFixtures(stage)).toHaveLength(2);
    stage.profiles = [];
    expect(renderableFixtures(stage)).toHaveLength(0);
  });
});
