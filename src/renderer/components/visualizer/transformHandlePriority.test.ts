import { Group, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { TransformControls, TransformControlsGizmo } from 'three-stdlib';
import { describe, expect, it } from 'vitest';
import { hitsTransformHandle } from './transformHandlePriority';

describe('transform handle priority', () => {
  it.each(['translate', 'rotate'] as const)('uses the actual %s picker and rejects empty space', mode => {
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(4, 4, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const target = new Group(); const scene = new Group(); scene.add(target);
    const controls = new TransformControls(camera, undefined);
    controls.attach(target); controls.setMode(mode); controls.updateMatrixWorld();
    const gizmo = controls.children.find(child => child instanceof TransformControlsGizmo);
    expect(gizmo).toBeInstanceOf(TransformControlsGizmo);
    if (!(gizmo instanceof TransformControlsGizmo)) throw new Error('No picker');
    const raycaster = new Raycaster();
    // Project a visible picker vertex to exercise the installed control geometry.
    const picker = gizmo.picker[mode];
    let hit = false;
    picker.traverse(child => {
      if (hit || !child.visible || !('geometry' in child)) return;
      const mesh = child as import('three').Mesh;
      const vertices = mesh.geometry.getAttribute('position');
      for (let i = 0; i < vertices.count && !hit; i++) {
        const point = new Vector3().fromBufferAttribute(vertices, i).applyMatrix4(child.matrixWorld).project(camera);
        raycaster.setFromCamera(new Vector2(point.x, point.y), camera);
        hit = hitsTransformHandle(controls, raycaster);
      }
    });
    expect(hit).toBe(true);
    raycaster.setFromCamera(new Vector2(0.95, 0.95), camera);
    expect(hitsTransformHandle(controls, raycaster)).toBe(false);
    controls.detach();
    expect(hitsTransformHandle(controls, raycaster)).toBe(false);
    controls.dispose();
  });
});
