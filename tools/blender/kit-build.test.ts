import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KIT_FOOTPRINTS } from '../../src/content/kit';
import { YARD_KIT_NODES } from '../../src/render/yard-kit-dims';
import { ROOT, YARD_KIT_RUN } from './glb-build';
import { bakedPixels, KIT_BUDGET_BYTES, KIT_TEXTURES } from './kit-build';

const read_ = (file: string): Buffer => readFileSync(join(ROOT, file));
const bytes = (file: string): number => statSync(join(ROOT, file)).size;

type Gltf = {
  nodes: { name: string; mesh?: number; extras?: { bounds?: { min: number[]; max: number[] } } }[];
  meshes: {
    primitives: { attributes: Record<string, number>; indices: number; material: number }[];
  }[];
  materials: { name: string }[];
  accessors: { count: number }[];
};

const gltf = (file: string): Gltf => {
  const glb = read_(file);
  return JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as Gltf;
};

describe('yard-kit.glb', () => {
  const json = gltf('src/render/assets/yard-kit.glb');
  const primitives = json.meshes.flatMap((m) => m.primitives);

  it('holds one node per kit piece, each with its bounds for placement', () => {
    expect(json.nodes.map((n) => n.name).sort()).toEqual([...YARD_KIT_NODES].sort());
    for (const node of json.nodes) expect(node.extras?.bounds).toBeDefined();
  });

  it('matches the footprints content places it by, within a millimetre', () => {
    expect(Object.keys(KIT_FOOTPRINTS).sort()).toEqual([...YARD_KIT_NODES].sort());
    for (const node of json.nodes) {
      const bounds = node.extras?.bounds;
      const footprint = KIT_FOOTPRINTS[node.name as keyof typeof KIT_FOOTPRINTS];
      if (bounds === undefined) throw new Error(`${node.name} has no bounds`);
      const [x0, y0, , x1, y1, z1] = [...bounds.min, ...bounds.max];
      const flat = [...footprint.min, ...footprint.max, footprint.height];
      flat.forEach((value, i) => {
        expect(value, `${node.name}[${i}]`).toBeCloseTo([x0, y0, x1, y1, z1][i] ?? Number.NaN, 3);
      });
    }
  });

  it('gives every primitive atlas UVs, normals and an untextured vertex colour', () => {
    for (const p of primitives) {
      expect(Object.keys(p.attributes)).toEqual(
        expect.arrayContaining(['POSITION', 'NORMAL', 'TEXCOORD_0', 'COLOR_0']),
      );
    }
    expect(json.materials.map((m) => m.name).sort()).toEqual(['yard-atlas', 'yard-leaves']);
  });

  it('draws at most one primitive per material per node', () => {
    const cards = json.nodes.filter((n) => /^(lime|maple)-|^hedge$/.test(n.name)).length;
    expect(primitives).toHaveLength(json.nodes.length + cards);
  });
});

describe('yard kit download budget', () => {
  it('fits with its glb and every atlas', () => {
    const files = [
      'src/render/assets/yard-kit.glb',
      ...Object.values(KIT_TEXTURES).map((t) => t.ktx2),
    ];
    expect(files).toHaveLength(4);
    expect(files.reduce((sum, f) => sum + bytes(f), 0)).toBeLessThanOrEqual(KIT_BUDGET_BYTES);
  });
});

describe('baked pixels', () => {
  it('name the missing bake rather than build from nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'kit-bake-'));
    expect(() => bakedPixels(YARD_KIT_RUN, 'yard-kit-atlas-a', 1024, root)).toThrow(
      /no bake in tools\/blender\/bake/,
    );
  });
});
