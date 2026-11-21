import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, type BufferGeometry, Color, Layers, Mesh, type Object3D, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRUCK_IDS, type TruckId } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import { bodyFrontX, bodyShellParams, TARP_TOP, TIPPER_RIM } from './body-dims';
import { truckWorkSill } from './lamp-layout';
import { CAB_HEIGHT, CAB_LENGTH, CAB_STRIPE, cabShellParams, FRAME_TOP, RELIEF } from './cab-dims';
import { REALISM_HUES } from './realism-hues';
import {
  parseShell,
  type Shell,
  type ShellKind,
  type Shells,
  startShells,
  type TruckShells,
} from './glb-shells';
import { TRUCK_LOOKS } from './livery';
import { createMirror } from './mirror';
import { KEYS } from './palette';
import { lookFor } from './look';
import { QUALITY_FLAGS, type QualityFlags } from './quality';
import {
  AIDS_LAYER,
  CAB_LAYER,
  CHASE_LAYERS,
  COCKPIT_LAYERS,
  enableLayers,
  PERSPECTIVE_LAYER,
  TOP_DOWN_LAYERS,
  SHADOW_ONLY_LAYER,
} from './seams';
import { proceduralTruck, TWIN_NAME } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

const glb = (key: string): ArrayBuffer => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${key}.glb`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const loadShell = (id: TruckId, kind: ShellKind): Promise<Shell> =>
  parseShell(glb(`${id}-${kind}`), kind);

/** The roof light bar (cab_shell.py BEACON_BASE + BEACON_HEIGHT) stands this far above the roof. */
const BEACON_TOP = 0.14;
/** A tipper's corner posts stand 0.06 m proud of its walls (body_shell.py POST). */
const TIPPER_POST = 0.06;
/** Meshopt quantisation moves positions by a couple of millimetres. */
const TOLERANCE = 5e-3;
/** Well below what the shells have, so only a lost part trips it. */
const MIN_VERTICES = { cab: 600, body: 450 } as const;
const COLOUR_TOLERANCE = 1 / 255;

describe.each(TRUCK_IDS)('shell assets of %s', (id) => {
  const spec = truckById(id);
  const look = TRUCK_LOOKS[id];
  const anchors = truckAnchors(spec);
  const half = spec.width.value / 2000;

  it('decodes the cab into one coloured mesh that fills the cab envelope', async () => {
    const { mesh } = await loadShell(id, 'cab');
    const box = new Box3().setFromObject(mesh);
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThanOrEqual(MIN_VERTICES.cab);
    // the crew cab's tow coupling reaches 0.2 m past the front face
    expect(box.max.x).toBeLessThanOrEqual(anchors.frontX + RELIEF + 0.2 + 1e-3);
    expect(box.max.x).toBeGreaterThanOrEqual(anchors.frontX + RELIEF - 1e-3);
    expect(box.min.x).toBeGreaterThanOrEqual(anchors.frontX - look.cab.length - 1e-3);
    expect(box.min.x).toBeCloseTo(anchors.frontX - look.cab.length, 2);
    expect(Math.max(-box.min.z, box.max.z)).toBeLessThanOrEqual(half + RELIEF + 1e-3);
    expect(Math.max(-box.min.z, box.max.z)).toBeCloseTo(half + RELIEF, 2);
    expect(box.max.y).toBeCloseTo(CAB_HEIGHT + BEACON_TOP, 2);
  });

  it('keeps the windows in a mesh of their own, on the glass hue', async () => {
    const { mesh, glass } = await loadShell(id, 'cab');
    const glassHue = new Color(cabShellParams(spec).hues.glass);
    const isGlass = (m: Mesh, i: number): boolean => {
      const c = m.geometry.getAttribute('color');
      const colour = new Color(c.getX(i), c.getY(i), c.getZ(i));
      return (
        Math.abs(colour.r - glassHue.r) + Math.abs(colour.g - glassHue.g) < 4 * COLOUR_TOLERANCE
      );
    };
    const count = (m: Mesh): number => m.geometry.getAttribute('color').count;
    expect(glass?.name).toBe('cab-glass');
    expect(
      Array.from({ length: count(glass as Mesh) }, (_, i) => isGlass(glass as Mesh, i)),
    ).not.toContain(false);
    expect(Array.from({ length: count(mesh) }, (_, i) => isGlass(mesh, i))).not.toContain(true);
  });

  it('decodes the body into one coloured mesh that fills the body footprint', async () => {
    const { mesh } = await loadShell(id, 'body');
    const box = new Box3().setFromObject(mesh);
    const params = bodyShellParams(spec);
    const proud = params.tipper === undefined ? RELIEF : TIPPER_POST;
    const top = params.tipper === undefined ? TARP_TOP : params.tipper.headboardTop + TIPPER_RIM;
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThanOrEqual(MIN_VERTICES.body);
    expect(box.min.x).toBeGreaterThanOrEqual(anchors.rearX - 1e-3);
    expect(box.min.x).toBeCloseTo(anchors.rearX, 2);
    expect(box.max.x).toBeLessThanOrEqual(bodyFrontX(anchors.frontX, look.cab.length) + 1e-3);
    expect(box.max.x).toBeCloseTo(params.bodyFront, 2);
    expect(Math.max(-box.min.z, box.max.z)).toBeLessThanOrEqual(half + proud + 1e-3);
    expect(Math.max(-box.min.z, box.max.z)).toBeCloseTo(half + proud, 2);
    expect(box.max.y).toBeCloseTo(top, 2);
    // the work lamps stand on the shell's top: on a tarp's roof, a little above a tipper's rim on posts
    const sill = truckWorkSill(spec);
    expect(sill).toBeGreaterThanOrEqual(box.max.y - 1e-3);
    expect(sill - box.max.y).toBeLessThan(look.body.kind === 'tarp' ? 1e-2 : 0.1);
  });

  it.runIf(look.body.kind === 'tipper')(
    'keeps the tipper walls below the cab and its stripe level with the cab stripe',
    async () => {
      const params = bodyShellParams(spec);
      expect(params.tipper?.headboardTop).toBeLessThan(CAB_HEIGHT);
      // the white faces on the outside of each side wall, above the lower front corners and arches
      const stripe = async (kind: ShellKind, beyond: number): Promise<[number, number]> => {
        const { mesh } = await loadShell(id, kind);
        const white = new Color(REALISM_HUES.liveryWhite);
        const positions = mesh.geometry.getAttribute('position');
        const colours = mesh.geometry.getAttribute('color');
        const point = new Vector3();
        let [low, high] = [Infinity, -Infinity];
        for (let i = 0; i < positions.count; i++) {
          const colour = new Color(colours.getX(i), colours.getY(i), colours.getZ(i));
          if (Math.abs(colour.r - white.r) + Math.abs(colour.b - white.b) > 2 * COLOUR_TOLERANCE)
            continue;
          point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
          if (Math.abs(point.z) < beyond - TOLERANCE || point.y < FRAME_TOP + 0.55) continue;
          low = Math.min(low, point.y);
          high = Math.max(high, point.y);
        }
        return [low, high];
      };
      const cab = await stripe('cab', half + RELIEF);
      const body = await stripe('body', half + RELIEF);
      expect(cab[0]).toBeCloseTo(FRAME_TOP + CAB_STRIPE[0], 2);
      expect(cab[1]).toBeCloseTo(FRAME_TOP + CAB_STRIPE[1], 2);
      expect(body[0]).toBeCloseTo(cab[0], 2);
      expect(body[1]).toBeCloseTo(cab[1], 2);
      expect(body[1]).toBeLessThan(params.tipper?.wallTop ?? 0);
    },
  );

  it.each(['cab', 'body'] as const)(
    'keeps every %s vertex colour on a livery hue, linear as tint() does',
    async (kind) => {
      const { mesh } = await loadShell(id, kind);
      const params = kind === 'cab' ? cabShellParams(spec) : bodyShellParams(spec);
      const hues = Object.values(params.hues).map((hex) => new Color(hex));
      const colours = mesh.geometry.getAttribute('color');
      const distinct = new Map<string, Color>();
      for (let i = 0; i < colours.count; i++) {
        const c = new Color(colours.getX(i), colours.getY(i), colours.getZ(i));
        distinct.set(c.getHexString(), c);
      }
      const near = (a: Color, b: Color): boolean =>
        Math.abs(a.r - b.r) <= COLOUR_TOLERANCE &&
        Math.abs(a.g - b.g) <= COLOUR_TOLERANCE &&
        Math.abs(a.b - b.b) <= COLOUR_TOLERANCE;
      for (const [hex, colour] of distinct) {
        expect(
          hues.some((hue) => near(colour, hue)),
          `${id} ${kind} colour ${hex} is no livery hue`,
        ).toBe(true);
      }
      // the livery's base colour is really there, not just allowed
      expect([...distinct.values()].some((c) => near(c, hues[0] ?? new Color()))).toBe(true);
    },
  );

  it.each(['cab', 'body'] as const)('rejects the %s shell under the other name', async (kind) => {
    const other = kind === 'cab' ? 'body' : 'cab';
    await expect(parseShell(glb(`${id}-${kind}`), other)).rejects.toThrow(`expected [${other}]`);
  });
});

const camera = (ids: readonly number[]): Layers => {
  const layers = new Layers();
  enableLayers(layers, ids);
  return layers;
};
const sees = {
  cockpit: camera(COCKPIT_LAYERS),
  chase: camera(CHASE_LAYERS),
  topDown: camera(TOP_DOWN_LAYERS),
  mirror: createMirror().camera.layers,
};

type DeferredShells = {
  shells: TruckShells;
  apply: (kind: ShellKind) => void;
  attached: [string, boolean][];
};

/** Shells that apply on demand, so a test sees the group before and after the swap. */
function deferred(shells: Readonly<Record<ShellKind, Shell>>): DeferredShells {
  const pending: Partial<Record<ShellKind, () => void>> = {};
  const attached: [string, boolean][] = [];
  const side = (kind: ShellKind): Shells => ({
    setEnabled: () => undefined,
    attached: (key, on) => attached.push([key, on]),
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
    attached,
  };
}

const loadBoth = async (id: TruckId) => ({
  cab: await loadShell(id, 'cab'),
  body: await loadShell(id, 'body'),
});

const maskOf = (group: Object3D) => group.children.map((m) => [m, m.layers.mask] as const);
const meshesOf = (group: Object3D): Mesh[] =>
  group.children.filter((m): m is Mesh => m instanceof Mesh);
/** The procedural meshes of `before` that now draw on `layer` only. */
const movedTo = (group: Object3D, before: ReturnType<typeof maskOf>, layer: number): Mesh[] =>
  before
    .filter(([m, mask]) => group.children.includes(m) && m.layers.mask !== mask)
    .filter(([m]) => m.layers.mask === 1 << layer)
    .map(([m]) => m)
    .filter((m): m is Mesh => m instanceof Mesh);
const seenBy = (group: Object3D, layers: Layers): Object3D[] =>
  meshesOf(group).filter((m) => layers.test(m.layers));
const flags = (cabGlb: boolean, vehicleGlb: boolean): QualityFlags => ({
  ...QUALITY_FLAGS.balanced,
  cabGlb,
  vehicleGlb,
});

describe.each(TRUCK_IDS)('shell swap of %s', (id) => {
  const spec = truckById(id);
  const linked = TRUCK_LOOKS[id].cab.length !== CAB_LENGTH;
  /** Loads each shell and applies it; the shells are linked on a longer cab, so both are needed. */
  const applyAll = (d: DeferredShells): void => {
    d.apply('cab');
    d.apply('body');
  };

  it('moves the procedural cab box to the top-down view and shows the cab shell in the mirrors and the chase view only', async () => {
    const d = deferred(await loadBoth(id));
    const group = proceduralTruck(spec, palette, d.shells).object;
    const before = maskOf(group);
    const cabFront = before.filter(([, mask]) => mask === 1 << CAB_LAYER);
    expect(cabFront).toHaveLength(1);
    const topDownBefore = seenBy(group, sees.topDown);
    applyAll(d);

    const added = meshesOf(group).filter((m) => !before.some(([b]) => b === m));
    const shell = added.find((m) => m.layers.mask === 1 << CAB_LAYER);
    expect(shell).toBeDefined();
    expect(group.children).not.toContain(cabFront[0]?.[0]);
    expect(sees.mirror.test(shell?.layers ?? new Layers())).toBe(true);
    expect(sees.chase.test(shell?.layers ?? new Layers())).toBe(true);
    expect(sees.cockpit.test(shell?.layers ?? new Layers())).toBe(false);
    expect(sees.topDown.test(shell?.layers ?? new Layers())).toBe(false);
    // what the top-down camera draws is the same set of meshes
    expect(seenBy(group, sees.topDown)).toEqual(topDownBefore);
    // the procedural cab box is the one mesh the cab swap hands to the top-down view
    const cabBox = movedTo(group, before, AIDS_LAYER).filter((m) => !added.includes(m));
    expect(cabBox.length).toBeGreaterThan(0);
    for (const box of cabBox) {
      expect(sees.chase.test(box.layers), 'chase sees no procedural box').toBe(false);
      expect(sees.mirror.test(box.layers)).toBe(false);
    }
  });

  it('moves the procedural body box to the top-down view and shows the body shell to the perspective views', async () => {
    const d = deferred(await loadBoth(id));
    const group = proceduralTruck(spec, palette, d.shells).object;
    const before = maskOf(group);
    const topDownBefore = seenBy(group, sees.topDown);
    applyAll(d);

    const added = meshesOf(group).filter((m) => !before.some(([b]) => b === m));
    const shell = added.find((m) => m.layers.mask === 1 << PERSPECTIVE_LAYER);
    expect(shell).toBeDefined();
    const layers = shell?.layers ?? new Layers();
    expect(sees.cockpit.test(layers)).toBe(true);
    expect(sees.chase.test(layers)).toBe(true);
    expect(sees.mirror.test(layers)).toBe(true);
    expect(sees.topDown.test(layers)).toBe(false);
    expect(seenBy(group, sees.topDown)).toEqual(topDownBefore);
    // the procedural cab and body boxes are for the top-down view only now
    expect(movedTo(group, before, AIDS_LAYER)).toHaveLength(2);
  });

  it('draws the night twins top-down in place of the tokens, whether or not a shell has taken them', async () => {
    const d = deferred(await loadBoth(id));
    const visual = proceduralTruck(spec, palette, d.shells);
    applyAll(d);
    const all = meshesOf(visual.object);
    // cab, chassis, body: no shell takes the chassis, so it keeps the perspective views
    const twins = all.filter((m) => m.name === TWIN_NAME);
    expect(twins).toHaveLength(3);
    const tokens = twins.map((t) => all.find((m) => m !== t && m.geometry === t.geometry));
    for (const shelled of [false, true]) {
      for (const night of [false, true]) {
        visual.setLook(
          lookFor(
            { ...QUALITY_FLAGS.balanced, cabGlb: shelled, vehicleGlb: shelled },
            night ? 'night' : 'day',
          ),
        );
        const label = `shelled ${String(shelled)}, night ${String(night)}`;
        const topDown = seenBy(visual.object, sees.topDown);
        for (const [i, twin] of twins.entries()) {
          const token = tokens[i];
          expect(token, label).toBeDefined();
          if (token === undefined) continue;
          expect(topDown.includes(twin) && twin.visible, label).toBe(night);
          expect(topDown.includes(token), label).toBe(!night);
          for (const view of ['cockpit', 'mirror', 'chase'] as const) {
            expect(seenBy(visual.object, sees[view]).includes(token), `${label} ${view}`).toBe(
              i === 1 || !shelled,
            );
            expect(sees[view].test(twin.layers)).toBe(false);
          }
          expect(twin.castShadow).toBe(false);
        }
      }
    }
  });

  it('shortens the side marking only where the cab is longer, by swapping the detail mesh', async () => {
    const d = deferred(await loadBoth(id));
    const group = proceduralTruck(spec, palette, d.shells).object;
    const before = [...group.children];
    applyAll(d);
    const removed = before.filter((m) => !group.children.includes(m));
    const added = group.children.filter((m) => !before.includes(m));
    // cab shell, its glass and lenses replace the cab front; the body shell adds one mesh, plus the detail swap when linked
    expect(removed).toHaveLength(linked ? 2 : 1);
    expect(added).toHaveLength(linked ? 6 : 5);
  });

  it('draws no more meshes with the shells than without, apart from the shells themselves', async () => {
    const d = deferred(await loadBoth(id));
    const group = proceduralTruck(spec, palette, d.shells).object;
    const before = group.children.length;
    applyAll(d);
    // cab shell replaces the cab front; its glass, lenses, shadow caster and the body shell are added
    expect(group.children.length).toBe(before + 4);
  });

  it('lets the cab skin cast the sun shadow with a hollow stand-in no camera draws, and its glass only take it', async () => {
    const shells = await loadBoth(id);
    const d = deferred(shells);
    const group = proceduralTruck(spec, palette, d.shells).object;
    applyAll(d);
    const placed = (geometry: BufferGeometry | undefined): Mesh | undefined =>
      meshesOf(group).find((m) => m.geometry === geometry);
    const [cab, glass] = [placed(shells.cab.mesh.geometry), placed(shells.cab.glass?.geometry)];
    expect([cab?.castShadow, cab?.receiveShadow]).toEqual([true, true]);
    expect([glass?.castShadow, glass?.receiveShadow]).toEqual([false, true]);
    const standIn = meshesOf(group).filter((m) => m.layers.mask === 1 << SHADOW_ONLY_LAYER);
    expect(standIn).toHaveLength(1);
    expect([standIn[0]?.castShadow, standIn[0]?.receiveShadow]).toEqual([true, false]);
  });

  it('restores the procedural meshes, layers and order when switched off, and reproduces the swap when switched on again', async () => {
    const d = deferred(await loadBoth(id));
    const visual = proceduralTruck(spec, palette, d.shells);
    const group = visual.object;
    const procedural = maskOf(group);
    applyAll(d);
    const shown = maskOf(group);
    expect(shown).not.toEqual(procedural);

    visual.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    expect(maskOf(group)).toEqual(procedural);
    visual.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    expect(maskOf(group)).toEqual(shown);
    visual.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    expect(maskOf(group)).toEqual(procedural);
  });

  it('leaves the group unchanged when the shells load after Low was chosen, and swaps on the next switch on', async () => {
    const d = deferred(await loadBoth(id));
    const visual = proceduralTruck(spec, palette, d.shells);
    const group = visual.object;
    const procedural = maskOf(group);
    visual.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    applyAll(d);
    expect(maskOf(group)).toEqual(procedural);
    expect(d.attached).toEqual([]);

    visual.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    expect(group.children.length).toBeGreaterThan(procedural.length - 1);
    expect(maskOf(group)).not.toEqual(procedural);
    visual.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    expect(maskOf(group)).toEqual(procedural);
  });

  it('logs no three.js error when toggling the shells off, with or without parts to restore', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = deferred(await loadBoth(id));
    const visual = proceduralTruck(spec, palette, d.shells);
    applyAll(d);
    visual.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    visual.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    visual.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    visual.dispose();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it(
    linked
      ? 'gates the cab and the body of a longer cab as one'
      : 'gates the cab by cabGlb and the body by vehicleGlb, independently',
    async () => {
      const d = deferred(await loadBoth(id));
      const visual = proceduralTruck(spec, palette, d.shells);
      const group = visual.object;
      const procedural = maskOf(group);
      visual.setLook(lookFor(flags(true, false), 'day'));
      applyAll(d);
      const cabOnly = maskOf(group);
      visual.setLook(lookFor(flags(false, true), 'day'));
      const bodyOnly = maskOf(group);
      if (linked) {
        expect(cabOnly).toEqual(procedural);
        expect(bodyOnly).toEqual(procedural);
      } else {
        expect(cabOnly).not.toEqual(procedural);
        expect(bodyOnly).not.toEqual(procedural);
        expect(bodyOnly).not.toEqual(cabOnly);
      }
      visual.setLook(lookFor(flags(false, false), 'day'));
      expect(maskOf(group)).toEqual(procedural);
      visual.setLook(lookFor(flags(true, true), 'day'));
      expect(group.children.length).toBeGreaterThan(procedural.length);
    },
  );

  it('reports a shell when it attaches, not when it merely loads, and clears it on detach and dispose', async () => {
    const d = deferred(await loadBoth(id));
    const visual = proceduralTruck(spec, palette, d.shells);
    visual.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    applyAll(d);
    expect(d.attached).toEqual([]);

    visual.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    expect(d.attached).toEqual([
      [`${id}-cab`, true],
      [`${id}-body`, true],
    ]);
    visual.setLook(lookFor(QUALITY_FLAGS.low, 'day'));
    expect(d.attached.slice(2)).toEqual([
      [`${id}-cab`, false],
      [`${id}-body`, false],
    ]);
    visual.setLook(lookFor(QUALITY_FLAGS.balanced, 'day'));
    visual.dispose();
    expect(d.attached.slice(6)).toEqual([
      [`${id}-cab`, false],
      [`${id}-body`, false],
    ]);
  });

  it('keeps the procedural meshes untouched when applying throws', async () => {
    const shells = await loadBoth(id);
    Object.defineProperty(shells.cab.mesh, 'geometry', {
      get: () => {
        throw new Error('broken shell');
      },
    });
    const d = deferred(shells);
    const group = proceduralTruck(spec, palette, d.shells).object;
    const before = maskOf(group);
    expect(() => {
      applyAll(d);
    }).toThrow('broken shell');
    expect(maskOf(group)).toEqual(before);
    expect(d.attached).toEqual([]);
  });

  it.runIf(linked)('takes the cab back when the body of a longer cab fails to apply', async () => {
    const shells = await loadBoth(id);
    Object.defineProperty(shells.body.mesh, 'geometry', {
      get: () => {
        throw new Error('broken shell');
      },
    });
    const d = deferred(shells);
    const group = proceduralTruck(spec, palette, d.shells).object;
    const before = maskOf(group);
    expect(() => {
      applyAll(d);
    }).toThrow('broken shell');
    expect(maskOf(group)).toEqual(before);
    expect(d.attached.filter(([, on]) => on).length).toBe(
      d.attached.filter(([, on]) => !on).length,
    );
  });

  it('keeps every part procedural when the body fails to load and the cab loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const cab = await loadShell(id, 'cab');
    const urls = { cab: `${id}-cab`, body: `${id}-body` };
    const group = proceduralTruck(spec, palette, {
      cab: startShells({ [urls.cab]: 'cab' }, { load: () => Promise.resolve(cab) }),
      body: startShells(
        { [urls.body]: 'body' },
        { load: () => Promise.reject(new Error('offline')) },
      ),
    }).object;
    const before = maskOf(group);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (linked) expect(maskOf(group)).toEqual(before);
    else expect(maskOf(group)).not.toEqual(before);
    warn.mockRestore();
  });

  it('stops waiting for the shells when disposed', () => {
    const cancel = vi.fn();
    const waiting: Shells = {
      onLoaded: () => cancel,
      attached: () => undefined,
      setEnabled: () => undefined,
    };
    proceduralTruck(spec, palette, { cab: waiting, body: waiting }).dispose();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});

describe('shell loading', () => {
  const urls = { 'man-le-18-280-cab': 'cab' };

  it('keeps the procedural mesh and warns when the load rejects, then retries on the next enable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const shell = await loadShell('man-le-18-280', 'cab');
    const load = vi
      .fn<() => Promise<Shell>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(shell);
    const shells = startShells(urls, { load });
    const apply = vi.fn();
    shells.onLoaded('man-le-18-280-cab', apply);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apply).not.toHaveBeenCalled();

    shells.setEnabled(true);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledExactlyOnceWith(shell));
    expect(load).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('warns about a key without a URL and never applies', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = vi.fn();
    const apply = vi.fn();
    startShells(urls, { load }).onLoaded('unknown-cab', apply)();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warn).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('applies a loaded shell once, and not after cancelling', async () => {
    const shell = await loadShell('man-le-18-280', 'cab');
    const shells = startShells(urls, { load: () => Promise.resolve(shell) });
    const apply = vi.fn();
    const cancelled = vi.fn();
    shells.onLoaded('man-le-18-280-cab', apply);
    shells.onLoaded('man-le-18-280-cab', cancelled)();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledExactlyOnceWith(shell));
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('reports a shell when its first visual takes it and when its last lets go', () => {
    const onAttached = vi.fn();
    const shells = startShells(urls, { enabled: false, onAttached });
    shells.attached('man-le-18-280-cab', true);
    shells.attached('man-le-18-280-cab', true);
    shells.attached('man-le-18-280-cab', false);
    expect(onAttached).toHaveBeenCalledExactlyOnceWith('man-le-18-280-cab', true);
    shells.attached('man-le-18-280-cab', false);
    shells.attached('man-le-18-280-cab', false);
    expect(onAttached).toHaveBeenCalledTimes(2);
    expect(onAttached).toHaveBeenLastCalledWith('man-le-18-280-cab', false);
  });

  it('downloads nothing until enabled', async () => {
    const shell = await loadShell('man-le-18-280', 'cab');
    const load = vi.fn(() => Promise.resolve(shell));
    const shells = startShells(urls, { load, enabled: false });
    const apply = vi.fn();
    shells.onLoaded('man-le-18-280-cab', apply);
    shells.setEnabled(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(load).not.toHaveBeenCalled();
    shells.setEnabled(true);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(load).toHaveBeenCalledOnce();
  });
});
