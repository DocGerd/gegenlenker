/*
 * How the renderer maps the authored ground texture (tools/textures) onto the scene. Not part of the
 * texture build: retuning it must not force a re-encode (the pixel inputs are ground-texture-pixels.ts).
 */
import { GROUND_CHANNELS } from './ground-texture-pixels';

/** Texture channel, world-space tile edge in metres, and the palette surface it textures. */
export const GROUND_SURFACES = {
  concrete: { channel: GROUND_CHANNELS.concrete, tile: 8, surface: 'yard' },
  asphalt: { channel: GROUND_CHANNELS.asphalt, tile: 4, surface: 'street' },
  pavers: { channel: GROUND_CHANNELS.pavers, tile: 3.2, surface: 'pavement' },
} as const;

/** Marks the injected fragment code, so a compile failure can be traced to the ground material. */
export const GROUND_SHADER_MARKER = 'groundDetail';
