import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, DataTexture, Group, MeshBasicMaterial, type Texture, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '../contracts/render';
import { trucks } from '../vehicles/registry';
import { truckAnchors } from '../vehicles/anchors';
import { cabShellParams } from './cab-dims';
import { createCockpitCamera, placeCockpitCamera } from './cockpit-camera';
import { placePose } from './coords';
import { gradeDisabled } from './grade';
import { type Shells, parseMeshes } from './glb-shells';
import type { VehicleEnvironment } from './vehicle-pbr';
import {
  createGlbInterior,
  INTERIOR_URLS,
  type InteriorShell,
  interiorShellFrom,
} from './interior-glb';
import { lookFor } from './look';
import {
  createInteriorCheck,
  type InteriorCheck,
  InteriorNodeMaterial,
  type InteriorVerdict,
} from './interior-material';
import { QUALITY_FLAGS } from './quality';
import { INTERIOR_LAYER } from './seams';
import { computeViewports } from './viewports';

const glb = async (id: string): Promise<InteriorShell> => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-interior.glb`));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return interiorShellFrom(await parseMeshes(data));
};

describe('interior asset', () => {
  it('keys one glb per truck', () => {
    expect(Object.keys(INTERIOR_URLS).sort()).toEqual(trucks.map((t) => `${t.id}-interior`).sort());
  });

  it.each(trucks)('decodes into the four coloured meshes for $id', async (spec) => {
    const shell = await glb(spec.id);
    for (const mesh of Object.values(shell)) {
      expect(mesh.geometry.hasAttribute('color'), mesh.name).toBe(true);
      expect(mesh.geometry.getAttribute('position').count, mesh.name).toBeGreaterThan(0);
    }
  });

  it('refuses a glb whose meshes are not the interior', async () => {
    const shell = await glb(trucks[0]?.id ?? '');
    expect(() => interiorShellFrom([shell.interior, shell.wheel])).toThrow(/expected/);
  });
});

describe.each(trucks)('interior of $id on the presets', (spec) => {
  it('shows the flat overlay until the asset is in place, then only the asset', async () => {
    const attached = vi.fn();
    const shells = {
      attached,
      onLoaded: () => () => undefined,
    } as unknown as Shells<InteriorShell>;
    const interior = createGlbInterior(spec, { shells });
    interior.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    expect(interior.drawn).toBe(false);
    expect(interior.flat.object.visible).toBe(true);
    interior.attach(await glb(spec.id));
    expect(interior.drawn).toBe(true);
    expect(interior.flat.object.visible).toBe(false);
    expect(attached).toHaveBeenLastCalledWith(`${spec.id}-interior`, true);
    interior.detach();
    expect(interior.drawn).toBe(false);
    expect(interior.flat.object.visible).toBe(true);
    expect(attached).toHaveBeenLastCalledWith(`${spec.id}-interior`, false);
  });

  it('keeps the flat overlay on Balanced and draws nothing on Low, asset or not', async () => {
    const interior = createGlbInterior(spec);
    interior.attach(await glb(spec.id));
    interior.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    expect(interior.drawn).toBe(false);
    expect(interior.flat.object.visible).toBe(true);
    interior.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    expect(interior.drawn).toBe(false);
    expect(interior.flat.object.visible).toBe(false);
  });

  it('takes the asset from the shells once they deliver it', async () => {
    const shell = await glb(spec.id);
    let deliver: ((shell: InteriorShell) => void) | null = null;
    const shells: Shells<InteriorShell> = {
      attached: () => undefined,
      setEnabled: () => undefined,
      onLoaded: (_key, apply) => {
        deliver = apply;
        return () => undefined;
      },
    };
    const interior = createGlbInterior(spec, { shells });
    interior.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    expect(interior.drawn).toBe(false);
    (deliver as unknown as (shell: InteriorShell) => void)(shell);
    expect(interior.drawn).toBe(true);
  });

  it('sits inside the cab at any heading, on the interior layer, casting no shadow', async () => {
    const interior = createGlbInterior(spec);
    interior.attach(await glb(spec.id));
    interior.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    const { cockpit, mirrorLeft, mirrorRight } = computeViewports(1350, 600, 'drive', null);
    const cab = cabShellParams(spec);
    const anchors = truckAnchors(spec);
    for (const heading of [0, 0.7, 2.9]) {
      const pose = { x: 12, y: -7, heading };
      const scene = new Group();
      scene.matrixWorldAutoUpdate = false;
      const truck = new Group();
      placePose(truck, pose);
      scene.add(truck, interior.object);
      const camera = createCockpitCamera();
      placeCockpitCamera(camera, pose, anchors.eye, cockpit as Rect);
      scene.updateMatrixWorld();
      interior.place({ camera, cockpit: cockpit as Rect, mirrorLeft, mirrorRight });
      truck.updateMatrixWorld(true);
      const inverse = truck.matrixWorld.clone().invert();
      for (const mesh of interior.meshes) {
        expect(mesh.layers.mask, mesh.name).toBe(1 << INTERIOR_LAYER);
        expect(mesh.castShadow, mesh.name).toBe(false);
        mesh.updateWorldMatrix(true, false);
        const box = new Box3();
        const position = mesh.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i++) {
          box.expandByPoint(
            new Vector3()
              .fromBufferAttribute(position, i)
              .applyMatrix4(mesh.matrixWorld)
              .applyMatrix4(inverse),
          );
        }
        // three space is x, z = -y, y up
        const rear = anchors.frontX - cab.cabLength;
        expect(box.min.x, mesh.name).toBeGreaterThanOrEqual(rear - 5e-3);
        expect(box.max.x, mesh.name).toBeLessThanOrEqual(anchors.frontX + 5e-3);
        expect(Math.max(-box.min.z, box.max.z), mesh.name).toBeLessThanOrEqual(
          cab.width / 2 + 5e-3,
        );
        const centre = box.getCenter(new Vector3());
        expect(centre.y, mesh.name).toBeGreaterThan(cab.frameTop);
      }
    }
  });
});

describe.each(trucks)('lit interior of $id', (spec) => {
  const day = (flags: typeof QUALITY_FLAGS.high) => lookFor(flags, 'day');
  const palette = {} as never;

  it('wears the lit node material and takes the sun shadow on High, casting none', async () => {
    const interior = createGlbInterior(spec);
    interior.attach(await glb(spec.id));
    interior.setLook(day(QUALITY_FLAGS.high));
    expect(interior.material).toBeInstanceOf(InteriorNodeMaterial);
    expect(interior.meshes.length).toBeGreaterThan(0);
    for (const mesh of interior.meshes) {
      expect(mesh.material, mesh.name).toBe(interior.material);
      expect(mesh.receiveShadow, mesh.name).toBe(true);
      expect(mesh.castShadow, mesh.name).toBe(false);
    }
  });

  it('is lit only while the preset lights the perspective views, and receives only while the sun casts', async () => {
    const interior = createGlbInterior(spec);
    interior.attach(await glb(spec.id));
    const unlit = { ...QUALITY_FLAGS.high, perspectiveLighting: false, sunShadow: false };
    interior.setLook(day(unlit));
    expect(interior.material).toBeInstanceOf(MeshBasicMaterial);
    expect(interior.meshes.every((m) => !m.receiveShadow)).toBe(true);
    interior.setLook(day({ ...QUALITY_FLAGS.high, sunShadow: false }));
    expect(interior.material).toBeInstanceOf(InteriorNodeMaterial);
    expect(interior.meshes.every((m) => !m.receiveShadow)).toBe(true);
    interior.setLook(day(QUALITY_FLAGS.high));
    expect(interior.meshes.every((m) => m.receiveShadow)).toBe(true);
    interior.setLook(day(QUALITY_FLAGS.balanced));
    expect(interior.material).toBeInstanceOf(MeshBasicMaterial);
  });

  describe('with the vehicles sky map', () => {
    const map = new DataTexture(new Uint8Array(4), 1, 1);
    const setup = (verdict: InteriorVerdict | null) => {
      let ready: DataTexture | null = null;
      const listeners = new Set<() => void>();
      const env = {
        texture: () => ready,
        onChange: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      } as unknown as VehicleEnvironment;
      let state: InteriorVerdict = verdict ?? 'ok';
      const perMap = new Map<Texture, InteriorVerdict>();
      const checkListeners = new Set<() => void>();
      const check: InteriorCheck = {
        attach: () => undefined,
        verdict: (m) => perMap.get(m) ?? state,
        onChange: (listener) => {
          checkListeners.add(listener);
          return () => checkListeners.delete(listener);
        },
        dispose: () => undefined,
      };
      return {
        env,
        check,
        listeners,
        checkListeners,
        deliver: (next: DataTexture = map) => {
          ready = next;
          listeners.forEach((listener) => listener());
        },
        settle: (next: InteriorVerdict, only?: Texture) => {
          if (only === undefined) state = next;
          else perMap.set(only, next);
          checkListeners.forEach((listener) => listener());
        },
      };
    };
    const lit = (interior: { material: unknown }): boolean =>
      interior.material instanceof InteriorNodeMaterial;
    const mapOf = (interior: { material: unknown }): unknown =>
      interior.material instanceof InteriorNodeMaterial ? interior.material.envMap : undefined;

    it('stays plain until the map is ready and has built the shader, then wears it on its own material', async () => {
      const t = setup('pending');
      const interior = createGlbInterior(spec, { env: t.env, palette, check: t.check });
      interior.attach(await glb(spec.id));
      interior.setLook(day(QUALITY_FLAGS.high));
      expect(lit(interior)).toBe(false);
      t.deliver();
      expect(lit(interior), 'checking').toBe(false);
      expect(interior.meshes.every((m) => !m.receiveShadow)).toBe(true);
      t.settle('ok');
      expect(lit(interior)).toBe(true);
      expect(mapOf(interior)).toBe(map);
      expect(interior.meshes.every((m) => m.receiveShadow)).toBe(true);
      interior.dispose();
      expect(t.listeners.size + t.checkListeners.size).toBe(0);
    });

    it('stays lit without a map while a new program is checked, and falls back only if it fails', async () => {
      const other = new DataTexture(new Uint8Array(16), 2, 2);
      const run = async (settleAs: InteriorVerdict) => {
        const t = setup('ok');
        const interior = createGlbInterior(spec, { env: t.env, palette, check: t.check });
        interior.attach(await glb(spec.id));
        interior.setLook(day(QUALITY_FLAGS.high));
        t.deliver();
        expect(mapOf(interior)).toBe(map);
        t.settle('pending', other);
        t.deliver(other);
        expect(lit(interior), 'checking').toBe(true);
        expect(mapOf(interior)).toBeNull();
        expect(interior.meshes.every((m) => m.receiveShadow)).toBe(true);
        t.settle(settleAs, other);
        return interior;
      };
      const ok = await run('ok');
      expect(mapOf(ok)).toBe(other);
      const failed = await run('failed');
      expect(lit(failed)).toBe(false);
      expect(failed.meshes.every((m) => !m.receiveShadow)).toBe(true);
    });

    it('falls back to the plain interior where the shader fails, leaving the grade and sun on', async () => {
      const t = setup('pending');
      const interior = createGlbInterior(spec, { env: t.env, palette, check: t.check });
      interior.attach(await glb(spec.id));
      interior.setLook(day(QUALITY_FLAGS.high));
      t.deliver();
      t.settle('failed');
      expect(interior.material).toBeInstanceOf(MeshBasicMaterial);
      expect(
        interior.meshes.every((m) => m.material === interior.material && !m.receiveShadow),
      ).toBe(true);
      expect(gradeDisabled()).toBe(false);
      expect(interior.flat.object.visible).toBe(false);
      expect(interior.drawn).toBe(true);
    });
  });
});

describe('the interior check', () => {
  const gpu = (): WebGPURenderer => ({ getContext: () => null }) as unknown as WebGPURenderer;
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  /** Maps of one size share a program. */
  const map = (size = 1): Texture => new DataTexture(new Uint8Array(4 * size * size), size, size);

  it('is pending without a renderer, then checks a program once on the attached one', async () => {
    const compiles = vi.fn(() => Promise.resolve(true));
    const check = createInteriorCheck(compiles);
    const a = map();
    expect(check.verdict(a)).toBe('pending');
    expect(compiles).not.toHaveBeenCalled();
    const first = gpu();
    check.attach(first);
    const changed = vi.fn();
    check.onChange(changed);
    expect(check.verdict(a)).toBe('pending');
    expect(check.verdict(a)).toBe('pending');
    await settled();
    expect(compiles).toHaveBeenCalledTimes(1);
    expect(compiles).toHaveBeenCalledWith(first, a);
    expect(check.verdict(a)).toBe('ok');
    expect(changed).toHaveBeenCalledOnce();
    // another map of the same program needs no check: the HDRI sky replacing the analytic one
    expect(check.verdict(map())).toBe('ok');
    expect(compiles).toHaveBeenCalledTimes(1);
    expect(check.verdict(map(2))).toBe('pending');
    expect(compiles).toHaveBeenCalledTimes(2);
  });

  it('fails a map whose shader did not build or threw, and drops every verdict with a new renderer', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const compiles = vi
      .fn<(g: WebGPURenderer, m: Texture) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('node graph'))
      .mockResolvedValue(true);
    const check = createInteriorCheck(compiles);
    check.attach(gpu());
    const [a, b] = [map(1), map(2)];
    check.verdict(a);
    check.verdict(b);
    await settled();
    expect([check.verdict(a), check.verdict(b)]).toEqual(['failed', 'failed']);
    check.attach(gpu());
    expect(check.verdict(a)).toBe('pending');
    await settled();
    expect(check.verdict(a)).toBe('ok');
    warn.mockRestore();
  });

  it('ignores a verdict that arrives for a renderer that has been replaced', async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const compiles = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const check = createInteriorCheck(compiles);
    check.attach(gpu());
    const a = map();
    check.verdict(a);
    check.attach(gpu());
    finish(false);
    await settled();
    expect(check.verdict(a)).toBe('pending');
  });
});
