import { BufferGeometry, Color, MeshBasicMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { Marking } from '../contracts/layout';
import { rectGeometry } from './ground-geometry';
import {
  addMarkBox,
  edgeKeep,
  MARK_BOX,
  MarkingChunks,
  SYMBOL_KINDS,
  WEAR_CAP,
  wearableMarkings,
  wearAt,
} from './marking-wear';
import { addMarking } from './yard-tokens';

const STEP = 0.01;

type Quad = { readonly coverage: number; readonly keptEdge: number; readonly wears: boolean };

/** The marking pieces of `markings` as the environment builds them, each sampled on a grid. */
function quads(markings: readonly Marking[]): Quad[] {
  const chunks = new MarkingChunks({ minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 });
  const wearing = wearableMarkings(markings);
  markings.forEach((m, i) => {
    chunks.worn = wearing[i] === true;
    addMarking(m, chunks, new Color());
  });
  const geometries: BufferGeometry[] = [];
  const out: Quad[] = [];
  for (const mesh of chunks.meshes(new MeshBasicMaterial(), geometries)) {
    const position = mesh.geometry.getAttribute('position');
    const box = mesh.geometry.getAttribute(MARK_BOX);
    for (let q = 0; q < position.count; q += 4) {
      const [halfLength, halfWidth] = [box.getZ(q), box.getW(q)];
      if (halfLength === 0) {
        out.push({ coverage: 0, keptEdge: 0, wears: false });
        continue;
      }
      const at = (k: number): number[] => [
        position.getX(q + k),
        position.getY(q + k),
        position.getZ(q + k),
      ];
      const [v0, v1, v2] = [at(0), at(1), at(2)];
      const centre = [0, 1, 2].map(
        (c) => [0, 1, 2, 3].reduce((s, k) => s + (at(k)[c] ?? 0), 0) / 4,
      );
      const unit = (v: number[], w: number[]): number[] => {
        const d = v.map((c, i) => c - (w[i] ?? 0));
        const n = Math.hypot(...d);
        return d.map((c) => c / n);
      };
      const [u, w] = [unit(v1, v0), unit(v2, v0)];
      const keep = edgeKeep(halfWidth);
      let [sum, count, keptEdge] = [0, 0, 0];
      for (let a = -halfLength + STEP / 2; a < halfLength; a += STEP) {
        for (let b = -halfWidth + STEP / 2; b < halfWidth; b += STEP) {
          const x = (centre[0] ?? 0) + a * (u[0] ?? 0) + b * (w[0] ?? 0);
          const z = (centre[2] ?? 0) + a * (u[2] ?? 0) + b * (w[2] ?? 0);
          const value = wearAt(x, z, a, b, halfLength, halfWidth);
          sum += value;
          count++;
          if (Math.min(halfLength - Math.abs(a), halfWidth - Math.abs(b)) <= keep) {
            keptEdge = Math.max(keptEdge, value);
          }
        }
      }
      out.push({ coverage: sum / count, keptEdge, wears: true });
    }
    mesh.geometry.dispose();
  }
  return out;
}

const sources = (): { id: string; markings: readonly Marking[] }[] => [
  ...Object.values(layouts).map((l) => ({ id: l.id, markings: resolveLayout(l, null).markings })),
  ...exercises.map((e) => ({
    id: e.id,
    markings: resolveLayout(layouts[e.layout], e).markings,
  })),
];

describe('worn marking paint', () => {
  it('wears no more than the cap of any single wearing piece, dashed lines included', () => {
    for (const { id, markings } of sources()) {
      const wearing = quads(markings).filter((q) => q.wears);
      expect(wearing.length, id).toBeGreaterThan(0);
      for (const q of wearing) expect(q.coverage, id).toBeLessThanOrEqual(WEAR_CAP);
    }
  });

  it('leaves the edge of every wearing piece unworn', () => {
    for (const { id, markings } of sources()) {
      for (const q of quads(markings).filter((p) => p.wears)) expect(q.keptEdge, id).toBe(0);
    }
  });

  it('wears nothing on the symbols or on strokes that cross another', () => {
    const wearing = (markings: readonly Marking[]): boolean[] => wearableMarkings(markings);
    for (const { id, markings } of sources()) {
      const flags = wearing(markings);
      markings.forEach((m, i) => {
        if (SYMBOL_KINDS.has(m.kind)) expect(flags[i], `${id} ${m.kind}`).toBe(false);
      });
    }
    const line = (x0: number, y0: number, x1: number, y1: number): Marking => ({
      kind: 'bay',
      from: { x: x0, y: y0 },
      to: { x: x1, y: y1 },
      width: 0.12,
      dashed: false,
    });
    expect(wearing([line(0, 0, 4, 0), line(2, -1, 2, 1)])).toEqual([false, false]);
    expect(wearing([line(0, 0, 4, 0), line(4, 0, 8, 0)])).toEqual([true, true]);
    expect(wearing([line(0, 0, 4, 0), line(0, 1, 4, 1)])).toEqual([true, true]);
  });

  it('wears the bays alike, with no hint of where the target is', () => {
    const bays = resolveLayout(layouts['logistics'], null).markings.filter((m) => m.kind === 'bay');
    const coverage = quads(bays)
      .filter((q) => q.wears)
      .map((q) => q.coverage);
    expect(coverage.length).toBeGreaterThan(4);
    const mean = coverage.reduce((a, b) => a + b, 0) / coverage.length;
    expect(mean).toBeGreaterThan(0.05);
    for (const c of coverage) expect(Math.abs(c - mean)).toBeLessThan(0.1);
  });

  it('is a pure function of position and the quad', () => {
    expect(wearAt(12.3, -4.5, 0.4, 0.01, 1, 0.06)).toBe(wearAt(12.3, -4.5, 0.4, 0.01, 1, 0.06));
    expect(wearAt(12.3, -4.5, 0, 0, 0, 0)).toBe(0);
  });
});

describe('marking quads', () => {
  it('records a quad as its local position and half extents, rotated and moved or not', () => {
    const geometry = rectGeometry(-2, 2, -0.1, 0.1).rotateY(0.7).translate(5, 0.01, -3);
    addMarkBox(geometry, true);
    const box = geometry.getAttribute(MARK_BOX);
    expect(box.count).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(box.getX(i))).toBeCloseTo(2);
      expect(Math.abs(box.getY(i))).toBeCloseTo(0.1);
      expect(box.getZ(i)).toBeCloseTo(2);
      expect(box.getW(i)).toBeCloseTo(0.1);
    }
  });

  it('gives a quad that may not wear no extent, and rejects anything but one quad', () => {
    const geometry = rectGeometry(0, 1, 0, 1);
    addMarkBox(geometry, false);
    expect(geometry.getAttribute(MARK_BOX).getZ(0)).toBe(0);
    expect(() => addMarkBox(geometry.toNonIndexed(), true)).toThrow();
  });
});
