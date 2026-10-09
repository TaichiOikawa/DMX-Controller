import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createFixtureGeometry } from './fixtureGeometry';

describe('fixture dimensions in stage metres', () => {
  it.each([1, 2, 3])('keeps the standard housing within 33cm wide and 44cm tall at detail %i', detail => {
    const parts = createFixtureGeometry(detail);
    const bounds = new Box3();
    for (const geometry of Object.values(parts)) {
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox!);
      geometry.dispose();
    }
    const size = bounds.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(0.30);
    expect(size.x).toBeLessThanOrEqual(0.33);
    expect(size.y).toBeGreaterThan(0.42);
    expect(size.y).toBeLessThanOrEqual(0.44);
  });
});
