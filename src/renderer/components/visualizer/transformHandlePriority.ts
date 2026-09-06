import { Raycaster, Vector2, type Camera } from 'three';
import { TransformControlsGizmo, type TransformControls } from 'three-stdlib';

/** Use the same invisible pick volumes as TransformControls, including rings. */
export function hitsTransformHandle(controls: TransformControls, raycaster: Raycaster): boolean {
  if (!controls.visible) return false;
  controls.updateMatrixWorld();
  const gizmo = controls.children.find(child => child instanceof TransformControlsGizmo);
  if (!(gizmo instanceof TransformControlsGizmo)) return false;
  const mode = controls.getMode();
  const picker = mode === 'translate' ? gizmo.picker.translate : mode === 'rotate' ? gizmo.picker.rotate : gizmo.picker.scale;
  return raycaster.intersectObject(picker, true)
    .some(hit => hit.object.visible);
}

export function bindTransformHandlePriority(
  element: HTMLElement,
  controls: TransformControls,
  camera: Camera,
  onPriority: (hit: boolean) => void,
) {
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const onPointerDown = (event: PointerEvent) => {
    const rect = element.getBoundingClientRect();
    if (event.button !== 0 || !rect.width || !rect.height) { onPriority(false); return; }
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(pointer, camera);
    onPriority(hitsTransformHandle(controls, raycaster));
    // Do not stop the DOM event: TransformControls still needs its own handler.
  };
  element.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    element.removeEventListener('pointerdown', onPointerDown, true);
    onPriority(false);
  };
}
