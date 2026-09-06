import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createDefaultStageLayout, createDefaultStaticFixtureParameters } from '../../../shared/types';
import { createStageSurfaces, intersectStage, stageBounds } from './stageGeometry';
import { fitCamera } from './cameraFit';

describe('scenery occlusion', () => {
  const stage = createDefaultStageLayout();
  it('hits the backdrop when aimed horizontally and misses outside its bounds', () => {
    const surfaces = createStageSurfaces(stage);
    const hit = intersectStage(new Vector3(0, 2, 3), new Vector3(0, 0, 1), surfaces);
    expect(hit?.distance).toBeCloseTo(5);
    expect(hit?.surface.normal.toArray()).toEqual([0, 0, -1]);
    expect(intersectStage(new Vector3(8, 2, 3), new Vector3(0, 0, 1), surfaces)).toBeNull();
  });
  it('uses a platform top instead of the floor and a curtain before the backdrop', () => {
    stage.obstacles = [
      { id: 'platform', name: '平台', positionM: { x: 0, y: 0.5, z: 2 }, sizeM: { x: 3, y: 1, z: 3 } },
      { id: 'curtain', name: '幕', positionM: { x: 0, y: 2, z: 5 }, sizeM: { x: 5, y: 4, z: 0.1 } },
    ];
    const surfaces = createStageSurfaces(stage);
    expect(intersectStage(new Vector3(0, 4, 2), new Vector3(0, -1, 0), surfaces)?.distance).toBeCloseTo(3);
    expect(intersectStage(new Vector3(0, 2, 2), new Vector3(0, 0, 1), surfaces)?.distance).toBeCloseTo(2.95);
  });
});

describe('fit camera', () => {
  it.each([0.2, 1, 2.5])('keeps every corner in view at aspect %s', aspect => {
    const stage = createDefaultStageLayout();
    stage.obstacles = [{ id: 'outside', name: 'outside', positionM: { x: 40, y: 10, z: -20 }, sizeM: { x: 4, y: 5, z: 2 } }];
    stage.fixtures = [{ id: 'outside-light', name: 'outside', profileId: 'missing', positionM: { x: -25, y: 15, z: 30 }, mountRotationDeg: { x: 45, y: 20, z: 90 }, staticParameters: createDefaultStaticFixtureParameters() }];
    const bounds = stageBounds(stage);
    const fit = fitCamera(bounds, new Vector3(-1, -0.75, 1), 45, aspect);
    const camera = new PerspectiveCamera(45, aspect, 0.05, fit.far);
    camera.position.copy(fit.position); camera.up.copy(fit.up); camera.lookAt(fit.target); camera.updateMatrixWorld();
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const ndc = new Vector3(x, y, z).project(camera);
      expect(Math.abs(ndc.x)).toBeLessThan(1); expect(Math.abs(ndc.y)).toBeLessThan(1); expect(Math.abs(ndc.z)).toBeLessThan(1);
    }
  });
});
