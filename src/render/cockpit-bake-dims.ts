import { COCKPIT_FOV } from './cockpit-camera';
import { dashEdge, headerEdge, pillarSpan } from './cockpit-interior';
import { REALISM_HUES } from './realism-hues';

const round = (value: number): number => Math.round(value * 1e6) / 1e6;
const hex = (rgb: number): string => `#${rgb.toString(16).padStart(6, '0')}`;

/** The widest supported cockpit aspect; narrower views crop the bake instead of stretching it. */
export const BAKE_ASPECT = 2.4;
/** The bake renders this far past the view edge, in NDC, so the bleed is covered. */
const OVERSCAN = 1.2;

function bakePillar(): { centre: number; width: number } {
  const span = pillarSpan(BAKE_ASPECT, COCKPIT_FOV, 1);
  if (span === null) throw new Error('no pillar fits the bake aspect');
  return { centre: round(span.centre), width: round(span.width) };
}

/**
 * Atlas regions ([x, y, width, height] texels, origin top-left) of the baked cockpit interior (`tools/blender/cockpit_interior.py`). Coordinates are
 * in view-height units (NDC y, so 1 is half the view height):
 * - `edge` regions: `x` is NDC x times the view aspect; `y` is the distance from the part's anchor
 *   edge (`dashEdge`, downwards; `headerEdge`, upwards). The first value is the region's first texel row.
 * - `quad` regions: `x` and `y` run 0..1 over the part's quad in `cockpit-interior.ts`. The visor's
 *   `x` runs left to right and `y` bottom to top; the pillar's `x` runs bottom to top and `y` from the
 *   inboard to the outboard edge of the right pillar (the left pillar is its mirror image, so its
 *   normal x flips).
 * The mask atlas (`maskSize`) has the same layout at its own scale.
 */
export const COCKPIT_ATLAS = {
  size: 2048,
  maskSize: 1024,
  regions: {
    dashLeft: {
      kind: 'edge',
      anchor: 'dash',
      rect: [0, 0, 2048, 512],
      x: [-2.64, 0],
      y: [-0.08, 0.62],
    },
    dashRight: {
      kind: 'edge',
      anchor: 'dash',
      rect: [0, 512, 2048, 512],
      x: [0, 2.64],
      y: [-0.08, 0.62],
    },
    headerLeft: {
      kind: 'edge',
      anchor: 'header',
      rect: [0, 1024, 2048, 256],
      x: [-2.64, 0],
      y: [0.35, 0],
    },
    headerRight: {
      kind: 'edge',
      anchor: 'header',
      rect: [0, 1280, 2048, 256],
      x: [0, 2.64],
      y: [0.35, 0],
    },
    visor: { kind: 'quad', part: 'visor', rect: [0, 1536, 1024, 256], x: [0, 1], y: [1, 0] },
    pillar: { kind: 'quad', part: 'pillar', rect: [0, 1792, 2048, 256], x: [0, 1], y: [0, 1] },
  },
} as const;

/**
 * Inputs of the cockpit interior bake: the NDC contracts of `cockpit-interior.ts` at the bake
 * aspect, the part materials (mean albedo near today's flat hues; `contrast` scales the source
 * texture about its mean) and the atlas layout.
 */
export function cockpitBakeParams() {
  return {
    schema: 1,
    fov: COCKPIT_FOV,
    aspect: BAKE_ASPECT,
    overscan: OVERSCAN,
    /** Duplicates of unexported `cockpit-interior.ts` constants, pinned by `tools/blender/kit-build.test.ts`. */
    bleed: 1.05,
    dash: { centre: round(dashEdge(0)), curve: round(dashEdge(1) - dashEdge(0)), lip: 0.035 },
    header: { centre: round(headerEdge(0)), curve: round(headerEdge(1) - headerEdge(0)) },
    visor: { left: -0.5, right: -0.08, bottom: 0.62, lip: 0.025 },
    pillar: { ...bakePillar(), lean: 0.25 },
    atlas: COCKPIT_ATLAS,
    materials: {
      dash: {
        hue: '#2a2c2e',
        roughness: 0.65,
        source: 'plastic',
        normal: 0.6,
        tile: 0.25,
        contrast: 0.3,
      },
      trim: {
        hue: hex(REALISM_HUES.anthracite),
        roughness: 0.5,
        source: 'plastic',
        normal: 0.25,
        tile: 0.4,
        contrast: 0.3,
      },
      headliner: {
        hue: hex(REALISM_HUES.headliner),
        roughness: 0.9,
        source: 'fabric',
        normal: 0.8,
        tile: 0.3,
        contrast: 0.6,
      },
      visor: {
        hue: '#2e3236',
        roughness: 0.55,
        source: 'leather',
        normal: 0.3,
        tile: 0.3,
        contrast: 0.5,
      },
      seal: {
        hue: '#141516',
        roughness: 0.7,
        source: 'rubber',
        normal: 0.5,
        tile: 0.2,
        contrast: 0.5,
      },
      console: {
        hue: '#1b1d1f',
        roughness: 0.5,
        source: 'plastic',
        normal: 0.3,
        tile: 0.25,
        contrast: 0.3,
      },
      grille: {
        hue: '#18191a',
        roughness: 0.7,
        source: 'plastic',
        normal: 0.6,
        tile: 0.25,
        contrast: 0.5,
      },
      display: {
        hue: '#0b0d10',
        roughness: 0.15,
        source: 'plastic',
        normal: 0.05,
        tile: 0.25,
        contrast: 0.2,
      },
    },
    samples: { colour: 16, occlusion: 64, occlusionDistance: 0.25 },
  };
}
