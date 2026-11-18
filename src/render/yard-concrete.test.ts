import { Box3, type BufferGeometry, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { concreteWall, kerb, loadingRamp, OVERLAY, trafficCone } from './yard-concrete';
import { Parts } from './yard-props';

class Recorder extends Parts {
  readonly geometries: BufferGeometry[] = [];

  override add(geometry: BufferGeometry, hue: number, shade = 1): this {
    this.geometries.push(geometry);
    return super.add(geometry, hue, shade);
  }
}

const HEIGHT = 0.1;
const builders: readonly (readonly [string, (p: Parts) => void])[] = [
  ['kerb', (p) => kerb(p, 0.4, 0.05, HEIGHT, 0)],
  ['wall', (p) => concreteWall(p, 0.4, 0.05, HEIGHT, 0)],
  ['ramp', (p) => loadingRamp(p, 0.4, 0.2, HEIGHT)],
  ['cone', (p) => trafficCone(p, 0.02, 0.02, HEIGHT / 4)],
];

describe('concrete builders with degenerate dimensions', () => {
  it.each(builders)('keep every %s geometry finite and inside its height', (_, build) => {
    const p = new Recorder();
    build(p);
    expect(p.geometries.length).toBeGreaterThan(0);
    for (const g of p.geometries) {
      const b = new Box3().setFromObject(new Mesh(g));
      for (const v of [b.min, b.max]) {
        expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
      }
      expect(b.max.x).toBeGreaterThan(b.min.x);
      expect(b.max.y).toBeGreaterThan(b.min.y);
      expect(b.max.z).toBeGreaterThan(b.min.z);
      expect(b.min.y).toBeGreaterThanOrEqual(-1e-4);
      expect(b.max.y).toBeLessThanOrEqual(HEIGHT + OVERLAY + 1e-4);
    }
  });
});
