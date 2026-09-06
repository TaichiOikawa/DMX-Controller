import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { createDefaultStaticFixtureParameters, type StageLayout } from '../../../shared/types';
import { createInitialVisualizerProfiles } from '../../../shared/visualizer';
import { updateVisualizerInstances } from './sceneInstances';
import { createStageSurfaces } from './stageGeometry';

describe('3D Fixture instance colors', () => {
  it('keeps the housing neutral while rendering final DMX RGB on the beam and marker', () => {
    const profile = createInitialVisualizerProfiles()[1];
    const fixture = {
      id: 'rgb',
      name: 'RGB',
      profileId: profile.id,
      startChannel: 0,
      positionM: { x: 0, y: 2, z: 1 },
      mountRotationDeg: { x: 0, y: 0, z: 0 },
      staticParameters: createDefaultStaticFixtureParameters(),
    };
    const stage: StageLayout = {
      widthM: 10,
      depthM: 8,
      heightM: 5,
      profiles: [profile],
      fixtures: [fixture],
    };
    const geometry = new BoxGeometry(1, 1, 1);
    const bodyMaterial = new MeshBasicMaterial();
    const lightMaterial = new MeshBasicMaterial();
    const body = new InstancedMesh(geometry, bodyMaterial, 1);
    const beam = new InstancedMesh(geometry, lightMaterial, 1);
    const marker = new InstancedMesh(geometry, lightMaterial, createStageSurfaces(stage).length);

    updateVisualizerInstances(
      fixture,
      profile,
      [255, 64, 0],
      0,
      stage,
      body,
      beam,
      marker,
      new Matrix4(),
      new Color(),
    );

    const beamColor = new Color();
    beam.getColorAt(0, beamColor);
    expect(beamColor.r).toBeCloseTo(1);
    expect(beamColor.g).toBeCloseTo(64 / 255);
    expect(beamColor.b).toBeCloseTo(0);

    const markerColor = new Color();
    marker.getColorAt(0, markerColor);
    expect(markerColor.r).toBeCloseTo(1);
    expect(markerColor.g).toBeCloseTo(64 / 255);
    expect(markerColor.b).toBeCloseTo(0);

    expect(body.instanceColor).toBeNull();
    expect(bodyMaterial.version).toBe(0);
    expect(lightMaterial.version).toBeGreaterThan(0);

    geometry.dispose();
    bodyMaterial.dispose();
    lightMaterial.dispose();
  });
});
