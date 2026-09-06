import { Box3, Vector3 } from 'three';
import type { StageLayout } from '../../../shared/types';

export interface StageSurface {
  center: Vector3;
  normal: Vector3;
  min: Vector3;
  max: Vector3;
}

/** The same boxes define scenery rendering, ray intersections, and camera bounds. */
export function stageBoxes(stage: StageLayout) {
  return [
    { id: 'floor', name: '床', positionM: { x: 0, y: -0.03, z: stage.depthM / 2 }, sizeM: { x: stage.widthM, y: 0.06, z: stage.depthM } },
    { id: 'backdrop', name: '背景', positionM: { x: 0, y: stage.heightM / 2, z: stage.depthM + 0.03 }, sizeM: { x: stage.widthM, y: stage.heightM, z: 0.06 } },
    ...(stage.obstacles ?? []),
  ];
}

export function createStageSurfaces(stage: StageLayout): StageSurface[] {
  return stageBoxes(stage).flatMap(box => {
    const center = new Vector3(box.positionM.x, box.positionM.y, box.positionM.z);
    const half = new Vector3(box.sizeM.x, box.sizeM.y, box.sizeM.z).multiplyScalar(0.5);
    const min = center.clone().sub(half);
    const max = center.clone().add(half);
    return ([0, 1, 2] as const).flatMap(axis => [-1, 1].map(sign => {
      const faceCenter = center.clone().setComponent(axis, sign < 0 ? min.getComponent(axis) : max.getComponent(axis));
      return { center: faceCenter, normal: new Vector3().setComponent(axis, sign), min, max };
    }));
  });
}

/** Only entering faces block a beam. Returns the nearest finite receiver in front. */
export function intersectStage(origin: Vector3, direction: Vector3, surfaces: readonly StageSurface[], maxDistance = 30) {
  let nearest: { surface: StageSurface; distance: number } | null = null;
  for (const surface of surfaces) {
    const dot = direction.dot(surface.normal);
    if (dot >= -1e-6) continue;
    const distance = (surface.center.dot(surface.normal) - origin.dot(surface.normal)) / dot;
    if (distance <= 1e-5 || distance > maxDistance || (nearest && distance >= nearest.distance)) continue;
    let inside = true;
    for (let axis = 0; axis < 3; axis++) {
      const coordinate = origin.getComponent(axis) + direction.getComponent(axis) * distance;
      if (coordinate < surface.min.getComponent(axis) - 1e-5 || coordinate > surface.max.getComponent(axis) + 1e-5) inside = false;
    }
    if (inside) nearest = { surface, distance };
  }
  return nearest;
}

export function stageBounds(stage: StageLayout): Box3 {
  const bounds = new Box3();
  for (const box of stageBoxes(stage)) {
    const center = new Vector3(box.positionM.x, box.positionM.y, box.positionM.z);
    const half = new Vector3(box.sizeM.x, box.sizeM.y, box.sizeM.z).multiplyScalar(0.5);
    bounds.expandByPoint(center.clone().sub(half));
    bounds.expandByPoint(center.clone().add(half));
  }
  // A sphere enclosing the rotated housing and selection highlight.
  for (const fixture of stage.fixtures) {
    const center = new Vector3(fixture.positionM.x, fixture.positionM.y, fixture.positionM.z);
    bounds.expandByPoint(center.clone().addScalar(0.5));
    bounds.expandByPoint(center.addScalar(-0.5));
  }
  return bounds;
}
