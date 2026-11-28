import { KIT_FOOTPRINTS, kitFootprint } from '../content/kit';
import type { KitDecor, KitPiece } from '../contracts/layout';
import { FRONT_BAY, rng, type Building } from './skyline-layout';

/*
 * The yard-facing wall and roof of the belt's first row (`Building.front`) from the kit's hall and
 * office pieces, laid out like `plot.ts` lays out its own. Visual only: decor the layout does not
 * hold, the same for every exercise.
 */

/** The far corner post stands this far in from the end, like `plot.ts`'s. */
const END_POST = 0.25;
/** Every third bay of a hall is a door; the end bays never are. */
const DOOR_EVERY = 3;

/** The kit decor of every first-row building of `buildings`. */
export function beltKitDecor(buildings: readonly Building[]): KitDecor[] {
  const out: KitDecor[] = [];
  buildings.forEach((b, index) => {
    if (b.front !== true) return;
    const office = b.kind === 'office';
    const bay = office ? FRONT_BAY.office : FRONT_BAY.hall;
    const bays = Math.round(b.length / bay);
    const [c, s] = [Math.cos(b.heading), Math.sin(b.heading)];
    // the face looks along heading + 90 degrees, towards the yard; the building stands behind it
    const [x0, y0] = [
      b.x - s * (b.depth / 2) - (c * b.length) / 2,
      b.y + c * (b.depth / 2) - (s * b.length) / 2,
    ];
    const pick = Math.floor(rng(b.seed)() * bays * DOOR_EVERY);
    const add = (piece: KitPiece, along: number, depth?: number): void => {
      out.push({
        id: `belt-${index}-${out.length}`,
        asset: 'kit',
        piece,
        footprint: kitFootprint(piece, x0 + c * along, y0 + s * along, b.heading, depth),
        variant: 0,
        height: KIT_FOOTPRINTS[piece].height,
      });
    };
    for (let k = 0; k < bays; k++) {
      const along = (k + 0.5) * bay;
      if (office) add(k === pick % bays ? 'office-entrance' : 'office-bay', along);
      else {
        const door = k > 0 && k < bays - 1 && (k + pick) % DOOR_EVERY === 0;
        add(door ? 'hall-door-bay' : 'hall-wall-bay', along);
      }
      add(office ? 'office-roof' : 'hall-roof', along, b.depth);
    }
    if (!office) {
      add('hall-corner', 0);
      add('hall-corner', bays * bay - END_POST);
    }
  });
  return out;
}
