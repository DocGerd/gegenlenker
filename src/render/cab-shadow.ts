import { BoxGeometry, type BufferGeometry } from 'three';
import type { TruckSpec } from '../contracts/vehicle';
import { cabShellParams } from './cab-dims';
import { box, merge } from './vehicle-geometry';

/*
 * What the cab adds to the sun's shadow map (#159). The sun's PCF map draws the back faces of a
 * FrontSide caster, so the cab's closed skin shades only what lies behind it, never the interior
 * under its roof, and a double-sided skin would close the windows too. This hollow stand-in has the
 * roof, floor and walls as thin closed slabs and leaves the windscreen and side glass open, so the
 * roof shades the dash and the sun comes through the glass. The skin keeps casting beside it: its
 * back faces lie beyond the interior, so they change nothing inside and keep the yard shadow.
 */

/** The roof's front edge drops and recedes by this much (cab_shell.py ROOF). */
export const ROOF = 0.12;

/** Slab thickness (m): thin enough to stay clear of the interior's headliner and door tops. */
export const SLAB = 0.05;

type Range = readonly [number, number];

/** The openings in the cab's walls, in the body frame (x forward, y left, z up). */
export type CabOpenings = {
  readonly windscreen: { readonly y: Range; readonly z: Range };
  /** Side glass spans along x, shared by both sides. */
  readonly sides: readonly Range[];
  readonly sideZ: Range;
};

export function cabOpenings(spec: TruckSpec): CabOpenings {
  const p = cabShellParams(spec);
  const { cab } = p;
  const sill = p.frameTop + cab.glassSill;
  const z: Range = [sill, sill + cab.glassHeight];
  const windscreenHalf = p.width / 2 - cab.windscreenInset;
  const front = p.frontX - cab.sideGlassSetback;
  const sides: Range[] = [[front - cab.sideGlassLength, front]];
  if (p.style === 'crew') {
    // cab_shell.py CREW_GLASS: the pillar gap and length of the second side window
    const [gap, length] = [0.2, 0.75];
    const near = front - cab.sideGlassLength - gap;
    sides.unshift([near - length, near]);
  }
  return { windscreen: { y: [-windscreenHalf, windscreenHalf], z }, sides, sideZ: z };
}

/** The front vertical edges are chamfered by this much (cab_shell.py CORNER). */
export const CORNER = 0.12;

/** The hollow cab, Three space, in the truck's frame; every slab stays inside the skin. */
export function cabShadowCaster(spec: TruckSpec): BufferGeometry {
  const p = cabShellParams(spec);
  const { windscreen, sides, sideZ } = cabOpenings(spec);
  const hw = p.width / 2;
  const rear = p.frontX - p.cabLength;
  const front = p.frontX;
  const [z0, z2] = [p.frameTop, p.cabHeight];
  const [sill, top] = sideZ;
  const z1 = z2 - ROOF;
  /** Where the chamfer starts on the walls, and on the roof, whose front edge recedes by ROOF. */
  const wallEnd = front - CORNER;
  const roofEnd = wallEnd - ROOF;
  const flat = hw - CORNER;
  const inward = SLAB / (2 * Math.SQRT2);
  const slope = new BoxGeometry(ROOF * Math.SQRT2, SLAB, 2 * flat)
    .rotateZ((3 * Math.PI) / 4)
    // the slab's outer face on the sloped skin, the rest inside it
    .translate(front - ROOF / 2 - inward, z1 + ROOF / 2 - inward, 0);
  // a wall slab along each chamfer, its outer face on the chamfer plane
  const chamfer = (side: -1 | 1): BufferGeometry =>
    new BoxGeometry(CORNER * Math.SQRT2, z1 - z0, SLAB)
      .rotateY((-side * Math.PI) / 4)
      .translate(front - CORNER / 2 - inward, (z0 + z1) / 2, -side * (hw - CORNER / 2 - inward));
  const parts: BufferGeometry[] = [
    box([rear, roofEnd], [-hw, hw], [z2 - SLAB, z2]),
    box([roofEnd, front - ROOF], [-flat, flat], [z2 - SLAB, z2]),
    slope,
    box([rear, wallEnd], [-hw, hw], [z0, z0 + SLAB]),
    box([wallEnd, front], [-flat, flat], [z0, z0 + SLAB]),
    box([rear, rear + SLAB], [-hw, hw], [z0, z2]),
    chamfer(-1),
    chamfer(1),
    // front wall: below and above the windscreen, and the pillars beside it
    box([front - SLAB, front], [-flat, flat], [z0, sill]),
    box([front - SLAB, front], [-flat, flat], [top, z1]),
    box([front - SLAB, front], [-flat, windscreen.y[0]], [sill, top]),
    box([front - SLAB, front], [windscreen.y[1], flat], [sill, top]),
  ];
  const side = (y: Range): void => {
    parts.push(
      box([rear, wallEnd], y, [z0, sill]),
      box([rear, roofEnd], y, [top, z2]),
      box([roofEnd, wallEnd], y, [top, z1]),
    );
    let from = rear;
    for (const [x0, x1] of sides) {
      parts.push(box([from, x0], y, [sill, top]));
      from = x1;
    }
    parts.push(box([from, wallEnd], y, [sill, top]));
  };
  side([hw - SLAB, hw]);
  side([-hw, -hw + SLAB]);
  return merge(parts);
}
