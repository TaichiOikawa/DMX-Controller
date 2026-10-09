import { GizmoHelper } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import { CanvasTexture } from 'three';

export type AxisView = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
const AXES = [
  { name: 'X', color: '#f05b70', position: [1, 0, 0] },
  { name: 'Y', color: '#83cc52', position: [0, 1, 0] },
  { name: 'Z', color: '#589cff', position: [0, 0, 1] },
] as const;

/** Screen-space overlay that rotates with the scene camera; clicks never reach fixtures. */
export function AxisNavigation({ onSelect }: { onSelect(view: AxisView): void }) {
  return <GizmoHelper alignment="top-right" margin={[72, 72]}>
    <group scale={36}>
      {AXES.map(axis => <group key={axis.name}>
        <mesh position={axis.position.map(value => value * 0.5) as [number, number, number]}>
          <boxGeometry args={axis.position.map(value => value ? 1 : 0.035) as [number, number, number]} />
          <meshBasicMaterial color={axis.color} toneMapped={false} />
        </mesh>
        {([1, -1] as const).map(sign => <AxisHead key={sign}
          label={`${sign > 0 ? '+' : '-'}${axis.name}`} color={axis.color}
          position={axis.position.map(value => value * sign) as [number, number, number]}
          onSelect={onSelect} />)}
      </group>)}
    </group>
  </GizmoHelper>;
}

function AxisHead({ label, color, position, onSelect }: {
  label: AxisView; color: string; position: [number, number, number]; onSelect(view: AxisView): void;
}) {
  const [hovered, setHovered] = useState(false);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.fillStyle = label[0] === '+' ? color : '#202938';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = label[0] === '+' ? '#111827' : color;
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label[0] === '+' ? label.slice(1) : label, 64, 65);
    return new CanvasTexture(canvas);
  }, [color, label]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={position} scale={hovered ? 0.8 : 0.65} userData={{ axisView: label }}
    onPointerOver={event => { event.stopPropagation(); setHovered(true); }}
    onPointerOut={event => { event.stopPropagation(); setHovered(false); }}
    onPointerDown={event => {
      const opposite: AxisView = `${label[0] === '+' ? '-' : '+'}${label[1]}` as AxisView;
      // When both ends are under the pointer, choose the hidden end. Use actual
      // hit intersections so this also works after freely orbiting the camera.
      const overlapping = event.intersections.some(hit => hit.object.userData.axisView === opposite);
      event.stopPropagation();
      onSelect(overlapping ? opposite : label);
    }}
    onClick={event => event.stopPropagation()}>
    <spriteMaterial map={texture} transparent alphaTest={0.1} toneMapped={false} />
  </sprite>;
}
