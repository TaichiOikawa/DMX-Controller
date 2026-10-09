import { OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Color,
  BoxGeometry,
  EdgesGeometry,
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  Matrix4,
  PerspectiveCamera,
  Vector3 as ThreeVector3,
  type InstancedMesh,
  type Group,
  type Camera,
} from 'three';
import type { OrbitControls as OrbitControlsImpl, TransformControls as TransformControlsImpl } from 'three-stdlib';
import type { StageLayout, VisualizerFixture } from '../../../shared/types';
import { evaluateVisualizerFixture } from '../../../shared/visualizer';
import { createFixturePointerDownHandler, renderableFixtures } from './fixtureSelection';
import { updateVisualizerInstances } from './sceneInstances';
import { createStageSurfaces, stageBoxes, stageBounds } from './stageGeometry';
import { fitCamera, setCameraFarPlane } from './cameraFit';
import { createProjectionOccluders, createProjectionShader } from './surfaceClipping';
import { createFixtureGeometry } from './fixtureGeometry';
import { createBeamShader } from './beamShading';
import { bindTransformHandlePriority } from './transformHandlePriority';
import { BoxSelection } from './BoxSelection';
import { transformSelectedFixtures } from './multiSelection';
import { fixtureDropPosition } from './fixtureDrop';
import { AxisNavigation, type AxisView } from './AxisNavigation';
import { FIXTURE_MODEL_SCALE } from './fixtureDimensions';
import { RENDER_QUALITY, type RenderQuality } from './renderQuality';

const CAMERA_STORAGE_KEY = 'dmx.visualizer.camera';
const MAX_FIXTURES = 170;
export const FIXTURE_MOVE_SNAP_M = 0.5;
export const FIXTURE_ROTATE_SNAP_DEG = 15;

export type CameraPreset = 'front' | 'top' | 'perspective' | 'fit' | AxisView;
export type FixtureTransform = Pick<VisualizerFixture, 'positionM' | 'mountRotationDeg'>;

export interface StageSceneHandle {
  setCameraPreset(preset: CameraPreset): void;
  getDropPosition(clientX: number, clientY: number): VisualizerFixture['positionM'] | null;
}

interface StageSceneProps {
  stage: StageLayout;
  outputFrame: readonly number[];
  selectedFixtureId: string | null;
  selectedFixtureIds?: readonly string[];
  onSelectFixtures?(ids: string[]): void;
  onSelectFixture(id: string | null): void;
  workLight?: boolean;
  quality?: RenderQuality;
  showGrid?: boolean;
  snapEnabled?: boolean;
  transformMode?: 'translate' | 'rotate';
  onTransformFixture?(id: string, transform: FixtureTransform): void;
}

export const StageScene = forwardRef<StageSceneHandle, StageSceneProps>(function StageScene(
  props,
  ref,
) {
  const presetRef = useRef<((preset: CameraPreset) => void) | null>(null);
  const dropView = useRef<{ camera: Camera; canvas: HTMLCanvasElement } | null>(null);
  const manipulating = useRef(false);
  const handlePriority = useRef(false);
  const boxPriority = useRef(false);
  const setBoxPriority = useCallback((active: boolean) => {
    if (active) boxPriority.current = true;
    else requestAnimationFrame(() => { boxPriority.current = false; });
  }, []);
  const setHandlePriority = useCallback((hit: boolean) => { handlePriority.current = hit; }, []);
  const [preview, setPreview] = useState<{ id: string; transform: FixtureTransform } | null>(null);
  const selected = props.stage.fixtures.find(fixture => fixture.id === props.selectedFixtureId);
  const selectableFixtures = useMemo(() => renderableFixtures(props.stage), [props.stage]);
  const displayStage = useMemo(() => preview ? transformSelectedFixtures(props.stage, props.selectedFixtureIds ?? [preview.id], preview.id, preview.transform) : props.stage, [props.stage, props.selectedFixtureIds, preview]);
  useImperativeHandle(ref, () => ({
    setCameraPreset(preset) {
      presetRef.current?.(preset);
    },
    getDropPosition(clientX, clientY) {
      const view = dropView.current;
      return view ? fixtureDropPosition(view.camera, view.canvas.getBoundingClientRect(), clientX, clientY, props.stage, props.snapEnabled ? FIXTURE_MOVE_SNAP_M : 0) : null;
    },
  }));

  return (
    <Canvas
      onCreated={({ camera, gl }) => { dropView.current = { camera, canvas: gl.domElement }; }}
      frameloop="demand"
      camera={{ position: [10, 8, 12], fov: 45, near: 0.05, far: 200 }}
      dpr={RENDER_QUALITY[props.quality ?? 'low'].dpr}
      gl={{ antialias: true, alpha: false, localClippingEnabled: true }}
      onPointerMissed={() => { if (!manipulating.current && !handlePriority.current && !boxPriority.current) props.onSelectFixture(null); }}
    >
      <color attach="background" args={['#080b12']} />
      <ambientLight intensity={props.workLight === false ? 0.15 : 0.8} />
      <directionalLight position={[4, 9, 5]} intensity={1.1} />
      {props.onSelectFixtures && <BoxSelection fixtures={selectableFixtures} onSelect={props.onSelectFixtures} onActive={setBoxPriority} />}
      <StageEnvironment stage={props.stage} workLight={props.workLight !== false} showGrid={props.showGrid !== false} />
      <InstancedFixtureLayer {...props} stage={displayStage} onSelectFixture={id => {
        if (!manipulating.current && !handlePriority.current && !boxPriority.current) props.onSelectFixture(id);
      }} />
      {selected && props.onTransformFixture && props.stage.profiles.some(profile => profile.id === selected.profileId) && (
        <FixtureTransformControls
          key={selected.id}
          fixture={selected}
          mode={props.transformMode ?? 'translate'}
          snapEnabled={props.snapEnabled === true}
          onPriority={setHandlePriority}
          onStart={() => { manipulating.current = true; }}
          onPreview={transform => setPreview({ id: selected.id, transform })}
          onFinish={transform => {
            setPreview(null);
            if (transform) props.onTransformFixture?.(selected.id, transform);
            requestAnimationFrame(() => { manipulating.current = false; });
          }}
        />
      )}
      <CameraController stage={props.stage} bindPreset={(handler) => (presetRef.current = handler)} />
    </Canvas>
  );
});

function FixtureTransformControls({ fixture, mode, snapEnabled, onPriority, onStart, onPreview, onFinish }: {
  fixture: VisualizerFixture;
  mode: 'translate' | 'rotate';
  snapEnabled: boolean;
  onPriority(hit: boolean): void;
  onStart(): void;
  onPreview(transform: FixtureTransform): void;
  onFinish(transform: FixtureTransform | null): void;
}) {
  const target = useRef<Group>(null!);
  const controls = useRef<TransformControlsImpl>(null);
  const { camera, gl, events } = useThree();
  useEffect(() => {
    if (!controls.current) return;
    const element = events.connected instanceof HTMLElement ? events.connected : gl.domElement;
    return bindTransformHandlePriority(element, controls.current, camera, onPriority);
  }, [camera, events.connected, gl, onPriority]);
  const changed = useRef(false);
  const readTransform = (): FixtureTransform | null => {
    const object = target.current;
    if (!object) return null;
    const degrees = 180 / Math.PI;
    return {
      positionM: { x: object.position.x, y: object.position.y, z: object.position.z },
      mountRotationDeg: { x: object.rotation.x * degrees, y: object.rotation.y * degrees, z: object.rotation.z * degrees },
    };
  };
  return (
    <>
    <group ref={target}
      position={[fixture.positionM.x, fixture.positionM.y, fixture.positionM.z]}
      rotation={[fixture.mountRotationDeg.x * Math.PI / 180, fixture.mountRotationDeg.y * Math.PI / 180, fixture.mountRotationDeg.z * Math.PI / 180]}
    />
    <TransformControls
      ref={controls}
      object={target}
      mode={mode}
      space="world"
      size={0.85}
      translationSnap={snapEnabled ? FIXTURE_MOVE_SNAP_M : null}
      rotationSnap={snapEnabled ? FIXTURE_ROTATE_SNAP_DEG * Math.PI / 180 : null}
      onMouseDown={() => { changed.current = false; onStart(); }}
      onObjectChange={() => {
        const transform = readTransform();
        if (transform) { changed.current = true; onPreview(transform); }
      }}
      onMouseUp={() => onFinish(changed.current ? readTransform() : null)}
    />
    </>
  );
}

function StageEnvironment({ stage, workLight, showGrid }: { stage: StageLayout; workLight: boolean; showGrid: boolean }) {
  return (
    <group>
      {stageBoxes(stage).map((box, index) => (
        <mesh key={`${index}-${box.id}`} position={[box.positionM.x, box.positionM.y, box.positionM.z]}>
          <boxGeometry args={[box.sizeM.x, box.sizeM.y, box.sizeM.z]} />
          <meshStandardMaterial color="#475569" roughness={0.9} emissive="#475569" emissiveIntensity={workLight ? 0.55 : 0.03} />
        </mesh>
      ))}
      <gridHelper
        visible={showGrid}
        args={[Math.max(stage.widthM, stage.depthM), Math.ceil(Math.max(stage.widthM, stage.depthM)), '#526078', '#30394a']}
        position={[0, 0.005, stage.depthM / 2]}
      />
    </group>
  );
}

function InstancedFixtureLayer({
  stage,
  outputFrame,
  selectedFixtureId,
  selectedFixtureIds,
  onSelectFixture,
  workLight = true,
  quality = 'low',
}: StageSceneProps) {
  const bodyRef = useRef<InstancedMesh>(null);
  const headRef = useRef<InstancedMesh>(null);
  const lensRef = useRef<InstancedMesh>(null);
  const geometry = useMemo(() => createFixtureGeometry(RENDER_QUALITY[quality].geometryDetail), [quality]);
  useEffect(() => () => {
    geometry.body.dispose();
    geometry.head.dispose();
    geometry.lens.dispose();
  }, [geometry]);
  const beamRef = useRef<InstancedMesh>(null);
  const markerRef = useRef<InstancedMesh>(null);
  const invalidate = useThree((state) => state.invalidate);
  const surfaces = useMemo(() => createStageSurfaces(stage), [stage]);
  const occluders = useMemo(() => createProjectionOccluders(surfaces.length / 6), [surfaces.length]);
  const projectionShader = useMemo(() => createProjectionShader(occluders, quality), [occluders, quality]);
  const beamShader = useMemo(() => createBeamShader(occluders, quality), [occluders, quality]);
  useLayoutEffect(() => {
    for (let i = 0; i < occluders.projectionBoxMin.value.length; i++) {
      occluders.projectionBoxMin.value[i].copy(surfaces[i * 6].min);
      occluders.projectionBoxMax.value[i].copy(surfaces[i * 6].max);
    }
  }, [surfaces, occluders]);
  const profileMap = useMemo(
    () => new Map(stage.profiles.map((profile) => [profile.id, profile])),
    [stage.profiles],
  );
  const fixtures = useMemo(() => renderableFixtures(stage), [stage]);
  const selectedFixtures = useMemo(
    () => fixtures.filter((fixture) => selectedFixtureIds ? selectedFixtureIds.includes(fixture.id) : fixture.id === selectedFixtureId),
    [fixtures, selectedFixtureId, selectedFixtureIds],
  );
  const matrix = useMemo(() => new Matrix4(), []);
  const color = useMemo(() => new Color(), []);
  const hasActiveStrobe = useMemo(
    () =>
      fixtures.some((fixture) => {
        const profile = profileMap.get(fixture.profileId);
        return (
          profile !== undefined &&
          evaluateVisualizerFixture(profile, fixture, outputFrame).parameters.strobe > 0
        );
      }),
    [fixtures, outputFrame, profileMap],
  );

  const handleFixturePointerDown = createFixturePointerDownHandler(fixtures, onSelectFixture);

  const updateInstances = useCallback((timeMs: number) => {
    if (!bodyRef.current || !headRef.current || !lensRef.current || !beamRef.current || !markerRef.current) return;
    let markerCount = 0;
    fixtures.forEach((fixture, index) => {
      const profile = profileMap.get(fixture.profileId);
      if (!profile) return;
      markerCount += updateVisualizerInstances(
        fixture,
        profile,
        outputFrame,
        index,
        stage,
        bodyRef.current!,
        beamRef.current!,
        markerRef.current!,
        matrix,
        color,
        timeMs,
        surfaces,
        { head: headRef.current!, lens: lensRef.current! },
        markerCount,
      );
    });
    bodyRef.current.count = fixtures.length;
    beamRef.current.count = fixtures.length;
    markerRef.current.count = markerCount;
    // InstancedMesh caches its raycast bounds; edits must not leave stale bounds.
    bodyRef.current.computeBoundingSphere();
    for (const mesh of [headRef.current, lensRef.current]) {
      mesh.count = fixtures.length;
      mesh.computeBoundingSphere();
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    bodyRef.current.instanceMatrix.needsUpdate = true;
    beamRef.current.instanceMatrix.needsUpdate = true;
    markerRef.current.instanceMatrix.needsUpdate = true;
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
    if (beamRef.current.instanceColor) beamRef.current.instanceColor.needsUpdate = true;
    if (markerRef.current.instanceColor) markerRef.current.instanceColor.needsUpdate = true;
  }, [color, fixtures, matrix, outputFrame, profileMap, stage, surfaces]);

  useLayoutEffect(() => {
    updateInstances(performance.now());
    invalidate();
  }, [invalidate, updateInstances]);

  useFrame(() => {
    if (!hasActiveStrobe) return;
    updateInstances(performance.now());
    invalidate();
  });

  useEffect(() => {
    for (const mesh of [bodyRef.current, headRef.current, lensRef.current, beamRef.current, markerRef.current]) {
      mesh?.instanceMatrix.setUsage(DynamicDrawUsage);
    }
  }, []);

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        geometry={geometry.body}
        frustumCulled={false}
        args={[undefined, undefined, MAX_FIXTURES]}
        onPointerDown={handleFixturePointerDown}
      >
        <meshStandardMaterial vertexColors emissive="#536174" emissiveIntensity={workLight ? 0.22 : 0.015} roughness={0.48} metalness={0.45} />
      </instancedMesh>
      <instancedMesh ref={headRef} geometry={geometry.head} frustumCulled={false}
        args={[undefined, undefined, MAX_FIXTURES]} onPointerDown={handleFixturePointerDown}>
        <meshStandardMaterial vertexColors emissive="#536174" emissiveIntensity={workLight ? 0.22 : 0.015} roughness={0.4} metalness={0.5} />
      </instancedMesh>
      <instancedMesh ref={lensRef} geometry={geometry.lens} frustumCulled={false}
        args={[undefined, undefined, MAX_FIXTURES]} onPointerDown={handleFixturePointerDown}>
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={beamRef} frustumCulled={false} args={[undefined, undefined, MAX_FIXTURES]}>
        <coneGeometry args={[1, 1, RENDER_QUALITY[quality].beamSegments, 1, true]} />
        <meshBasicMaterial key={`beam-${surfaces.length}-${quality}`} transparent opacity={0.12} depthWrite={false}
          blending={AdditiveBlending} side={DoubleSide} toneMapped={false}
          onBeforeCompile={beamShader} customProgramCacheKey={() => `beam-scattering-${surfaces.length}-${quality}`} />
      </instancedMesh>
      <instancedMesh key={surfaces.length} ref={markerRef} frustumCulled={false} args={[undefined, undefined, MAX_FIXTURES * surfaces.length]}>
        <planeGeometry args={[2, 2]} />
        <meshBasicMaterial key={`projection-${surfaces.length}-${quality}`} transparent opacity={0.65} depthWrite={false} blending={AdditiveBlending} toneMapped={false}
          onBeforeCompile={projectionShader} customProgramCacheKey={() => `surface-projection-${surfaces.length}-${quality}`} />
      </instancedMesh>
      {selectedFixtures.map(fixture => <SelectedFixtureHighlight key={fixture.id} fixture={fixture} onSelectFixture={onSelectFixture} />)}
    </group>
  );
}

function SelectedFixtureHighlight({
  fixture,
  onSelectFixture,
}: {
  fixture: VisualizerFixture;
  onSelectFixture(id: string): void;
}) {
  const toRadians = Math.PI / 180;
  const outline = useMemo(() => {
    const bounds = new BoxGeometry(0.76, 1, 0.76).translate(0, 0.16, 0)
      .scale(FIXTURE_MODEL_SCALE, FIXTURE_MODEL_SCALE, FIXTURE_MODEL_SCALE);
    const edges = new EdgesGeometry(bounds);
    bounds.dispose();
    return edges;
  }, []);
  useEffect(() => () => outline.dispose(), [outline]);

  return (
    <lineSegments geometry={outline}
      position={[fixture.positionM.x, fixture.positionM.y, fixture.positionM.z]}
      rotation={[
        fixture.mountRotationDeg.x * toRadians,
        fixture.mountRotationDeg.y * toRadians,
        fixture.mountRotationDeg.z * toRadians,
      ]}
      renderOrder={10}
      onClick={(event) => {
        event.stopPropagation();
        onSelectFixture(fixture.id);
      }}
    >
      <lineBasicMaterial
        color="#38bdf8"
        transparent
        opacity={0.55}
        depthTest={false}
        depthWrite={false}
      />
    </lineSegments>
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
  const { camera, size, invalidate } = useThree();
  const activePreset = useRef<CameraPreset | null>(null);
  const applyPreset = useCallback((preset: CameraPreset) => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const axisDirections: Record<AxisView, [number, number, number]> = {
      '+X': [-1, 0, 0], '-X': [1, 0, 0],
      '+Y': [0, -1, 0], '-Y': [0, 1, 0],
      '+Z': [0, 0, -1], '-Z': [0, 0, 1],
    };
    const direction = preset in axisDirections ? new ThreeVector3(...axisDirections[preset as AxisView])
      : preset === 'front' ? new ThreeVector3(0, -0.05, 1)
      : preset === 'top' ? new ThreeVector3(0, -1, 0)
      : new ThreeVector3(-1, -0.75, 1);
    const fit = fitCamera(stageBounds(stage), direction, camera.fov, size.width / Math.max(1, size.height));
    camera.position.copy(fit.position);
    camera.up.copy(fit.up);
    setCameraFarPlane(camera, fit.far);
    controls.current?.target.copy(fit.target);
    if (controls.current) controls.current.maxDistance = Math.max(100, fit.distance * 4);
    camera.lookAt(fit.target);
    controls.current?.update();
    invalidate();
  }, [camera, invalidate, size.width, size.height, stage]);

  useEffect(() => {
    const saved = loadCamera();
    if (saved) {
      camera.position.fromArray(saved.position);
      controls.current?.target.fromArray(saved.target);
      if (camera instanceof PerspectiveCamera) {
        setCameraFarPlane(camera, Math.max(200, camera.position.distanceTo(controls.current?.target ?? new ThreeVector3()) * 4));
        if (controls.current) controls.current.maxDistance = camera.far;
      }
      controls.current?.update();
    }
  }, [camera]);

  useEffect(() => {
    bindPreset((preset) => {
      activePreset.current = preset;
      applyPreset(preset);
    });
    return () => bindPreset(() => {});
  }, [applyPreset, bindPreset]);

  useEffect(() => {
    if (activePreset.current) applyPreset(activePreset.current);
  }, [applyPreset]);

  return (
    <>
    <AxisNavigation onSelect={view => {
      activePreset.current = view;
      applyPreset(view);
    }} />
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={1}
      onStart={() => { activePreset.current = null; }}
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
    </>
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
