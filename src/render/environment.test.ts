import {
  BackSide,
  Color,
  DataTexture,
  DirectionalLight,
  HemisphereLight,
  Layers,
  LightProbe,
  Mesh,
  type Light,
  type Material,
  type Object3D,
  type Texture,
} from 'three';
import {
  type MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  UniformNode,
} from 'three/webgpu';
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
import { NIGHT_AMBIENT, perspectiveLight } from './light-rig';
import { nightDomeGround, skyColours } from './scene-sky';
import { MARK_BOX } from './marking-wear';
import { lookFor, TOP_DOWN_NIGHT_LIGHT } from './look';
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
import { RetroNodeMaterial, type RetroCheck, type RetroVerdict } from './retro';

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
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    const balanced = Object.fromEntries(
      Object.entries(cameras).map(([k, c]) => [k, seen(env.object, c)]),
    );

    env.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    for (const view of ['cockpit', 'mirror'] as const) {
      const low = seen(env.object, cameras[view]);
      const tokens = only(low, balanced[view] ?? new Set());
      expect(tokens.length, view).toBeGreaterThan(0);
      for (const t of tokens) expect(seen(env.object, cameras.topDown).has(t)).toBe(true);
      expect(only(balanced[view] ?? new Set(), low).length, view).toBeGreaterThan(0);
    }
    expect(seen(env.object, cameras.topDown)).toEqual(balanced['topDown']);

    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    for (const [view, meshes] of Object.entries(balanced)) {
      expect(seen(env.object, cameras[view as keyof typeof cameras]), view).toEqual(meshes);
    }
    env.dispose();
  });
});

describe('environment night twins', () => {
  it('draws the lit tokens top-down only as twins at night and leaves them to the perspective views as by day, on every preset', () => {
    if (layout === undefined) return;
    const env = proceduralEnvironment(layout, palette);
    const lit = (e: { object: Object3D }, view: Layers): Mesh[] =>
      [...seen(e.object, view)].filter((m) => !isNodeMaterial(m) && !isMarking(m)).map(asMesh);
    for (const preset of ['low', 'balanced', 'high'] as const) {
      env.setLook(lookFor(QUALITY_FLAGS[preset], 'day'));
      const tokens = lit(env, cameras.topDown);
      expect(tokens.length, preset).toBeGreaterThan(0);
      const perspective = (view: Layers): boolean[] =>
        tokens.map((t) => seen(env.object, view).has(t));
      const byDay = [cameras.cockpit, cameras.mirror].map(perspective);

      env.setLook(lookFor(QUALITY_FLAGS[preset], 'night'));
      const night = lit(env, cameras.topDown);
      expect(night.length, preset).toBe(tokens.length);
      for (const t of tokens) expect(night.includes(t), preset).toBe(false);
      for (const twin of night) {
        expect(twin.layers.mask, preset).toBe(1 << AIDS_LAYER);
        expect(twin.castShadow, preset).toBe(false);
        for (const view of [cameras.cockpit, cameras.mirror]) {
          expect(seen(env.object, view).has(twin), preset).toBe(false);
        }
      }
      expect([cameras.cockpit, cameras.mirror].map(perspective), preset).toEqual(byDay);
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
    env.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    const low = topDown(env);
    for (const preset of ['balanced', 'high'] as const) {
      env.setLook(lookFor(QUALITY_FLAGS[preset], 'day'));
      expect(topDown(env), preset).toEqual(low);
    }
    env.dispose();
  });

  it('swaps each marking for a lit copy in perspective only, keeping the polygon offset', () => {
    const env = build();
    if (env === null) return;
    env.setLook(lookFor({ ...QUALITY_FLAGS.balanced, litMarkings: false }, 'day'));
    const off = Object.fromEntries(
      Object.entries(cameras).map(([k, c]) => [k, seen(env.object, c)]),
    );
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
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
      env.setLook(lookFor(flags, 'day'));
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
    env.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
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
  const aidPalette = { ...palette, accent: 0xff0000, marking: 0x00ff00, wheel: 0x101010 };
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
  const isGate = (mesh: Object3D): boolean => {
    const material = asMesh(mesh).material as unknown as { vertexColors: boolean; color: Color };
    return (
      isMarking(mesh) && !material.vertexColors && material.color.getHex() !== aidPalette.wheel
    );
  };
  const frame = (waypointVisited: boolean): RenderFrame =>
    ({ topDown: 'follow', waypointVisited }) as RenderFrame;
  const on = QUALITY_FLAGS.balanced;
  const off = { ...on, litMarkings: false };

  it('shows no flat mesh to a perspective camera while lit copies are on, aids included', () => {
    const env = build();
    env.setLook(lookFor(off, 'day'));
    for (const [view, c] of Object.entries(perspectiveViews)) {
      expect([...seen(env.object, c)].filter(isFlat).some(isGate), view).toBe(true);
    }
    env.setLook(lookFor(on, 'day'));
    for (const [view, c] of Object.entries(perspectiveViews)) {
      expect([...seen(env.object, c)].filter(isFlat), view).toEqual([]);
    }
    env.dispose();
  });

  it('swaps every flat token one for one in each perspective view, outline, band and gate too', () => {
    const env = build();
    const plain = layout === undefined ? null : proceduralEnvironment(layout, aidPalette);
    env.setLook(lookFor(off, 'day'));
    plain?.setLook(lookFor(off, 'day'));
    const flat = (e: { object: Object3D }, c: Layers): Mesh[] =>
      [...seen(e.object, c)].filter(isFlat).map(asMesh);
    for (const [view, c] of Object.entries(perspectiveViews)) {
      const before = flat(env, c);
      // outline, casing, band and gate sit on top of the markings
      expect(before.length - (plain === null ? 0 : flat(plain, c).length), view).toBe(4);
      env.setLook(lookFor(on, 'day'));
      const copies = [...seen(env.object, c)].filter(isMesh).filter(isMarking);
      expect(copies, view).toHaveLength(before.length);
      for (const token of before) {
        expect(
          copies.filter((m) => m.geometry === token.geometry),
          view,
        ).toHaveLength(1);
      }
      env.setLook(lookFor(off, 'day'));
    }
    env.dispose();
    plain?.dispose();
  });

  it('keeps the top-down meshes and materials as on low, at every preset', () => {
    const env = build();
    const topDown = (): Map<Object3D, unknown> =>
      new Map([...seen(env.object, cameras.topDown)].map((m) => [m, asMesh(m).material]));
    env.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    const low = topDown();
    for (const preset of ['balanced', 'high'] as const) {
      env.setLook(lookFor(QUALITY_FLAGS[preset], 'day'));
      expect(topDown(), preset).toEqual(low);
    }
    env.dispose();
  });

  it('colours the gate copy with its token as the gate is passed', () => {
    const env = build();
    env.setLook(lookFor(on, 'day'));
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
      env.update(frame(visited), { x: 0, y: 0, radius: 10 });
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
    env.setLook(lookFor(on, 'day'));
    const lit = [...seen(env.object, cameras.cockpit)].filter(isMesh).find(isGate);
    expect(lit).toBeDefined();
    if (lit === undefined) return;
    const material = lit.material as unknown as { outputNode: unknown; dispose(): void };
    expect(material.outputNode !== null).toBe(on.perspectiveLighting);
    env.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    expect(material.outputNode !== null).toBe(true);
    const disposeMaterial = vi.spyOn(material, 'dispose');
    const disposeGeometry = vi.spyOn(lit.geometry, 'dispose');
    env.dispose();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });
});

describe('environment at night', () => {
  const slalom = exercises.find((e) => e.id === 'slalom');
  const nightLayout = slalom === undefined ? null : resolveLayout(layouts[slalom.layout], slalom);
  const build = (): ReturnType<typeof proceduralEnvironment> => {
    if (nightLayout === null) throw new Error('no slalom exercise');
    return proceduralEnvironment(nightLayout, palette);
  };
  const views = [cameras.cockpit, cameras.mirror, camera(CHASE_LAYERS)];
  const flatMeshes = (env: { object: Object3D }, c: Layers): Mesh[] =>
    [...seen(env.object, c)].filter(isMesh).filter((m) => isMarking(m) && !isNodeMaterial(m));
  const litMeshes = (env: { object: Object3D }, c: Layers): Mesh[] =>
    [...seen(env.object, c)].filter(isMesh).filter((m) => isMarking(m) && isNodeMaterial(m));
  const mask = (layer: number): number => 1 << layer;

  it('lets no flat token reach a perspective camera on low, the unlit aids on their own layer aside', () => {
    const env = build();
    env.setLook(lookFor(QUALITY_FLAGS.low, 'night'));
    for (const c of views) {
      const flat = flatMeshes(env, c);
      // target outline, casing, band and the gate
      expect(flat).toHaveLength(4);
      for (const m of flat) expect(m.layers.mask).toBe(mask(PERSPECTIVE_LAYER));
    }
    env.dispose();
  });

  it('swaps every marking and aid for one copy on low as on balanced by day', () => {
    const env = build();
    const copies = (): string[] =>
      [...litMeshes(env, cameras.cockpit), ...flatMeshes(env, cameras.cockpit)]
        .map((m) => m.geometry.uuid)
        .sort();
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    const day = copies();
    env.setLook(lookFor(QUALITY_FLAGS.low, 'night'));
    expect(litMeshes(env, cameras.cockpit).length).toBeGreaterThan(0);
    expect(copies()).toEqual(day);
    env.dispose();
  });

  it('gives the aids their unlit tokens at night and the lit copies back by day', () => {
    const env = build();
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    const before = new Set(flatMeshes(env, cameras.cockpit));
    expect(before.size).toBe(0);
    const lit = litMeshes(env, cameras.cockpit).map((m) => m.material);
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'night'));
    expect(flatMeshes(env, cameras.cockpit)).toHaveLength(4);
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    expect(flatMeshes(env, cameras.cockpit)).toHaveLength(0);
    expect(litMeshes(env, cameras.cockpit).map((m) => m.material)).toEqual(lit);
    env.dispose();
  });

  describe('top-down strokes', () => {
    const strokePalette = {
      ...palette,
      accent: 0xff0000,
      nightAccent: 0x00ffff,
      marking: 0x00ff00,
      wheel: 0x101010,
    };
    const buildStroked = (): ReturnType<typeof proceduralEnvironment> => {
      if (nightLayout === null) throw new Error('no slalom exercise');
      return proceduralEnvironment(nightLayout, strokePalette);
    };
    const topDown = (env: { object: Object3D }): Map<Object3D, unknown> =>
      new Map([...seen(env.object, cameras.topDown)].map((m) => [m, asMesh(m).material]));
    const colour = (m: Object3D): number =>
      (asMesh(m).material as unknown as { color: Color }).color.getHex();

    /** What a mesh draws: its material and geometry content, so a twin of a token matches it. */
    const signature = (m: Object3D): string => {
      const mesh = asMesh(m);
      const sum = (name: string): number => {
        const attribute = mesh.geometry.attributes[name];
        return attribute === undefined ? 0 : Array.from(attribute.array).reduce((a, b) => a + b, 0);
      };
      const positions = mesh.geometry.getAttribute('position').count;
      return [(mesh.material as Material).id, positions, sum('position'), sum('color')].join(':');
    };
    const drawn = (env: { object: Object3D }): string[] =>
      [...seen(env.object, cameras.topDown)].map(signature).sort();
    const without = (from: readonly string[], other: readonly string[]): string[] => {
      const rest = [...other];
      return from.filter((s) => {
        const i = rest.indexOf(s);
        if (i >= 0) rest.splice(i, 1);
        return i < 0;
      });
    };

    it('keeps the top-down grounds, obstacles and markings as by day and swaps only the accent strokes', () => {
      const env = buildStroked();
      env.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
      const day = drawn(env);
      const dayMeshes = topDown(env);
      for (const preset of ['low', 'balanced', 'high'] as const) {
        env.setLook(lookFor(QUALITY_FLAGS[preset], 'night'));
        const night = drawn(env);
        // the outline, the band core, its whole-yard copy and the gate give way; their casings stay
        const gone = without(day, night);
        const added = [...seen(env.object, cameras.topDown)]
          .filter((m) => without([signature(m)], day).length > 0)
          .map(colour);
        expect(gone, preset).toHaveLength(4);
        expect(added, preset).toEqual([0x00ffff, 0x00ffff, 0x00ffff, 0x00ffff]);
        expect(night.length, preset).toBe(day.length);
      }
      env.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
      expect(topDown(env)).toEqual(dayMeshes);
      env.dispose();
    });

    it('draws the outline and gate casings by day and night, to the top-down camera only', () => {
      const env = buildStroked();
      for (const look of ['day', 'night'] as const) {
        env.setLook(lookFor(QUALITY_FLAGS.balanced, look));
        const casings = [...seen(env.object, cameras.topDown)].filter(
          (m) => colour(m) === strokePalette.wheel,
        );
        // the outline and the gate; the band's casings take vertex colours
        expect(casings, look).toHaveLength(2);
        for (const view of views) {
          expect(
            [...seen(env.object, view)].map(colour),
            `${look} view ${views.indexOf(view)}`,
          ).not.toContain(strokePalette.wheel);
        }
      }
      env.dispose();
    });

    it('draws the night strokes to the top-down camera only', () => {
      const env = buildStroked();
      env.setLook(lookFor(QUALITY_FLAGS.balanced, 'night'));
      const topOnly = only(seen(env.object, cameras.topDown), seen(env.object, cameras.cockpit));
      expect(topOnly.map(colour)).toContain(0x00ffff);
      for (const view of views) {
        expect([...seen(env.object, view)].map((m) => colour(m))).not.toContain(0x00ffff);
      }
      env.dispose();
    });

    it('turns the night gate to the marking colour once it is passed', () => {
      const env = buildStroked();
      env.setLook(lookFor(QUALITY_FLAGS.low, 'night'));
      const colours = (): number[] => [...seen(env.object, cameras.topDown)].map(colour);
      expect(colours()).not.toContain(strokePalette.marking);
      env.update({ topDown: 'follow', waypointVisited: true } as RenderFrame, {
        x: 0,
        y: 0,
        radius: 10,
      });
      expect(colours().filter((c) => c === strokePalette.marking)).toHaveLength(1);
      env.dispose();
    });

    it('scales the legacy lights to the night share and back', () => {
      const env = buildStroked();
      const lights: Light[] = [];
      env.object.traverse((o) => {
        if (o instanceof DirectionalLight || o instanceof HemisphereLight) lights.push(o);
      });
      const [legacySun, legacyAmbient] = lights;
      env.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
      const day = [legacySun?.intensity, legacyAmbient?.intensity];
      env.setLook(lookFor(QUALITY_FLAGS.high, 'night'));
      expect([legacySun?.intensity, legacyAmbient?.intensity]).toEqual(
        day.map((i) => (i ?? 0) * TOP_DOWN_NIGHT_LIGHT),
      );
      env.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
      expect([legacySun?.intensity, legacyAmbient?.intensity]).toEqual(day);
      env.dispose();
    });
  });

  it('lights the perspective views from a dim tinted probe alone, with no shadow, at every preset', () => {
    const env = build();
    const lights: Light[] = [];
    env.object.traverse((o) => {
      if ('isLight' in o) lights.push(o as Light);
    });
    const [legacySun, legacyAmbient, sun, probe] = lights;
    for (const preset of ['low', 'balanced', 'high'] as const) {
      env.setLook(lookFor(QUALITY_FLAGS[preset], 'night'));
      for (const l of [legacySun, legacyAmbient]) expect(l?.layers.mask).toBe(mask(AIDS_LAYER));
      for (const l of [sun, probe]) {
        expect(l?.layers.mask, preset).toBe(mask(PERSPECTIVE_LAYER));
        expect(l?.visible, preset).toBe(true);
      }
      expect(sun?.intensity, preset).toBe(0);
      expect(sun?.castShadow, preset).toBe(false);
      expect(probe?.intensity, preset).toBe(NIGHT_AMBIENT);
    }
    env.dispose();
  });

  it('draws the dome, the ground below it and the skyline haze from the night colours, and the day ones back', () => {
    const env = build();
    const colours = (root: Node): Set<number> => {
      const found = new Set<number>();
      const walk = (n: Node): void => {
        if (n instanceof UniformNode && n.value instanceof Color) found.add(n.value.getHex());
        for (const child of n.getChildren()) walk(child);
      };
      walk(root);
      return found;
    };
    const parts = (): { sky: Set<number>; skyline: Set<number> } => {
      const out = { sky: new Set<number>(), skyline: new Set<number>() };
      env.object.traverse((o) => {
        if (!isMesh(o)) return;
        const m = o.material as MeshBasicNodeMaterial & MeshLambertNodeMaterial;
        if (m.side === BackSide && m.colorNode !== null) out.sky = colours(m.colorNode);
        if ('haze' in o.geometry.attributes && m.outputNode !== null) {
          out.skyline = colours(m.outputNode);
        }
      });
      return out;
    };
    const hex = (c: Color): number => c.getHex();
    const night = skyColours(palette, 'night');
    const day = skyColours(palette, 'day');
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'night'));
    let now = parts();
    for (const c of [
      night.horizon,
      night.zenith,
      night.haze,
      night.halo,
      nightDomeGround(palette),
    ]) {
      expect(now.sky.has(hex(c)), `night dome ${hex(c).toString(16)}`).toBe(true);
    }
    expect(now.skyline.has(hex(night.haze))).toBe(true);
    for (const c of [day.haze, day.halo]) expect(now.sky.has(hex(c))).toBe(false);
    expect(now.skyline.has(hex(day.haze))).toBe(false);
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    now = parts();
    for (const c of [day.horizon, day.haze, day.halo]) {
      expect(now.sky.has(hex(c)), `day dome ${hex(c).toString(16)}`).toBe(true);
    }
    expect(now.sky.has(hex(night.horizon))).toBe(false);
    expect(now.skyline.has(hex(day.haze))).toBe(true);
    env.dispose();
  });

  it('fades the haze to the night horizon whether or not the HDRI is attached', () => {
    const sky = fakeTextures();
    if (nightLayout === null) throw new Error('no slalom exercise');
    const env = proceduralEnvironment(nightLayout, palette, undefined, sky.textures);
    const night = new Color(REALISM_HUES.nightHorizon).getHex();
    for (const deliver of [false, true]) {
      if (deliver) sky.deliver();
      env.setLook(lookFor(QUALITY_FLAGS.high, 'night'));
      expect(GRADE.hazeToward.value.getHex(), String(deliver)).toBe(night);
      expect(GRADE.hazeAway.value.getHex(), String(deliver)).toBe(night);
      expect(GRADE.skyHdri.value).toBe(0);
    }
    env.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    expect(GRADE.hazeToward.value.getHex()).toBe(perspectiveLight(palette).hazeToward.getHex());
    expect(GRADE.skyHdri.value).toBe(1);
    env.dispose();
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
      env.setLook(lookFor(flags, 'day'));
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

  it('lets no light the top-down camera sees cast, at any flags', () => {
    expect(layout).toBeDefined();
    if (layout === undefined) return;
    const env = proceduralEnvironment(layout, palette);
    for (const flags of Object.values(QUALITY_FLAGS)) {
      env.setLook(lookFor(flags, 'day'));
      for (const l of lightsOf(env.object)) {
        if (cameras.topDown.test(l.layers)) expect(l.castShadow).toBe(false);
      }
    }
    env.dispose();
  });

  it('lets the props cast and every lit ground and marking copy receive, never the sky or the skyline', () => {
    expect(layout).toBeDefined();
    if (layout === undefined) return;
    const env = proceduralEnvironment(layout, palette);
    env.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    const all: Mesh[] = [];
    env.object.traverse((o) => {
      if (isMesh(o)) all.push(o);
    });
    const casters = all.filter((m) => m.castShadow);
    expect(casters.length).toBeGreaterThan(0);
    for (const m of casters) {
      expect((m.material as { vertexColors?: boolean }).vertexColors, 'casts only solids').toBe(
        true,
      );
      expect(isMarking(m), 'no marking casts').toBe(false);
      expect(m.receiveShadow).toBe(true);
    }
    const markings = all.filter(isMarking);
    expect(markings.length).toBeGreaterThan(0);
    for (const m of markings.filter(isNodeMaterial)) expect(m.receiveShadow).toBe(true);
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

    const expectSplit = (on: boolean, label: string): void => {
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

    // night splits the lights on a preset that does not grade: the props are lit, and still plain
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'night'));
    expectSplit(true, 'balanced night');
    expect((wears()[0] as { outputNode: unknown }).outputNode, 'balanced night').toBeNull();
    expect(hdriSun?.castShadow, 'balanced night').toBe(false);
    expect(GRADE.fogDensity.value, 'balanced night').toBe(0);

    for (const [label, flags] of [
      ['high', QUALITY_FLAGS.high],
      ['balanced', QUALITY_FLAGS.balanced],
      ['low', QUALITY_FLAGS.low],
      ['high again', QUALITY_FLAGS.high],
    ] as const) {
      env.setLook(lookFor(flags, 'day'));
      expectSplit(flags.perspectiveLighting, label);
      expect(hdriSun?.castShadow, label).toBe(flags.sunShadow);
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

    env.setLook(lookFor(ground.high, 'day'));
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

    env.setLook(lookFor(ground.balanced, 'day'));
    for (const [view, meshes] of Object.entries(before)) {
      expect(now(view as keyof typeof cameras), view).toEqual(meshes);
    }
    env.setLook(lookFor(ground.high, 'day'));
    expect(now('cockpit').size).toBe(before['cockpit']?.size);
    expect(only(now('cockpit'), before['cockpit'] ?? new Set())).toHaveLength(1);
    env.dispose();
  });

  it('keeps the token ground until the texture has loaded, and below High after', () => {
    if (layout === undefined) return;
    const { textures, deliver } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    const before = seen(env.object, cameras.cockpit);
    env.setLook(lookFor(ground.high, 'day'));
    expect(seen(env.object, cameras.cockpit)).toEqual(before);
    env.setLook(lookFor(ground.balanced, 'day'));
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
    env.setLook(lookFor(ground.high, 'day'));
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
    env.setLook(lookFor(ground.high, 'day'));
    deliver();
    expect(seen(env.object, cameras.cockpit)).not.toEqual(before);
    expect(applied).toEqual([true]);
    reject();
    expect(seen(env.object, cameras.cockpit)).toEqual(before);
    env.setLook(lookFor(ground.balanced, 'day'));
    env.setLook(lookFor(ground.high, 'day'));
    expect(seen(env.object, cameras.cockpit)).toEqual(before);
    expect(applied).toEqual([true, false]);
    env.dispose();
  });

  it('reports the swap, and its end when disposed', () => {
    if (layout === undefined) return;
    const { textures, deliver, applied } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    env.setLook(lookFor(ground.high, 'day'));
    deliver();
    env.setLook(lookFor(ground.balanced, 'day'));
    env.setLook(lookFor(ground.high, 'day'));
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
  const groundMesh = (env: { object: Object3D }): Mesh => {
    const meshes = env.object.children.filter(
      (o): o is Mesh => 'geometry' in o && (o as Mesh).geometry.hasAttribute('groundSelect'),
    );
    expect(meshes).toHaveLength(1);
    return meshes[0] as Mesh;
  };
  const groundMaterial = (env: { object: Object3D }): unknown => groundMesh(env).material;

  it('puts the PBR material on the perspective ground copy over the detail one, and takes it off below High', () => {
    if (layout === undefined) return;
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(layout, palette, detail.textures, undefined, pbr.textures);
    env.setLook(lookFor(flags.pbr, 'day'));
    detail.deliver();
    expect(groundMaterial(env)).toBeInstanceOf(MeshLambertNodeMaterial);
    pbr.deliver();
    expect(groundMaterial(env)).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(pbr.applied).toEqual([true]);
    env.setLook(lookFor(flags.detail, 'day'));
    expect(groundMaterial(env)).toBeInstanceOf(MeshLambertNodeMaterial);
    env.setLook(lookFor(flags.pbr, 'day'));
    expect(groundMaterial(env)).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(pbr.applied).toEqual([true, false, true]);
    // the detail set is still the one reported as drawn
    expect(detail.applied).toEqual([true]);
    env.dispose();
  });

  it('lets the detail and the PBR ground copies receive shadows', () => {
    if (layout === undefined) return;
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(layout, palette, detail.textures, undefined, pbr.textures);
    env.setLook(lookFor(flags.pbr, 'day'));
    detail.deliver();
    expect(groundMesh(env).material).toBeInstanceOf(MeshLambertNodeMaterial);
    expect(groundMesh(env).receiveShadow).toBe(true);
    pbr.deliver();
    expect(groundMesh(env).material).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(groundMesh(env).receiveShadow).toBe(true);
    expect(groundMesh(env).castShadow).toBe(false);
    env.dispose();
  });

  it('wears the PBR ground whichever set loads last', () => {
    if (layout === undefined) return;
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(layout, palette, detail.textures, undefined, pbr.textures);
    env.setLook(lookFor(flags.pbr, 'day'));
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
    env.setLook(lookFor(flags.pbr, 'day'));
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
    env.setLook(lookFor(flags.pbr, 'day'));
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
    env.setLook(lookFor(flags.pbr, 'day'));
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
    env.setLook(lookFor(flags.pbr, 'day'));
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

describe('environment worn markings', () => {
  const slalom = exercises.find((e) => e.id === 'slalom');
  const wornLayout = slalom === undefined ? null : resolveLayout(layouts[slalom.layout], slalom);

  /** Perspective copies of the paint (`paint`) and of the aids, by their material. */
  const copies = (env: { object: Object3D }): { paint: Set<unknown>; aids: Set<unknown> } => {
    const lit = [...seen(env.object, cameras.cockpit)]
      .filter(isMesh)
      .filter((m) => isMarking(m) && isNodeMaterial(m));
    const paint = lit.filter((m) => m.geometry.hasAttribute(MARK_BOX));
    expect(paint.length).toBeGreaterThan(0);
    return {
      paint: new Set(paint.map((m) => m.material)),
      aids: new Set(lit.filter((m) => !paint.includes(m)).map((m) => m.material)),
    };
  };
  const setUp = (): NonNullable<ReturnType<typeof proceduralEnvironment>> & {
    pbr: ReturnType<typeof fakePbrTextures>;
  } => {
    if (wornLayout === null) throw new Error('no slalom exercise');
    const detail = fakeTextures();
    const pbr = fakePbrTextures();
    const env = proceduralEnvironment(
      wornLayout,
      palette,
      detail.textures,
      undefined,
      pbr.textures,
    );
    detail.deliver();
    pbr.deliver();
    return Object.assign(env, { pbr });
  };

  it('wears the paint on High over the PBR ground and leaves the aids on the lit flat look', () => {
    const env = setUp();
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    const { paint: plain, aids: plainAids } = copies(env);
    expect([...plain][0]).toBeInstanceOf(MeshLambertNodeMaterial);
    env.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    const { paint, aids } = copies(env);
    expect(paint.size).toBe(1);
    const [worn] = [...paint];
    expect(worn).toBeInstanceOf(MeshLambertNodeMaterial);
    expect(plain.has(worn)).toBe(false);
    expect(aids).toEqual(plainAids);
    env.dispose();
  });

  it('gives Balanced and Low nothing, and the same shared material back after High', () => {
    const env = setUp();
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    const before = copies(env);
    env.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    expect(copies(env)).toEqual(before);
    env.dispose();
  });

  it('keeps the unworn markings when the PBR ground is off or rejected', () => {
    const env = setUp();
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    const { paint: plain } = copies(env);
    env.setLook(lookFor({ ...QUALITY_FLAGS.high, groundPbr: false }, 'day'));
    expect(copies(env).paint).toEqual(plain);
    env.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    expect(copies(env).paint).not.toEqual(plain);
    env.pbr.reject();
    expect(copies(env).paint).toEqual(plain);
    env.dispose();
  });

  it('leaves the top-down tokens as on Low, and the quads carry their box', () => {
    const env = setUp();
    const tokens = (): Map<Object3D, unknown> =>
      new Map([...seen(env.object, cameras.topDown)].map((m) => [m, asMesh(m).material]));
    env.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    const low = tokens();
    env.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    expect(tokens()).toEqual(low);
    for (const m of low.keys()) {
      const geometry = asMesh(m).geometry;
      if (geometry.hasAttribute(MARK_BOX)) {
        expect(geometry.getAttribute(MARK_BOX).count).toBe(geometry.getAttribute('position').count);
      }
    }
    env.dispose();
  });
});

describe('reflector props at night', () => {
  const check = (
    initial: RetroVerdict,
  ): { check: RetroCheck; settle: (v: RetroVerdict) => void } => {
    let verdict = initial;
    const listeners = new Set<() => void>();
    return {
      check: {
        attach: () => undefined,
        verdict: () => verdict,
        onChange: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
        dispose: () => undefined,
      },
      settle: (v) => {
        verdict = v;
        for (const l of [...listeners]) l();
      },
    };
  };
  const reflective = (env: ReturnType<typeof proceduralEnvironment>): number =>
    [...seen(env.object, cameras.cockpit)].filter(
      (m) => asMesh(m).material instanceof RetroNodeMaterial,
    ).length;

  it.each(['balanced', 'high'] as const)(
    'draw with the reflector material at night on %s, and with the plain one by day',
    (preset) => {
      if (layout === undefined) throw new Error('no layout');
      const env = proceduralEnvironment(
        layout,
        palette,
        undefined,
        undefined,
        undefined,
        undefined,
        check('ok').check,
      );
      env.setLook(lookFor(QUALITY_FLAGS[preset], 'night'));
      expect(reflective(env)).toBeGreaterThan(0);
      env.setLook(lookFor(QUALITY_FLAGS[preset], 'day'));
      expect(reflective(env)).toBe(0);
      env.dispose();
    },
  );

  it('falls back to the plain props when the reflector program fails to build, also after the look is set', () => {
    if (layout === undefined) throw new Error('no layout');
    const { check: c, settle } = check('pending');
    const env = proceduralEnvironment(
      layout,
      palette,
      undefined,
      undefined,
      undefined,
      undefined,
      c,
    );
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'night'));
    expect(reflective(env)).toBeGreaterThan(0);
    settle('failed');
    expect(reflective(env)).toBe(0);
    env.dispose();
  });
});
