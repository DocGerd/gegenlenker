import { Camera, Color } from 'three';
import { describe, expect, it } from 'vitest';
import { AIDS_LAYER, SKY_LAYER } from './seams';
import { createSkyline, skylineSilhouettes } from './skyline';

describe('skyline', () => {
  const silhouettes = skylineSilhouettes();

  it('is the same in every session', () => {
    expect(skylineSilhouettes()).toEqual(silhouettes);
  });

  it('spreads both rings around the full circle with no wide gap', () => {
    for (const far of [true, false]) {
      const azimuths = silhouettes.filter((s) => s.far === far).map((s) => s.azimuth);
      expect(azimuths.length).toBeGreaterThan(8);
      const sorted = [...azimuths].sort((a, b) => a - b);
      const wrapped = [...sorted, (sorted[0] ?? 0) + Math.PI * 2];
      for (let i = 1; i < wrapped.length; i++) {
        expect((wrapped[i] ?? 0) - (wrapped[i - 1] ?? 0)).toBeLessThan(1);
      }
    }
  });

  it('keeps every part above the horizon and below the zenith', () => {
    for (const s of silhouettes) {
      for (const part of s.parts) {
        expect(part.length).toBeGreaterThanOrEqual(3);
        for (const [dx, y] of part) {
          expect(Number.isFinite(dx)).toBe(true);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThan(0.5);
        }
      }
    }
  });

  it('is seen by the perspective cameras only', () => {
    const skyline = createSkyline(new Color(0x5c6875), new Color(0xdcebf2));
    const perspective = new Camera();
    perspective.layers.enable(SKY_LAYER);
    const topDown = new Camera();
    topDown.layers.enable(AIDS_LAYER);
    expect(skyline.mesh.layers.test(perspective.layers)).toBe(true);
    expect(skyline.mesh.layers.test(topDown.layers)).toBe(false);
    skyline.dispose();
  });
});
