/*
 * What the ground texture's pixels depend on besides the generator in tools/textures; this file is
 * hashed into the build manifest, so keep render-only values in ground-texture-spec.ts.
 */

export const GROUND_TEXTURE_SIZE = 1024;

/** Mean linear value of every channel; the shader multiplies by its inverse, so a surface keeps its token brightness. */
export const GROUND_TEXTURE_MEAN = 0.7;

/** Texture channel of each authored material. */
export const GROUND_CHANNELS = { concrete: 0, asphalt: 1, pavers: 2 } as const;

export type GroundMaterial = keyof typeof GROUND_CHANNELS;
