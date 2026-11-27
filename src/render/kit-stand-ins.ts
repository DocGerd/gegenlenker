import { type BufferGeometry, SphereGeometry } from 'three';
import { isKitDecor, type Decor, type KitDecor } from '../contracts/layout';
import { REALISM_HUES as HUE } from './realism-hues';
import { merge } from './vehicle-geometry';
import { Parts, type Range } from './yard-props';

/*
 * Plain shapes for the yard kit's surroundings (`plotDecor`) where the kit itself is not drawn, so the
 * plots around the yard are never bare ground from above. Each stays inside its piece's footprint.
 * Bays and corners stand on the face of a roof's volume, and small furniture reads as nothing from
 * the outside views, so neither is drawn.
 */

const ROOF_SLAB = 0.3;
const TRUNK = { half: 0.25, top: 0.4 };
const CROWN = { inset: 0.85, bottom: 0.3, segments: 7, rings: 5 };
const CANOPY_SLAB = 0.5;
const POST = 0.15;
const FLAGPOLE = 0.06;

const around = (half: number, inset = 1): Range => [-half * inset, half * inset];

function standIn({ piece, footprint, height: h }: KitDecor): BufferGeometry | null {
  const { cx, cy, halfLength: hl, halfWidth: hw, heading } = footprint;
  const [x, y] = [around(hl), around(hw)];
  const p = new Parts();
  switch (piece) {
    case 'hall-roof':
    case 'office-roof':
      p.box(
        x,
        y,
        [0, h - ROOF_SLAB],
        piece === 'hall-roof' ? HUE.whiteAluminium : HUE.concrete,
      ).box(x, y, [h - ROOF_SLAB, h], HUE.anthracite);
      break;
    case 'office-entrance':
      p.box(x, y, [0, h], HUE.concrete, 0.9);
      break;
    case 'lime-a':
    case 'lime-b':
    case 'maple-a':
    case 'maple-b': {
      const bottom = h * CROWN.bottom;
      const radius = Math.min(hl, hw) * CROWN.inset;
      p.box(around(TRUNK.half), around(TRUNK.half), [0, h * TRUNK.top], HUE.deckWood).add(
        new SphereGeometry(1, CROWN.segments, CROWN.rings)
          .scale(radius, (h - bottom) / 2, radius)
          .translate(0, (h + bottom) / 2, 0),
        HUE.containerGreen,
      );
      break;
    }
    case 'hedge':
      p.box(x, y, [0, h], HUE.containerGreen, 0.75);
      break;
    case 'wash-canopy':
      p.box(x, y, [h - CANOPY_SLAB, h], HUE.whiteAluminium);
      for (const side of [-1, 1]) {
        p.box([side * hl - POST, side * hl + POST], around(POST), [0, h], HUE.anthracite);
      }
      break;
    case 'flagpole':
      p.box(around(FLAGPOLE), around(FLAGPOLE), [0, h], HUE.whiteAluminium);
      break;
    default:
      return null;
  }
  return p.place(cx, cy, heading);
}

/** One merged geometry of the stand-ins for `decor`'s kit pieces; null when none draws one. */
export function kitStandInGeometry(decor: readonly Decor[]): BufferGeometry | null {
  const parts = decor.filter(isKitDecor).flatMap((d) => standIn(d) ?? []);
  return parts.length === 0 ? null : merge(parts);
}
