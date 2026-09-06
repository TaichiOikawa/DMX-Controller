import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { createDefaultStageLayout } from '../../../shared/types';
import { fixtureDropPosition } from './fixtureDrop';

const stage = { ...createDefaultStageLayout(), widthM: 10, heightM: 5, depthM: 8 };
const rect = { left: 100, top: 50, width: 800, height: 600 };
const center = new Vector3(0, 4, 4);

describe('fixtureDropPosition', () => {
  for (const [name, position, up] of [
    ['front', new Vector3(0, 4, -10), new Vector3(0, 1, 0)],
    ['top', new Vector3(0, 20, 4), new Vector3(0, 0, 1)],
    ['perspective', new Vector3(10, 12, -10), new Vector3(0, 1, 0)],
  ] as const) {
    it(`places at the drop pixel in the ${name} view`, () => {
      const camera = new PerspectiveCamera(45, rect.width / rect.height, 0.05, 200);
      camera.position.copy(position);
      camera.up.copy(up);
      camera.lookAt(center);
      camera.updateMatrixWorld();
      const drop = fixtureDropPosition(camera, rect, 620, 260, stage)!;
      const projected = new Vector3(drop.x, drop.y, drop.z).project(camera);
      expect((projected.x + 1) / 2 * rect.width + rect.left).toBeCloseTo(620);
      expect((1 - projected.y) / 2 * rect.height + rect.top).toBeCloseTo(260);
      const snapped = fixtureDropPosition(camera, rect, 620, 260, stage, 0.5)!;
      for (const value of Object.values(snapped)) expect(value * 2).toBe(Math.round(value * 2));
    });
  }

  it('rejects drops outside or without a rendered viewport', () => {
    const camera = new PerspectiveCamera();
    expect(fixtureDropPosition(camera, rect, 50, 250, stage)).toBeNull();
    expect(fixtureDropPosition(camera, { ...rect, width: 0 }, 500, 350, stage)).toBeNull();
  });
});
