import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';
import type { StageLayout, VisualizerFixture } from '../../../shared/types';

/** Place on a view-facing plane through the stage so front/top/orbit views all support drops. */
export function fixtureDropPosition(
  camera: Camera,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
  stage: StageLayout,
  snap = 0,
): VisualizerFixture['positionM'] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const pointer = new Vector2((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
  if (Math.abs(pointer.x) > 1 || Math.abs(pointer.y) > 1) return null;
  const ray = new Raycaster();
  ray.setFromCamera(pointer, camera);
  const center = new Vector3(0, Math.min(stage.heightM, 4), stage.depthM / 2);
  const plane = new Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), center);
  const point = ray.ray.intersectPlane(plane, new Vector3());
  if (!point || !point.toArray().every(Number.isFinite)) return null;
  const round = (value: number) => snap > 0 ? Math.round(value / snap) * snap : value;
  return { x: round(point.x), y: round(point.y), z: round(point.z) };
}
