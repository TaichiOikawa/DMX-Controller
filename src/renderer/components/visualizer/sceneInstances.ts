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
) {
  const state = evaluateVisualizerFixture(profile, fixture, outputFrame);
  const position = new ThreeVector3(fixture.positionM.x, fixture.positionM.y, fixture.positionM.z);
  const mount = new Quaternion().setFromEuler(
    new Euler(
      degrees(fixture.mountRotationDeg.x),
      degrees(fixture.mountRotationDeg.y),
      degrees(fixture.mountRotationDeg.z),
      'XYZ',
    ),
  );
  const aim = mount
    .clone()
    .multiply(new Quaternion().setFromAxisAngle(new ThreeVector3(0, 1, 0), degrees(state.parameters.pan)))
    .multiply(new Quaternion().setFromAxisAngle(new ThreeVector3(1, 0, 0), degrees(state.parameters.tilt)));
  const direction = new ThreeVector3(0, -1, 0).applyQuaternion(aim).normalize();
  const red = state.color.red * state.intensity;
  const green = state.color.green * state.intensity;
  const blue = state.color.blue * state.intensity;

  matrix.compose(position, mount, new ThreeVector3(1, 1, 1));
  body.setMatrixAt(index, matrix);

  const floorDistance = direction.y < -0.0001 ? Math.max(0.05, -position.y / direction.y) : 0;
  const length = Math.min(floorDistance || Math.max(stage.widthM, stage.depthM), 30);
  const beamRotation = new Quaternion().setFromUnitVectors(new ThreeVector3(0, -1, 0), direction);
  const radius = Math.max(0.015, Math.tan(degrees(state.parameters.zoom / 2)) * length);
  const beamPosition = position.clone().addScaledVector(direction, length / 2);
  matrix.compose(beamPosition, beamRotation, new ThreeVector3(radius, length, radius));
  beam.setMatrixAt(index, matrix);
  setInstanceColor(beam, index, color.setRGB(red, green, blue));

  const hit = position.clone().addScaledVector(direction, length);
  const markerRotation = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
  const markerRadius = floorDistance > 0 ? radius * state.intensity : 0;
  matrix.compose(
    new ThreeVector3(hit.x, 0.012, hit.z),
    markerRotation,
    new ThreeVector3(markerRadius, markerRadius, markerRadius),
  );
  marker.setMatrixAt(index, matrix);
  setInstanceColor(marker, index, color.setRGB(red, green, blue));
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
