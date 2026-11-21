// No `three` import: viewports.ts shares these bounds with the interior.

const rad = (degrees: number): number => (degrees * Math.PI) / 180;

/** Vertical field of view of the cockpit camera, in degrees. */
export const COCKPIT_FOV = 55;

/** Half-angle in degrees about the view axis of the forward sight cone that no part may enter. */
export const CLEAR_CONE_DEG = 12;
/** NDC gaps between a pillar and the cone, and between a pillar and a mirror rect. */
export const CONE_GAP = 0.05;
export const MIRROR_GAP = 0.03;
export const PILLAR_WIDTH = 0.12;
/** NDC; a narrower pillar is a sliver. */
export const MIN_PILLAR_WIDTH = 0.06;
/** The pillar's top edge leans this far towards the centre of the view, in pillar widths. */
export const PILLAR_LEAN = 0.25;

/** NDC; the dash low point and header high point never move further right than this. */
export const MAX_SHIFT = 0.45;
export const VISOR = { left: -0.55, right: 0, bottom: 0.62 };

/** The header's lower edge: highest at `shift`, and as high at the left view edge as unshifted, where the left mirror sits. */
export const headerEdge = (x: number, shift = 0): number =>
  0.78 - 0.06 * ((x - shift) / (1 + shift)) ** 2;

/** NDC x of the forward sight cone's edge. */
export function coneEdge(aspect: number, fov: number): number {
  return Math.tan(rad(CLEAR_CONE_DEG)) / (aspect * Math.tan(rad(fov / 2)));
}

/** NDC y of the forward sight cone's top; the cone is cut about the view axis. */
export const coneTop = (fov: number): number =>
  Math.tan(rad(CLEAR_CONE_DEG)) / Math.tan(rad(fov / 2));

export type PillarSpan = { centre: number; width: number };

/** The room for a pillar in NDC beside a mirror whose inner edge is `mirrorInner` from the centre; null where it does not fit. */
export function pillarSlot(aspect: number, fov: number, mirrorInner: number): PillarSpan | null {
  const outer = Math.min(mirrorInner - MIRROR_GAP, 1);
  const inner = Math.max(outer - PILLAR_WIDTH, coneEdge(aspect, fov) + CONE_GAP);
  const width = outer - inner;
  return width < MIN_PILLAR_WIDTH ? null : { centre: (inner + outer) / 2, width };
}

/** An NDC box: x to the right, y up. */
export type NdcBox = {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
};

/** The lowest the header's edge reaches over `x0`..`x1` at any truck: its shift lies between 0 and `MAX_SHIFT`. */
function headerFloor(x0: number, x1: number): number {
  let low = Infinity;
  for (const shift of [0, MAX_SHIFT / 2, MAX_SHIFT]) {
    for (const x of [x0, x1]) low = Math.min(low, headerEdge(x, shift));
  }
  return low;
}

/**
 * Where the front mirror may sit in a cockpit view of `aspect`, whose right mirror's inner edge is
 * `rightInner` from the centre: in the windscreen, right of the visor and the cone, left of the
 * right pillar's top and mirror, below the header and above the sight cone. Null where nothing is left.
 */
export function frontBand(aspect: number, rightInner: number): NdcBox | null {
  const slot = pillarSlot(aspect, COCKPIT_FOV, rightInner);
  const left = VISOR.right + MIRROR_GAP;
  const right =
    slot === null
      ? Math.min(rightInner, 1) - MIRROR_GAP
      : slot.centre - slot.width / 2 - PILLAR_LEAN * slot.width - MIRROR_GAP;
  const bottom = coneTop(COCKPIT_FOV) + CONE_GAP;
  const top = headerFloor(left, right) - MIRROR_GAP;
  return right > left && top > bottom ? { left, right, bottom, top } : null;
}
