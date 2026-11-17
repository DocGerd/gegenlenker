import type { ScenePalette, ScenePaletteKey } from '../contracts/render';

const KEYS: Record<ScenePaletteKey, true> = {
  sky: true,
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
  band: true,
  cladding: true,
};

export function readScenePalette(el: Element = document.documentElement): ScenePalette {
  const style = getComputedStyle(el);
  const palette: Partial<Record<ScenePaletteKey, number>> = {};
  for (const key of Object.keys(KEYS) as ScenePaletteKey[]) {
    const raw = style.getPropertyValue(`--scene-${key}`).trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(raw)?.[1];
    if (hex === undefined) throw new Error(`Missing or invalid scene token --scene-${key}`);
    palette[key] = parseInt(hex, 16);
  }
  return palette as ScenePalette;
}
