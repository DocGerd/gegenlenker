import type { TrailerId, TruckId } from '../contracts/vehicle';

// No `three` import: the Blender param scripts load this module under plain Node.

export type CabStyle = 'day' | 'crew';
export type TruckBodyKind = 'tipper' | 'tarp';
/** Twin rear tyres per side, or one wide single (4x4 off-road tyres, as on the front axle). */
export type RearTyres = 'twin' | 'single';

/**
 * How a truck looks in the perspective views. Render estimates, not Params: the sim and the
 * top-down view keep the vehicle data's dimensions, so a longer crew cab or single rear tyres
 * change no fingerprint, and the top-down wheel tokens stay twins.
 */
export type TruckLook = {
  readonly cab: { readonly style: CabStyle; readonly length: number };
  readonly body: { readonly kind: TruckBodyKind; readonly rearTyres: RearTyres };
};

export const TRUCK_LOOKS = {
  'arocs-1835-ak': {
    cab: { style: 'day', length: 2.2 },
    body: { kind: 'tipper', rearTyres: 'twin' },
  },
  'man-le-18-280': {
    cab: { style: 'crew', length: 3 },
    body: { kind: 'tarp', rearTyres: 'single' },
  },
} as const satisfies Record<TruckId, TruckLook>;

export type TrailerShellKind = 'low-loader' | 'lafette';

/** The perspective look of a trailer: a Hüffermann low-loader in THW blue, or a bare Krone swap-body chassis. */
export type TrailerLook = { readonly kind: TrailerShellKind };

export const TRAILER_LOOKS = {
  'hueffermann-hpa-24-81-l': { kind: 'low-loader' },
  'krone-azw-18': { kind: 'lafette' },
} as const satisfies Record<TrailerId, TrailerLook>;
