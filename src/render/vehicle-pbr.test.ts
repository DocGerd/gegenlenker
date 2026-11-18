import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Camera,
  type Material,
  Mesh,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Object3D,
  Scene,
  ShaderLib,
  Texture,
} from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS, type TruckId } from '../contracts/vehicle';
import { trailerById, truckById } from '../vehicles/registry';
import { parseShell, type ShellKind, startShells } from './glb-shells';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { AIDS_LAYER, enableLayers, TOP_DOWN_LAYERS } from './seams';
import {
  createVehicleEnvironment,
  IBL_ANCHOR,
  SPECULAR_ANCHOR,
  ROLE_ANCHOR,
  roleShader,
  type VehicleEnvironment,
} from './vehicle-pbr';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o as Mesh);
  });
  return out;
}

const materialsOf = (root: Object3D): Map<Mesh, Material> =>
  new Map(meshes(root).map((m) => [m, m.material as Material]));

const standardOf = (root: Object3D): MeshStandardMaterial[] =>
  meshes(root)
    .map((m) => m.material)
    .filter((m): m is MeshStandardMaterial => m instanceof MeshStandardMaterial);

const topDown = new Camera();
enableLayers(topDown.layers, TOP_DOWN_LAYERS);
const seenByTopDown = (m: Mesh): boolean => m.layers.test(topDown.layers);

const environment = (texture: Texture | null): VehicleEnvironment => ({
  attach: () => undefined,
  texture: () => texture,
  dispose: () => undefined,
});

const shell = async (id: TruckId, kind: ShellKind) => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-${kind}.glb`));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return parseShell(data, kind);
};

/** A truck whose shells have loaded and attached, so the swap meets the meshes a real run has. */
async function truckWithShells(
  id: TruckId,
  env: VehicleEnvironment,
  preset: keyof typeof QUALITY_FLAGS = 'balanced',
) {
  const [cab, body] = await Promise.all([shell(id, 'cab'), shell(id, 'body')]);
  const attached = new Set<string>();
  const onAttached = (key: string, on: boolean): void => {
    if (on) attached.add(key);
    else attached.delete(key);
  };
  const shells = {
    cab: startShells({ [`${id}-cab`]: 'cab' }, { load: () => Promise.resolve(cab), onAttached }),
    body: startShells(
      { [`${id}-body`]: 'body' },
      { load: () => Promise.resolve(body), onAttached },
    ),
  };
  const visual = proceduralTruck(truckById(id), palette, shells, env);
  visual.setQuality(QUALITY_FLAGS[preset]);
  await vi.waitFor(() => {
    expect(attached.size).toBe(2);
  });
  return visual;
}

describe('role shader', () => {
  it('finds the anchors it patches in three, so an upgrade that moves them fails here', () => {
    const { fragmentShader } = ShaderLib['physical'];
    expect(fragmentShader).toContain(ROLE_ANCHOR);
    expect(fragmentShader).toContain(IBL_ANCHOR);
    expect(fragmentShader).toContain(SPECULAR_ANCHOR);
  });

  it('keeps the anchors and adds the roles and the cut of the diffuse sky light', () => {
    const shader = { fragmentShader: `${ROLE_ANCHOR}\n${IBL_ANCHOR}\n${SPECULAR_ANCHOR}` };
    roleShader(shader);
    expect(shader.fragmentShader).toContain(ROLE_ANCHOR);
    expect(shader.fragmentShader).toContain('roughnessFactor = mix(');
    expect(shader.fragmentShader).toContain('iblIrradiance = vec3(0.0);');
    expect(shader.fragmentShader).toContain('reflectedLight.directSpecular *= specularShare;');
  });
});

describe('vehicle environment', () => {
  it('has no map until a renderer is attached, and disposes without one', () => {
    const env = createVehicleEnvironment();
    expect(env.texture(palette)).toBeNull();
    expect(() => {
      env.dispose();
    }).not.toThrow();
  });
});

type Make = (env: VehicleEnvironment) => ReturnType<typeof proceduralTruck>;
const makers: readonly (readonly [string, Make])[] = [
  ['truck', (env) => proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env)],
  ['trailer', (env) => proceduralTrailer(trailerById(TRAILER_IDS[0]), palette, env)],
];

describe.each(makers)('reflective detail of the %s', (_kind, make) => {
  it.each(['low', 'balanced'] as const)('stays Lambert at %s', (preset) => {
    const visual = make(environment(new Texture()));
    const before = materialsOf(visual.object);
    visual.setQuality(QUALITY_FLAGS[preset]);
    expect(materialsOf(visual.object)).toEqual(before);
  });

  it('swaps the detail material at high and restores the very same materials after', () => {
    const visual = make(environment(new Texture()));
    const before = materialsOf(visual.object);
    visual.setQuality(QUALITY_FLAGS.high);
    const high = materialsOf(visual.object);
    const swapped = [...high].filter(([m, material]) => before.get(m) !== material);
    expect(swapped.length).toBeGreaterThan(0);
    for (const [, material] of swapped) expect(material).toBeInstanceOf(MeshStandardMaterial);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(materialsOf(visual.object)).toEqual(before);
    visual.setQuality(QUALITY_FLAGS.high);
    expect(materialsOf(visual.object)).toEqual(high);
  });

  it('never touches a mesh the top-down camera sees', () => {
    const visual = make(environment(new Texture()));
    const seen = meshes(visual.object).filter(seenByTopDown);
    expect(seen.length).toBeGreaterThan(0);
    const before = seen.map((m) => m.material);
    visual.setQuality(QUALITY_FLAGS.high);
    expect(seen.map((m) => m.material)).toEqual(before);
    for (const m of seen) expect(m.material).not.toBeInstanceOf(MeshStandardMaterial);
  });

  it('sets the map on the material and leaves scene.environment alone', () => {
    const map = new Texture();
    const scene = new Scene();
    const visual = make(environment(map));
    scene.add(visual.object);
    visual.setQuality(QUALITY_FLAGS.high);
    const standard = standardOf(visual.object);
    expect(standard.length).toBeGreaterThan(0);
    for (const material of standard) expect(material.envMap).toBe(map);
    expect(scene.environment).toBeNull();
  });

  it('keeps the Lambert look without a map', () => {
    const visual = make(environment(null));
    const before = materialsOf(visual.object);
    visual.setQuality(QUALITY_FLAGS.high);
    expect(materialsOf(visual.object)).toEqual(before);
  });

  it('disposes its own material and leaves the shared map to its owner', () => {
    const map = new Texture();
    const visual = make(environment(map));
    visual.setQuality(QUALITY_FLAGS.high);
    const [material] = standardOf(visual.object);
    const materialDisposed = vi.fn();
    material?.addEventListener('dispose', materialDisposed);
    const mapDisposed = vi.fn();
    map.addEventListener('dispose', mapDisposed);
    visual.dispose();
    expect(materialDisposed).toHaveBeenCalledOnce();
    expect(mapDisposed).not.toHaveBeenCalled();
  });
});

describe.each(TRUCK_IDS)('reflective shells of %s', (id) => {
  it('follows the preset through every toggle with the shells coming and going', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const visual = await truckWithShells(id, environment(new Texture()));
    const scene = new Scene();
    scene.add(visual.object);

    expect(standardOf(visual.object)).toHaveLength(0);
    visual.setQuality(QUALITY_FLAGS.high);
    const withShells = standardOf(visual.object).length;
    expect(withShells).toBeGreaterThan(2);
    visual.setQuality(QUALITY_FLAGS.low);
    expect(standardOf(visual.object)).toHaveLength(0);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(standardOf(visual.object)).toHaveLength(0);
    visual.setQuality(QUALITY_FLAGS.high);
    expect(standardOf(visual.object)).toHaveLength(withShells);
    expect(scene.environment).toBeNull();
    visual.dispose();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('puts a shell that loads at high straight on the reflective material', async () => {
    const visual = await truckWithShells(id, environment(new Texture()), 'high');
    expect(standardOf(visual.object).length).toBeGreaterThan(2);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(standardOf(visual.object)).toHaveLength(0);
  });

  it('keeps the reflective meshes off the top-down camera and the schematic untouched', async () => {
    const visual = await truckWithShells(id, environment(new Texture()));
    visual.setQuality(QUALITY_FLAGS.high);
    for (const m of meshes(visual.object)) {
      if (m.material instanceof MeshStandardMaterial) expect(seenByTopDown(m)).toBe(false);
      if (m.layers.mask === 1 << AIDS_LAYER) {
        expect(m.material).not.toBeInstanceOf(MeshStandardMaterial);
      }
    }
    expect(meshes(visual.object).some((m) => m.material instanceof MeshLambertMaterial)).toBe(true);
  });
});
