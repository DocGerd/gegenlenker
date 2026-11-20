import type { KitPiece } from '../contracts/layout';
import type { Obb } from '../contracts/sim';

/**
 * Where each yard-kit piece stands in its own frame: +X along the piece, +Y out of its face, origin at
 * ground level on the face line (metres). `tools/blender/kit-build.test.ts` pins the table to the
 * `bounds` of the glb's nodes; content cannot read the glb itself.
 */
export type KitBounds = {
  readonly min: readonly [number, number];
  readonly max: readonly [number, number];
  readonly height: number;
};

export const KIT_FOOTPRINTS: Readonly<Record<KitPiece, KitBounds>> = {
  bench: { min: [-0.9, -0.28], max: [0.9, 0.26], height: 0.85 },
  'bike-rack': { min: [-1.024, -0.424], max: [1.024, 0.424], height: 0.871 },
  'bin-1100': { min: [-0.705, -0.555], max: [0.705, 0.555], height: 1.47 },
  'bin-240': { min: [-0.31, -0.465], max: [0.31, 0.385], height: 1.07 },
  'fence-gate': { min: [-0.06, -0.06], max: [4.06, 0.06], height: 2.1 },
  'fence-panel': { min: [-0.03, -0.03], max: [2.47, 0.03], height: 2.05 },
  flagpole: { min: [-0.2, -0.2], max: [0.2, 0.2], height: 8.08 },
  'grass-tuft': { min: [-0.25, -0.217], max: [0.25, 0.217], height: 0.45 },
  'hall-corner': { min: [-0.1, -0.1], max: [0.35, 0.327], height: 7 },
  'hall-door-bay': { min: [-2.5, -0.25], max: [2.5, 0.23], height: 7 },
  'hall-roof': { min: [-2.5, -1], max: [2.5, 0], height: 7.05 },
  'hall-wall-bay': { min: [-2.5, -0.25], max: [2.5, 0.23], height: 7 },
  hedge: { min: [-1.15, -0.4], max: [1.15, 0.4], height: 1.45 },
  hydrant: { min: [-0.23, -0.16], max: [0.23, 0.16], height: 0.85 },
  'lime-a': { min: [-3.772, -4.009], max: [4.351, 4.424], height: 12.674 },
  'lime-b': { min: [-3.574, -3.814], max: [3.507, 2.833], height: 10.712 },
  'maple-a': { min: [-5.076, -5.057], max: [4.671, 4.727], height: 12.679 },
  'maple-b': { min: [-4.386, -4.078], max: [4.417, 3.824], height: 10.299 },
  'office-bay': { min: [-1.5, -0.33], max: [1.5, 0.05], height: 7.56 },
  'office-entrance': { min: [-1.7, -0.33], max: [1.7, 1.6], height: 7.56 },
  'office-roof': { min: [-1.5, -1], max: [1.5, 0], height: 6.7 },
  'salt-bin': { min: [-0.62, -0.42], max: [0.62, 0.42], height: 0.8 },
  'sign-post': { min: [-0.3, -0.03], max: [0.3, 0.057], height: 2.6 },
  'wash-canopy': { min: [-4.2, -6.2], max: [4.2, 0.2], height: 6.05 },
};

/** The roofs are one metre deep in the glb; a placement scales them along Y to the building's depth. */
const STRETCHED: ReadonlySet<KitPiece> = new Set(['hall-roof', 'office-roof']);

/**
 * The world box of `piece` standing at `(x, y)` with its +X along `heading`; its +Y (out of the face)
 * is `heading` + 90 degrees. `depth` (metres, stretched roofs only) replaces the one metre of the glb.
 */
export function kitFootprint(
  piece: KitPiece,
  x: number,
  y: number,
  heading: number,
  depth?: number,
): Obb {
  const { min, max } = KIT_FOOTPRINTS[piece];
  const scale = depth !== undefined && STRETCHED.has(piece) ? depth : 1;
  const [x0, y0] = [min[0], min[1] * scale];
  const [x1, y1] = [max[0], max[1] * scale];
  const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const [c, s] = [Math.cos(heading), Math.sin(heading)];
  return {
    cx: x + c * mx - s * my,
    cy: y + s * mx + c * my,
    halfLength: (x1 - x0) / 2,
    halfWidth: (y1 - y0) / 2,
    heading,
  };
}
