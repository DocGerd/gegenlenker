import type { Decor, DecorAsset, KitPiece, Rect2 } from '../contracts/layout';
import { KIT_FOOTPRINTS, kitFootprint } from './kit';
import { STREET } from './street';

/** Neighbouring plot behind the yard's north edge: unreachable, so its goods need no collision. */
const GAP = 3;
const SWAP_X = [14, 26, 38];
const SKIP_X = [52, 56.5];
const PALLETS_X = 68.1;
const MESH_BOXES_X = 84.8;

// Footprint half sizes, centred on the drawn goods.
const SWAP = { halfLength: 3.725, halfWidth: 1.275, row: 3 };
const SKIP = { halfLength: 1.7, halfWidth: 0.85, row: 2.5, rowPitch: 4, tilt: 0.06 };
const PALLETS = { halfLength: 2.7, halfWidth: 1.5, row: 4 };
const MESH_BOXES = { halfLength: 3.42, halfWidth: 0.97, row: 4 };
/** Top of each drawing (`yard-props.test.ts` pins them to the render). */
const GOODS_HEIGHT: Readonly<Record<Exclude<DecorAsset, 'kit'>, number>> = {
  'swap-body': 3.655,
  skip: 1.2055,
  pallets: 1.544,
  'mesh-boxes': 1.94,
};

type Placer = (piece: KitPiece, x: number, y: number, heading: number, depth?: number) => void;

/*
 * The yard kit's surroundings, all beyond the yard's walls and the street's kerbs. A piece's +X runs
 * along its heading and its face looks along heading + 90 degrees, so a facade that looks south has
 * heading pi and one that looks east has heading -pi/2.
 */
const NORTH = { setback: 16, right: 92, bays: 16, doors: [2, 7, 12], bin: 4 };
const WEST = { face: -9, top: 46, bays: 10, entrance: 4, depth: 8, hedge: -1 };
const EAST = { wash: { x: 106, y: 25 }, face: 118, bottom: 6, bays: 12, doors: [2, 6, 10] };
const SOUTH = { hedgeSetback: 1.4, treeSetback: 6, from: -26, to: 124, treePitch: 16 };
const HALL_BAY = 5;
const HALL_DEPTH = 10;
const OFFICE_BAY = 3;
const HEDGE_PITCH = 2.3;
const TREES: readonly KitPiece[] = ['lime-a', 'maple-a', 'lime-b', 'maple-b'];

/** A hall facade of `bays` bays from `(x, y)`, its roof `depth` deep, ending in a corner post at each end. */
function hall(
  kit: Placer,
  at: { x: number; y: number; heading: number },
  bays: number,
  doors: readonly number[],
): void {
  const [c, s] = [Math.cos(at.heading), Math.sin(at.heading)];
  const along = (d: number): [number, number] => [at.x + c * d, at.y + s * d];
  for (let k = 0; k < bays; k++) {
    const [x, y] = along((k + 0.5) * HALL_BAY);
    kit(doors.includes(k) ? 'hall-door-bay' : 'hall-wall-bay', x, y, at.heading);
    kit('hall-roof', x, y, at.heading, HALL_DEPTH);
  }
  kit('hall-corner', ...along(0), at.heading);
  kit('hall-corner', ...along(bays * HALL_BAY - 0.25), at.heading);
}

function surroundings(yard: Rect2, kit: Placer): void {
  const { PI } = Math;
  hall(kit, { x: NORTH.right, y: yard.maxY + NORTH.setback, heading: PI }, NORTH.bays, NORTH.doors);
  const hallFace = yard.maxY + NORTH.setback - 1.5;
  kit('bin-1100', 40, hallFace, PI);
  kit('bin-240', 43.5, hallFace, PI);
  for (const x of [20, 45, 60, 85]) kit('grass-tuft', x, hallFace + 0.6, PI);

  // west office, its front to the east
  const west = (k: number): number => WEST.top - (k + 0.5) * OFFICE_BAY;
  for (let k = 0; k < WEST.bays; k++) {
    kit(k === WEST.entrance ? 'office-entrance' : 'office-bay', WEST.face, west(k), -PI / 2);
    kit('office-roof', WEST.face, west(k), -PI / 2, WEST.depth);
  }
  const door = west(WEST.entrance);
  for (const dy of [-8, 0, 8]) kit('flagpole', -4.5, door + dy, 0);
  kit('bench', WEST.face + 1, door + 6, -PI / 2);
  kit('bike-rack', WEST.face + 1, door - 7, -PI / 2);
  kit('bin-240', WEST.face + 1, door + 9, -PI / 2);
  kit('bin-1100', WEST.face + 1.2, door - 11, -PI / 2);
  for (let y = 6; y < yard.maxY - 2; y += HEDGE_PITCH) kit('hedge', WEST.hedge, y, PI / 2);
  for (const y of [12, 20, 55]) kit('grass-tuft', -2.6, y, 0);

  // east wash canopy and hall, their fronts to the west
  kit('wash-canopy', EAST.wash.x, EAST.wash.y, PI / 2);
  hall(kit, { x: EAST.face, y: EAST.bottom, heading: PI / 2 }, EAST.bays, EAST.doors);
  kit('bin-1100', EAST.face - 1.5, 22, PI / 2);
  kit('bin-240', EAST.face - 1.5, 24.5, PI / 2);
  kit('bench', EAST.face - 1.5, 44, PI / 2);
  for (const y of [14, 36, 58]) kit('grass-tuft', EAST.face - 2.2, y, PI / 2);

  // south of the street: a hedge, and street trees behind it
  const { from, to, treePitch } = SOUTH;
  const verge = STREET.kerbY - STREET.width - STREET.pavement; // the far pavement's outer edge
  const hedgeY = verge - SOUTH.hedgeSetback;
  const treeY = verge - SOUTH.treeSetback;
  for (let x = from; x <= to; x += HEDGE_PITCH) kit('hedge', x, hedgeY, 0);
  for (let i = 0, x = from + 2; x <= to; i++, x += treePitch) {
    kit(TREES[i % TREES.length] ?? 'lime-a', x, treeY, 0);
  }
  for (const x of [-20, 10, 40, 70, 100]) kit('grass-tuft', x, hedgeY - 1, 0);
}

export function plotDecor(yard: Rect2): Decor[] {
  const y0 = yard.maxY + GAP;
  const counts = new Map<string, number>();
  const out: Decor[] = [];
  const add = (
    asset: Exclude<DecorAsset, 'kit'>,
    cx: number,
    cy: number,
    halfLength: number,
    halfWidth: number,
    heading = 0,
    variant = 0,
  ): void => {
    const n = (counts.get(asset) ?? 0) + 1;
    counts.set(asset, n);
    out.push({
      id: `${asset}-${n}`,
      asset,
      footprint: { cx, cy, halfLength, halfWidth, heading },
      variant,
      height: GOODS_HEIGHT[asset],
    });
  };
  const kit: Placer = (piece, x, y, heading, depth) => {
    const n = (counts.get(piece) ?? 0) + 1;
    counts.set(piece, n);
    out.push({
      id: `kit-${piece}-${n}`,
      asset: 'kit',
      piece,
      footprint: kitFootprint(piece, x, y, heading, depth),
      variant: 0,
      height: KIT_FOOTPRINTS[piece].height,
    });
  };
  SWAP_X.forEach((x, i) => {
    add('swap-body', yard.minX + x, y0 + SWAP.row, SWAP.halfLength, SWAP.halfWidth, 0, i + 1);
  });
  SKIP_X.forEach((x, i) => {
    for (const row of [0, 1]) {
      const heading = row * 2 * SKIP.tilt - SKIP.tilt;
      const cy = y0 + SKIP.row + row * SKIP.rowPitch;
      add('skip', yard.minX + x, cy, SKIP.halfLength, SKIP.halfWidth, heading, i + row);
    }
  });
  add('pallets', yard.minX + PALLETS_X, y0 + PALLETS.row, PALLETS.halfLength, PALLETS.halfWidth);
  add(
    'mesh-boxes',
    yard.minX + MESH_BOXES_X,
    y0 + MESH_BOXES.row,
    MESH_BOXES.halfLength,
    MESH_BOXES.halfWidth,
  );
  surroundings(yard, kit);
  return out;
}
