import { Layers, Mesh, Texture, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { KIT_FOOTPRINTS } from '../content/kit';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { KitPiece } from '../contracts/layout';
import type { ScenePalette } from '../contracts/render';
import { proceduralEnvironment } from './environment';
import { KEYS } from './palette';
import { lookFor } from './look';
import { QUALITY_FLAGS } from './quality';
import {
  COCKPIT_LAYERS,
  DEFAULT_LAYER,
  enableLayers,
  SHADOW_CASTER_LAYERS,
  TOP_DOWN_LAYERS,
} from './seams';
import type { VehicleEnvironment } from './vehicle-pbr';
import { type KitTextureKey, type LoadedKit, type YardKit } from './yard-kit';
import type { KitModel, KitPieces } from './yard-kit-pieces';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const layout = resolveLayout(layouts.depot, null);

const camera = (ids: readonly number[]): Layers => {
  const layers = new Layers();
  layers.set(DEFAULT_LAYER);
  enableLayers(layers, ids);
  return layers;
};
const cockpit = camera(COCKPIT_LAYERS);
const topDown = camera(TOP_DOWN_LAYERS);

function seen(root: Object3D, layers: Layers): Set<Object3D> {
  const out = new Set<Object3D>();
  const walk = (o: Object3D): void => {
    if (!o.visible) return;
    if (o instanceof Mesh && layers.test(o.layers)) out.add(o);
    o.children.forEach(walk);
  };
  walk(root);
  return out;
}

const minus = (a: Set<Object3D>, b: Set<Object3D>): Object3D[] => [...a].filter((m) => !b.has(m));

/** One triangle per piece, enough for the placed geometry to exist. */
function trianglePieces(): KitPieces {
  const model: KitModel = {
    primitives: [
      {
        kind: 'atlas',
        position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        uv: new Float32Array([0, 0, 1, 0, 0, 1]),
        index: new Uint32Array([0, 1, 2]),
      },
      {
        kind: 'leaves',
        position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
        uv: new Float32Array([0, 0, 1, 0, 0, 1]),
        index: new Uint32Array([0, 1, 2]),
      },
    ],
    bounds: { min: [0, 0, 0], max: [1, 1, 0] },
  };
  const pieces = new Map<KitPiece, KitModel>();
  for (const piece of Object.keys(KIT_FOOTPRINTS) as KitPiece[]) {
    const { min, max } = KIT_FOOTPRINTS[piece];
    pieces.set(piece, { ...model, bounds: { min: [min[0], min[1], 0], max: [max[0], max[1], 0] } });
  }
  return pieces;
}

function fakeKit() {
  let apply: ((kit: LoadedKit) => void) | undefined;
  let revert: (() => void) | undefined;
  const kit: YardKit = {
    attach: () => undefined,
    setEnabled: () => undefined,
    onLoaded(next, onRevert) {
      apply = next;
      revert = onRevert;
      return () => {
        apply = undefined;
      };
    },
    reportApplied: () => undefined,
    dispose: () => undefined,
  };
  const reflections: VehicleEnvironment = {
    attach: () => undefined,
    texture: () => null,
    onChange: () => () => undefined,
    reportApplied: () => undefined,
    setSky: () => undefined,
    dispose: () => undefined,
  };
  const texture = new Texture();
  const maps = { atlasA: texture, atlasB: texture, leaves: texture } satisfies Record<
    KitTextureKey,
    Texture
  >;
  return {
    parts: { kit, reflections },
    load: () => apply?.({ maps, pieces: trianglePieces() }),
    reject: () => revert?.(),
  };
}

describe('the yard kit props', () => {
  const draws = { ...QUALITY_FLAGS.balanced, yardKit: true };
  const setup = () => {
    const { parts, load, reject } = fakeKit();
    const env = proceduralEnvironment(layout, palette, undefined, undefined, undefined, parts);
    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    return { env, load, reject, off: seen(env.object, cockpit) };
  };

  it('are drawn once in perspective: a stand-in until the kit draws them, then the kit alone', () => {
    const { env, load, reject, off } = setup();
    const top = seen(env.object, topDown);
    const now = (): Set<Object3D> => seen(env.object, cockpit);

    env.setLook(lookFor(draws, 'day'));
    expect(now(), 'loading').toEqual(off);
    load();
    const applied = now();
    const standIns = minus(off, applied);
    const kitMeshes = minus(applied, off);
    expect(standIns.length).toBeGreaterThan(0);
    expect(kitMeshes.length).toBeGreaterThan(0);
    for (const mesh of standIns) expect(mesh.parent).not.toBe(env.object);
    expect(seen(env.object, topDown), 'top-down').toEqual(top);

    env.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    expect(now(), 'off again').toEqual(off);
    env.setLook(lookFor(draws, 'day'));
    expect(now(), 'applied again').toEqual(applied);

    reject();
    expect(now(), 'failed').toEqual(off);
    env.dispose();
  });

  it('cast the sun shadow only where the sun does, and only the atlas receives it', () => {
    const { env, load } = setup();
    // what the sun's shadow camera draws: the cockpit camera's layers would pass a kit on the wrong one
    const shadowCamera = camera(SHADOW_CASTER_LAYERS);
    const before = seen(env.object, shadowCamera);
    load();
    const kitMeshes = (flags: typeof draws): Mesh[] => {
      env.setLook(lookFor(flags, 'day'));
      return minus(seen(env.object, shadowCamera), before).filter(
        (m): m is Mesh => m instanceof Mesh,
      );
    };
    const leaves = (m: Mesh): boolean => (m.material as { alphaTest: number }).alphaTest > 0;
    const without = kitMeshes(draws);
    expect(without.length).toBeGreaterThan(0);
    for (const m of without)
      expect([m.castShadow, m.receiveShadow], 'no sun shadow').toEqual([false, false]);
    const high = kitMeshes(QUALITY_FLAGS.high);
    expect(high.length).toBeGreaterThan(0);
    for (const m of high) expect([m.castShadow, m.receiveShadow]).toEqual([true, !leaves(m)]);
    expect(high.some(leaves)).toBe(true);
    for (const m of kitMeshes(draws))
      expect([m.castShadow, m.receiveShadow], 'off again').toEqual([false, false]);
    env.dispose();
  });

  it('stay stand-ins while the preset does not draw the kit, however it has loaded', () => {
    const { env, load, off } = setup();
    load();
    expect(seen(env.object, cockpit)).toEqual(off);
    env.dispose();
  });
});
