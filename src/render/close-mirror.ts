import type { MirrorSpec } from './mirror';

/** The class V mirror's width over its height. */
export const CLOSE_ASPECT = 2;

/**
 * Narrowest the class V mirror gets, in CSS px: wide enough that a 0.3 m cone base spans 6 texels at a
 * device pixel ratio of 1 anywhere in the class V field (`close-mirror.test.ts` derives it from the
 * camera); where the layout cannot hold it, there is no class V mirror.
 */
export const MIN_CLOSE_WIDTH = 140;

/**
 * Class V: from beside the A-pillar, outward and down onto the ground between the cab side and 2 m out.
 * The camera is rolled upside down, so the cab side lies on the image's top edge, and the composite's
 * mirrored u puts the front on the left. The anchor and view rect belong to the layout.
 */
export const CLASS_V: Omit<MirrorSpec, 'anchor' | 'view'> = {
  yaw: Math.PI / 2,
  pitch: (-75 * Math.PI) / 180,
  roll: Math.PI,
  fov: 55,
  aspect: CLOSE_ASPECT,
  targetScale: 1,
  cadence: 1,
  parity: 0,
};
