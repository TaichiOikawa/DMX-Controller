import type { MeshBasicMaterial } from 'three';
import { type createProjectionOccluders, projectionOcclusionGLSL } from './surfaceClipping';

/** Clip each beam fragment along its own light ray, rather than a centre-ray cap. */
export function createBeamShader(occluders: ReturnType<typeof createProjectionOccluders>): MeshBasicMaterial['onBeforeCompile'] {
  return shader => {
    Object.assign(shader.uniforms, occluders);
    const count = occluders.projectionBoxMin.value.length;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying vec3 vBeamWorld;
      varying vec3 vBeamOrigin;
      varying vec3 vBeamAxis;
    `).replace('#include <project_vertex>', `#include <project_vertex>
      mat4 beamTransform = modelMatrix * instanceMatrix;
      vBeamWorld = (beamTransform * vec4(transformed, 1.0)).xyz;
      vBeamOrigin = (beamTransform * vec4(0.0, 0.5, 0.0, 1.0)).xyz;
      vBeamAxis = normalize((beamTransform * vec4(0.0, -1.0, 0.0, 0.0)).xyz);
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vBeamWorld;
      varying vec3 vBeamOrigin;
      varying vec3 vBeamAxis;
      ${projectionOcclusionGLSL(count)}
    `).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      vec3 fromLight = vBeamWorld - vBeamOrigin;
      float beamDistance = length(fromLight);
      if (beamDistance < 0.24 || beamDistance > 30.0) discard;
      vec3 lightRay = fromLight / beamDistance;
      for (int box = 0; box < ${count}; box++) {
        if (blocksProjection(vBeamOrigin, lightRay, beamDistance, projectionBoxMin[box], projectionBoxMax[box])) discard;
      }
    `).replace('#include <opaque_fragment>', `
      // A smooth silhouette and distance falloff avoid the flat translucent-sheet look.
      vec3 radial = normalize(lightRay - vBeamAxis * dot(lightRay, vBeamAxis));
      vec3 viewRay = normalize(cameraPosition - vBeamWorld);
      float edgeFade = pow(abs(dot(radial, viewRay)), 0.7);
      float distanceFade = exp(-beamDistance * 0.055) * (1.0 - smoothstep(24.0, 30.0, beamDistance));
      diffuseColor.a *= edgeFade * distanceFade * smoothstep(0.24, 0.4, beamDistance);
      #include <opaque_fragment>
    `);
  };
}
