import { Layers, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { ScenePalette } from '../contracts/render';
import { createMirror } from './mirror';
import { proceduralEnvironment } from './environment';
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

describe('environment construction', () => {
  it('adds no empty batch to the scene graph when every obstacle is restyled', () => {
    // Object3D.add() with no argument logs "object not an instance of THREE.Object3D".
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const l = Object.values(layouts)
        .map((x) => resolveLayout(x, null))
        .find(
          (x) => x.obstacles.length > 0 && x.obstacles.every((o) => RESTYLED_KINDS.has(o.kind)),
        );
      expect(l).toBeDefined();
      if (l === undefined) return;
      proceduralEnvironment(l, palette).dispose();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
