import { SKY_LAYER } from './seams';
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, type Vector3 } from 'three';

// Anchored to the camera (view rotation only, depth at the far plane), so it needs no per-frame
// update and serves the cockpit and both mirrors. It is on SKY_LAYER, which the top-down camera skips.
const DOME_PROJECTION = /* glsl */ `
  vec4 clip = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = clip.xyww;
  gl_Position.z *= 0.9999;
`;

const VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  ${DOME_PROJECTION}
}
`;

const FRAGMENT = /* glsl */ `
#define HAZE_STRENGTH 0.8
#define HAZE_FALLOFF 9.0
#define HALO_BROAD 0.12
#define HALO_TIGHT 0.35
uniform vec3 horizon;
uniform vec3 zenith;
uniform vec3 ground;
uniform vec3 haze;
uniform vec3 halo;
uniform vec3 sunDirection;
varying vec3 vDirection;
void main() {
  vec3 direction = normalize(vDirection);
  float up = direction.y;
  vec3 sky = mix(horizon, zenith, pow(max(up, 0.0), 0.6));
  sky = mix(haze, sky, 1.0 - HAZE_STRENGTH * exp(-max(up, 0.0) * HAZE_FALLOFF));
  float sun = max(dot(direction, sunDirection), 0.0);
  sky += halo * (HALO_BROAD * pow(sun, 6.0) + HALO_TIGHT * pow(sun, 200.0));
  gl_FragColor = vec4(mix(ground, sky, smoothstep(-0.003, 0.003, up)), 1.0);
  #include <colorspace_fragment>
}
`;

// Linear-space shift from the horizon colour to the zenith: deeper, bluer.
const ZENITH_SHIFT = new Color(0.45, 0.7, 1);

/** Grey of the sky's luminance: the ambient light stays neutral under the blue sky. */
export function neutralSky(sky: number): Color {
  const c = new Color(sky);
  return new Color().setScalar(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
}

export type Sky = { readonly mesh: Mesh; dispose(): void };

/**
 * `ground` is the lit colour of the ground below the horizon, so the dome continues the ground plane.
 * `haze` lightens the horizon; `halo` is added around `sunDirection`.
 */
export function createSky(
  horizon: Color,
  ground: Color,
  haze: Color,
  halo: Color,
  sunDirection: Vector3,
): Sky {
  const geometry = new SphereGeometry(1, 16, 8);
  const material = new ShaderMaterial({
    uniforms: {
      horizon: { value: horizon.clone() },
      zenith: { value: horizon.clone().multiply(ZENITH_SHIFT) },
      ground: { value: ground.clone() },
      haze: { value: haze.clone() },
      halo: { value: halo.clone() },
      sunDirection: { value: sunDirection.clone().normalize() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1; // after the opaque scene, so occluded fragments fail the depth test
  mesh.layers.set(SKY_LAYER);
  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
