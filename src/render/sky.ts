import { SKY_LAYER } from './seams';
import { BackSide, Color, Mesh, SphereGeometry, type Vector3 } from 'three';
import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  positionLocal,
  pow,
  smoothstep,
  uniform,
  vec4,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

const HAZE_STRENGTH = 0.8;
const HAZE_FALLOFF = 9;
const HALO_BROAD = 0.12;
const HALO_TIGHT = 0.35;
/** Just inside the far plane, so the dome never clips; the ratio works for either depth range. */
const DOME_DEPTH = 0.9999;

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
  const material = new MeshBasicNodeMaterial({
    side: BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  // Anchored to the camera (view rotation only, depth at the far plane), so it needs no per-frame
  // update and serves the cockpit and both mirrors. It is on SKY_LAYER, which the top-down camera skips.
  const clip = cameraProjectionMatrix.mul(
    vec4(cameraViewMatrix.mul(vec4(positionLocal, 0)).xyz, 1),
  );
  material.vertexNode = vec4(clip.xy, clip.w.mul(DOME_DEPTH), clip.w);

  const direction = normalize(positionLocal);
  const up = max(direction.y, 0);
  const zenith = horizon.clone().multiply(ZENITH_SHIFT);
  const gradient = mix(uniform(horizon.clone()), uniform(zenith), pow(up, 0.6));
  const hazed = mix(
    uniform(haze.clone()),
    gradient,
    float(1).sub(exp(up.mul(-HAZE_FALLOFF)).mul(HAZE_STRENGTH)),
  );
  const sun = max(dot(direction, uniform(sunDirection.clone().normalize())), 0);
  const lit = hazed.add(
    uniform(halo.clone()).mul(pow(sun, 6).mul(HALO_BROAD).add(pow(sun, 200).mul(HALO_TIGHT))),
  );
  material.colorNode = mix(uniform(ground.clone()), lit, smoothstep(-0.003, 0.003, direction.y));

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
