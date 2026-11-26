import { Layers, type Mesh, type MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EinweiserVisual, ScenePalette } from '../contracts/render';
import { createEinweiserToken, TOKEN_RADIUS, TOKEN_TIP } from './einweiser-token';
import { KEYS } from './palette';
import { AID_STROKE, AIDS_LAYER, enableLayers, TOP_DOWN_LAYERS } from './seams';

const palette = {
  ...Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])),
  wheel: 0x101010,
  einweiser: 0xffee00,
} as ScenePalette;
const visual = (x: number, y: number, heading: number): EinweiserVisual => ({
  pose: { x, y, heading },
  pitch: 0,
  sign: null,
  phase: 0,
});

describe('Einweiser token', () => {
  it('is hidden without an Einweiser', () => {
    const token = createEinweiserToken(palette);
    expect(token.object.visible).toBe(false);
    token.update(visual(0, 0, 0));
    token.update(undefined);
    expect(token.object.visible).toBe(false);
    token.dispose();
  });

  it('draws only for the top-down camera, its core over the casing', () => {
    const token = createEinweiserToken(palette);
    const topDown = new Layers();
    enableLayers(topDown, TOP_DOWN_LAYERS);
    const meshes = token.object.children as Mesh[];
    token.object.traverse((o) => expect(o.layers.mask).toBe(1 << AIDS_LAYER));
    expect(meshes.every((m) => topDown.test(m.layers))).toBe(true);
    const [casing, core] = meshes;
    expect((casing?.material as MeshBasicMaterial).color.getHex()).toBe(0x101010);
    expect((core?.material as MeshBasicMaterial).color.getHex()).toBe(0xffee00);
    expect(core?.renderOrder).toBeGreaterThan(casing?.renderOrder ?? Infinity);
    token.dispose();
  });

  it.each([0, Math.PI / 2, -2.2])(
    'stands at his pose with the wedge along his heading, %f',
    (h) => {
      const token = createEinweiserToken(palette);
      token.update(visual(5, -2, h));
      token.object.updateMatrixWorld();
      const [casing, core] = token.object.children as Mesh[];
      if (casing === undefined || core === undefined) throw new Error('two meshes');
      /** Each vertex as (metres ahead of his centre along his heading, metres to his left). */
      const local = (mesh: Mesh): [number, number][] => {
        const at = mesh.geometry.getAttribute('position');
        const v = new Vector3();
        return Array.from({ length: at.count }, (_, i) => {
          v.fromBufferAttribute(at, i).applyMatrix4(mesh.matrixWorld);
          const [dx, dy] = [v.x - 5, -v.z + 2];
          return [dx * Math.cos(h) + dy * Math.sin(h), -dx * Math.sin(h) + dy * Math.cos(h)];
        });
      };
      const reach = (mesh: Mesh) => {
        const points = local(mesh);
        return {
          ahead: Math.max(...points.map(([a]) => a)),
          behind: -Math.min(...points.map(([a]) => a)),
          side: Math.max(...points.map(([, l]) => Math.abs(l))),
        };
      };
      const c = reach(core);
      expect(c.ahead).toBeCloseTo(TOKEN_TIP, 6);
      expect(c.behind).toBeCloseTo(TOKEN_RADIUS, 2);
      expect(c.side).toBeCloseTo(TOKEN_RADIUS, 2);
      const k = reach(casing);
      for (const edge of ['ahead', 'behind', 'side'] as const) {
        expect(k[edge] - c[edge], edge).toBeGreaterThanOrEqual(AID_STROKE.casing - 1e-3);
      }
      token.dispose();
    },
  );
});
