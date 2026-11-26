import type { SignId } from '../contracts/einweiser';
import type { SimSnapshot, Vec2 } from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { bodyFootprints } from '../sim/geometry';
import { MOVEMENT_SIGNS, REACTION_TIME } from './signs';
import { overlaps, WALKER_RADIUS } from './walk';

type Bodies = Pick<SimSnapshot, 'truck' | 'coupling' | 'dolly' | 'trailer'>;

/** The gap from his circle to the nearest body; negative when they overlap. */
export function clearance(params: VehicleParams, s: Bodies, at: Vec2): number {
  return Math.min(
    ...bodyFootprints(params, s).map(({ obb }) => {
      const [c, n] = [Math.cos(obb.heading), Math.sin(obb.heading)];
      const [dx, dy] = [at.x - obb.cx, at.y - obb.cy];
      const lx = Math.abs(c * dx + n * dy) - obb.halfLength;
      const ly = Math.abs(-n * dx + c * dy) - obb.halfWidth;
      const outside = Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
      return (outside > 0 ? outside : Math.max(lx, ly)) - WALKER_RADIUS;
    }),
  );
}

/** Run over: his circle, grown by how far his held pose moved since the last sample, overlaps a body. */
export const runOver = (
  params: VehicleParams,
  s: Bodies,
  at: Vec2,
  displacement: number,
): boolean =>
  bodyFootprints(params, s).some(({ obb }) => overlaps(obb, at, WALKER_RADIUS + displacement));

/** A sign that starts while the driver does not see him. */
export const signOutOfSight = (
  previous: SignId | null,
  sign: SignId | null,
  inSight: boolean,
): boolean => sign !== null && sign !== previous && !inSight;

/** An obstacle contact under a movement sign, with the contact warning up for longer than `REACTION_TIME`. */
export const lateHalt = (contact: boolean, sign: SignId | null, warnedFor: number): boolean =>
  contact && sign !== null && MOVEMENT_SIGNS.has(sign) && warnedFor > REACTION_TIME;
