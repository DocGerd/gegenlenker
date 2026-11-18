/*
 * Contract between tools/textures (which authors the ground texture) and the renderer (which reads it).
 * One linear RGB tile; each channel is a different surface, picked per vertex in the ground shader.
 */

export const GROUND_TEXTURE_SIZE = 1024;

/** Mean linear value of every channel; the shader multiplies by its inverse, so a surface keeps its token brightness. */
export const GROUND_TEXTURE_MEAN = 0.7;

/** Texture channel, world-space tile edge in metres, and the palette surface it textures. */
export const GROUND_SURFACES = {
  concrete: { channel: 0, tile: 8, surface: 'yard' },
  asphalt: { channel: 1, tile: 4, surface: 'street' },
  pavers: { channel: 2, tile: 3.2, surface: 'pavement' },
} as const;

export type GroundMaterial = keyof typeof GROUND_SURFACES;
