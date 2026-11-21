import type { ScenePalette, ScenePaletteKey } from '../contracts/render';

export const KEYS: Record<ScenePaletteKey, true> = {
  sky: true,
  backdrop: true,
  nightBackdrop: true,
  verge: true,
  yard: true,
  pavement: true,
  street: true,
  marking: true,
  kerb: true,
  wall: true,
  fence: true,
  hall: true,
  ramp: true,
  lamp: true,
  parked: true,
  cone: true,
  cab: true,
  body: true,
  chassis: true,
  wheel: true,
  tracks: true,
  accent: true,
  nightAccent: true,
  nightTracks: true,
  band: true,
  cladding: true,
};

/** `nightBackdrop` is the token `--scene-night-backdrop`. */
export const tokenName = (key: ScenePaletteKey): string =>
  key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function readScenePalette(el: Element = document.documentElement): ScenePalette {
  const style = getComputedStyle(el);
  const palette: Partial<Record<ScenePaletteKey, number>> = {};
  for (const key of Object.keys(KEYS) as ScenePaletteKey[]) {
    const raw = style.getPropertyValue(`--scene-${tokenName(key)}`).trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(raw)?.[1];
    if (hex === undefined)
      throw new Error(`Missing or invalid scene token --scene-${tokenName(key)}`);
    palette[key] = parseInt(hex, 16);
  }
  return palette as ScenePalette;
}

/** The tokens the top-down view draws its lit surfaces in at night. */
export const nightPalette = (palette: ScenePalette): ScenePalette => palette;
