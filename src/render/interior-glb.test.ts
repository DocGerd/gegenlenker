import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Group, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '../contracts/render';
import { trucks } from '../vehicles/registry';
import { truckAnchors } from '../vehicles/anchors';
import { cabShellParams } from './cab-dims';
import { createCockpitCamera, placeCockpitCamera } from './cockpit-camera';
import { placePose } from './coords';
import { type Shells, parseMeshes } from './glb-shells';
import {
  createGlbInterior,
  INTERIOR_URLS,
  type InteriorShell,
  interiorShellFrom,
} from './interior-glb';
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
    interior.setQuality(QUALITY_FLAGS.high);
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
    interior.setQuality(QUALITY_FLAGS.balanced);
    expect(interior.drawn).toBe(false);
    expect(interior.flat.object.visible).toBe(true);
    interior.setQuality(QUALITY_FLAGS.low);
    expect(interior.drawn).toBe(false);
    expect(interior.flat.object.visible).toBe(false);
  });

  it('asks for the asset only on a preset that draws it', () => {
    const states = Object.entries(QUALITY_FLAGS).map(
      ([preset, flags]) => [preset, flags.cockpitInterior && flags.interiorGlb] as const,
    );
    expect(Object.fromEntries(states)).toEqual({ low: false, balanced: false, high: true });
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
    interior.setQuality(QUALITY_FLAGS.high);
    expect(interior.drawn).toBe(false);
    (deliver as unknown as (shell: InteriorShell) => void)(shell);
    expect(interior.drawn).toBe(true);
  });

  it('sits inside the cab at any heading, on the interior layer, casting no shadow', async () => {
    const interior = createGlbInterior(spec);
    interior.attach(await glb(spec.id));
    interior.setQuality(QUALITY_FLAGS.high);
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
      for (const mesh of interior.meshes.filter(
        (m) => m.name !== 'pillar-left' && m.name !== 'pillar-right',
      )) {
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
