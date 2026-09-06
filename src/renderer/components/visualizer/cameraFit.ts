import { Box3, Vector3, type PerspectiveCamera } from 'three';

/** Three.js cameras are mutable external render objects, not React state. */
export function setCameraFarPlane(camera: PerspectiveCamera, far: number) {
  camera.far = far;
  camera.updateProjectionMatrix();
}

/** Fit all eight corners, including their depth, inside a perspective frustum. */
export function fitCamera(bounds: Box3, viewDirection: Vector3, verticalFovDeg: number, aspect: number) {
  const target = bounds.getCenter(new Vector3());
  const forward = viewDirection.clone().normalize();
  const upReference = Math.abs(forward.y) > 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(forward, upReference).normalize();
  const up = new Vector3().crossVectors(right, forward).normalize();
  const tanY = Math.tan(verticalFovDeg * Math.PI / 360);
  const tanX = tanY * Math.max(0.01, aspect);
  let distance = 1;
  let depthRadius = 0;
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    const delta = new Vector3(x, y, z).sub(target);
    const depth = delta.dot(forward);
    distance = Math.max(distance, Math.abs(delta.dot(right)) * 1.12 / tanX - depth, Math.abs(delta.dot(up)) * 1.12 / tanY - depth);
    depthRadius = Math.max(depthRadius, Math.abs(depth));
  }
  distance = Math.max(distance, depthRadius + 1);
  return { target, position: target.clone().addScaledVector(forward, -distance), up, far: Math.max(200, (distance + depthRadius) * 2), distance };
}
