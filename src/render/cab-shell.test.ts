import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Mesh, MeshLambertMaterial, type Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import { type CabShells, parseCabShell, startCabShells } from './cab-shell';
import { CAB_LENGTH, RELIEF } from './cab-dims';
import { KEYS } from './palette';
import { AIDS_LAYER, CAB_LAYER } from './seams';
import { proceduralTruck } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const spec = truckById('man-le-18-280');

const glb = (): ArrayBuffer => {
  const bytes = readFileSync(join(import.meta.dirname, 'assets/man-le-18-280-cab.glb'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const meshesOf = (root: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o as Mesh);
  });
  return out;
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

describe('cab shell swap', () => {
  const loaded = async (): Promise<CabShells> => {
    const shell = await parseCabShell(glb());
    return { onLoaded: (_id, apply) => (apply(shell), () => undefined) };
  };
  const count = (root: Object3D, layer: number): number =>
    meshesOf(root).filter((m) => m.layers.mask === 1 << layer).length;
  const procedural = proceduralTruck(spec, palette).object;

  it('moves the box top-down only and shows the shell in the mirrors only', async () => {
    const swapped = proceduralTruck(spec, palette, await loaded()).object;
    expect(count(swapped, AIDS_LAYER)).toBe(count(procedural, AIDS_LAYER) + 1);
    expect(count(swapped, 0)).toBe(count(procedural, 0) - 1);
    // the shell's two meshes replace the single cab front
    expect(count(swapped, CAB_LAYER)).toBe(count(procedural, CAB_LAYER) + 1);
    const shell = meshesOf(swapped).filter(
      (m) => m.layers.mask === 1 << CAB_LAYER && m.material instanceof MeshLambertMaterial,
    );
    expect(shell.map((m) => (m.material as MeshLambertMaterial).vertexColors).sort()).toEqual([
      false,
      true,
    ]);
  });

  it('leaves the procedural cab when no shell arrives', () => {
    const waiting = proceduralTruck(spec, palette, { onLoaded: () => () => undefined }).object;
    const layers = (root: Object3D) => meshesOf(root).map((m) => m.layers.mask);
    expect(layers(waiting)).toEqual(layers(procedural));
  });

  it('stops waiting for the shell when disposed', () => {
    const cancel = vi.fn();
    proceduralTruck(spec, palette, { onLoaded: () => cancel }).dispose();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe('cab shell loading', () => {
  it('warns and never applies when the load fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const apply = vi.fn();
    const shells = startCabShells(() => Promise.reject(new Error('offline')));
    shells.onLoaded('man-le-18-280', apply);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(apply).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('applies a loaded shell once, and not after cancelling', async () => {
    const shell = await parseCabShell(glb());
    const shells = startCabShells(() => Promise.resolve(shell));
    const apply = vi.fn();
    const cancelled = vi.fn();
    shells.onLoaded('man-le-18-280', apply);
    shells.onLoaded('man-le-18-280', cancelled)();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledExactlyOnceWith(shell));
    expect(cancelled).not.toHaveBeenCalled();
  });
});
