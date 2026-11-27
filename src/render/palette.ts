import type { NightLitKey, ScenePalette, ScenePaletteKey } from '../contracts/render';

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
  einweiser: true,
  nightYard: true,
  nightPavement: true,
  nightStreet: true,
  nightVerge: true,
  nightKerb: true,
  nightCone: true,
  nightBand: true,
  nightWall: true,
  nightFence: true,
  nightHall: true,
  nightRamp: true,
  nightLamp: true,
  nightParked: true,
  nightBody: true,
  nightCab: true,
  nightChassis: true,
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

/** The night token of each lit key. */
export const NIGHT_KEY: Readonly<{ [K in NightLitKey]: `night${Capitalize<K>}` }> = {
  yard: 'nightYard',
  pavement: 'nightPavement',
  street: 'nightStreet',
  verge: 'nightVerge',
  kerb: 'nightKerb',
  cone: 'nightCone',
  band: 'nightBand',
  wall: 'nightWall',
  fence: 'nightFence',
  hall: 'nightHall',
  ramp: 'nightRamp',
  lamp: 'nightLamp',
  parked: 'nightParked',
  body: 'nightBody',
  cab: 'nightCab',
  chassis: 'nightChassis',
};

/** The palette the top-down view draws its lit surfaces in at night: each lit key takes its night token. */
export function nightPalette(palette: ScenePalette): ScenePalette {
  const night: Record<ScenePaletteKey, number> = { ...palette };
  for (const key of Object.keys(NIGHT_KEY) as NightLitKey[]) night[key] = palette[NIGHT_KEY[key]];
  return night;
}
