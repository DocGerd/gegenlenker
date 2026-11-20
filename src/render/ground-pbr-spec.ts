/*
 * How the renderer maps the authored PBR ground textures (tools/textures/pbr-build.ts) onto the
 * scene. Not part of the texture build: retuning it must not force a re-encode (the pixel inputs are
 * ground-pbr-pixels.ts).
 */
import type { PbrRole, PbrSurface } from './ground-pbr-pixels';

/** World-space edge (m) one tile of each photoscan covers: the scan's own size. */
export const PBR_TILE: Readonly<Record<PbrSurface, number>> = {
  concrete: 2.5,
  asphalt: 3,
  pavers: 2,
};

/** Saw-cut slab pitch (m) of the yard; in phase with the slab lines baked into ground.ktx2. */
export const SLAB_PITCH = 4;
/** Half width (m) of a joint. */
export const JOINT_HALF_WIDTH = 0.01;
/** Share of albedo and of ambient occlusion a joint removes. */
export const JOINT_DARKEN = 0.55;
export const JOINT_OCCLUDE = 0.8;
/** Roughness of the verge, which wears no photoscan. */
export const VERGE_ROUGHNESS = 0.95;

/**
 * Mip bias the ground.ktx2 channels are read at, on top of the level the pixel footprint picks:
 * the procedural paver grid, slab joints, grain and pores average out and only slab tone and
 * mottling remain, as macro variation over the scan's repeat. A bias, not a pinned level, so a
 * grazing view minifies further instead of point-sampling a band.
 */
export const MACRO_BIAS = 6;

/** Most samplers the PBR ground material may declare: the macro map, six scans and three's DFG look-up table. */
export const PBR_SAMPLER_BUDGET = 8;

/**
 * Directions in the three frame of the texture axes. u runs along +x and v down the image along +z,
 * so the green of an OpenGL normal map, which points up the image, is -z; the surface normal is +y.
 * Right-handed, so no normal map is mirrored.
 */
export const GROUND_FRAME = {
  right: [1, 0, 0],
  up: [0, 0, -1],
  normal: [0, 1, 0],
} as const;

/** A 2x2 matrix (a b / c d) as [a, b, c, d]. */
export type Mat2 = readonly [number, number, number, number];

/** The eight rotations and mirrored rotations of a square: the UV transform a slab may wear. */
export const SLAB_UV_TRANSFORMS: readonly Mat2[] = [false, true].flatMap((mirror) =>
  [0, 1, 2, 3].map((quarter): Mat2 => {
    const cos = [1, 0, -1, 0][quarter] ?? 1;
    const sin = [0, 1, 0, -1][quarter] ?? 0;
    // rotation of (u, v) by `quarter` quarter turns, after mirroring u
    const flip = mirror ? -1 : 1;
    return [cos * flip + 0, -sin + 0, sin * flip + 0, cos + 0];
  }),
);

/**
 * The matrix a slab's tangent-space normal XY is multiplied by when its texture coordinates are
 * `uv`-transformed. The texture frame is (right, up) and the UV frame (right, down), so the
 * transpose of the orthogonal UV matrix is conjugated with the vertical flip.
 */
export function slabNormalMatrix([a, b, c, d]: Mat2): Mat2 {
  return [a + 0, -c + 0, -b + 0, d + 0];
}

/** Role-wise texture keys of the PBR set. */
export type PbrKey = `${PbrSurface}${Capitalize<PbrRole>}`;
