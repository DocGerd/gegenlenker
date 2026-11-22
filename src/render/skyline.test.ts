import { Camera, Color, Vector3, type BufferGeometry } from 'three';
import { UniformNode, type MeshLambertNodeMaterial, type Node } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { layouts } from '../content/registry';
import { BOUNDS } from '../content/street';
import { AIDS_LAYER, CAMERA_FAR, PERSPECTIVE_LAYER } from './seams';
import { createSkyline } from './skyline';
import { isGlassTile, TILES, tileUv } from './skyline-atlas';
import {
  buildingGeometry,
  buildingParts,
  GLOW_ATTRIBUTE,
  LIT_SHARE,
  SINK,
  skylineGeometry,
} from './skyline-geometry';
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

describe('skyline windows', () => {
  const glowOf = (g: BufferGeometry): number[] => [...g.getAttribute(GLOW_ATTRIBUTE).array];
  const glass = TILES.filter(isGlassTile).map(tileUv);
  const onGlass = (g: BufferGeometry, i: number): boolean => {
    const uv = g.getAttribute('uv');
    const [u, v] = [uv.getX(i), uv.getY(i)];
    return glass.some((t) => u >= t.u0 && u <= t.u1 && v >= t.v0 && v <= t.v1);
  };
  const office = (): BufferGeometry => buildingGeometry(fixture('office', 'flat'));

  it('is the same in every session', () => {
    const buildings = skylineBuildings(BOUNDS);
    expect(glowOf(skylineGeometry(buildings))).toEqual(glowOf(skylineGeometry(buildings)));
  });

  it('glows only on glass tiles, one level to a quad', () => {
    const g = office();
    const glow = glowOf(g);
    expect(glow.some((l) => l > 0)).toBe(true);
    for (let i = 0; i < glow.length; i++) {
      if (!onGlass(g, i)) expect(glow[i], `vertex ${String(i)}`).toBe(0);
    }
    for (let q = 0; q < glow.length; q += 6) {
      expect(new Set(glow.slice(q, q + 6)).size, `quad ${String(q / 6)}`).toBe(1);
    }
    for (const level of glow) expect(level === 0 || (level >= 0.6 && level <= 1)).toBe(true);
  });

  it('leaves every other building dark', () => {
    for (const [kind, roof] of [
      ['hall', 'sawtooth'],
      ['warehouse', 'flat'],
      ['chimney', 'flat'],
      ['crane', 'flat'],
    ] as const) {
      expect(Math.max(...glowOf(buildingGeometry(fixture(kind, roof)))), kind).toBe(0);
    }
  });

  it.each(Object.values(layouts))('lights about a quarter of the windows around $id', (layout) => {
    const g = skylineGeometry(skylineBuildings(layout.bounds));
    const glow = glowOf(g);
    let windows = 0;
    let lit = 0;
    for (let q = 0; q < glow.length; q += 6) {
      if (!onGlass(g, q)) continue;
      windows++;
      if ((glow[q] ?? 0) > 0) lit++;
    }
    expect(windows).toBeGreaterThan(100);
    expect(lit / windows).toBeGreaterThan(LIT_SHARE - 0.05);
    expect(lit / windows).toBeLessThan(LIT_SHARE + 0.05);
  });

  it('flips a uniform and leaves the material and its program alone', () => {
    const skyline = createSkyline(BOUNDS, new Color(0xdcebf2));
    const material = skyline.mesh.material as MeshLambertNodeMaterial;
    const uniforms = (root: Node | null): number[] => {
      const found: number[] = [];
      const walk = (n: Node): void => {
        if (n instanceof UniformNode && typeof n.value === 'number') found.push(n.value);
        for (const child of n.getChildren()) walk(child);
      };
      if (root !== null) walk(root);
      return found;
    };
    const { version } = material;
    expect(uniforms(material.emissiveNode)).toEqual([0]);
    skyline.setWindows(true);
    expect(uniforms(material.emissiveNode)).toEqual([1]);
    skyline.setWindows(false);
    expect(uniforms(material.emissiveNode)).toEqual([0]);
    expect(material.version).toBe(version);
    skyline.dispose();
  });
});
