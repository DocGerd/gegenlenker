import { CLASS_V_OPTICS } from '../vehicles/mirrors';
import type { MirrorSpec } from './mirror';

export { CLOSE_ASPECT } from '../vehicles/mirrors';

/**
 * Narrowest the class V mirror gets, in CSS px: wide enough that a 0.3 m cone base spans 6 texels at a
 * device pixel ratio of 1 anywhere in the class V field (`close-mirror.test.ts` derives it from the
 * camera); where the layout cannot hold it, there is no class V mirror.
 */
export const MIN_CLOSE_WIDTH = 128;

/**
 * Class V (`CLASS_V_OPTICS`): the composite's mirrored u puts the front on the left. The anchor and
 * view rect belong to the layout.
 */
export const CLASS_V: Omit<MirrorSpec, 'anchor' | 'view'> = {
  ...CLASS_V_OPTICS,
  targetScale: 1,
  cadence: 1,
  parity: 0,
};
