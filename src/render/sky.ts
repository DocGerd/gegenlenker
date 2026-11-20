import { HDRI_LIGHT } from './hdri-light';
import { GRADE, toneMap } from './grade';
import { PERSPECTIVE_LAYER } from './seams';
import { BackSide, Color, Mesh, SphereGeometry, type Texture, Vector3 } from 'three';
import {
  asin,
  atan,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  dot,
  exp,
  float,
  fract,
  max,
  mix,
  normalize,
  positionLocal,
  pow,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';

const HAZE_STRENGTH = 0.8;
const HAZE_FALLOFF = 9;
const HALO_BROAD = 0.12;
const HALO_TIGHT = 0.35;
/** Just inside the far plane, so the dome never clips; the ratio works for either depth range. */
const DOME_DEPTH = 0.9999;

// Linear-space shift from the horizon colour to the zenith: deeper, bluer.
const ZENITH_SHIFT = new Color(0.45, 0.7, 1);
/** Elevation (rad) over which the HDRI fades into the haze, hiding its horizon. */
const HDRI_HORIZON_BLEND = (4 * Math.PI) / 180;
/** The sky texture stores x / (1 + x); this caps the inverse below the 8-bit top. */
const MAX_COMPRESSED = 0.95;
const HDRI_SUN_SHARPNESS = 2000;
const HDRI_SUN_GAIN = 4;
/** Named in the generated shader, so a shader error can be traced to the HDRI sky. */
export const SKY_SHADER_MARKER = 'skyHdri';

/** Linear radiance of the sky texture along `direction` (upper hemisphere), in scene units. */
export function hdriRadiance(map: Texture, direction: Node<'vec3'>, scale: Color): Node<'vec3'> {
  const elevation = asin(clamp(direction.y, 0, 1));
  const turn = atan(direction.z, direction.x)
    .sub(HDRI_LIGHT.azimuth)
    .div(2 * Math.PI)
    .add(HDRI_LIGHT.sun.u);
  const v = float(1).sub(elevation.div(Math.PI / 2));
  const compressed = texture(map, vec2(fract(turn), v)).rgb.min(MAX_COMPRESSED);
  return compressed
    .div(float(1).sub(compressed))
    .mul(vec3(scale.r, scale.g, scale.b))
    .toVar(SKY_SHADER_MARKER);
}

/** Grey of the sky's luminance: the ambient light stays neutral under the blue sky. */
export function neutralSky(sky: number): Color {
  const c = new Color(sky);
  return new Color().setScalar(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
}

export type Sky = {
  readonly mesh: Mesh;
  /** Draws `map` (the HDRI sky texture) above the horizon, or the analytic gradient for null. */
  setHdri(map: Texture | null): void;
  /** Moves the analytic sun halo. */
  setSun(direction: Vector3): void;
  /** The colour below the horizon. */
  setGround(colour: Color): void;
  dispose(): void;
};

/** How the HDRI part is drawn (`perspectiveLight`). */
export type SkyHdri = {
  /** Scene radiance per HDRI unit. */
  readonly scale: Color;
  /** The HDRI's horizon, which its lowest degrees fade into. */
  readonly hazeToward: Color;
  readonly hazeAway: Color;
  /** Unit vector towards the HDRI's sun. */
  readonly sun: Vector3;
  /** Tone-map the HDRI part; off for a capture whose result is tone-mapped by the material reading it. */
  readonly tone: boolean;
};

const PLACEHOLDER_HDRI: SkyHdri = {
  scale: new Color(1, 1, 1),
  hazeToward: new Color(),
  hazeAway: new Color(),
  sun: new Vector3(0, 1, 0),
  tone: true,
};

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
  hdri: SkyHdri = PLACEHOLDER_HDRI,
): Sky {
  const geometry = new SphereGeometry(1, 16, 8);
  const material = new MeshBasicNodeMaterial({
    side: BackSide,
    depthWrite: false,
    toneMapped: false,
  });
  // Anchored to the camera (view rotation only, depth at the far plane), so it needs no per-frame
  // update and serves the cockpit and both mirrors. It is on PERSPECTIVE_LAYER, which the top-down camera skips.
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
  const sunUniform = uniform(sunDirection.clone().normalize());
  const sun = max(dot(direction, sunUniform), 0);
  const haloColour = uniform(halo.clone());
  const lit = hazed.add(
    haloColour.mul(pow(sun, 6).mul(HALO_BROAD).add(pow(sun, 200).mul(HALO_TIGHT))),
  );
  const groundColour = uniform(ground.clone());
  const aboveHorizon = smoothstep(-0.003, 0.003, direction.y);
  const analytic = mix(groundColour, lit, aboveHorizon);
  material.colorNode = analytic;

  const hdriColour = (map: Texture): Node<'vec3'> => {
    const radiance = hdriRadiance(map, direction, hdri.scale);
    const hdriSun = vec3(hdri.sun.x, hdri.sun.y, hdri.sun.z);
    const toward = dot(normalize(vec3(direction.x, 0, direction.z)), hdriSun)
      .mul(0.5)
      .add(0.5);
    const haze = mix(uniform(hdri.hazeAway.clone()), uniform(hdri.hazeToward.clone()), toward);
    const elevation = asin(clamp(direction.y, 0, 1));
    const disk = haloColour.mul(
      pow(max(dot(direction, hdriSun), 0), HDRI_SUN_SHARPNESS).mul(HDRI_SUN_GAIN),
    );
    const sky = mix(haze, radiance, smoothstep(0, HDRI_HORIZON_BLEND, elevation)).add(disk);
    const above = mix(groundColour, hdri.tone ? toneMap(sky) : sky, aboveHorizon);
    return mix(analytic, above, GRADE.skyHdri);
  };
  let shown: Texture | null = null;

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1; // after the opaque scene, so occluded fragments fail the depth test
  mesh.layers.set(PERSPECTIVE_LAYER);
  return {
    mesh,
    setHdri(map) {
      if (map === shown) return;
      shown = map;
      material.colorNode = map === null ? analytic : hdriColour(map);
      material.needsUpdate = true;
    },
    setSun(direction) {
      sunUniform.value.copy(direction).normalize();
    },
    setGround(colour) {
      groundColour.value.copy(colour);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
