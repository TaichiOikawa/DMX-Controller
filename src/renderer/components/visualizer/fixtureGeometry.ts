import { BoxGeometry, BufferAttribute, Color, CylinderGeometry, TorusGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared low-poly geometry: one instance per fixture, not one draw call per part.
function mergeParts(parts: [BufferGeometry, string][]) {
  for (const [geometry, hex] of parts) {
    const color = new Color(hex);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
  }
  const merged = mergeGeometries(parts.map(([geometry]) => geometry))!;
  for (const [geometry] of parts) geometry.dispose();
  return merged;
}

export function createFixtureGeometry() {
  const body = mergeParts([
    [new CylinderGeometry(0.23, 0.27, 0.15, 8).translate(0, 0.55, 0), '#303845'],
    [new BoxGeometry(0.62, 0.08, 0.16).translate(0, 0.42, 0), '#465363'],
    ...[-1, 1].flatMap((side): [BufferGeometry, string][] => [
      [new BoxGeometry(0.065, 0.42, 0.16).translate(side * 0.28, 0.19, 0), '#465363'],
      [new CylinderGeometry(0.075, 0.075, 0.075, 12).rotateZ(Math.PI / 2).translate(side * 0.285, 0, 0), '#8b99aa'],
    ]),
    [new BoxGeometry(0.15, 0.045, 0.01).translate(0, 0.55, 0.238), '#163c48'],
  ]);
  const head = mergeParts([
    [new CylinderGeometry(0.15, 0.22, 0.38, 20).translate(0, 0.025, 0), '#303845'],
    [new CylinderGeometry(0.225, 0.225, 0.07, 24).translate(0, -0.19, 0), '#18212d'],
    [new TorusGeometry(0.198, 0.018, 6, 24).rotateX(Math.PI / 2).translate(0, -0.228, 0), '#96a4b5'],
    ...[0.09, 0.13, 0.17].map((y): [BufferGeometry, string] => [
      new TorusGeometry(0.174 - (y - 0.09) * 0.18, 0.012, 4, 20).rotateX(Math.PI / 2).translate(0, y, 0), '#637184',
    ]),
  ]);
  // Cylinder axis and the optical axis both point down (-Y).
  const lens = new CylinderGeometry(0.177, 0.177, 0.012, 24).translate(0, -0.229, 0);
  return { body, head, lens };
}
