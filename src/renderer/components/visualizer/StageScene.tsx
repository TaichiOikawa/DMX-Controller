import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Color,
  DynamicDrawUsage,
  Euler,
  Matrix4,
  Quaternion,
  Vector3 as ThreeVector3,
  type InstancedMesh,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { evaluateVisualizerFixture } from '../../../shared/visualizer';
import type {
  StageLayout,
  VisualizerFixture,
  VisualizerFixtureProfile,
} from '../../../shared/types';

const CAMERA_STORAGE_KEY = 'dmx.visualizer.camera';
const MAX_FIXTURES = 170;

export type CameraPreset = 'front' | 'top' | 'perspective' | 'fit';

export interface StageSceneHandle {
  setCameraPreset(preset: CameraPreset): void;
}

interface StageSceneProps {
  stage: StageLayout;
  outputFrame: readonly number[];
  selectedFixtureId: string | null;
  onSelectFixture(id: string | null): void;
}

export const StageScene = forwardRef<StageSceneHandle, StageSceneProps>(function StageScene(
  props,
  ref,
) {
  const presetRef = useRef<((preset: CameraPreset) => void) | null>(null);
  useImperativeHandle(ref, () => ({
    setCameraPreset(preset) {
      presetRef.current?.(preset);
    },
  }));

  return (
    <Canvas
      camera={{ position: [10, 8, 12], fov: 45, near: 0.05, far: 200 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: false }}
      onPointerMissed={() => props.onSelectFixture(null)}
    >
      <color attach="background" args={['#080b12']} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 9, 5]} intensity={1.1} />
      <StageEnvironment stage={props.stage} />
      <InstancedFixtureLayer {...props} />
      <CameraController stage={props.stage} bindPreset={(handler) => (presetRef.current = handler)} />
    </Canvas>
  );
});

function StageEnvironment({ stage }: { stage: StageLayout }) {
  return (
    <group>
      <mesh position={[0, -0.03, stage.depthM / 2]} receiveShadow>
        <boxGeometry args={[stage.widthM, 0.06, stage.depthM]} />
        <meshStandardMaterial color="#202735" roughness={0.9} />
      </mesh>
      <gridHelper
        args={[Math.max(stage.widthM, stage.depthM), Math.ceil(Math.max(stage.widthM, stage.depthM)), '#526078', '#30394a']}
        position={[0, 0.005, stage.depthM / 2]}
      />
      <mesh position={[0, stage.heightM / 2, stage.depthM]}>
        <boxGeometry args={[stage.widthM, stage.heightM, 0.06]} />
        <meshStandardMaterial color="#151a24" roughness={1} />
      </mesh>
    </group>
  );
}

function InstancedFixtureLayer({
  stage,
  outputFrame,
  selectedFixtureId,
  onSelectFixture,
}: StageSceneProps) {
  const bodyRef = useRef<InstancedMesh>(null);
  const beamRef = useRef<InstancedMesh>(null);
  const markerRef = useRef<InstancedMesh>(null);
  const profileMap = useMemo(
    () => new Map(stage.profiles.map((profile) => [profile.id, profile])),
    [stage.profiles],
  );
  const fixtures = useMemo(() => stage.fixtures.slice(0, MAX_FIXTURES), [stage.fixtures]);
  const matrix = useMemo(() => new Matrix4(), []);
  const color = useMemo(() => new Color(), []);

  useLayoutEffect(() => {
    if (!bodyRef.current || !beamRef.current || !markerRef.current) return;
    fixtures.forEach((fixture, index) => {
      const profile = profileMap.get(fixture.profileId);
      if (!profile) return;
      updateInstances(
        fixture,
        profile,
        outputFrame,
        index,
        fixture.id === selectedFixtureId,
        stage,
        bodyRef.current!,
        beamRef.current!,
        markerRef.current!,
        matrix,
        color,
      );
    });
    bodyRef.current.count = fixtures.length;
    beamRef.current.count = fixtures.length;
    markerRef.current.count = fixtures.length;
    bodyRef.current.instanceMatrix.needsUpdate = true;
    beamRef.current.instanceMatrix.needsUpdate = true;
    markerRef.current.instanceMatrix.needsUpdate = true;
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
    if (beamRef.current.instanceColor) beamRef.current.instanceColor.needsUpdate = true;
    if (markerRef.current.instanceColor) markerRef.current.instanceColor.needsUpdate = true;
  }, [color, fixtures, matrix, outputFrame, profileMap, selectedFixtureId, stage]);

  useEffect(() => {
    for (const mesh of [bodyRef.current, beamRef.current, markerRef.current]) {
      mesh?.instanceMatrix.setUsage(DynamicDrawUsage);
    }
  }, []);

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[undefined, undefined, MAX_FIXTURES]}
        onClick={(event) => {
          event.stopPropagation();
          const fixture = event.instanceId === undefined ? undefined : fixtures[event.instanceId];
          onSelectFixture(fixture?.id ?? null);
        }}
      >
        <boxGeometry args={[0.42, 0.28, 0.52]} />
        <meshStandardMaterial vertexColors roughness={0.45} metalness={0.35} />
      </instancedMesh>
      <instancedMesh ref={beamRef} args={[undefined, undefined, MAX_FIXTURES]}>
        <coneGeometry args={[1, 1, 18, 1, true]} />
        <meshBasicMaterial vertexColors transparent opacity={0.17} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={markerRef} args={[undefined, undefined, MAX_FIXTURES]}>
        <circleGeometry args={[1, 24]} />
        <meshBasicMaterial vertexColors transparent opacity={0.65} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

function updateInstances(
  fixture: VisualizerFixture,
  profile: VisualizerFixtureProfile,
  outputFrame: readonly number[],
  index: number,
  selected: boolean,
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

  matrix.compose(position, mount, new ThreeVector3(1, 1, 1));
  body.setMatrixAt(index, matrix);
  body.setColorAt(index, color.set(selected ? '#54d8ff' : '#697386'));

  const floorDistance = direction.y < -0.0001 ? Math.max(0.05, -position.y / direction.y) : 0;
  const length = Math.min(floorDistance || Math.max(stage.widthM, stage.depthM), 30);
  const beamRotation = new Quaternion().setFromUnitVectors(new ThreeVector3(0, -1, 0), direction);
  const radius = Math.max(0.015, Math.tan(degrees(state.parameters.zoom / 2)) * length);
  const beamPosition = position.clone().addScaledVector(direction, length / 2);
  matrix.compose(beamPosition, beamRotation, new ThreeVector3(radius, length, radius));
  beam.setMatrixAt(index, matrix);
  beam.setColorAt(
    index,
    color.setRGB(
      state.color.red * state.intensity,
      state.color.green * state.intensity,
      state.color.blue * state.intensity,
    ),
  );

  const hit = position.clone().addScaledVector(direction, length);
  const markerRotation = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
  const markerRadius = floorDistance > 0 ? radius * state.intensity : 0;
  matrix.compose(
    new ThreeVector3(hit.x, 0.012, hit.z),
    markerRotation,
    new ThreeVector3(markerRadius, markerRadius, markerRadius),
  );
  marker.setMatrixAt(index, matrix);
  marker.setColorAt(
    index,
    color.setRGB(
      state.color.red * state.intensity,
      state.color.green * state.intensity,
      state.color.blue * state.intensity,
    ),
  );
}

function CameraController({
  stage,
  bindPreset,
}: {
  stage: StageLayout;
  bindPreset(handler: (preset: CameraPreset) => void): void;
}) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  useEffect(() => {
    const saved = loadCamera();
    if (saved) {
      camera.position.fromArray(saved.position);
      controls.current?.target.fromArray(saved.target);
      controls.current?.update();
    }
  }, [camera]);

  useEffect(() => {
    bindPreset((preset) => {
      const distance = Math.max(stage.widthM, stage.depthM, stage.heightM) * 1.35;
      const target = new ThreeVector3(0, stage.heightM * 0.35, stage.depthM / 2);
      controls.current?.target.copy(target);
      if (preset === 'front') camera.position.set(0, stage.heightM * 0.45, -distance);
      else if (preset === 'top') camera.position.set(0, distance, stage.depthM / 2);
      else if (preset === 'perspective') camera.position.set(distance, distance * 0.65, -distance * 0.8);
      else camera.position.set(distance, distance * 0.75, distance);
      camera.lookAt(target);
      controls.current?.update();
    });
    return () => bindPreset(() => {});
  }, [bindPreset, camera, stage]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={1}
      maxDistance={100}
      onEnd={() => {
        if (!controls.current) return;
        try {
          localStorage.setItem(
            CAMERA_STORAGE_KEY,
            JSON.stringify({
              position: camera.position.toArray(),
              target: controls.current.target.toArray(),
            }),
          );
        } catch {
          // localStorage不可時は視点の永続化だけを省略する。
        }
      }}
    />
  );
}

function loadCamera(): { position: [number, number, number]; target: [number, number, number] } | null {
  try {
    const value = JSON.parse(localStorage.getItem(CAMERA_STORAGE_KEY) ?? 'null') as {
      position?: unknown;
      target?: unknown;
    } | null;
    if (!value || !isVector(value.position) || !isVector(value.target)) return null;
    return { position: value.position, target: value.target };
  } catch {
    return null;
  }
}

function isVector(value: unknown): value is [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => typeof component === 'number' && Number.isFinite(component))
  );
}

function degrees(value: number): number {
  return (value * Math.PI) / 180;
}
