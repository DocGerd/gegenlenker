import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Layers, Mesh, MeshLambertMaterial } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import { type CabShell, type CabShells, parseCabShell, startCabShells } from './cab-shell';
import { CAB_LENGTH, RELIEF } from './cab-dims';
import { createMirror } from './mirror';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { CAB_LAYER, COCKPIT_LAYERS, enableLayers, TOP_DOWN_LAYERS } from './seams';
import { proceduralTruck } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const spec = truckById('man-le-18-280');

const glb = (): ArrayBuffer => {
  const bytes = readFileSync(join(import.meta.dirname, 'assets/man-le-18-280-cab.glb'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe('cab shell asset', () => {
  it('decodes into a body and a coloured detail mesh inside the cab envelope', async () => {
    const shell = await parseCabShell(glb());
    expect(shell.detail.geometry.hasAttribute('color')).toBe(true);
    const front = truckAnchors(spec).frontX;
    const half = spec.width.value / 2000 + RELIEF + 1e-3;
    for (const mesh of [shell.body, shell.detail]) {
      const box = new Box3().setFromObject(mesh);
      expect(box.max.x).toBeLessThanOrEqual(front + RELIEF + 1e-3);
      expect(box.min.x).toBeGreaterThanOrEqual(front - CAB_LENGTH - 1e-3);
      expect(Math.max(-box.min.z, box.max.z)).toBeLessThanOrEqual(half);
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
function deferred(shell: CabShell): { shells: CabShells; apply: () => void } {
  let apply = (): void => undefined;
  return {
    shells: {
      onLoaded: (_id, cb) => {
        apply = () => {
          cb(shell);
        };
        return () => undefined;
      },
    },
    apply: () => {
      apply();
    },
  };
}

describe('cab shell swap', () => {
  it('hides the box from the mirrors, shows the shell to them only, and drops the cab front', async () => {
    const { shells, apply } = deferred(await parseCabShell(glb()));
    const group = proceduralTruck(spec, palette, shells).object;
    const before = [...group.children];
    const cabFront = before.filter((m) => m.layers.mask === 1 << CAB_LAYER);
    const box = before.find(
      (m) =>
        sees.cockpit.test(m.layers) && sees.mirror.test(m.layers) && sees.topDown.test(m.layers),
    );
    expect(cabFront).toHaveLength(1);
    expect(box).toBeDefined();
    apply();

    const after = group.children;
    expect(after).not.toContain(cabFront[0]);
    expect(after.filter((m) => !before.includes(m))).toHaveLength(2);
    for (const kept of before.filter((m) => m !== cabFront[0] && m !== box)) {
      expect(after).toContain(kept);
    }

    expect(sees.topDown.test(box?.layers ?? new Layers())).toBe(true);
    expect(sees.mirror.test(box?.layers ?? new Layers())).toBe(false);
    expect(sees.cockpit.test(box?.layers ?? new Layers())).toBe(false);

    const shell = after.filter((m): m is Mesh => m instanceof Mesh && !before.includes(m));
    for (const m of shell) {
      expect(sees.mirror.test(m.layers)).toBe(true);
      expect(sees.cockpit.test(m.layers)).toBe(false);
      expect(sees.topDown.test(m.layers)).toBe(false);
    }
    expect(shell.map((m) => (m.material as MeshLambertMaterial).vertexColors).sort()).toEqual([
      false,
      true,
    ]);

    group.updateMatrixWorld(true);
    const cab = new Box3().setFromObject(box ?? new Mesh());
    const body = new Box3().setFromObject(
      shell.find((m) => !(m.material as MeshLambertMaterial).vertexColors) ?? new Mesh(),
    );
    for (const [a, b] of [
      [cab.min, body.min],
      [cab.max, body.max],
    ] as const) {
      expect(a.distanceTo(b)).toBeLessThan(0.05);
    }
  });

  it('restores the procedural cab for the mirrors when the shell is switched off, also before it loads', async () => {
    const { shells, apply } = deferred(await parseCabShell(glb()));
    const visual = proceduralTruck(spec, palette, shells);
    const group = visual.object;
    const before = group.children.map((m) => [m, m.layers.mask] as const);
    visual.setQuality?.(QUALITY_FLAGS.low);
    apply();
    expect(group.children.map((m) => [m, m.layers.mask])).toEqual(before);

    visual.setQuality?.(QUALITY_FLAGS.balanced);
    expect(group.children).toHaveLength(before.length + 1);
    visual.setQuality?.(QUALITY_FLAGS.low);
    expect(group.children).toHaveLength(before.length);
    for (const [m, mask] of before) {
      expect(group.children).toContain(m);
      expect(m.layers.mask).toBe(mask);
    }
  });

  it('keeps the procedural cab untouched when applying throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shell = await parseCabShell(glb());
    Object.defineProperty(shell.detail, 'geometry', {
      get: () => {
        throw new Error('broken shell');
      },
    });
    const loaded = startCabShells(() => Promise.resolve(shell));
    const group = proceduralTruck(spec, palette, loaded).object;
    const before = group.children.map((m) => [m, m.layers.mask] as const);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(group.children.map((m) => [m, m.layers.mask])).toEqual(before);
    warn.mockRestore();
  });

  it('stops waiting for the shell when disposed', () => {
    const cancel = vi.fn();
    proceduralTruck(spec, palette, { onLoaded: () => cancel }).dispose();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('cab shell loading', () => {
  it('keeps the procedural cab and warns when the load rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onApplied = vi.fn();
    const shells = startCabShells(() => Promise.reject(new Error('offline')), onApplied);
    const group = proceduralTruck(spec, palette, shells).object;
    const before = group.children.map((m) => [m, m.layers.mask] as const);
    const box = group.children.filter((m) => m.layers.mask === 1);
    const front = group.children.filter((m) => m.layers.mask === 1 << CAB_LAYER);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(onApplied).not.toHaveBeenCalled();
    expect(group.children.map((m) => [m, m.layers.mask])).toEqual(before);
    expect(box.length).toBeGreaterThan(0);
    expect(front).toHaveLength(1);
    warn.mockRestore();
  });

  it('applies a loaded shell once, reports it, and not after cancelling', async () => {
    const shell = await parseCabShell(glb());
    const onApplied = vi.fn();
    const shells = startCabShells(() => Promise.resolve(shell), onApplied);
    const apply = vi.fn();
    const cancelled = vi.fn();
    shells.onLoaded('man-le-18-280', apply);
    shells.onLoaded('man-le-18-280', cancelled)();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledExactlyOnceWith(shell));
    expect(onApplied).toHaveBeenCalledExactlyOnceWith('man-le-18-280');
    expect(cancelled).not.toHaveBeenCalled();
  });
});
