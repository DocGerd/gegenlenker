import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { KitDecor, KitPiece } from '../contracts/layout';
import { KIT_FOOTPRINTS, kitFootprint } from '../content/kit';
import { kitPiecesFrom, mergeKit, parseKitGlb, type KitPieces } from './yard-kit-pieces';
import { YARD_KIT_NODES } from './yard-kit-dims';
import { KIT_NORMAL_SCALE } from './yard-kit';

/** Meshopt quantisation moves positions by a couple of millimetres. */
const TOLERANCE = 5e-3;

const data = readFileSync(join(import.meta.dirname, 'assets/yard-kit.glb'));
const pieces: KitPieces = await parseKitGlb(
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
);

const decor = (
  piece: KitPiece,
  x: number,
  y: number,
  heading: number,
  depth?: number,
): KitDecor => ({
  id: piece,
  asset: 'kit',
  piece,
  footprint: kitFootprint(piece, x, y, heading, depth),
  variant: 0,
});

/** Extent of the merged geometry in the footprint's frame, and its height. */
function extent(d: KitDecor): { x: number[]; y: number[]; height: number } {
  const { footprint: f } = d;
  const [c, s] = [Math.cos(f.heading), Math.sin(f.heading)];
  const x: number[] = [];
  const y: number[] = [];
  let height = 0;
  for (const kind of ['atlas', 'leaves'] as const) {
    const position = mergeKit(pieces, [d], kind)?.getAttribute('position');
    if (position === undefined) continue;
    for (let i = 0; i < position.count; i++) {
      // three: x = x, z = -y
      const [dx, dy] = [position.getX(i) - f.cx, -position.getZ(i) - f.cy];
      x.push(c * dx + s * dy);
      y.push(-s * dx + c * dy);
      height = Math.max(height, position.getY(i));
    }
  }
  return { x, y, height };
}

describe('the yard kit glb', () => {
  it('decodes into every node, each with float geometry and bounds', () => {
    expect([...pieces.keys()].sort()).toEqual([...YARD_KIT_NODES].sort());
    for (const [name, model] of pieces) {
      expect(model.primitives.length, name).toBeGreaterThan(0);
      for (const p of model.primitives) {
        expect(p.position.length / 3, name).toBe(p.uv.length / 2);
        expect(Math.max(...p.index), name).toBeLessThan(p.position.length / 3);
      }
    }
  });

  it('refuses meshes that are not the kit', () => {
    expect(() => kitPiecesFrom([])).toThrow(/lacks/);
  });

  it.each(YARD_KIT_NODES)('puts %s on its footprint', (piece) => {
    const d = decor(piece, 12, -7, 0.7);
    const { x, y, height } = extent(d);
    const { halfLength, halfWidth } = d.footprint;
    expect(Math.max(...x)).toBeCloseTo(halfLength, 1);
    expect(Math.min(...x)).toBeCloseTo(-halfLength, 1);
    expect(Math.max(...x)).toBeLessThanOrEqual(halfLength + TOLERANCE);
    expect(Math.min(...x)).toBeGreaterThanOrEqual(-halfLength - TOLERANCE);
    expect(Math.max(...y)).toBeLessThanOrEqual(halfWidth + TOLERANCE);
    expect(Math.min(...y)).toBeGreaterThanOrEqual(-halfWidth - TOLERANCE);
    expect(height).toBeCloseTo(KIT_FOOTPRINTS[piece].height, 1);
  });

  it('stretches a roof to the depth it is placed with', () => {
    const { y } = extent(decor('hall-roof', 0, 0, 0, 10));
    expect(Math.max(...y) - Math.min(...y)).toBeCloseTo(10, 1);
  });

  it('splits a tree into atlas and leaf geometry and a bench into atlas only', () => {
    expect(mergeKit(pieces, [decor('lime-a', 0, 0, 0)], 'leaves')).not.toBeNull();
    expect(mergeKit(pieces, [decor('lime-a', 0, 0, 0)], 'atlas')).not.toBeNull();
    expect(mergeKit(pieces, [decor('bench', 0, 0, 0)], 'leaves')).toBeNull();
  });

  it('keeps unit normals and indices in range after the merge', () => {
    const geometry = mergeKit(pieces, [decor('bench', 1, 2, 2), decor('hedge', 3, 4, 1)], 'atlas');
    const normal = geometry?.getAttribute('normal');
    const index = geometry?.getIndex();
    if (geometry === null || normal === undefined || index === null || index === undefined) {
      throw new Error('no merged geometry');
    }
    for (let i = 0; i < normal.count; i++) {
      expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 3);
    }
    expect(Math.max(...index.array)).toBeLessThan(normal.count);
  });

  // three derives the bitangent along +v when a mesh has no tangents; on a wall that is world down
  // (v runs down the atlas), against atlas B's OpenGL green, so the material negates Y.
  it('runs v down a wall, which is why the normal map is flipped in Y', () => {
    for (const piece of ['hall-wall-bay', 'office-bay'] as const) {
      const faces = pieces
        .get(piece)
        ?.primitives.filter((p) => p.kind === 'atlas')
        .flatMap((p) => {
          const rows: { y: number; v: number }[] = [];
          for (let i = 0; i < p.position.length / 3; i++) {
            // the wall's own face: its normal points out of the piece's face, three -z
            if ((p.normal[i * 3 + 2] ?? 0) < -0.99) {
              rows.push({ y: p.position[i * 3 + 1] ?? 0, v: p.uv[i * 2 + 1] ?? 0 });
            }
          }
          return rows;
        });
      if (faces === undefined || faces.length < 3) throw new Error(`${piece} has no wall face`);
      const [my, mv] = [faces.reduce((a, f) => a + f.y, 0), faces.reduce((a, f) => a + f.v, 0)].map(
        (sum) => sum / faces.length,
      ) as [number, number];
      const covariance = faces.reduce((a, f) => a + (f.y - my) * (f.v - mv), 0);
      expect(covariance, piece).toBeLessThan(0);
    }
    expect(KIT_NORMAL_SCALE).toEqual([1, -1]);
  });
});
