import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BufferGeometry, type Mesh, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { trucks } from '../vehicles/registry';
import { type CabOpenings, cabOpenings, cabShadowCaster, ROOF } from './cab-shadow';
import { cabShellParams } from './cab-dims';
import { parseMeshes } from './glb-shells';
import { interiorShellFrom } from './interior-glb';
import { perspectiveSunDirection } from './light-rig';

type Triangle = readonly [Vector3, Vector3, Vector3];

function triangles(geometry: BufferGeometry, mesh?: Mesh): Triangle[] {
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const count = index === null ? position.count : index.count;
  const point = (i: number): Vector3 => {
    const v = new Vector3().fromBufferAttribute(position, index === null ? i : index.getX(i));
    return mesh === undefined ? v : v.applyMatrix4(mesh.matrixWorld);
  };
  const out: Triangle[] = [];
  for (let i = 0; i < count; i += 3) out.push([point(i), point(i + 1), point(i + 2)]);
  return out;
}

const normal = ([a, b, c]: Triangle): Vector3 =>
  new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();

/** Möller–Trumbore: the distance along `dir` to `triangle`, or null. */
function hit(origin: Vector3, dir: Vector3, [a, b, c]: Triangle): number | null {
  const e1 = new Vector3().subVectors(b, a);
  const e2 = new Vector3().subVectors(c, a);
  const p = new Vector3().crossVectors(dir, e2);
  const det = e1.dot(p);
  if (Math.abs(det) < 1e-12) return null;
  const t = new Vector3().subVectors(origin, a);
  const u = t.dot(p) / det;
  if (u < 0 || u > 1) return null;
  const q = new Vector3().crossVectors(t, e1);
  const v = dir.dot(q) / det;
  if (v < 0 || u + v > 1) return null;
  const distance = e2.dot(q) / det;
  return distance > 1e-4 ? distance : null;
}

/** Whether the ray leaves the cab through the windscreen or a side window (Three space, truck frame). */
function leavesThroughGlass(
  from: Vector3,
  sun: Vector3,
  open: CabOpenings,
  front: number,
  halfWidth: number,
): boolean {
  const within = ([lo, hi]: readonly [number, number], v: number): boolean => v >= lo && v <= hi;
  const at = (t: number): Vector3 => from.clone().addScaledVector(sun, t);
  if (sun.x > 1e-6) {
    const p = at((front - from.x) / sun.x);
    if (within(open.windscreen.y, -p.z) && within(open.windscreen.z, p.y)) return true;
  }
  for (const side of [-1, 1]) {
    // body +y is Three -z
    const wall = -side * halfWidth;
    const towards = (wall - from.z) / sun.z;
    if (Math.abs(sun.z) < 1e-6 || towards <= 0) continue;
    const p = at(towards);
    if (within(open.sideZ, p.y) && open.sides.some((span) => within(span, p.x))) return true;
  }
  return false;
}

const bytesOf = (file: string): ArrayBuffer => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${file}.glb`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const interiorOf = async (id: string) => {
  return interiorShellFrom(await parseMeshes(bytesOf(`${id}-interior`)));
};

describe.each(trucks)('the cab shadow caster of $id', (spec) => {
  it('shades the sun-facing interior under the roof and leaves the glass openings lit', async () => {
    const p = cabShellParams(spec);
    const open = cabOpenings(spec);
    // what casts: the stand-in and, as in the scene, the cab skin
    const skin = (await parseMeshes(bytesOf(`${spec.id}-cab`))).find((m) => m.name === 'cab');
    if (skin === undefined) throw new Error('no cab skin');
    skin.updateWorldMatrix(true, false);
    const caster = [...triangles(cabShadowCaster(spec)), ...triangles(skin.geometry, skin)];
    const parts = Object.values(await interiorOf(spec.id));
    const facing = parts.flatMap((mesh) => {
      mesh.updateWorldMatrix(true, false);
      return triangles(mesh.geometry, mesh);
    });
    const sunWorld = perspectiveSunDirection();
    let covered = 0;
    let shadowedCovered = 0;
    let lit = 0;
    let shadowedLit = 0;
    for (let k = 0; k < 16; k++) {
      const sun = sunWorld.clone().applyAxisAngle(new Vector3(0, 1, 0), -(k / 16) * 2 * Math.PI);
      for (const tri of facing) {
        const n = normal(tri);
        if (n.dot(sun) <= 0.05) continue;
        const from = tri[0]
          .clone()
          .add(tri[1])
          .add(tri[2])
          .divideScalar(3)
          .addScaledVector(n, 1e-3);
        // the map draws back faces of a FrontSide caster
        const shadowed = caster.some((c) => normal(c).dot(sun) < 0 && hit(from, sun, c) !== null);
        if (leavesThroughGlass(from, sun, open, p.frontX, p.width / 2)) {
          lit++;
          if (shadowed) shadowedLit++;
        } else {
          covered++;
          if (shadowed) shadowedCovered++;
        }
      }
    }
    expect(lit, 'the check sees the sun through the glass').toBeGreaterThan(0);
    expect(covered, 'the check sees the roof').toBeGreaterThan(0);
    expect(shadowedCovered / covered).toBeGreaterThan(0.9);
    expect(shadowedLit / lit).toBeLessThan(0.05);
  });

  it('is hollow exactly at the glass and roof edge the cab asset draws', async () => {
    const p = cabShellParams(spec);
    const open = cabOpenings(spec);
    const meshes = await parseMeshes(bytesOf(`${spec.id}-cab`));
    const vertices = (name: string): Vector3[] => {
      const mesh = meshes.find((m) => m.name === name);
      if (mesh === undefined) throw new Error(`no ${name}`);
      mesh.updateWorldMatrix(true, false);
      const position = mesh.geometry.getAttribute('position');
      return Array.from({ length: position.count }, (_, i) =>
        new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld),
      );
    };
    const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3;
    const glass = vertices('cab-glass');
    const front = glass.filter((v) => v.x > p.frontX);
    expect(Math.max(...front.map((v) => -v.z))).toBeCloseTo(open.windscreen.y[1], 3);
    expect(Math.min(...front.map((v) => v.y))).toBeCloseTo(open.sideZ[0], 3);
    expect(Math.max(...front.map((v) => v.y))).toBeCloseTo(open.sideZ[1], 3);
    const edges = [
      ...new Set(glass.filter((v) => Math.abs(v.z) > p.width / 2).map((v) => v.x.toFixed(3))),
    ]
      .map(Number)
      .sort((a, b) => a - b);
    expect(edges).toHaveLength(open.sides.length * 2);
    open.sides.flat().forEach((x, i) => expect(edges[i]).toBeCloseTo(x, 3));
    // the roof's front edge recedes by ROOF and drops to the wall top
    const skin = vertices('cab');
    expect(skin.some((v) => near(v.x, p.frontX - ROOF) && near(v.y, p.cabHeight))).toBe(true);
    expect(skin.some((v) => near(v.x, p.frontX) && near(v.y, p.cabHeight - ROOF))).toBe(true);
  });
});
