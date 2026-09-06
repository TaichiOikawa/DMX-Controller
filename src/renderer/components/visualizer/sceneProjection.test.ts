import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createDefaultVisualizerProfileLibrary } from '../../../shared/visualizerProfiles';
import { updateVisualizerInstances } from './sceneInstances';
import { createStageSurfaces } from './stageGeometry';

function project({ dimmer = 1, tilt = 0, height = 4 } = {}) {
  const profile = createDefaultVisualizerProfileLibrary().profiles[0];
  const fixture = {
    id: 'projection', name: 'Projection', profileId: profile.id,
    positionM: { x: 0, y: height, z: 6 }, mountRotationDeg: { x: tilt, y: 0, z: 0 },
    staticParameters: { ...profile.defaultStaticParameters, dimmer, zoom: 20 },
  };
  const stage = { widthM: 10, depthM: 8, heightM: 5, profiles: [profile], fixtures: [fixture] };
  const geometry = new BoxGeometry();
  const material = new MeshBasicMaterial();
  const meshes = Array.from({ length: 3 }, () => new InstancedMesh(geometry, material, createStageSurfaces(stage).length));
  const count = updateVisualizerInstances(fixture, profile, [], 0, stage, meshes[0], meshes[1], meshes[2], new Matrix4(), new Color());
  const matrix = new Matrix4().makeScale(0, 0, 0);
  // Other faces may receive light now; inspect the floor specifically.
  for (let i = 0; i < count; i++) {
    const candidate = new Matrix4(); meshes[2].getMatrixAt(i, candidate);
    if (new Vector3(0, 0, 1).transformDirection(candidate).y > 0.99 &&
        Math.abs(new Vector3().setFromMatrixPosition(candidate).y - 0.012) < 0.001) matrix.copy(candidate);
  }
  const position = new Vector3().setFromMatrixPosition(matrix);
  const scale = new Vector3().setFromMatrixScale(matrix);
  const color = new Color();
  meshes[2].getColorAt(0, color);
  geometry.dispose(); material.dispose(); meshes.forEach(mesh => mesh.dispose());
  return { position, scale, color };
}

describe('floor illumination geometry', () => {
  it('preserves the illuminated area when dimming', () => {
    expect(project({ dimmer: 0.25 }).scale.x).toBeCloseTo(project().scale.x);
    expect(project({ dimmer: 0.25 }).color.r).toBeCloseTo(0.25);
  });
  it('projects an oblique cone as an ellipse with the correct edge intersections', () => {
    const { position, scale } = project({ tilt: 45 });
    const near = 6 - 4 * Math.tan(55 * Math.PI / 180);
    const far = 6 - 4 * Math.tan(35 * Math.PI / 180);
    expect(position.z).toBeCloseTo((near + far) / 2);
    expect(scale.x).toBeCloseTo((far - near) / 2);
    expect(scale.x).toBeGreaterThan(scale.y);
  });
  it.each([{ height: 40 }, { height: 0 }, { height: -1 }, { tilt: 180 }])(
    'does not invent a floor hit for %o', (settings) => {
      expect(project(settings).scale.length()).toBe(0);
    },
  );
});
