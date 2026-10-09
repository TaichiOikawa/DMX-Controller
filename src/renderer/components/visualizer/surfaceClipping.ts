import { InstancedBufferAttribute, Vector3, type InstancedMesh, type MeshBasicMaterial } from 'three';
import type { StageSurface } from './stageGeometry';
import type { RenderQuality } from './renderQuality';
import { FIXTURE_EMITTER_RADIUS_M } from './fixtureDimensions';

export function setSurfaceBounds(mesh: InstancedMesh, index: number, surface?: StageSurface) {
  for (const key of ['min', 'max'] as const) {
    const name = key === 'min' ? 'surfaceMin' : 'surfaceMax';
    let attribute = mesh.geometry.getAttribute(name) as InstancedBufferAttribute | undefined;
    if (!attribute) {
      attribute = new InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3), 3);
      mesh.geometry.setAttribute(name, attribute);
    }
    const value = surface?.[key];
    attribute.setXYZ(index, value?.x ?? 0, value?.y ?? 0, value?.z ?? 0);
    attribute.needsUpdate = true;
  }
}

export function setProjectionCone(mesh: InstancedMesh, index: number, origin: Vector3, direction: Vector3, cosine: number) {
  for (const [name, value] of [['coneOrigin', origin], ['coneDirection', direction]] as const) {
    let attribute = mesh.geometry.getAttribute(name) as InstancedBufferAttribute | undefined;
    if (!attribute) {
      attribute = new InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 4), 4);
      mesh.geometry.setAttribute(name, attribute);
    }
    attribute.setXYZW(index, value.x, value.y, value.z, cosine);
    attribute.needsUpdate = true;
  }
}

export function createProjectionOccluders(count: number) {
  return {
    projectionBoxMin: { value: Array.from({ length: count }, () => new Vector3()) },
    projectionBoxMax: { value: Array.from({ length: count }, () => new Vector3()) },
  };
}

export function projectionOcclusionGLSL(count: number) {
  return `
    uniform vec3 projectionBoxMin[${count}];
    uniform vec3 projectionBoxMax[${count}];
    bool blocksProjection(vec3 origin, vec3 ray, float distanceToSurface, vec3 boxMin, vec3 boxMax) {
      float entry = 0.0;
      float exitDistance = distanceToSurface - 0.025;
      for (int axis = 0; axis < 3; axis++) {
        if (abs(ray[axis]) < 0.000001) {
          if (origin[axis] < boxMin[axis] || origin[axis] > boxMax[axis]) return false;
        } else {
          float a = (boxMin[axis] - origin[axis]) / ray[axis];
          float b = (boxMax[axis] - origin[axis]) / ray[axis];
          entry = max(entry, min(a, b));
          exitDistance = min(exitDistance, max(a, b));
        }
      }
      return exitDistance > max(entry, 0.00001);
    }
  `;
}

/** Cone clipping works for ellipses and grazing rays; ray/box tests preserve shadows. */
export function createProjectionShader(occluders: ReturnType<typeof createProjectionOccluders>, quality: RenderQuality = 'low'): MeshBasicMaterial['onBeforeCompile'] {
  return (shader, renderer) => {
    clipToSurface(shader, renderer);
    Object.assign(shader.uniforms, occluders);
    const count = occluders.projectionBoxMin.value.length;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 coneOrigin;
      attribute vec4 coneDirection;
      varying vec4 vConeOrigin;
      varying vec4 vConeDirection;
      varying vec3 vReceiverNormal;
    `).replace('#include <project_vertex>', `#include <project_vertex>
      vConeOrigin = coneOrigin;
      vConeDirection = coneDirection;
      vReceiverNormal = normalize(mat3(modelMatrix * instanceMatrix) * vec3(0.0, 0.0, 1.0));
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec4 vConeOrigin;
      varying vec4 vConeDirection;
      varying vec3 vReceiverNormal;
      ${projectionOcclusionGLSL(count)}
    `).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      vec3 fromLight = vSurfaceWorld - vConeOrigin.xyz;
      float lightDistance = length(fromLight);
      if (lightDistance < 0.00001 || lightDistance > 30.0) discard;
      vec3 lightRay = fromLight / lightDistance;
      if (dot(lightRay, vConeDirection.xyz) < vConeDirection.w) discard;
      ${quality === 'low' ? `for (int box = 0; box < ${count}; box++) {
        if (blocksProjection(vConeOrigin.xyz, lightRay, lightDistance, projectionBoxMin[box], projectionBoxMax[box])) discard;
      }` : `
      // A finite emitter produces a penumbra that grows away from an obstacle.
      vec3 axis = normalize(vConeDirection.xyz);
      vec3 tangent = normalize(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
      vec3 bitangent = cross(axis, tangent);
      float visibility = 0.0;
      const int samples = ${quality === 'high' ? 9 : 5};
      for (int sampleIndex = 0; sampleIndex < samples; sampleIndex++) {
        float angle = float(sampleIndex) * 2.39996323;
        float radius = ${FIXTURE_EMITTER_RADIUS_M} * sqrt(float(sampleIndex) / float(samples - 1));
        vec3 origin = vConeOrigin.xyz + radius * (cos(angle) * tangent + sin(angle) * bitangent);
        vec3 sampleVector = vSurfaceWorld - origin;
        float sampleDistance = length(sampleVector);
        vec3 sampleRay = sampleVector / max(sampleDistance, 0.00001);
        float unblocked = 1.0;
        for (int box = 0; box < ${count}; box++) {
          if (blocksProjection(origin, sampleRay, sampleDistance, projectionBoxMin[box], projectionBoxMax[box])) { unblocked = 0.0; break; }
        }
        visibility += unblocked / float(samples);
      }
      // Angular falloff follows the optical axis, including oblique wall hits.
      float radialSquared = clamp((1.0 - dot(lightRay, axis)) / max(1.0 - vConeDirection.w, 0.000001), 0.0, 1.0);
      float feather = 1.0 - smoothstep(${quality === 'high' ? '0.35' : '0.55'}, 1.0, radialSquared);
      float core = exp(-radialSquared * ${quality === 'high' ? '3.5' : '2.0'});
      float distribution = ${quality === 'high' ? '(0.8 * core + 0.2 * exp(-radialSquared * 0.8))' : 'core'} * feather;
      float incidence = max(dot(normalize(vReceiverNormal), -lightRay), 0.0);
      float attenuation = 1.0 / (1.0 + 0.035 * lightDistance * lightDistance);
      diffuseColor.a *= visibility * distribution * incidence * attenuation;
      `}
    `);
  };
}

/** Bound each projected ellipse to its receiver; shared material preserves batching. */
export const clipToSurface: MeshBasicMaterial['onBeforeCompile'] = shader => {
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
    attribute vec3 surfaceMin;
    attribute vec3 surfaceMax;
    varying vec3 vSurfaceMin;
    varying vec3 vSurfaceMax;
    varying vec3 vSurfaceWorld;
  `).replace('#include <project_vertex>', `#include <project_vertex>
    vSurfaceMin = surfaceMin;
    vSurfaceMax = surfaceMax;
    vSurfaceWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
    varying vec3 vSurfaceMin;
    varying vec3 vSurfaceMax;
    varying vec3 vSurfaceWorld;
  `).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
    if (any(lessThan(vSurfaceWorld, vSurfaceMin - vec3(0.015))) ||
        any(greaterThan(vSurfaceWorld, vSurfaceMax + vec3(0.015)))) discard;
  `);
};
