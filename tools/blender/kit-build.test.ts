import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { KHR_DF_TRANSFER_SRGB, read } from 'ktx-parse';
import { describe, expect, it } from 'vitest';
import { cockpitBakeParams } from '../../src/render/cockpit-bake-dims';
import { createCockpitInterior, dashEdge } from '../../src/render/cockpit-interior';
import { YARD_KIT_NODES } from '../../src/render/yard-kit-dims';
import { ROOT, runHashes } from './glb-build';
import {
  encoderVersion,
  KIT_BUDGETS,
  KIT_TEXTURES,
  KTX2_ENCODINGS,
  ktx2Sha256,
  KV_INPUTS,
  textureInputsSha256,
  type TextureManifest,
} from './kit-build';

const read_ = (file: string): Buffer => readFileSync(join(ROOT, file));
const bytes = (file: string): number => statSync(join(ROOT, file)).size;

/** Red means a stale bake: rerun the Blender script, `pnpm kit:atlas <run> <dir>` and, for the glb, `pnpm glb:optimise` and `pnpm glb:manifest`. */
describe.each(KIT_TEXTURES)('kit texture: $key', (texture) => {
  const manifest = JSON.parse(read_(texture.manifest).toString('utf8')) as TextureManifest;
  const container = read(new Uint8Array(read_(texture.ktx2)));

  it('records the current bake inputs and the committed ktx2', () => {
    expect({
      ...runHashes(texture.run),
      inputsSha256: textureInputsSha256(texture),
      encoderVersion: encoderVersion(),
      ktx2Sha256: ktx2Sha256(texture),
      ktx2Bytes: bytes(texture.ktx2),
    }).toEqual({
      scriptSha256: manifest.scriptSha256,
      commonSha256: manifest.commonSha256,
      kitCommonSha256: manifest.kitCommonSha256,
      paramsSha256: manifest.paramsSha256,
      inputsSha256: manifest.inputsSha256,
      encoderVersion: manifest.encoderVersion,
      ktx2Sha256: manifest.ktx2Sha256,
      ktx2Bytes: manifest.ktx2Bytes,
    });
  });

  it('was encoded from the current inputs', () => {
    const recorded = container.keyValue[KV_INPUTS] as Uint8Array;
    expect(new TextDecoder().decode(recorded).replace(/\0$/, '')).toBe(
      textureInputsSha256(texture),
    );
  });

  it('has the atlas size, a full mip chain and the encoding transfer function', () => {
    const srgb = KTX2_ENCODINGS[texture.encoding].isSetKTX2SRGBTransferFunc;
    expect(container.pixelWidth).toBe(texture.size);
    expect(container.pixelHeight).toBe(texture.size);
    expect(container.levelCount).toBe(Math.log2(texture.size) + 1);
    expect(container.dataFormatDescriptor[0]?.transferFunction === KHR_DF_TRANSFER_SRGB).toBe(srgb);
  });
});

type Gltf = {
  nodes: { name: string; mesh?: number; extras?: { bounds?: unknown } }[];
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

describe('kit download budgets', () => {
  it.each(Object.entries(KIT_BUDGETS))('%s fits its budget', (run, budget) => {
    const files = KIT_TEXTURES.filter((t) => t.run.key === run).map((t) => t.ktx2);
    if (run === 'yard-kit') files.push('src/render/assets/yard-kit.glb');
    expect(files.length).toBeGreaterThan(0);
    expect(files.reduce((sum, f) => sum + bytes(f), 0)).toBeLessThanOrEqual(budget);
  });
});

describe('cockpit bake params', () => {
  const params = cockpitBakeParams();
  const interior = createCockpitInterior();
  const points = (name: string): (readonly [number, number])[] => {
    const mesh = interior.meshes.find((m) => m.name === name);
    if (mesh === undefined) throw new Error(`no ${name} mesh`);
    const position = mesh.geometry.getAttribute('position');
    return Array.from(
      { length: position.count },
      (_, i) => [position.getX(i), position.getY(i)] as const,
    );
  };
  const has = (list: readonly (readonly [number, number])[], x: number, y: number): boolean =>
    list.some(([px, py]) => Math.abs(px - x) < 1e-6 && Math.abs(py - y) < 1e-6);

  it('duplicates the pillar bleed and lean of cockpit-interior.ts', () => {
    const pillar = points('pillar-right');
    expect(has(pillar, 0.5, -params.bleed)).toBe(true);
    expect(has(pillar, 0.5 - params.pillar.lean, params.bleed)).toBe(true);
  });

  it('duplicates the visor and the dash lip of cockpit-interior.ts', () => {
    const frame = points('frame');
    const { left, right, bottom, lip } = params.visor;
    expect(has(frame, left, bottom) && has(frame, right, bottom)).toBe(true);
    expect(has(frame, left, bottom + lip)).toBe(true);
    expect(has(frame, -params.bleed, dashEdge(-params.bleed) - params.dash.lip)).toBe(true);
  });

  it('renders every atlas region inside the bake overscan', () => {
    const edge = (x: number, anchor: 'dash' | 'header'): number =>
      (anchor === 'dash' ? params.dash : params.header).centre +
      (anchor === 'dash' ? params.dash : params.header).curve * x * x;
    for (const region of Object.values(params.atlas.regions)) {
      if (region.kind !== 'edge') continue;
      for (const x of [...region.x, 0].map((v) => v / params.aspect)) {
        for (const y of region.y) {
          const ndc = region.anchor === 'dash' ? edge(x, 'dash') - y : edge(x, 'header') + y;
          expect(Math.abs(ndc)).toBeLessThan(params.overscan);
          expect(Math.abs(x)).toBeLessThan(params.overscan);
        }
      }
    }
  });
});
