import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry } from 'three';

// Anchored to the camera (view rotation only, depth at the far plane), so it needs no per-frame
// update and serves the cockpit and both mirrors. Orthographic cameras collapse it: no top-down sky.
const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  if (projectionMatrix[3][3] == 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
  gl_Position.z *= 0.9999;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 horizon;
uniform vec3 zenith;
uniform vec3 ground;
varying vec3 vDirection;
void main() {
  float up = normalize(vDirection).y;
  vec3 sky = mix(horizon, zenith, pow(max(up, 0.0), 0.6));
  gl_FragColor = vec4(mix(ground, sky, smoothstep(-0.003, 0.003, up)), 1.0);
  #include <colorspace_fragment>
}
`;

// Linear-space shift from the horizon colour to the zenith: deeper, bluer.
const ZENITH_SHIFT = new Color(0.45, 0.7, 1);

export type Sky = { readonly mesh: Mesh; dispose(): void };

/** `ground` is the lit colour of the ground below the horizon, so the dome continues the ground plane. */
export function createSky(horizon: Color, ground: Color): Sky {
  const geometry = new SphereGeometry(1, 16, 8);
  const material = new ShaderMaterial({
    uniforms: {
      horizon: { value: horizon.clone() },
      zenith: { value: horizon.clone().multiply(ZENITH_SHIFT) },
      ground: { value: ground.clone() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
