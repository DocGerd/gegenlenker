import { Camera, Color, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { BOUNDS } from '../content/street';
import { AIDS_LAYER, CAMERA_FAR, PERSPECTIVE_LAYER } from './seams';
import { createSkyline } from './skyline';
import { buildingGeometry, buildingParts, SINK, skylineGeometry } from './skyline-geometry';
import { CLEARANCE, REACH, skylineBuildings, type Building } from './skyline-layout';

function triangles(g: BufferGeometry): [Vector3, Vector3, Vector3][] {
  const p = g.getAttribute('position');
  const at = (i: number): Vector3 => new Vector3(p.getX(i), p.getY(i), p.getZ(i));
  return Array.from({ length: p.count / 3 }, (_, t) => [at(3 * t), at(3 * t + 1), at(3 * t + 2)]);
}

/** Möller-Trumbore: distance along the ray to the triangle, or null. */
function hit(o: Vector3, d: Vector3, [a, b, c]: [Vector3, Vector3, Vector3]): number | null {
  const e1 = new Vector3().subVectors(b, a);
  const e2 = new Vector3().subVectors(c, a);
  const h = new Vector3().crossVectors(d, e2);
  const det = e1.dot(h);
  if (Math.abs(det) < 1e-12) return null;
  const s = new Vector3().subVectors(o, a);
  const u = s.dot(h) / det;
  if (u < 0 || u > 1) return null;
  const q = new Vector3().crossVectors(s, e1);
  const v = d.dot(q) / det;
  if (v < 0 || u + v > 1) return null;
  const t = e2.dot(q) / det;
  return t > 1e-6 ? t : null;
}

/** Signed volume by the divergence theorem: positive when the faces wind outwards. */
function volume(tris: [Vector3, Vector3, Vector3][]): number {
  return tris.reduce((sum, [a, b, c]) => sum + a.dot(new Vector3().crossVectors(b, c)) / 6, 0);
}

/** Faces that start outside a closed solid cross its surface an even number of times. */
function facesOutward(tris: [Vector3, Vector3, Vector3][]): number {
  const jitter = new Vector3(0.0123, 0.0171, 0.0093);
  let inward = 0;
  for (const tri of tris) {
    const [a, b, c] = tri;
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    const centre = new Vector3().add(a).add(b).add(c).divideScalar(3);
    const o = centre.addScaledVector(n, 1e-3);
    const d = n.clone().add(jitter).normalize();
    const crossings = tris.filter((other) => hit(o, d, other) !== null).length;
    if (crossings % 2 === 1) inward++;
  }
  return inward;
}

const fixture = (kind: Building['kind'], roof: Building['roof'], skin = 0): Building => ({
  kind,
  roof,
  skin,
  seed: 7,
  x: 200,
  y: 30,
  heading: 0.4,
  length: 48,
  depth: 27,
  height: kind === 'office' ? 21 : kind === 'chimney' ? 60 : 9,
  haze: 0.3,
});

describe('skyline', () => {
  const buildings = skylineBuildings(BOUNDS);

  it('is the same in every session', () => {
    expect(skylineBuildings(BOUNDS)).toEqual(buildings);
  });

  it('spreads both rings around the full circle with no wide gap', () => {
    const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
    const cy = (BOUNDS.minY + BOUNDS.maxY) / 2;
    for (const haze of new Set(buildings.map((b) => b.haze))) {
      const azimuths = buildings
        .filter((b) => b.haze === haze)
        .map((b) => Math.atan2(b.y - cy, b.x - cx))
        .sort((a, b) => a - b);
      expect(azimuths.length).toBeGreaterThan(8);
      const wrapped = [...azimuths, (azimuths[0] ?? 0) + Math.PI * 2];
      for (let i = 1; i < wrapped.length; i++) {
        expect((wrapped[i] ?? 0) - (wrapped[i - 1] ?? 0)).toBeLessThan(1);
      }
    }
  });

  it('keeps every building outside the bounds and inside the far plane from any camera spot', () => {
    const corners = [BOUNDS.minX, BOUNDS.maxX].flatMap((x) =>
      [BOUNDS.minY, BOUNDS.maxY].map((y) => new Vector3(x, 0, -y)),
    );
    const p = skylineGeometry(buildings).getAttribute('position');
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i));
      for (const corner of corners) expect(v.distanceTo(corner)).toBeLessThan(REACH);
      const inside =
        v.x > BOUNDS.minX - CLEARANCE / 2 &&
        v.x < BOUNDS.maxX + CLEARANCE / 2 &&
        -v.z > BOUNDS.minY - CLEARANCE / 2 &&
        -v.z < BOUNDS.maxY + CLEARANCE / 2;
      expect(inside).toBe(false);
    }
    expect(REACH).toBeLessThan(CAMERA_FAR);
  });

  it('plants every building at or below the ground', () => {
    for (const b of buildings) {
      const p = buildingGeometry(b).getAttribute('position');
      let min = Infinity;
      for (let i = 0; i < p.count; i++) min = Math.min(min, p.getY(i));
      expect(min).toBeCloseTo(-SINK, 5);
    }
  });

  it.each([
    ['office', 'flat'],
    ['hall', 'gable'],
    ['hall', 'sawtooth'],
    ['hall', 'shed'],
    ['warehouse', 'flat'],
    ['warehouse', 'shed'],
    ['chimney', 'flat'],
    ['poplar', 'flat'],
  ] as const)('builds a %s with a %s roof as a closed solid facing outwards', (kind, roof) => {
    const tris = triangles(buildingGeometry(fixture(kind, roof)));
    expect(volume(tris)).toBeGreaterThan(0);
    expect(facesOutward(tris)).toBe(0);
  });

  it.each(['pylon', 'crane'] as const)(
    'builds every part of the %s as a closed solid facing outwards',
    (kind) => {
      const parts = buildingParts(fixture(kind, 'flat'));
      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        const tris = triangles(part);
        expect(volume(tris)).toBeGreaterThan(0);
        expect(facesOutward(tris)).toBe(0);
      }
    },
  );

  it('is seen by the perspective cameras only', () => {
    const skyline = createSkyline(BOUNDS, new Color(0xdcebf2));
    const perspective = new Camera();
    perspective.layers.enable(PERSPECTIVE_LAYER);
    const topDown = new Camera();
    topDown.layers.enable(AIDS_LAYER);
    expect(skyline.mesh.layers.test(perspective.layers)).toBe(true);
    expect(skyline.mesh.layers.test(topDown.layers)).toBe(false);
    skyline.dispose();
  });
});
