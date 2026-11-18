import { DataTexture, Layers, type Object3D, ShaderLib, type Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { ScenePalette } from '../contracts/render';
import { createMirror } from './mirror';
import { groundShader, proceduralEnvironment, texturedGroundGeometry } from './environment';
import type { GroundTextures } from './ground-texture';
import { GROUND_SURFACES } from './ground-texture-spec';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { COCKPIT_LAYERS, DEFAULT_LAYER, enableLayers, TOP_DOWN_LAYERS } from './seams';
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

describe('environment quality', () => {
  it('shows the obstacle tokens to every camera on low, in place of the hidden props', () => {
    expect(layout).toBeDefined();
    if (layout === undefined) return;
    const env = proceduralEnvironment(layout, palette);
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

/** Delivers the texture on demand, standing in for the KTX2 load. */
function fakeTextures(): { textures: GroundTextures; deliver: () => void } {
  const waiting: ((texture: Texture) => void)[] = [];
  return {
    textures: {
      attach: () => undefined,
      setEnabled: () => undefined,
      onLoaded(apply) {
        waiting.push(apply);
        return () => undefined;
      },
    },
    deliver: () => {
      for (const apply of waiting) apply(new DataTexture(new Uint8Array(4), 1, 1));
    },
  };
}

describe('environment ground texture', () => {
  it('swaps the ground in perspective only, leaving top-down as it was, and reverses', () => {
    expect(layout).toBeDefined();
    if (layout === undefined) return;
    const { textures, deliver } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    const before = Object.fromEntries(
      Object.entries(cameras).map(([k, c]) => [k, seen(env.object, c)]),
    );

    env.setQuality(QUALITY_FLAGS.high);
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

    env.setQuality(QUALITY_FLAGS.balanced);
    for (const [view, meshes] of Object.entries(before)) {
      expect(now(view as keyof typeof cameras), view).toEqual(meshes);
    }
    env.setQuality(QUALITY_FLAGS.high);
    expect(now('cockpit').size).toBe(before['cockpit']?.size);
    expect(only(now('cockpit'), before['cockpit'] ?? new Set())).toHaveLength(1);
    env.dispose();
  });

  it('keeps the token ground until the texture has loaded, and below High after', () => {
    if (layout === undefined) return;
    const { textures, deliver } = fakeTextures();
    const env = proceduralEnvironment(layout, palette, textures);
    const before = seen(env.object, cameras.cockpit);
    env.setQuality(QUALITY_FLAGS.high);
    expect(seen(env.object, cameras.cockpit)).toEqual(before);
    env.setQuality(QUALITY_FLAGS.balanced);
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

  it('patches the chunks of the real Lambert shader', () => {
    const shader = {
      vertexShader: ShaderLib.lambert.vertexShader,
      fragmentShader: ShaderLib.lambert.fragmentShader,
    };
    groundShader(shader);
    expect(shader.vertexShader).toContain('vGroundSelect = groundSelect;');
    expect(shader.fragmentShader).toContain('dot( groundDetail, vGroundSelect )');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
  });
});
