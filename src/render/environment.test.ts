import {
  Color,
  DataTexture,
  DirectionalLight,
  HemisphereLight,
  Layers,
  LightProbe,
  Mesh,
  type Light,
  type Object3D,
  type Texture,
} from 'three';
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import { createMirror } from './mirror';
import { proceduralEnvironment } from './environment';
import { texturedGroundGeometry } from './ground-geometry';
import { createGroundMaterial } from './ground-material';
import { createGroundPbrMaterial } from './ground-pbr-material';
import type { TextureMaps, TextureSet } from './texture-set';
import type { PbrKey } from './ground-pbr-spec';
import { GROUND_SURFACES } from './ground-texture-spec';
import { KEYS } from './palette';
import { FOG_DENSITY, GRADE } from './grade';
import { perspectiveLight } from './light-rig';
import { QUALITY_FLAGS } from './quality';
import { REALISM_HUES } from './realism-hues';
vi.mock('./ground-pbr-material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ground-pbr-material')>();
  return { ...actual, createGroundPbrMaterial: vi.fn(actual.createGroundPbrMaterial) };
});
vi.mock('./ground-material', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ground-material')>();
  return { createGroundMaterial: vi.fn(actual.createGroundMaterial) };
});

import {
  AIDS_LAYER,
  CHASE_LAYERS,
  COCKPIT_LAYERS,
  DEFAULT_LAYER,
  enableLayers,
  PERSPECTIVE_LAYER,
  TOP_DOWN_LAYERS,
} from './seams';
import { RESTYLED_KINDS } from './yard-props';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const layout = Object.values(layouts)
  .map((l) => resolveLayout(l, null))
  .find((l) => l.obstacles.some((o) => RESTYLED_KINDS.has(o.kind)));

const camera = (ids: readonly number[]): Layers => {
  const layers = new Layers();
  layers.set(DEFAULT_LAYER);
  enableLayers(layers, ids);
  return layers;
};
const cameras = {
  cockpit: camera(COCKPIT_LAYERS),
  mirror: createMirror().camera.layers,
  topDown: camera(TOP_DOWN_LAYERS),
};

/** The meshes a camera with these layers draws. */
function seen(root: Object3D, layers: Layers): Set<Object3D> {
  const out = new Set<Object3D>();
  const walk = (o: Object3D): void => {
    if (!o.visible) return;
    if ('isMesh' in o && layers.test(o.layers)) out.add(o);
    o.children.forEach(walk);
  };
  walk(root);
  return out;
}

const only = (a: Set<Object3D>, b: Set<Object3D>): Object3D[] => [...a].filter((m) => !b.has(m));

const isMesh = (object: Object3D): object is Mesh => object instanceof Mesh;
const asMesh = (object: Object3D): Mesh => {
  if (!isMesh(object)) throw new Error('not a mesh');
  return object;
};
const materialOf = (mesh: Object3D): { polygonOffset?: boolean } =>
  asMesh(mesh).material as { polygonOffset?: boolean };
const isMarking = (mesh: Object3D): boolean => materialOf(mesh).polygonOffset === true;

describe('environment quality', () => {
  it('shows the obstacle tokens to every camera on low, in place of the hidden props', () => {
    expect(layout).toBeDefined();
    if (layout === undefined) return;
    const env = proceduralEnvironment(layout, palette);
    env.setQuality(QUALITY_FLAGS.balanced);
    const balanced = Object.fromEntries(
      Object.entries(cameras).map(([k, c]) => [k, seen(env.object, c)]),
    );

    env.setQuality(QUALITY_FLAGS.low);
    for (const view of ['cockpit', 'mirror'] as const) {
      const low = seen(env.object, cameras[view]);
      const tokens = only(low, balanced[view] ?? new Set());
      expect(tokens.length, view).toBeGreaterThan(0);
      for (const t of tokens) expect(seen(env.object, cameras.topDown).has(t)).toBe(true);
      expect(only(balanced[view] ?? new Set(), low).length, view).toBeGreaterThan(0);
    }
    expect(seen(env.object, cameras.topDown)).toEqual(balanced['topDown']);

    env.setQuality(QUALITY_FLAGS.balanced);
    for (const [view, meshes] of Object.entries(balanced)) {
      expect(seen(env.object, cameras[view as keyof typeof cameras]), view).toEqual(meshes);
    }
    env.dispose();
  });
});

describe('environment lit markings', () => {
  const build = (): ReturnType<typeof proceduralEnvironment> | null =>
    layout === undefined ? null : proceduralEnvironment(layout, palette);
  const topDown = (env: { object: Object3D }): Map<Object3D, unknown> =>
    new Map([...seen(env.object, cameras.topDown)].map((m) => [m, asMesh(m).material]));

  it('leaves the top-down meshes and materials as on low, at every preset', () => {
    const env = build();
    if (env === null) return;
    env.setQuality(QUALITY_FLAGS.low);
    const low = topDown(env);
    for (const preset of ['balanced', 'high'] as const) {
      env.setQuality(QUALITY_FLAGS[preset]);
      expect(topDown(env), preset).toEqual(low);
    }
    env.dispose();
  });

  it('swaps each marking for a lit copy in perspective only, keeping the polygon offset', () => {
    const env = build();
    if (env === null) return;
    env.setQuality({ ...QUALITY_FLAGS.balanced, litMarkings: false });
    const off = Object.fromEntries(
      Object.entries(cameras).map(([k, c]) => [k, seen(env.object, c)]),
    );
    env.setQuality(QUALITY_FLAGS.balanced);
    for (const view of ['cockpit', 'mirror'] as const) {
      const now = seen(env.object, cameras[view]);
      const gone = only(off[view] ?? new Set(), now);
      const added = only(now, off[view] ?? new Set());
      expect(gone.length, view).toBeGreaterThan(0);
      expect(added, view).toHaveLength(gone.length);
      for (const copy of added.map(asMesh)) {
        expect(isNodeMaterial(copy), view).toBe(true);
        expect(copy.material, view).toMatchObject({
          vertexColors: true,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        expect(copy.receiveShadow, view).toBe(true);
        expect(
          gone.some((t) => asMesh(t).geometry === copy.geometry),
          view,
        ).toBe(true);
      }
      for (const token of gone) expect(seen(env.object, cameras.topDown).has(token)).toBe(true);
    }
    expect(seen(env.object, cameras.topDown)).toEqual(new Set([...(off['topDown'] ?? [])]));
    env.dispose();
  });

  it('shares one material across the copies and grades it with the lighting', () => {
    const env = build();
    if (env === null) return;
    const copies = (): Mesh[] =>
      [...seen(env.object, cameras.cockpit)].filter(
        (m): m is Mesh => m instanceof Mesh && isMarking(m) && isNodeMaterial(m),
      );
    for (const [label, flags] of [
      ['high', QUALITY_FLAGS.high],
      ['balanced', QUALITY_FLAGS.balanced],
      ['low', QUALITY_FLAGS.low],
      ['high again', QUALITY_FLAGS.high],
    ] as const) {
      env.setQuality(flags);
      const shown = copies();
      expect(shown.length > 0, label).toBe(flags.litMarkings);
      expect(new Set(shown.map((m) => m.material)).size, label).toBe(flags.litMarkings ? 1 : 0);
      const material = shown[0]?.material as { outputNode: unknown } | undefined;
      if (material !== undefined) {
        expect(material.outputNode !== null, label).toBe(flags.perspectiveLighting);
      }
    }
    env.dispose();
  });

  it('frees the copy material and each shared geometry once', () => {
    const env = build();
    if (env === null) return;
    env.setQuality(QUALITY_FLAGS.high);
    const copies = [...seen(env.object, cameras.cockpit)].filter(
      (m): m is Mesh => m instanceof Mesh && isMarking(m) && isNodeMaterial(m),
    );
    expect(copies.length).toBeGreaterThan(0);
    const material = copies[0]?.material as { dispose(): void };
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const geometries = copies.map((c) => vi.spyOn(c.geometry, 'dispose'));
    env.dispose();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    for (const g of geometries) expect(g).toHaveBeenCalledOnce();
  });
});

describe('environment lit aids', () => {
  const slalom = exercises.find((e) => e.id === 'slalom');
  const aidLayout = slalom === undefined ? null : resolveLayout(layouts[slalom.layout], slalom);
  const aidPalette = { ...palette, accent: 0xff0000, marking: 0x00ff00 };
  const perspectiveViews = {
    cockpit: cameras.cockpit,
    mirror: cameras.mirror,
    chase: camera(CHASE_LAYERS),
  };
  const build = (): ReturnType<typeof proceduralEnvironment> => {
    if (aidLayout === null) throw new Error('no slalom exercise');
    return proceduralEnvironment(aidLayout, aidPalette);
  };
  const isFlat = (mesh: Object3D): boolean => isMarking(mesh) && !isNodeMaterial(mesh);
  const isGate = (mesh: Object3D): boolean =>
    isMarking(mesh) && !(asMesh(mesh).material as { vertexColors: boolean }).vertexColors;
  const frame = (waypointVisited: boolean): RenderFrame =>
    ({ topDown: 'follow', waypointVisited }) as RenderFrame;
  const on = QUALITY_FLAGS.balanced;
  const off = { ...on, litMarkings: false };

  it('shows no flat mesh to a perspective camera while lit copies are on, aids included', () => {
    const env = build();
    env.setQuality(off);
    for (const [view, c] of Object.entries(perspectiveViews)) {
      expect([...seen(env.object, c)].filter(isFlat).some(isGate), view).toBe(true);
    }
    env.setQuality(on);
    for (const [view, c] of Object.entries(perspectiveViews)) {
      expect([...seen(env.object, c)].filter(isFlat), view).toEqual([]);
    }
    env.dispose();
  });

  it('swaps every flat token one for one in each perspective view, outline, band and gate too', () => {
    const env = build();
    const plain = layout === undefined ? null : proceduralEnvironment(layout, aidPalette);
    env.setQuality(off);
    plain?.setQuality(off);
    const flat = (e: { object: Object3D }, c: Layers): Mesh[] =>
      [...seen(e.object, c)].filter(isFlat).map(asMesh);
    for (const [view, c] of Object.entries(perspectiveViews)) {
      const before = flat(env, c);
      // outline, casing, band and gate sit on top of the markings
      expect(before.length - (plain === null ? 0 : flat(plain, c).length), view).toBe(4);
      env.setQuality(on);
      const copies = [...seen(env.object, c)].filter(isMesh).filter(isMarking);
      expect(copies, view).toHaveLength(before.length);
      for (const token of before) {
        expect(
          copies.filter((m) => m.geometry === token.geometry),
          view,
        ).toHaveLength(1);
      }
      env.setQuality(off);
    }
    env.dispose();
    plain?.dispose();
  });

  it('keeps the top-down meshes and materials as on low, at every preset', () => {
    const env = build();
    const topDown = (): Map<Object3D, unknown> =>
      new Map([...seen(env.object, cameras.topDown)].map((m) => [m, asMesh(m).material]));
    env.setQuality(QUALITY_FLAGS.low);
    const low = topDown();
    for (const preset of ['balanced', 'high'] as const) {
      env.setQuality(QUALITY_FLAGS[preset]);
      expect(topDown(), preset).toEqual(low);
    }
    env.dispose();
  });

  it('colours the gate copy with its token as the gate is passed', () => {
    const env = build();
    env.setQuality(on);
    const gate = (c: Layers): Mesh => {
      const found = [...seen(env.object, c)].filter(isMesh).filter(isGate);
      expect(found).toHaveLength(1);
      return found[0] as Mesh;
    };
    const copy = gate(cameras.cockpit);
    const token = gate(cameras.topDown);
    expect(isNodeMaterial(copy)).toBe(true);
    expect(copy.receiveShadow).toBe(true);
    for (const [visited, hex] of [
      [false, 0xff0000],
      [true, 0x00ff00],
      [false, 0xff0000],
    ] as const) {
      env.update(frame(visited));
      expect((copy.material as unknown as { color: Color }).color.getHex(), String(visited)).toBe(
        hex,
      );
      expect((token.material as unknown as { color: Color }).color.getHex(), String(visited)).toBe(
        hex,
      );
    }
    env.dispose();
  });

  it('grades the gate copy with the lighting and frees it once, sharing the ring geometry', () => {
    const env = build();
    env.setQuality(on);
    const lit = [...seen(env.object, cameras.cockpit)].filter(isMesh).find(isGate);
    expect(lit).toBeDefined();
    if (lit === undefined) return;
    const material = lit.material as unknown as { outputNode: unknown; dispose(): void };
    expect(material.outputNode !== null).toBe(on.perspectiveLighting);
    env.setQuality(QUALITY_FLAGS.high);
    expect(material.outputNode !== null).toBe(true);
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const disposeGeometry = vi.spyOn(lit.geometry, 'dispose');
    env.dispose();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });
});

describe('environment quality wiring', () => {
  const lightsOf = (root: Object3D): Light[] => {
    const out: Light[] = [];
    root.traverse((o) => {
      if ('isLight' in o) out.push(o as Light);
    });
    return out;
  };
  const only = (layer: number): number => 1 << layer;

  it('keeps every light on the top-down layer or on a layer every perspective camera sees', () => {
    expect(layout).toBeDefined();
    if (layout === undefined) return;
    const env = proceduralEnvironment(layout, palette);
    const perspective = [cameras.cockpit, cameras.mirror, camera(CHASE_LAYERS)];
    for (const flags of [QUALITY_FLAGS.high, QUALITY_FLAGS.low]) {
      env.setQuality(flags);
      const lights = lightsOf(env.object);
      expect(lights.length).toBeGreaterThan(0);
      for (const l of lights) {
        const aidsOnly = l.layers.mask === only(AIDS_LAYER);
        const everywhere = perspective.every((c) => (c.mask & l.layers.mask) === l.layers.mask);
        expect(aidsOnly || everywhere).toBe(true);
      }
    }
    env.dispose();
  });

  it('follows the flags through high, balanced, low and high again', () => {
    expect(layout).toBeDefined();
    if (layout === undefined) return;
    const sky = fakeTextures();
    const env = proceduralEnvironment(layout, palette, undefined, sky.textures);
    sky.deliver();
    const lights = lightsOf(env.object);
    const [legacySun, legacyAmbient, hdriSun, probe] = lights;
    expect(legacySun).toBeInstanceOf(DirectionalLight);
    expect(legacyAmbient).toBeInstanceOf(HemisphereLight);
    expect(hdriSun).toBeInstanceOf(DirectionalLight);
    expect(probe).toBeInstanceOf(LightProbe);
    const props = [...seen(env.object, cameras.cockpit)]
      .filter((m): m is Mesh => m instanceof Mesh)
      .filter((m) => m.layers.mask === only(PERSPECTIVE_LAYER) && !isNodeMaterial(m));
    expect(props.length).toBeGreaterThan(0);
    const tokenMaterial = props[0]?.material;
    const wears = (): unknown[] => [...new Set(props.map((m) => m.material))];
    const hazeToward = (): number => GRADE.hazeToward.value.getHex();
    const sunHaze = perspectiveLight(palette).hazeToward.getHex();
    const plainHaze = new Color(REALISM_HUES.skyHaze).getHex();

    const expectGraded = (on: boolean, label: string): void => {
      for (const l of [legacySun, legacyAmbient]) {
        expect(l?.layers.mask, label).toBe(only(on ? AIDS_LAYER : DEFAULT_LAYER));
      }
      for (const l of [hdriSun, probe]) expect(l?.visible, label).toBe(on);
      if (on) {
        const [material, ...rest] = wears();
        expect(rest, label).toEqual([]);
        expect(material, label).not.toBe(tokenMaterial);
        expect(isNodeMaterial(props[0]), label).toBe(true);
      } else {
        expect(wears(), label).toEqual([tokenMaterial]);
      }
    };

    for (const [label, flags] of [
      ['high', QUALITY_FLAGS.high],
      ['balanced', QUALITY_FLAGS.balanced],
      ['low', QUALITY_FLAGS.low],
      ['high again', QUALITY_FLAGS.high],
    ] as const) {
      env.setQuality(flags);
      expectGraded(flags.perspectiveLighting, label);
      expect(GRADE.fogDensity.value, label).toBe(flags.aerialPerspective ? FOG_DENSITY : 0);
      expect(hazeToward(), label).toBe(flags.hdriSky ? sunHaze : plainHaze);
    }

    // the uniforms are shared: building and disposing another environment leaves them as they were
    const other = proceduralEnvironment(layout, palette, undefined, sky.textures);
    other.dispose();
    expect(GRADE.fogDensity.value).toBe(FOG_DENSITY);
    expect(hazeToward()).toBe(sunHaze);
    env.dispose();
  });
});

const isNodeMaterial = (mesh: Object3D | undefined): boolean =>
  mesh !== undefined &&
  'material' in mesh &&
  (mesh.material as { isNodeMaterial?: boolean }).isNodeMaterial === true;

/** Delivers the texture on demand, standing in for the KTX2 load. */
function fakeTextures() {
  const waiting = new Map<
    (maps: TextureMaps<'detail' | 'sky'>) => void,
    (() => void) | undefined
  >();
  const cancel = vi.fn();
  const applied: boolean[] = [];
  const textures: TextureSet<'detail' | 'sky'> = {
    attach: () => undefined,
    setEnabled: () => undefined,
    onLoaded(apply, revert) {
      waiting.set(apply, revert);
      return () => {
        cancel();
        waiting.delete(apply);
      };
    },
    reportApplied: (on) => applied.push(on),
    dispose: () => undefined,
  };
  return {
    textures,
    cancel,
    applied,
    deliver: () => {
      for (const apply of waiting.keys()) {
        const texture = new DataTexture(new Uint8Array(4), 1, 1);
        apply({ detail: texture, sky: texture });
      }
    },
    reject: () => {
      for (const revert of waiting.values()) revert?.();
    },
  };
}

describe('environment ground texture', () => {
  afterEach(() => vi.restoreAllMocks());
  // the markings swap separately (see 'environment lit markings'); keep them out of these set comparisons
  const ground = {
    high: { ...QUALITY_FLAGS.high, litMarkings: false },
    balanced: { ...QUALITY_FLAGS.balanced, litMarkings: false },
  };

  it('swaps the ground in perspective only, leaving top-down as it was, and reverses', () => {
    expect(layout).toBeDefined();
    if (layout === undefined) return;
    const { textures, deliver } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    const before = Object.fromEntries(
      Object.entries(cameras).map(([k, c]) => [k, seen(env.object, c)]),
    );

    env.setQuality(ground.high);
    deliver();
    const now = (k: keyof typeof cameras): Set<Object3D> => seen(env.object, cameras[k]);
    expect(now('topDown')).toEqual(before['topDown']);
    for (const view of ['cockpit', 'mirror'] as const) {
      const gone = only(before[view] ?? new Set(), now(view));
      const added = only(now(view), before[view] ?? new Set());
      expect(gone, view).toHaveLength(1);
      expect(added, view).toHaveLength(1);
      expect(now('topDown').has(gone[0] as Object3D)).toBe(true);
    }

    env.setQuality(ground.balanced);
    for (const [view, meshes] of Object.entries(before)) {
      expect(now(view as keyof typeof cameras), view).toEqual(meshes);
    }
    env.setQuality(ground.high);
    expect(now('cockpit').size).toBe(before['cockpit']?.size);
    expect(only(now('cockpit'), before['cockpit'] ?? new Set())).toHaveLength(1);
    env.dispose();
  });

  it('keeps the token ground until the texture has loaded, and below High after', () => {
    if (layout === undefined) return;
    const { textures, deliver } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    const before = seen(env.object, cameras.cockpit);
    env.setQuality(ground.high);
    expect(seen(env.object, cameras.cockpit)).toEqual(before);
    env.setQuality(ground.balanced);
    deliver();
    expect(seen(env.object, cameras.cockpit)).toEqual(before);
    env.dispose();
  });

  it('gives the ground world-space UVs and one channel per surface, none for the verge', () => {
    if (layout === undefined) return;
    const geometry = texturedGroundGeometry(layout, palette);
    const uv = geometry.getAttribute('uv');
    const select = geometry.getAttribute('groundSelect');
    const position = geometry.getAttribute('position');
    const { minX, minY } = layout.bounds;
    const tiles = Object.values(GROUND_SURFACES).map((e) => e.tile);
    const picks = new Set<string>();
    for (let i = 0; i < position.count; i++) {
      const picked = [select.getX(i), select.getY(i), select.getZ(i)];
      picks.add(picked.join());
      const channel = picked.indexOf(1);
      if (channel < 0) {
        expect(picked).toEqual([0, 0, 0]);
        continue;
      }
      const tile = tiles[channel] as number;
      expect(uv.getX(i)).toBeCloseTo((position.getX(i) - minX) / tile, 3);
      expect(uv.getY(i)).toBeCloseTo((-position.getZ(i) - minY) / tile, 3);
    }
    expect(picks.has('0,0,0')).toBe(true);
    expect(picks.size).toBeGreaterThan(1);
    geometry.dispose();
  });

  it('shades the textured ground with its own colour node over the vertex colours', () => {
    const material = createGroundMaterial(new DataTexture());
    expect(material).toBeInstanceOf(MeshLambertNodeMaterial);
    expect(material.vertexColors).toBe(true);
    expect(material.colorNode).not.toBeNull();
    material.dispose();
  });

  it('keeps the token ground and warns once when the material cannot be built', () => {
    if (layout === undefined) return;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(createGroundMaterial).mockImplementationOnce(() => {
      throw new Error('no node material');
    });
    const { textures, deliver, applied } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    const before = seen(env.object, cameras.cockpit);
    const children = env.object.children.length;
    env.setQuality(ground.high);
    deliver();
    expect(warn).toHaveBeenCalledOnce();
    expect(seen(env.object, cameras.cockpit)).toEqual(before);
    expect(env.object.children).toHaveLength(children);
    expect(applied).not.toContain(true);
    env.dispose();
  });

  it('goes back to the token ground when the GPU rejects the shader', () => {
    if (layout === undefined) return;
    const { textures, deliver, reject, applied } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    const before = seen(env.object, cameras.cockpit);
    env.setQuality(ground.high);
    deliver();
    expect(seen(env.object, cameras.cockpit)).not.toEqual(before);
    expect(applied).toEqual([true]);
    reject();
    expect(seen(env.object, cameras.cockpit)).toEqual(before);
    env.setQuality(ground.balanced);
    env.setQuality(ground.high);
    expect(seen(env.object, cameras.cockpit)).toEqual(before);
    expect(applied).toEqual([true, false]);
    env.dispose();
  });

  it('reports the swap, and its end when disposed', () => {
    if (layout === undefined) return;
    const { textures, deliver, applied } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    env.setQuality(ground.high);
    deliver();
    env.setQuality(ground.balanced);
    env.setQuality(ground.high);
    env.dispose();
    expect(applied).toEqual([true, false, true, false]);
  });

  it('unsubscribes on dispose, so a late texture adds no mesh', () => {
    if (layout === undefined) return;
    const { textures, deliver, cancel } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    const children = env.object.children.length;
    env.dispose();
    expect(cancel).toHaveBeenCalledOnce();
    deliver();
    expect(env.object.children).toHaveLength(children);
  });
});

/** Delivers the PBR ground set on demand, standing in for the six KTX2 loads. */
function fakePbrTextures() {
  const waiting = new Map<(maps: TextureMaps<PbrKey>) => void, (() => void) | undefined>();
  const applied: boolean[] = [];
  const textures: TextureSet<PbrKey> = {
    attach: () => undefined,
    setEnabled: () => undefined,
    onLoaded(apply, revert) {
      waiting.set(apply, revert);
      return () => waiting.delete(apply);
    },
    reportApplied: (on) => applied.push(on),
    dispose: () => undefined,
  };
  return {
    textures,
    applied,
    deliver: () => {
      const texture = (): Texture => new DataTexture(new Uint8Array(4), 1, 1);
      const maps: TextureMaps<PbrKey> = {
        concreteAlbedo: texture(),
        concretePacked: texture(),
        asphaltAlbedo: texture(),
        asphaltPacked: texture(),
        paversAlbedo: texture(),
        paversPacked: texture(),
      };
      for (const apply of waiting.keys()) apply(maps);
    },
    reject: () => {
      for (const revert of waiting.values()) revert?.();
    },
  };
}

describe('environment PBR ground', () => {
  afterEach(() => vi.restoreAllMocks());
  const flags = {
    pbr: { ...QUALITY_FLAGS.high, litMarkings: false },
    detail: { ...QUALITY_FLAGS.high, litMarkings: false, groundPbr: false },
  };
  const groundMaterial = (env: { object: Object3D }): unknown => {
    const meshes = env.object.children.filter(
      (o): o is Mesh => 'geometry' in o && (o as Mesh).geometry.hasAttribute('groundSelect'),
    );
    expect(meshes).toHaveLength(1);
    return meshes[0]?.material;
  };

  it('puts the PBR material on the perspective ground copy over the detail one, and takes it off below High', () => {
    if (layout === undefined) return;
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(layout, palette, detail.textures, undefined, pbr.textures);
    env.setQuality(flags.pbr);
    detail.deliver();
    expect(groundMaterial(env)).toBeInstanceOf(MeshLambertNodeMaterial);
    pbr.deliver();
    expect(groundMaterial(env)).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(pbr.applied).toEqual([true]);
    env.setQuality(flags.detail);
    expect(groundMaterial(env)).toBeInstanceOf(MeshLambertNodeMaterial);
    env.setQuality(flags.pbr);
    expect(groundMaterial(env)).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(pbr.applied).toEqual([true, false, true]);
    // the detail set is still the one reported as drawn
    expect(detail.applied).toEqual([true]);
    env.dispose();
  });

  it('wears the PBR ground whichever set loads last', () => {
    if (layout === undefined) return;
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(layout, palette, detail.textures, undefined, pbr.textures);
    env.setQuality(flags.pbr);
    pbr.deliver();
    detail.deliver();
    expect(groundMaterial(env)).toBeInstanceOf(MeshStandardNodeMaterial);
    env.dispose();
  });

  it('falls back to the detail ground when the GPU rejects the PBR shader', () => {
    if (layout === undefined) return;
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(layout, palette, detail.textures, undefined, pbr.textures);
    env.setQuality(flags.pbr);
    detail.deliver();
    pbr.deliver();
    pbr.reject();
    expect(groundMaterial(env)).toBeInstanceOf(MeshLambertNodeMaterial);
    expect(pbr.applied).toEqual([true, false]);
    env.dispose();
  });

  it('stops reporting the PBR ground when the environment is disposed while it is drawn', () => {
    if (layout === undefined) return;
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(layout, palette, detail.textures, undefined, pbr.textures);
    env.setQuality(flags.pbr);
    detail.deliver();
    pbr.deliver();
    expect(pbr.applied).toEqual([true]);
    env.dispose();
    expect(pbr.applied).toEqual([true, false]);
  });

  it('stops reporting the PBR ground when the detail copy it is drawn through is rejected', () => {
    if (layout === undefined) return;
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(layout, palette, detail.textures, undefined, pbr.textures);
    env.setQuality(flags.pbr);
    detail.deliver();
    pbr.deliver();
    detail.reject();
    expect(pbr.applied).toEqual([true, false]);
    env.dispose();
  });

  it('keeps the detail ground and warns once when the PBR material cannot be built', () => {
    if (layout === undefined) return;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(createGroundPbrMaterial).mockImplementationOnce(() => {
      throw new Error('no node material');
    });
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(layout, palette, detail.textures, undefined, pbr.textures);
    env.setQuality(flags.pbr);
    detail.deliver();
    pbr.deliver();
    expect(warn).toHaveBeenCalledOnce();
    expect(groundMaterial(env)).toBeInstanceOf(MeshLambertNodeMaterial);
    expect(pbr.applied).toEqual([]);
    env.dispose();
  });
});

describe('environment construction', () => {
  it('never reaches Object3D.add with a non-object, for every layout and exercise', () => {
    // Object3D.add() with no argument logs "object not an instance of THREE.Object3D".
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const resolved = [
        ...Object.values(layouts).map((l) => resolveLayout(l, null)),
        ...exercises.map((e) => resolveLayout(layouts[e.layout], e)),
      ];
      for (const l of resolved) proceduralEnvironment(l, palette).dispose();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
