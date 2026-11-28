import type { AidFlags } from '../contracts/render';
import { AID_DASH_OFF, AID_DASH_ON, AID_STROKE } from '../render/seams';

const SCALE = 12; // px per metre of the aid strokes
const CASING = AID_STROKE.casing * SCALE;

const stroke = (d: string, metres: number, dash = ''): string => {
  const width = metres * SCALE;
  const dashes = dash === '' ? '' : ` stroke-dasharray="${dash}"`;
  return (
    `<path class="swatch-casing" d="${d}" stroke-width="${width + 2 * CASING}"${dashes} />` +
    `<path class="swatch-core" d="${d}" stroke-width="${width}"${dashes} />`
  );
};

const outline = (metres: number): string => {
  const rect = (cls: string, width: number): string =>
    `<rect class="${cls}" x="5" y="4" width="30" height="12" stroke-width="${width}" />`;
  return rect('swatch-casing', metres * SCALE + 2 * CASING) + rect('swatch-core', metres * SCALE);
};

const DASH = `${AID_DASH_ON * SCALE} ${AID_DASH_OFF * SCALE}`;

const SHAPES: Record<keyof AidFlags, string> = {
  pivots: stroke('M4 10 L36 5', AID_STROKE.pivot) + stroke('M4 10 L36 15', AID_STROKE.pivot),
  path:
    stroke('M3 6 H31', AID_STROKE.path) +
    stroke('M3 14 H31', AID_STROKE.corridor, DASH) +
    stroke('M35 3 V17', AID_STROKE.bar),
  tracks: `<path class="swatch-tracks" d="M3 7 H37 M3 13 H37" stroke-width="${AID_STROKE.track * SCALE}" />`,
  ghost: outline(AID_STROKE.ghost),
};

/** A small drawing of one aid's stroke, in the same tokens and dash the top-down view uses. */
export const aidSwatch = (aid: keyof AidFlags): string =>
  `<svg class="hud-swatch" viewBox="0 0 40 20" aria-hidden="true">${SHAPES[aid]}</svg>`;

/** The direct sight area and the mirror-only one beside it, as both views draw them. */
export const sightSwatch = (): string => {
  const area = (cls: string, x: number, width: number): string =>
    `<rect class="${cls}" x="${x}" y="4" width="${width}" height="12" />`;
  return `<svg class="hud-swatch" viewBox="0 0 40 20" aria-hidden="true">${area('swatch-sight-direct', 5, 18)}${area('swatch-sight-mirror', 23, 12)}</svg>`;
};
