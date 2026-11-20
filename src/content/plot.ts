import type { Decor, DecorAsset, Rect2 } from '../contracts/layout';

/** Neighbouring plot behind the yard's north edge: unreachable, so its goods need no collision. */
const GAP = 3;
const SWAP_X = [14, 26, 38];
const SKIP_X = [52, 56.5];
const PALLETS_X = 66;
const MESH_BOXES_X = 82;

// Footprint half sizes, centred on the drawn goods.
const SWAP = { halfLength: 3.725, halfWidth: 1.275, row: 3 };
const SKIP = { halfLength: 1.7, halfWidth: 0.85, row: 2.5, rowPitch: 4, tilt: 0.06 };
const PALLETS = { halfLength: 2.7, halfWidth: 1.5, centreX: 2.1, row: 4 };
const MESH_BOXES = { halfLength: 3.42, halfWidth: 0.97, centreX: 2.8, row: 4 };

export function plotDecor(yard: Rect2): Decor[] {
  const y0 = yard.maxY + GAP;
  const counts = new Map<DecorAsset, number>();
  const out: Decor[] = [];
  const add = (
    asset: DecorAsset,
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
  add(
    'pallets',
    yard.minX + PALLETS_X + PALLETS.centreX,
    y0 + PALLETS.row,
    PALLETS.halfLength,
    PALLETS.halfWidth,
  );
  add(
    'mesh-boxes',
    yard.minX + MESH_BOXES_X + MESH_BOXES.centreX,
    y0 + MESH_BOXES.row,
    MESH_BOXES.halfLength,
    MESH_BOXES.halfWidth,
  );
  return out;
}
