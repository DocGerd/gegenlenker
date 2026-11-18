import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Color, Layers, Mesh, type Object3D, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, type TrailerId } from '../contracts/vehicle';
import { trailerById } from '../vehicles/registry';
import { createMirror } from './mirror';
import { parseTrailerShell, type Shells, startShells, type TrailerShell } from './glb-shells';
import { TRAILER_LOOKS } from './livery';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import {
  AIDS_LAYER,
  CHASE_LAYERS,
  COCKPIT_LAYERS,
  enableLayers,
  SKY_LAYER,
  TOP_DOWN_LAYERS,
} from './seams';
import { RAMP_HEIGHT, trailerFrame, trailerShellParams } from './trailer-dims';
import { proceduralTrailer } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

const glb = (id: TrailerId): ArrayBuffer => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-trailer.glb`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const load = (id: TrailerId): Promise<TrailerShell> => parseTrailerShell(glb(id));

/** Well below what the shells have, so only a lost part trips it. */
const MIN_VERTICES = { trailer: 600, dolly: 250 } as const;
/** Meshopt quantisation moves positions by a couple of millimetres. */
const TOLERANCE = 5e-3;
const COLOUR_TOLERANCE = 1 / 255;
/** Heights above the deck of the tallest parts: the ramps, or the lamp carrier (trailer_shell.py LAMP_BAR). */
const LAMP_BAR_HEIGHT = 0.4;

describe.each(TRAILER_IDS)('trailer shell asset of %s', (id) => {
  const spec = trailerById(id);
  const f = trailerFrame(spec);
  const params = trailerShellParams(spec);

  it('keeps the trailer inside its footprint and fills it', async () => {
    const { mesh } = (await load(id)).trailer;
    const box = new Box3().setFromObject(mesh);
    const top = f.deck + (TRAILER_LOOKS[id].kind === 'low-loader' ? RAMP_HEIGHT : LAMP_BAR_HEIGHT);
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThanOrEqual(
      MIN_VERTICES.trailer,
    );
    expect(box.min.x).toBeGreaterThanOrEqual(f.a.rearX - TOLERANCE);
    expect(box.min.x).toBeCloseTo(f.a.rearX, 2);
    expect(box.max.x).toBeLessThanOrEqual(f.a.frontX + TOLERANCE);
    expect(box.max.x).toBeCloseTo(f.a.frontX, 2);
    expect(Math.max(-box.min.z, box.max.z)).toBeLessThanOrEqual(f.hw + TOLERANCE);
    expect(Math.max(-box.min.z, box.max.z)).toBeCloseTo(f.hw, 2);
    expect(box.min.y).toBeGreaterThanOrEqual(f.axleZ[0] - TOLERANCE);
    expect(box.min.y).toBeCloseTo(f.axleZ[0], 2);
    expect(box.max.y).toBeLessThanOrEqual(top + TOLERANCE);
    expect(box.max.y).toBeCloseTo(top, 2);
  });

  it('keeps the dolly between its axle, the turntable and the drawbar eye', async () => {
    const { mesh } = (await load(id)).dolly;
    const box = new Box3().setFromObject(mesh);
    const positions = mesh.geometry.getAttribute('position');
    expect(positions.count).toBeGreaterThanOrEqual(MIN_VERTICES.dolly);
    expect(box.min.x).toBeCloseTo(-0.5, 2); // the turntable plate
    expect(box.max.x).toBeLessThanOrEqual(f.a.eye.x + 0.05 + TOLERANCE);
    expect(box.max.x).toBeCloseTo(f.a.eye.x + 0.05, 2);
    expect(Math.max(-box.min.z, box.max.z)).toBeCloseTo(f.track / 2, 2);
    expect(box.min.y).toBeCloseTo(f.axleZ[0], 2);
    expect(box.max.y).toBeCloseTo(Math.max(f.plateTop, f.a.eye.z + 0.07), 2);
    // within the body's swing the drawbar stays below the plate, so it clears the deck
    const point = new Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (point.x <= f.kink - TOLERANCE) {
        expect(point.y, `vertex ${i}`).toBeLessThanOrEqual(f.plateTop + TOLERANCE);
      }
    }
  });

  it.each(['trailer', 'dolly'] as const)(
    'keeps every %s vertex colour on a livery hue, linear as tint() does',
    async (name) => {
      const { mesh } = (await load(id))[name];
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
          `${id} ${name} colour ${hex} is no livery hue`,
        ).toBe(true);
      }
      // the livery's base colour is really there
      expect([...distinct.values()].some((c) => near(c, hues[0] ?? new Color()))).toBe(true);
      if (name === 'trailer') {
        // every hue the livery declares shows on the trailer
        for (const hue of hues) {
          expect([...distinct.values()].some((c) => near(c, hue))).toBe(true);
        }
      }
    },
  );

  it('rejects a glb that lacks a trailer or a dolly', async () => {
    const bytes = readFileSync(join(import.meta.dirname, 'assets/man-le-18-280-cab.glb'));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await expect(parseTrailerShell(data)).rejects.toThrow('expected [dolly, trailer]');
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

type Deferred = {
  shells: Shells<TrailerShell>;
  apply: () => void;
  attached: [string, boolean][];
};

/** A shell that applies on demand, so a test sees the groups before and after the swap. */
function deferred(shell: TrailerShell): Deferred {
  let pending: (() => void) | null = null;
  const attached: [string, boolean][] = [];
  return {
    shells: {
      setEnabled: () => undefined,
      attached: (key, on) => attached.push([key, on]),
      onLoaded: (_key, cb) => {
        pending = () => {
          cb(shell);
        };
        return () => undefined;
      },
    },
    apply: () => {
      pending?.();
    },
    attached,
  };
}

const maskOf = (group: Object3D) => group.children.map((m) => [m, m.layers.mask] as const);
const stateOf = (root: Object3D) => root.children.map((part) => maskOf(part));
const meshesOf = (group: Object3D): Mesh[] =>
  group.children.filter((m): m is Mesh => m instanceof Mesh);
const seenBy = (root: Object3D, layers: Layers): Object3D[] =>
  root.children.flatMap((part) => meshesOf(part).filter((m) => layers.test(m.layers)));
const partsOf = (visual: { object: Object3D }) => {
  const [dolly, trailer] = visual.object.children;
  if (dolly === undefined || trailer === undefined) throw new Error('trailer lacks its groups');
  return { dolly, trailer };
};

describe.each(TRAILER_IDS)('trailer shell swap of %s', (id) => {
  const spec = trailerById(id);
  const isBox = spec.body === 'box';

  it('moves the procedural body, frame and dolly chassis to the top-down view and shows the shells to the perspective views', async () => {
    const d = deferred(await load(id));
    const visual = proceduralTrailer(spec, palette, d.shells);
    const before = stateOf(visual.object);
    const topDownBefore = seenBy(visual.object, sees.topDown);
    d.apply();

    const { dolly, trailer } = partsOf(visual);
    for (const [group, count] of [
      [trailer, 2],
      [dolly, 1],
    ] as const) {
      const index = visual.object.children.indexOf(group);
      const moved = (before[index] ?? []).filter(
        ([m, mask]) => group.children.includes(m) && m.layers.mask !== mask,
      );
      expect(moved).toHaveLength(count);
      for (const [m] of moved) expect(m.layers.mask).toBe(1 << AIDS_LAYER);
      const added = meshesOf(group).filter((m) => !(before[index] ?? []).some(([b]) => b === m));
      expect(added).toHaveLength(1);
      const shell = added[0]?.layers ?? new Layers();
      expect(added[0]?.layers.mask).toBe(1 << SKY_LAYER);
      expect(sees.cockpit.test(shell)).toBe(true);
      expect(sees.chase.test(shell)).toBe(true);
      expect(sees.mirror.test(shell)).toBe(true);
      expect(sees.topDown.test(shell)).toBe(false);
    }
    // what the top-down camera draws is the same set of meshes
    expect(seenBy(visual.object, sees.topDown)).toEqual(topDownBefore);
  });

  it(
    isBox
      ? 'takes the swap body marking away with the box'
      : 'keeps every detail mesh, as there is no box to mark',
    async () => {
      const d = deferred(await load(id));
      const visual = proceduralTrailer(spec, palette, d.shells);
      const { trailer } = partsOf(visual);
      const sky = (): Mesh[] => meshesOf(trailer).filter((m) => m.layers.mask === 1 << SKY_LAYER);
      const before = sky().length;
      d.apply();
      const removed = isBox ? 1 : 0;
      // the shell is one more SKY mesh
      expect(sky().length).toBe(before - removed + 1);
    },
  );

  it('restores the procedural meshes, layers and order in both groups when switched off, and reproduces the swap when switched on again', async () => {
    const d = deferred(await load(id));
    const visual = proceduralTrailer(spec, palette, d.shells);
    const procedural = stateOf(visual.object);
    d.apply();
    const shown = stateOf(visual.object);
    expect(shown).not.toEqual(procedural);

    visual.setQuality(QUALITY_FLAGS.low);
    expect(stateOf(visual.object)).toEqual(procedural);
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(stateOf(visual.object)).toEqual(shown);
    visual.setQuality(QUALITY_FLAGS.low);
    expect(stateOf(visual.object)).toEqual(procedural);
  });

  it('leaves the groups unchanged when the shell loads after Low was chosen, and swaps on the next switch on', async () => {
    const d = deferred(await load(id));
    const visual = proceduralTrailer(spec, palette, d.shells);
    const procedural = stateOf(visual.object);
    visual.setQuality(QUALITY_FLAGS.low);
    d.apply();
    expect(stateOf(visual.object)).toEqual(procedural);
    expect(d.attached).toEqual([]);

    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(stateOf(visual.object)).not.toEqual(procedural);
    visual.setQuality(QUALITY_FLAGS.low);
    expect(stateOf(visual.object)).toEqual(procedural);
  });

  it('logs no three.js error when toggling the shell off, with or without parts to restore', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = deferred(await load(id));
    const visual = proceduralTrailer(spec, palette, d.shells);
    d.apply();
    visual.setQuality(QUALITY_FLAGS.low);
    visual.setQuality(QUALITY_FLAGS.balanced);
    visual.setQuality(QUALITY_FLAGS.low);
    visual.dispose();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('follows vehicleGlb only, not cabGlb', async () => {
    const d = deferred(await load(id));
    const visual = proceduralTrailer(spec, palette, d.shells);
    const procedural = stateOf(visual.object);
    visual.setQuality({ ...QUALITY_FLAGS.balanced, cabGlb: false, vehicleGlb: true });
    d.apply();
    const shown = stateOf(visual.object);
    expect(shown).not.toEqual(procedural);
    visual.setQuality({ ...QUALITY_FLAGS.balanced, cabGlb: true, vehicleGlb: false });
    expect(stateOf(visual.object)).toEqual(procedural);
    visual.setQuality({ ...QUALITY_FLAGS.balanced, cabGlb: false, vehicleGlb: true });
    expect(stateOf(visual.object)).toEqual(shown);
  });

  it('reports the shell once when it attaches, not when it merely loads, and clears it on detach and dispose', async () => {
    const d = deferred(await load(id));
    const visual = proceduralTrailer(spec, palette, d.shells);
    visual.setQuality(QUALITY_FLAGS.low);
    d.apply();
    expect(d.attached).toEqual([]);

    const key = `${id}-trailer`;
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(d.attached).toEqual([[key, true]]);
    visual.setQuality(QUALITY_FLAGS.low);
    expect(d.attached.slice(1)).toEqual([[key, false]]);
    visual.setQuality(QUALITY_FLAGS.balanced);
    visual.dispose();
    expect(d.attached.slice(3)).toEqual([[key, false]]);
  });

  it('keeps the procedural meshes when the dolly fails to apply, after the trailer has applied', async () => {
    const shell = await load(id);
    Object.defineProperty(shell.dolly.mesh, 'geometry', {
      get: () => {
        throw new Error('broken shell');
      },
    });
    const d = deferred(shell);
    const visual = proceduralTrailer(spec, palette, d.shells);
    const before = stateOf(visual.object);
    expect(() => {
      d.apply();
    }).toThrow('broken shell');
    expect(stateOf(visual.object)).toEqual(before);
    expect(d.attached.filter(([, on]) => on).length).toBe(
      d.attached.filter(([, on]) => !on).length,
    );
  });

  it('keeps every part procedural and warns when the shell fails to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const visual = proceduralTrailer(
      spec,
      palette,
      startShells<TrailerShell>(
        { [`${id}-trailer`]: 'trailer' },
        { load: () => Promise.reject(new Error('offline')) },
      ),
    );
    const before = stateOf(visual.object);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stateOf(visual.object)).toEqual(before);
    warn.mockRestore();
  });

  it('stops waiting for the shell when disposed', () => {
    const cancel = vi.fn();
    const waiting: Shells<TrailerShell> = {
      onLoaded: () => cancel,
      attached: () => undefined,
      setEnabled: () => undefined,
    };
    proceduralTrailer(spec, palette, waiting).dispose();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
