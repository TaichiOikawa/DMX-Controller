import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { StageLayout, VisualizerFixture } from '../../../shared/types';
import { createDefaultVisualizerProfileLibrary } from '../../../shared/visualizerProfiles';
import { updateVisualizerInstances } from './sceneInstances';
import { createStageSurfaces } from './stageGeometry';

const FIXTURE_COUNT = 170;
const FRAME_BUDGET_MS = 1000 / 30;

describe('3D Visualizer instance update performance', () => {
  it.each([0, 64])('updates 170 fixtures with %s obstacles within a 30fps CPU frame budget', obstacleCount => {
    const profile = createDefaultVisualizerProfileLibrary().profiles[3];
    const fixtures: VisualizerFixture[] = Array.from({ length: FIXTURE_COUNT }, (_, index) => ({
      id: `fixture-${index}`,
      name: `Fixture ${index + 1}`,
      profileId: profile.id,
      startChannel: index % 504,
      positionM: { x: (index % 17) * 0.5 - 4, y: 4, z: Math.floor(index / 17) * 0.5 + 1 },
      mountRotationDeg: { x: 0, y: 0, z: 0 },
      staticParameters: structuredClone(profile.defaultStaticParameters),
    }));
    const stage: StageLayout = {
      widthM: 10,
      depthM: 8,
      heightM: 5,
      profiles: [profile],
      fixtures,
      obstacles: Array.from({ length: obstacleCount }, (_, i) => ({ id: `box-${i}`, name: 'box', positionM: { x: (i % 8) - 4, y: 0.5, z: Math.floor(i / 8) }, sizeM: { x: 0.5, y: 1, z: 0.5 } })),
    };
    const surfaces = createStageSurfaces(stage);
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshBasicMaterial();
    const body = new InstancedMesh(geometry, material, FIXTURE_COUNT);
    const beam = new InstancedMesh(geometry, material, FIXTURE_COUNT);
    const marker = new InstancedMesh(geometry, material, FIXTURE_COUNT * surfaces.length);
    const outputFrame = Array<number>(512).fill(192);
    const matrix = new Matrix4();
    const color = new Color();

    const updateAll = () => {
      let markerOffset = 0;
      fixtures.forEach((fixture, index) => {
        markerOffset += updateVisualizerInstances(
          fixture,
          profile,
          outputFrame,
          index,
          stage,
          body,
          beam,
          marker,
          matrix,
          color,
          0,
          surfaces,
          undefined,
          markerOffset,
        );
      });
    };

    updateAll();
    const durations = Array.from({ length: 7 }, () => {
      const startedAt = performance.now();
      updateAll();
      return performance.now() - startedAt;
    }).sort((a, b) => a - b);
    const medianMs = durations[Math.floor(durations.length / 2)];

    geometry.dispose();
    material.dispose();
    expect(medianMs).toBeLessThan(FRAME_BUDGET_MS);
  });
});
