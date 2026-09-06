import {
  Color,
  Euler,
  Matrix4,
  Quaternion,
  Vector3 as ThreeVector3,
  type InstancedMesh,
} from 'three';
import type {
  StageLayout,
  VisualizerFixture,
  VisualizerFixtureProfile,
} from '../../../shared/types';
import { evaluateVisualizerFixture } from '../../../shared/visualizer';
import { createStageSurfaces, intersectStage, type StageSurface } from './stageGeometry';
import { setProjectionCone, setSurfaceBounds } from './surfaceClipping';

// Synchronous scratch space: never retain these objects in scene state.
const position = new ThreeVector3();
const direction = new ThreeVector3();
const beamPosition = new ThreeVector3();
const markerPosition = new ThreeVector3();
const scale = new ThreeVector3();
const mount = new Quaternion();
const aim = new Quaternion();
const rotation = new Quaternion();
const euler = new Euler();
const down = new ThreeVector3(0, -1, 0);
const panAxis = new ThreeVector3(0, 1, 0);
const tiltAxis = new ThreeVector3(1, 0, 0);
const MAX_BEAM_LENGTH = 30;
const tangent = new ThreeVector3();
const bitangent = new ThreeVector3();
const basis = new Matrix4();

export function updateVisualizerInstances(
  fixture: VisualizerFixture,
  profile: VisualizerFixtureProfile,
  outputFrame: readonly number[],
  index: number,
  stage: StageLayout,
  body: InstancedMesh,
  beam: InstancedMesh,
  marker: InstancedMesh,
  matrix: Matrix4,
  color: Color,
  timeMs = 0,
  surfaces: readonly StageSurface[] = createStageSurfaces(stage),
  housing?: { head: InstancedMesh; lens: InstancedMesh },
  markerOffset = index,
) {
  const state = evaluateVisualizerFixture(profile, fixture, outputFrame, timeMs);
  position.set(fixture.positionM.x, fixture.positionM.y, fixture.positionM.z);
  mount.setFromEuler(
    euler.set(
      degrees(fixture.mountRotationDeg.x),
      degrees(fixture.mountRotationDeg.y),
      degrees(fixture.mountRotationDeg.z),
      'XYZ',
    ),
  );
  aim.copy(mount)
    .multiply(rotation.setFromAxisAngle(panAxis, degrees(state.parameters.pan)))
    .multiply(rotation.setFromAxisAngle(tiltAxis, degrees(state.parameters.tilt)));
  direction.copy(down).applyQuaternion(aim).normalize();
  const red = state.color.red * state.intensity;
  const green = state.color.green * state.intensity;
  const blue = state.color.blue * state.intensity;

  mount.multiply(rotation.setFromAxisAngle(panAxis, degrees(state.parameters.pan)));
  matrix.compose(position, mount, scale.set(1, 1, 1));
  body.setMatrixAt(index, matrix);
  if (housing) {
    matrix.compose(position, aim, scale.set(1, 1, 1));
    housing.head.setMatrixAt(index, matrix);
    housing.lens.setMatrixAt(index, matrix);
    setInstanceColor(housing.lens, index, color.setRGB(red, green, blue));
  }

  const hit = intersectStage(position, direction, surfaces, MAX_BEAM_LENGTH);
  // The shader clips individual rays against scenery. A centre-ray length
  // would cut some edges short and allow others to penetrate the receiver.
  const length = MAX_BEAM_LENGTH;
  rotation.setFromUnitVectors(down, direction);
  const spread = Math.tan(degrees(Math.min(179, Math.max(0, state.parameters.zoom)) / 2));
  const radius = spread * length;
  beamPosition.copy(position).addScaledVector(direction, length / 2);
  matrix.compose(beamPosition, rotation, scale.set(radius, length, radius));
  beam.setMatrixAt(index, matrix);
  setInstanceColor(beam, index, color.setRGB(red, green, blue));

  // Every entering face can receive a different part of the cone. The centre
  // ray's nearest hit only determines ordering, not the receiver list.
  let markerCount = 0;
  const projectSurface = (surface: StageSurface) => {
    const normal = surface.normal;
    const height = tangent.copy(position).sub(surface.center).dot(normal);
    if (height <= 0.00001 || height > MAX_BEAM_LENGTH) return;
    const boundRadius = tangent.copy(surface.max).sub(surface.min).length() / 2;
    tangent.copy(surface.center).sub(position);
    const distanceSquared = tangent.lengthSq();
    const axialDistance = tangent.dot(direction);
    if (Math.sqrt(distanceSquared) - boundRadius > MAX_BEAM_LENGTH || axialDistance + boundRadius <= 0 ||
        Math.sqrt(Math.max(0, distanceSquared - axialDistance ** 2)) > Math.max(0, axialDistance) * spread + boundRadius * Math.sqrt(1 + spread * spread)) return;
    const cosine = -direction.dot(normal);
    if (cosine <= -Math.sin(Math.atan(spread))) return;
    const denominator = cosine ** 2 - spread ** 2 * (1 - cosine ** 2);
    markerPosition.copy(position);
    if (cosine > 0 && denominator > 0.0001) {
      tangent.copy(direction).addScaledVector(normal, cosine);
      markerPosition.addScaledVector(normal, -height + 0.012)
        .addScaledVector(tangent, height * cosine * (1 + spread ** 2) / denominator);
      if (tangent.lengthSq() < 1e-10) tangent.set(Math.abs(normal.x) < 0.9 ? 1 : 0, Math.abs(normal.x) < 0.9 ? 0 : 1, 0);
      tangent.normalize();
      bitangent.crossVectors(normal, tangent).normalize();
      rotation.setFromRotationMatrix(basis.makeBasis(tangent, bitangent, normal));
      scale.set(height * spread / denominator, height * spread / Math.sqrt(denominator), 1);
    } else {
      // At grazing angles the conic is unbounded. Cover the finite face and
      // let the fragment shader clip the exact cone, including partial hits.
      tangent.set(Math.abs(normal.x) < 0.9 ? 1 : 0, Math.abs(normal.x) < 0.9 ? 0 : 1, 0);
      bitangent.crossVectors(normal, tangent).normalize();
      rotation.setFromRotationMatrix(basis.makeBasis(tangent, bitangent, normal));
      markerPosition.copy(surface.center).addScaledVector(normal, 0.012);
      const extent = beamPosition.copy(surface.max).sub(surface.min);
      scale.set(Math.abs(extent.dot(tangent)) / 2, Math.abs(extent.dot(bitangent)) / 2, 1);
    }
    // Conservative world AABB of the quad avoids submitting distant faces.
    for (let axis = 0; axis < 3; axis++) {
      const extent = Math.abs(tangent.getComponent(axis)) * scale.x + Math.abs(bitangent.getComponent(axis)) * scale.y;
      if (markerPosition.getComponent(axis) + extent < surface.min.getComponent(axis) - 0.015 ||
          markerPosition.getComponent(axis) - extent > surface.max.getComponent(axis) + 0.015) return;
    }
    const slot = markerOffset + markerCount++;
    matrix.compose(markerPosition, rotation, scale);
    marker.setMatrixAt(slot, matrix);
    setSurfaceBounds(marker, slot, surface);
    setProjectionCone(marker, slot, position, direction, 1 / Math.sqrt(1 + spread * spread));
    setInstanceColor(marker, slot, color.setRGB(red, green, blue));
  };
  // Keep the principal receiver first for inspection and deterministic order.
  if (hit) projectSurface(hit.surface);
  for (const surface of surfaces) if (surface !== hit?.surface) projectSurface(surface);
  if (markerCount === 0) {
    marker.setMatrixAt(markerOffset, matrix.makeScale(0, 0, 0));
    setInstanceColor(marker, markerOffset, color.setRGB(red, green, blue));
  }
  return markerCount;
}

function setInstanceColor(mesh: InstancedMesh, index: number, color: Color): void {
  const createsInstanceColor = mesh.instanceColor === null;
  mesh.setColorAt(index, color);
  if (!createsInstanceColor) return;

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) material.needsUpdate = true;
}

function degrees(value: number): number {
  return (value * Math.PI) / 180;
}
