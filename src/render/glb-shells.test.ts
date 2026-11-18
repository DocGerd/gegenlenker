import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Color, Layers, Mesh, MeshLambertMaterial, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRUCK_IDS, type TruckId } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import { bodyFrontX, bodyShellParams } from './body-dims';
import { RELIEF } from './cab-dims';
import { type Shell, type Shells, parseShell, startShells, type TruckShells } from './glb-shells';
import { TRUCK_LOOKS } from './livery';
import { createMirror } from './mirror';
import { KEYS } from './palette';
import { QUALITY_FLAGS, type QualityFlags } from './quality';
import { REALISM_HUES } from './realism-hues';
import {
  AIDS_LAYER,
  CAB_LAYER,
  COCKPIT_LAYERS,
  enableLayers,
  SKY_LAYER,
  TOP_DOWN_LAYERS,
} from './seams';
import { proceduralTruck } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

const glb = (key: string): ArrayBuffer => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${key}.glb`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const loadShell = (id: TruckId, kind: 'cab' | 'body'): Promise<Shell> =>
  parseShell(glb(`${id}-${kind}`));

describe.each(TRUCK_IDS)('shell assets of %s', (id) => {
  const spec = truckById(id);
  const look = TRUCK_LOOKS[id];
  const anchors = truckAnchors(spec);
  const half = spec.width.value / 2000;

  it('decodes the cab into one coloured mesh inside the cab envelope', async () => {
    const { mesh } = await loadShell(id, 'cab');
    const box = new Box3().setFromObject(mesh);
    // the crew cab's tow coupling reaches 0.25 m past the front face
    expect(box.max.x).toBeLessThanOrEqual(anchors.frontX + RELIEF + 0.25);
    expect(box.min.x).toBeGreaterThanOrEqual(anchors.frontX - look.cab.length - 1e-3);
    expect(Math.max(-box.min.z, box.max.z)).toBeLessThanOrEqual(half + RELIEF + 1e-3);
  });

  it('decodes the body into one coloured mesh inside the body footprint', async () => {
    const { mesh } = await loadShell(id, 'body');
    const box = new Box3().setFromObject(mesh);
    const params = bodyShellParams(spec);
    expect(box.min.x).toBeGreaterThanOrEqual(anchors.rearX - 1e-3);
    expect(box.max.x).toBeLessThanOrEqual(bodyFrontX(anchors.frontX, look.cab.length) + 1e-3);
    expect(Math.max(-box.min.z, box.max.z)).toBeLessThanOrEqual(half + 0.05 + 1e-3);
    expect(params.bodyFront).toBeCloseTo(box.max.x, 3);
  });

  it('keeps the colours linear, as tint() does', async () => {
    for (const kind of ['cab', 'body'] as const) {
      const { mesh } = await loadShell(id, kind);
      const colours = mesh.geometry.getAttribute('color');
      const want = new Color(REALISM_HUES.thwBlue);
      const found = Array.from({ length: colours.count }, (_, i) => i).some(
        (i) =>
          Math.abs(colours.getX(i) - want.r) < 1.5 / 255 &&
          Math.abs(colours.getY(i) - want.g) < 1.5 / 255 &&
          Math.abs(colours.getZ(i) - want.b) < 1.5 / 255,
      );
      expect(found, `${id} ${kind} carries thwBlue`).toBe(true);
    }
  });
});

const camera = (ids: readonly number[]): Layers => {
  const layers = new Layers();
  enableLayers(layers, ids);
  return layers;
};
const sees = {
  cockpit: camera(COCKPIT_LAYERS),
  topDown: camera(TOP_DOWN_LAYERS),
  mirror: createMirror().camera.layers,
};

/** Shells that apply on demand, so a test sees the group before and after the swap. */
function deferred(shells: Readonly<Record<'cab' | 'body', Shell>>): {
  shells: TruckShells;
  apply: (kind: 'cab' | 'body') => void;
} {
  const pending: Partial<Record<'cab' | 'body', () => void>> = {};
  const side = (kind: 'cab' | 'body'): Shells => ({
    setEnabled: () => undefined,
    onLoaded: (_key, cb) => {
      pending[kind] = () => {
        cb(shells[kind]);
      };
      return () => undefined;
    },
  });
  return {
    shells: { cab: side('cab'), body: side('body') },
    apply: (kind) => {
      pending[kind]?.();
    },
  };
}

const loadBoth = async (id: TruckId) => ({
  cab: await loadShell(id, 'cab'),
  body: await loadShell(id, 'body'),
});

const maskOf = (group: Object3D) => group.children.map((m) => [m, m.layers.mask] as const);
/** The new layer mask of every procedural mesh still in the group whose layers changed. */
const relayered = (group: Object3D, before: ReturnType<typeof maskOf>): number[] =>
  before
    .filter(([m, mask]) => group.children.includes(m) && m.layers.mask !== mask)
    .map(([m]) => m.layers.mask);
const seenBy = (group: Object3D, layers: Layers): Object3D[] =>
  group.children.filter((m) => m instanceof Mesh && layers.test(m.layers));

describe.each(TRUCK_IDS)('shell swap of %s', (id) => {
  const spec = truckById(id);

  it('moves the procedural cab box to the top-down view and shows the cab shell in the mirrors only', async () => {
    const { shells, apply } = deferred(await loadBoth(id));
    const group = proceduralTruck(spec, palette, shells).object;
    const before = [...group.children];
    const cabFront = before.filter((m) => m.layers.mask === 1 << CAB_LAYER);
    expect(cabFront).toHaveLength(1);
    const topDownBefore = seenBy(group, sees.topDown);
    const layersBefore = maskOf(group);
    apply('cab');

    const added = group.children.filter((m): m is Mesh => !before.includes(m));
    expect(added).toHaveLength(1);
    expect(group.children).not.toContain(cabFront[0]);
    const [shell] = added;
    expect(sees.mirror.test(shell?.layers ?? new Layers())).toBe(true);
    expect(sees.cockpit.test(shell?.layers ?? new Layers())).toBe(false);
    expect(sees.topDown.test(shell?.layers ?? new Layers())).toBe(false);
    expect((shell?.material as MeshLambertMaterial).vertexColors).toBe(true);
    // what the top-down camera draws is the same set of meshes
    expect(seenBy(group, sees.topDown)).toEqual(topDownBefore);
    expect(relayered(group, layersBefore)).toEqual([1 << AIDS_LAYER]);
  });

  it('moves the procedural body box to the top-down view and shows the body shell to the perspective views', async () => {
    const { shells, apply } = deferred(await loadBoth(id));
    const group = proceduralTruck(spec, palette, shells).object;
    const before = [...group.children];
    const topDownBefore = seenBy(group, sees.topDown);
    const layersBefore = maskOf(group);
    apply('body');

    const added = group.children.filter((m): m is Mesh => !before.includes(m));
    const shell = added.find((m) => (m.material as MeshLambertMaterial).vertexColors);
    expect(shell?.layers.mask).toBe(1 << SKY_LAYER);
    expect(sees.cockpit.test(shell?.layers ?? new Layers())).toBe(true);
    expect(sees.mirror.test(shell?.layers ?? new Layers())).toBe(true);
    expect(sees.topDown.test(shell?.layers ?? new Layers())).toBe(false);
    expect(seenBy(group, sees.topDown)).toEqual(topDownBefore);
    // the procedural body box is for the top-down view only now
    expect(relayered(group, layersBefore)).toEqual([1 << AIDS_LAYER]);
  });

  it('shortens the side marking with the body shell only where the cab is longer', async () => {
    const { shells, apply } = deferred(await loadBoth(id));
    const group = proceduralTruck(spec, palette, shells).object;
    const before = [...group.children];
    apply('body');
    const longer = TRUCK_LOOKS[id].cab.length > 2.2;
    const removed = before.filter((m) => !group.children.includes(m));
    expect(removed).toHaveLength(longer ? 1 : 0);
    expect(group.children.length - before.length + removed.length).toBe(longer ? 2 : 1);
  });

  it('restores the procedural meshes, layers and order when switched off, also before the shells load', async () => {
    const { shells, apply } = deferred(await loadBoth(id));
    const visual = proceduralTruck(spec, palette, shells);
    const group = visual.object;
    const before = maskOf(group);
    visual.setQuality(QUALITY_FLAGS.low);
    apply('cab');
    apply('body');
    expect(maskOf(group)).toEqual(before);

    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(group.children.length).toBeGreaterThan(before.length - 1);
    expect(maskOf(group)).not.toEqual(before);
    visual.setQuality(QUALITY_FLAGS.low);
    expect(maskOf(group)).toEqual(before);
  });

  it('gates the cab by cabGlb and the body by vehicleGlb, independently', async () => {
    const { shells, apply } = deferred(await loadBoth(id));
    const visual = proceduralTruck(spec, palette, shells);
    const group = visual.object;
    const before = maskOf(group);
    const flags = (cabGlb: boolean, vehicleGlb: boolean): QualityFlags => ({
      ...QUALITY_FLAGS.balanced,
      cabGlb,
      vehicleGlb,
    });
    visual.setQuality(flags(true, false));
    apply('cab');
    apply('body');
    const cabOnly = maskOf(group);
    expect(cabOnly).not.toEqual(before);

    visual.setQuality(flags(false, true));
    const bodyOnly = maskOf(group);
    expect(bodyOnly).not.toEqual(before);
    expect(bodyOnly).not.toEqual(cabOnly);

    visual.setQuality(flags(false, false));
    expect(maskOf(group)).toEqual(before);
    visual.setQuality(flags(true, true));
    expect(group.children.length).toBeGreaterThan(before.length);
  });

  it('keeps the procedural meshes untouched when applying throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shell = await loadShell(id, 'cab');
    Object.defineProperty(shell.mesh, 'geometry', {
      get: () => {
        throw new Error('broken shell');
      },
    });
    const loaded = startShells({ [`${id}-cab`]: 'cab' }, { load: () => Promise.resolve(shell) });
    const group = proceduralTruck(spec, palette, {
      cab: loaded,
      body: startShells({}, { enabled: false }),
    }).object;
    const before = maskOf(group);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(maskOf(group)).toEqual(before);
    warn.mockRestore();
  });

  it('stops waiting for the shells when disposed', () => {
    const cancel = vi.fn();
    const waiting: Shells = { onLoaded: () => cancel, setEnabled: () => undefined };
    proceduralTruck(spec, palette, { cab: waiting, body: waiting }).dispose();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});

describe('shell loading', () => {
  const urls = { 'man-le-18-280-cab': 'cab' };

  it('keeps the procedural mesh and warns when the load rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onApplied = vi.fn();
    const shells = startShells(urls, {
      load: () => Promise.reject(new Error('offline')),
      onApplied,
    });
    const apply = vi.fn(() => true);
    shells.onLoaded('man-le-18-280-cab', apply);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apply).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('applies a loaded shell once, reports it, and not after cancelling', async () => {
    const shell = await loadShell('man-le-18-280', 'cab');
    const onApplied = vi.fn();
    const shells = startShells(urls, { load: () => Promise.resolve(shell), onApplied });
    const apply = vi.fn(() => true);
    const cancelled = vi.fn(() => true);
    shells.onLoaded('man-le-18-280-cab', apply);
    shells.onLoaded('man-le-18-280-cab', cancelled)();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledExactlyOnceWith(shell));
    expect(onApplied).toHaveBeenCalledExactlyOnceWith('man-le-18-280-cab');
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('does not report a shell that was not attached', async () => {
    const shell = await loadShell('man-le-18-280', 'cab');
    const onApplied = vi.fn();
    const apply = vi.fn(() => false);
    startShells(urls, { load: () => Promise.resolve(shell), onApplied }).onLoaded(
      'man-le-18-280-cab',
      apply,
    );
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('downloads nothing until enabled', async () => {
    const shell = await loadShell('man-le-18-280', 'cab');
    const load = vi.fn(() => Promise.resolve(shell));
    const shells = startShells(urls, { load, enabled: false });
    const apply = vi.fn(() => true);
    shells.onLoaded('man-le-18-280-cab', apply);
    shells.setEnabled(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(load).not.toHaveBeenCalled();
    shells.setEnabled(true);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(load).toHaveBeenCalledOnce();
  });
});
