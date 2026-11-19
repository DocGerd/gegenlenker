import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Color,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  type RenderTarget,
  Texture,
} from 'three';
import {
  LightingContextNode,
  LightingModel,
  LightsNode,
  MeshLambertNodeMaterial,
  PhysicalLightingModel,
  type WebGPURenderer,
} from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import { trailerById, truckById } from '../vehicles/registry';
import { parseShell, parseTrailerShell, type ShellKind, startShells } from './glb-shells';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { REALISM_HUES } from './realism-hues';
import { AIDS_LAYER, CAB_LAYER, SKY_LAYER } from './seams';
import {
  createVehicleEnvironment,
  replaceMaterial,
  ROLE_HUES,
  ROLE_TOLERANCE,
  type VehicleEnvironment,
  type VehicleEnvironmentState,
  VEHICLE_SHADER_MARKER,
  VehicleLightingModel,
  VehicleNodeMaterial,
  vehicleShaderCompiles,
} from './vehicle-pbr';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

afterEach(() => vi.restoreAllMocks());

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o as Mesh);
  });
  return out;
}

const materialsOf = (root: Object3D): Map<Mesh, Material> =>
  new Map(meshes(root).map((m) => [m, m.material as Material]));

const standardOf = (root: Object3D): VehicleNodeMaterial[] =>
  meshes(root)
    .map((m) => m.material)
    .filter((m): m is VehicleNodeMaterial => m instanceof VehicleNodeMaterial);

const environment = (texture: () => Texture | null): VehicleEnvironment => ({
  attach: () => undefined,
  texture,
  onChange: () => () => undefined,
  reportApplied: () => undefined,
  setSky: () => undefined,
  dispose: () => undefined,
});
const fixed = (texture: Texture | null): VehicleEnvironment => environment(() => texture);

describe('vehicle material', () => {
  it('derives the roles from the vertex colour and lights through the vehicle model', () => {
    const material = new VehicleNodeMaterial(new Texture());
    expect(material.vertexColors).toBe(false);
    for (const node of [material.colorNode, material.roughnessNode, material.metalnessNode]) {
      expect(node).not.toBeNull();
    }
    expect(material.setupLightingModel()).toBeInstanceOf(VehicleLightingModel);
    expect(material.type).toBe('VehicleNodeMaterial');
  });

  it('relies on lighting internals this three still has', () => {
    for (const method of ['start', 'indirectSpecular'] as const) {
      expect(Object.hasOwn(PhysicalLightingModel.prototype, method), method).toBe(true);
    }
    expect(Object.hasOwn(LightingModel.prototype, 'indirect')).toBe(true);
    const context = new LightingContextNode(new LightsNode()).getContext() as unknown as Record<
      string,
      unknown
    >;
    expect(context).toHaveProperty('iblIrradiance');
    expect(context['reflectedLight']).toHaveProperty('directSpecular');
    expect(context['reflectedLight']).toHaveProperty('indirectSpecular');
  });
});

describe('role hues', () => {
  const [, hi] = ROLE_TOLERANCE;
  const reach = { glass: hi / 2, metal: hi };
  const distance = (a: Color, b: Color): number => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

  it('are matched by no livery or detail hue besides glass and aluminium', () => {
    const roles = (['glass', 'metal'] as const).map((role) => ({
      role,
      hue: new Color(ROLE_HUES[role]),
    }));
    const others = Object.entries(REALISM_HUES).filter(
      ([, hex]) => hex !== ROLE_HUES.glass && hex !== ROLE_HUES.metal,
    );
    for (const [name, hex] of others) {
      for (const { role, hue } of roles) {
        expect(distance(new Color(hex), hue), `${name} vs ${role}`).toBeGreaterThanOrEqual(
          reach[role],
        );
      }
    }
  });

  it('are worn only by the cab-front glass among the procedural detail', () => {
    const glass = new Color(ROLE_HUES.glass);
    const glassVertices = (mesh: Mesh): number => {
      const colors = mesh.geometry.getAttribute('color');
      let n = 0;
      for (let i = 0; i < colors.count; i++) {
        const c = new Color(colors.getX(i), colors.getY(i), colors.getZ(i));
        if (distance(c, glass) < reach.glass) n++;
      }
      return n;
    };
    const visuals = [
      ...TRUCK_IDS.map((id) => proceduralTruck(truckById(id), palette)),
      ...TRAILER_IDS.map((id) => proceduralTrailer(trailerById(id), palette)),
    ];
    for (const visual of visuals) {
      const detail = meshes(visual.object).filter(
        (m) => m.material instanceof MeshLambertNodeMaterial && m.material.vertexColors,
      );
      expect(detail.length).toBeGreaterThan(0);
      for (const mesh of detail) {
        const onCab = mesh.layers.isEnabled(CAB_LAYER);
        if (!onCab) expect(glassVertices(mesh)).toBe(0);
      }
    }
    const cabFront = meshes(proceduralTruck(truckById(TRUCK_IDS[0]), palette).object).find((m) =>
      m.layers.isEnabled(CAB_LAYER),
    );
    expect(cabFront).toBeDefined();
    expect(glassVertices(cabFront as Mesh)).toBeGreaterThan(0);
  });
});

describe('vehicle environment', () => {
  const renderer = (lost = { value: false }): WebGPURenderer =>
    ({ getContext: () => ({ isContextLost: () => lost.value }) }) as unknown as WebGPURenderer;
  const disposed = (t: RenderTarget | undefined): unknown =>
    (t as unknown as { dispose: unknown }).dispose;
  const target = (): RenderTarget =>
    ({ texture: new Texture(), dispose: vi.fn() }) as unknown as RenderTarget;
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const setup = (
    parts: { generate?: () => RenderTarget; compiles?: () => Promise<boolean> } = {},
  ) => {
    const states: VehicleEnvironmentState[] = [];
    const generate = vi.fn(parts.generate ?? target);
    const compiles = vi.fn(parts.compiles ?? (() => Promise.resolve(true)));
    const env = createVehicleEnvironment((state) => states.push(state), { generate, compiles });
    const changes = vi.fn();
    env.onChange(changes);
    return { env, states, generate, compiles, changes };
  };
  /** The map once its check has passed. */
  const ready = async (env: VehicleEnvironment, p: ScenePalette = palette) => {
    env.texture(p);
    await settle();
    return env.texture(p);
  };

  it('has no map until a renderer is attached, and disposes without one', () => {
    const { env } = setup();
    expect(env.texture(palette)).toBeNull();
    expect(() => {
      env.dispose();
    }).not.toThrow();
  });

  it('hands out the map only once its shader check passed, and says so', async () => {
    let pass: (ok: boolean) => void = () => undefined;
    const { env, changes, compiles } = setup({
      compiles: () =>
        new Promise((resolve) => {
          pass = resolve;
        }),
    });
    env.attach(renderer());
    expect(env.texture(palette)).toBeNull();
    expect(env.texture(palette)).toBeNull();
    expect(compiles).toHaveBeenCalledOnce();
    expect(changes).not.toHaveBeenCalled();
    pass(true);
    await settle();
    expect(changes).toHaveBeenCalledOnce();
    expect(env.texture(palette)).not.toBeNull();
  });

  it('generates once per palette, reuses it, and replaces it when the palette changes', async () => {
    const made: RenderTarget[] = [];
    const { env, generate } = setup({
      generate: () => made[made.push(target()) - 1] as never,
    });
    env.attach(renderer());
    const first = await ready(env);
    expect(first).not.toBeNull();
    expect(env.texture(palette)).toBe(first);
    expect(generate).toHaveBeenCalledOnce();
    const other = { ...palette, sky: 0x123456 };
    const second = await ready(env, other);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(disposed(made[0])).toHaveBeenCalledOnce();
  });

  it('warns once, reports failure and stays plain when the map cannot be built', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { env, states, generate } = setup({
      generate: () => {
        throw new Error('no float targets');
      },
    });
    env.attach(renderer());
    expect(env.texture(palette)).toBeNull();
    expect(env.texture(palette)).toBeNull();
    expect(generate).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBe('failed');
  });

  it.each([
    ['does not compile', () => Promise.resolve(false)],
    ['check rejects', () => Promise.reject(new Error('pipeline'))],
  ])('discards the map when the shader %s', async (_, compiles) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const made = target();
    const { env, states, changes } = setup({ generate: () => made, compiles });
    env.attach(renderer());
    expect(await ready(env)).toBeNull();
    expect(disposed(made)).toHaveBeenCalledOnce();
    expect(states.at(-1)).toBe('failed');
    expect(changes).not.toHaveBeenCalled();
  });

  it('drops a check that a newer palette or renderer overtook', async () => {
    const made = [target(), target(), target()];
    let n = 0;
    const { env, generate } = setup({ generate: () => made[n++] as RenderTarget });
    env.attach(renderer());
    env.texture(palette);
    env.texture({ ...palette, sky: 0x123456 });
    env.attach(renderer());
    expect(disposed(made[0])).toHaveBeenCalledOnce();
    expect(disposed(made[1])).toHaveBeenCalledOnce();
    expect(await ready(env)).toBe(made[2]?.texture);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('reports on only while a vehicle wears the reflective material, which it puts on once ready', async () => {
    const { env, states } = setup();
    env.attach(renderer());
    const visual = proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(states.at(-1)).toBeNull();
    visual.setQuality(QUALITY_FLAGS.high);
    expect(standardOf(visual.object)).toHaveLength(0);
    await settle();
    expect(states.at(-1)).toBe('on');
    expect(standardOf(visual.object).length).toBeGreaterThan(0);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(states.at(-1)).toBeNull();
    visual.setQuality(QUALITY_FLAGS.high);
    expect(states.at(-1)).toBe('on');
    visual.dispose();
    expect(states.at(-1)).toBeNull();
  });

  it('drops the map and a failure when a new renderer replaces a lost one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const made = target();
    const { env, states, generate, changes } = setup({ generate: () => made });
    env.attach(renderer());
    await ready(env);
    expect(changes).toHaveBeenCalledOnce();
    env.attach(renderer());
    expect(disposed(made)).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toBeNull();
    env.texture(palette);
    expect(generate).toHaveBeenCalledTimes(2);

    const failing = setup({
      generate: vi
        .fn<() => RenderTarget>()
        .mockImplementationOnce(() => {
          throw new Error('lost');
        })
        .mockImplementation(target),
    });
    failing.env.attach(renderer());
    expect(failing.env.texture(palette)).toBeNull();
    failing.env.attach(renderer());
    expect(await ready(failing.env)).not.toBeNull();
  });

  it('drops a check that settled on a lost context without failing, and checks again on the next renderer', async () => {
    const lost = { value: false };
    const made = target();
    const { env, states } = setup({
      generate: () => made,
      compiles: () => {
        lost.value = true;
        return Promise.resolve(true);
      },
    });
    env.attach(renderer(lost));
    expect(await ready(env)).toBeNull();
    expect(disposed(made)).toHaveBeenCalledOnce();
    expect(states).not.toContain('failed');
    lost.value = false;
    env.attach(renderer());
    expect(await ready(env)).not.toBeNull();
  });

  it('generates nothing while the context is lost', async () => {
    const lost = { value: true };
    const { env, generate } = setup();
    env.attach(renderer(lost));
    expect(env.texture(palette)).toBeNull();
    expect(generate).not.toHaveBeenCalled();
    lost.value = false;
    expect(await ready(env)).not.toBeNull();
  });

  it('moves to a different renderer without keeping the old map', async () => {
    const made = target();
    const { env, generate } = setup({ generate: () => made });
    const first = renderer();
    env.attach(first);
    await ready(env);
    env.attach(first);
    expect(disposed(made)).not.toHaveBeenCalled();
    env.attach(renderer());
    expect(disposed(made)).toHaveBeenCalledOnce();
    env.texture(palette);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

describe('replaceMaterial', () => {
  it('skips and reports a mesh the top-down camera sees', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const from = new MeshLambertMaterial();
    const to = new MeshBasicMaterial();
    const hidden = new Mesh(undefined, from);
    hidden.layers.set(SKY_LAYER);
    const seen = new Mesh(undefined, from);
    seen.layers.set(AIDS_LAYER);
    replaceMaterial([hidden, seen], [from], to);
    expect(hidden.material).toBe(to);
    expect(seen.material).toBe(from);
    expect(warn).toHaveBeenCalledOnce();
  });
});

type Make = (env: VehicleEnvironment) => ReturnType<typeof proceduralTruck>;
const makers: readonly (readonly [string, Make])[] = [
  ['truck', (env) => proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env)],
  ['trailer', (env) => proceduralTrailer(trailerById(TRAILER_IDS[0]), palette, undefined, env)],
];

describe.each(makers)('reflective detail of the %s', (_kind, make) => {
  it('swaps the detail material at high and restores the very same materials after', () => {
    const visual = make(fixed(new Texture()));
    const before = materialsOf(visual.object);
    visual.setQuality(QUALITY_FLAGS.high);
    const high = materialsOf(visual.object);
    const swapped = [...high].filter(([m, material]) => before.get(m) !== material);
    expect(swapped.length).toBeGreaterThan(0);
    for (const [, material] of swapped) expect(material).toBeInstanceOf(VehicleNodeMaterial);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(materialsOf(visual.object)).toEqual(before);
    visual.setQuality(QUALITY_FLAGS.high);
    expect(materialsOf(visual.object)).toEqual(high);
  });

  it('never touches a mesh the top-down camera sees', () => {
    const visual = make(fixed(new Texture()));
    const seen = meshes(visual.object).filter((m) => m.layers.isEnabled(AIDS_LAYER));
    expect(seen.length).toBeGreaterThan(0);
    const before = seen.map((m) => m.material);
    visual.setQuality(QUALITY_FLAGS.high);
    expect(seen.map((m) => m.material)).toEqual(before);
  });

  it('keeps the Lambert look without a map', () => {
    const visual = make(fixed(null));
    const before = materialsOf(visual.object);
    visual.setQuality(QUALITY_FLAGS.high);
    expect(materialsOf(visual.object)).toEqual(before);
  });

  it('follows the map the environment hands out, and drops it when the environment fails', () => {
    let map: Texture | null = new Texture();
    const visual = make(environment(() => map));
    visual.setQuality(QUALITY_FLAGS.high);
    const first = map;
    map = new Texture();
    visual.setQuality(QUALITY_FLAGS.high);
    expect(standardOf(visual.object).length).toBeGreaterThan(0);
    for (const material of standardOf(visual.object)) {
      expect(material.envMap).toBe(map);
      expect(material.envMap).not.toBe(first);
    }
    const [material] = standardOf(visual.object);
    map = null;
    visual.setQuality(QUALITY_FLAGS.high);
    expect(standardOf(visual.object)).toHaveLength(0);
    expect(material?.envMap).toBeNull();
  });

  it('disposes its own material and leaves the shared map to its owner', () => {
    const map = new Texture();
    const visual = make(fixed(map));
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

const shell = (id: TruckId, kind: ShellKind) => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-${kind}.glb`));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return parseShell(data, kind);
};

/** A truck whose shells load while `preset` is applied, so the swap meets the meshes a real run has. */
async function truckWithShells(
  id: TruckId,
  env: VehicleEnvironment,
  preset: keyof typeof QUALITY_FLAGS,
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
  const procedural = materialsOf(visual.object);
  visual.setQuality(QUALITY_FLAGS[preset]);
  await vi.waitFor(() => {
    expect(attached.size).toBe(2);
  });
  return { visual, procedural };
}

describe('reflective shells', () => {
  const id = TRUCK_IDS[0];

  it('follows the preset through every toggle, detached swap-out meshes included', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { visual, procedural } = await truckWithShells(id, fixed(new Texture()), 'balanced');
    const detail = [...procedural].filter(
      ([, m]) => m instanceof MeshLambertNodeMaterial && m.vertexColors,
    );
    expect(detail.length).toBeGreaterThan(0);

    expect(standardOf(visual.object)).toHaveLength(0);
    visual.setQuality(QUALITY_FLAGS.high);
    const withShells = standardOf(visual.object).length;
    expect(withShells).toBeGreaterThan(2);
    for (const [mesh] of detail) expect(mesh.material).toBeInstanceOf(VehicleNodeMaterial);
    for (const m of meshes(visual.object)) {
      if (m.material instanceof VehicleNodeMaterial)
        expect(m.layers.isEnabled(AIDS_LAYER)).toBe(false);
    }
    visual.setQuality(QUALITY_FLAGS.low);
    expect(standardOf(visual.object)).toHaveLength(0);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(standardOf(visual.object)).toHaveLength(0);
    for (const [mesh, material] of detail) expect(mesh.material).toBe(material);
    visual.setQuality(QUALITY_FLAGS.high);
    expect(standardOf(visual.object)).toHaveLength(withShells);
    visual.dispose();
    expect(error).not.toHaveBeenCalled();
  });

  it('puts a shell that loads at high straight on the reflective material', async () => {
    const { visual } = await truckWithShells(id, fixed(new Texture()), 'high');
    expect(standardOf(visual.object).length).toBeGreaterThan(2);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(standardOf(visual.object)).toHaveLength(0);
  });
});

describe.each(TRAILER_IDS)('reflective trailer shell of %s', (id) => {
  const load = async (): Promise<Awaited<ReturnType<typeof parseTrailerShell>>> => {
    const bytes = readFileSync(
      join(import.meta.dirname, `assets/${id satisfies TrailerId}-trailer.glb`),
    );
    return parseTrailerShell(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
  };

  it('follows the preset with the shell and its bare detail swapped in and out', async () => {
    const loaded = await load();
    let attach = (): void => undefined;
    const shells = {
      setEnabled: () => undefined,
      attached: () => undefined,
      onLoaded: (_key: string, cb: (shell: typeof loaded) => void) => {
        attach = () => {
          cb(loaded);
        };
        return () => undefined;
      },
    };
    const visual = proceduralTrailer(trailerById(id), palette, shells, fixed(new Texture()));
    const detail = meshes(visual.object).filter(
      (m) => m.material instanceof MeshLambertNodeMaterial && m.material.vertexColors,
    );
    attach();
    visual.setQuality(QUALITY_FLAGS.high);
    expect(standardOf(visual.object).length).toBeGreaterThan(1);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(standardOf(visual.object)).toHaveLength(0);
    visual.setQuality(QUALITY_FLAGS.high);
    expect(detail.length).toBeGreaterThan(0);
    for (const mesh of detail) expect(mesh.material).toBeInstanceOf(VehicleNodeMaterial);
    for (const m of meshes(visual.object)) {
      if (m.material instanceof VehicleNodeMaterial)
        expect(m.layers.isEnabled(AIDS_LAYER)).toBe(false);
    }
  });
});

describe('vehicle shader check', () => {
  type Hook = NonNullable<WebGPURenderer['debug']['onShaderError']>;
  const gpu = (build: (hook: Hook | null) => Promise<string | null>) => {
    const debug: { onShaderError: Hook | null; getShaderAsync: () => Promise<object> } = {
      onShaderError: null,
      getShaderAsync: async () => ({ fragmentShader: await build(debug.onShaderError) }),
    };
    return { debug } as unknown as WebGPURenderer;
  };
  const report = (hook: Hook | null, fragment: string): void => {
    const context = {
      getShaderSource: (shader: unknown) => shader,
      getShaderInfoLog: () => 'log',
      getProgramInfoLog: () => 'log',
    } as unknown as WebGL2RenderingContext;
    hook?.(...([context, {}, 'vertex', fragment] as unknown as Parameters<Hook>));
  };
  const built = `float ${VEHICLE_SHADER_MARKER};`;

  it('passes a shader that built with the marker, and restores the hook', async () => {
    const g = gpu(() => Promise.resolve(built));
    expect(await vehicleShaderCompiles(g, new Texture())).toBe(true);
    expect(g.debug.onShaderError).toBeNull();
  });

  it.each([
    ['three swapped in a plain material', () => Promise.resolve('void main() {}')],
    [
      'its GLSL fails',
      (hook: Hook | null) => {
        report(hook, built);
        return Promise.resolve(built);
      },
    ],
    ['the build rejects', () => Promise.reject(new Error('pipeline'))],
  ])('fails when %s', async (_, build) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const g = gpu(build);
    expect(await vehicleShaderCompiles(g, new Texture())).toBe(false);
    expect(warn).toHaveBeenCalled();
    expect(g.debug.onShaderError).toBeNull();
  });
});
