import type { TruckId } from '../contracts/vehicle';

// No `three` import: the Blender param scripts load this module under plain Node.

export type CabStyle = 'day' | 'crew';
export type TruckBodyKind = 'tipper' | 'tarp';

/**
 * How a truck looks in the perspective views. Render estimates, not Params: the sim and the
 * top-down view keep the vehicle data's dimensions, so a longer crew cab changes no fingerprint.
 */
export type TruckLook = {
  readonly cab: { readonly style: CabStyle; readonly length: number };
  readonly body: { readonly kind: TruckBodyKind };
};

export const TRUCK_LOOKS = {
  'arocs-1835-ak': { cab: { style: 'day', length: 2.2 }, body: { kind: 'tipper' } },
  'man-le-18-280': { cab: { style: 'crew', length: 3 }, body: { kind: 'tarp' } },
} as const satisfies Record<TruckId, TruckLook>;
