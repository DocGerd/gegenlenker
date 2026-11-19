import { Color, Vector3 } from 'three';
import {
  cameraPosition,
  dot,
  exp,
  float,
  max,
  mix,
  normalize,
  output,
  positionWorld,
  select,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';

/*
 * The perspective grade: aerial perspective, then tone mapping, inside each
 * perspective-only lit material. The renderer stays at NoToneMapping, which would also grade the
 * top-down view and the unlit cockpit. The uniforms are shared, so night (N2) switches them once.
 */

/** Extinction (1/m) of the aerial-perspective fog: a few per cent across the yard, a fifth at the far plane. */
export const FOG_DENSITY = 0.0006;
/** Height (m) over which the fog thins by e. */
const FOG_HEIGHT = 60;

export const GRADE = {
  exposure: uniform(1),
  /** 0 switches the fog off without a shader change. */
  fogDensity: uniform(0),
  hazeToward: uniform(new Color()),
  hazeAway: uniform(new Color()),
  /** Share of the HDRI in a sky dome that has one; night fades it out. */
  skyHdri: uniform(1),
  /** Unit vector towards the perspective sun: the haze is warmer on that side. */
  sunDirection: uniform(new Vector3(0, 1, 0)),
};

/** Share of the fog colour at this fragment. */
export function fogFactor(): Node<'float'> {
  const offset = positionWorld.sub(cameraPosition);
  const thin = exp(max(positionWorld.y, 0).div(-FOG_HEIGHT));
  return float(1)
    .sub(exp(offset.length().mul(GRADE.fogDensity).negate()))
    .mul(thin);
}

/** The haze colour seen along this fragment's view ray. */
export function hazeColour(): Node<'vec3'> {
  const view = normalize(positionWorld.sub(cameraPosition));
  const toward = dot(view, GRADE.sunDirection).mul(0.5).add(0.5);
  return mix(GRADE.hazeAway, GRADE.hazeToward, toward);
}

/** Khronos PBR Neutral: highlights roll off from here, darker colours pass unchanged. */
const COMPRESSION_START = 0.76;
const DESATURATION = 0.15;

/**
 * Khronos PBR Neutral without its toe: the toe offsets the F0 = 0.04 of a full PBR material, but
 * these are Lambert, and it would crush the dark tones next to the ungraded layer-0 tokens.
 */
export function toneMap(color: Node<'vec3'>): Node<'vec3'> {
  const c = color.mul(GRADE.exposure);
  const peak = max(c.r, max(c.g, c.b));
  const over = max(peak, COMPRESSION_START);
  const d = 1 - COMPRESSION_START;
  const newPeak = float(1).sub(float(d * d).div(over.add(d - COMPRESSION_START)));
  const fade = float(1).sub(float(1).div(over.sub(newPeak).mul(DESATURATION).add(1)));
  const compressed = mix(c.mul(newPeak.div(over)), vec3(newPeak), fade);
  return select(peak.lessThan(COMPRESSION_START), c, compressed);
}

/** Fog, then tone mapping, of a linear scene colour. */
export const graded = (color: Node<'vec3'>): Node<'vec3'> =>
  toneMap(mix(color, hazeColour(), fogFactor()));

const gradedMaterials = new WeakMap<NodeMaterial, boolean>();

/**
 * Puts the grade on `material`'s output, or takes it off; `base` is the material's own output
 * stage, kept underneath. Recompiles, so call it on a quality change only.
 */
export function setGraded(
  material: NodeMaterial,
  on: boolean,
  base: Node<'vec4'> | null = null,
): void {
  if (gradedMaterials.get(material) === on) return;
  gradedMaterials.set(material, on);
  const source = base ?? output;
  material.outputNode = on ? vec4(graded(source.rgb), source.a) : base;
  material.needsUpdate = true;
}
