import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Box3, Color, Layers, Mesh, type Object3D, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { trailerById, truckById } from '../vehicles/registry';
import { createMirror } from './mirror';
import { REALISM_HUES } from './realism-hues';
import {
  parseTrailerShell,
  type Shells,
  startShells,
  TRAILER_SHELL_URLS,
  type TrailerShell,
} from './glb-shells';
import { TRAILER_LOOKS } from './livery';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import {
  AIDS_LAYER,
  CHASE_LAYERS,
  COCKPIT_LAYERS,
  enableLayers,
  PERSPECTIVE_LAYER,
  TOP_DOWN_LAYERS,
} from './seams';
import {
  EYE_BLOCK,
  LAFETTE,
  lowLoaderDeck,
  PLATE_RADIUS,
  SWING_MARGIN,
  TRAILER_WHEEL_WIDTH,
  trailerFrame,
  trailerShellParams,
} from './trailer-dims';
import { trailerDetail } from './vehicle-detail';
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

/** Plan distance from (tx, 0) to the segment p-q, in three space (x, z). */
function planDistance(tx: number, p: Vector3, q: Vector3): number {
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const length2 = dx * dx + dz * dz;
  const t = length2 === 0 ? 0 : Math.min(1, Math.max(0, ((tx - p.x) * dx - p.z * dz) / length2));
  return Math.hypot(p.x + t * dx - tx, p.z + t * dz);
}

describe.each(TRAILER_IDS)('trailer shell asset of %s', (id) => {
  const spec = trailerById(id);
  const f = trailerFrame(spec);
  const params = trailerShellParams(spec);

  it('keeps the trailer inside its footprint and fills it', async () => {
    const { mesh } = (await load(id)).trailer;
    const box = new Box3().setFromObject(mesh);
    const top = params.lowLoader?.rampTop ?? f.deck + LAFETTE.lampBar.height;
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

  it.runIf(TRAILER_LOOKS[id].kind === 'low-loader')(
    'folds the ramps up to every cockpit eye, and runs from the sloped rear deck up to the raised front',
    async () => {
      const deck = params.lowLoader;
      if (deck === undefined) throw new Error('no low-loader deck');
      for (const truck of TRUCK_IDS) {
        expect(deck.rampTop).toBeGreaterThanOrEqual(truckAnchors(truckById(truck)).eye.z);
      }
      // the lamps sit on the carrier, above the underrun guard's reach below the underside
      expect(deck.rearDeck + spec.tailLamp.sill.value / 1000).toBeGreaterThanOrEqual(f.underside);

      const { mesh } = (await load(id)).trailer;
      mesh.updateWorldMatrix(true, false);
      const positions = mesh.geometry.getAttribute('position');
      const point = new Vector3();
      // whether the deck has a surface at height y inside the side members, within a window in x
      const hasSurface = (x0: number, x1: number, y: number, tolerance: number): boolean => {
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
          if (
            point.x >= x0 &&
            point.x <= x1 &&
            Math.abs(point.z) < f.hw - 0.1 &&
            Math.abs(point.y - y) <= tolerance
          ) {
            return true;
          }
        }
        return false;
      };
      // the grating starts at the rear deck's height just behind the ramps' foot, and the raised front begins at its own
      expect(hasSurface(deck.slopeEnd + 0.03, deck.slopeEnd + 0.05, deck.rearDeck, 0.02)).toBe(
        true,
      );
      expect(
        hasSurface(
          deck.frontStart - TOLERANCE,
          deck.frontStart + TOLERANCE,
          deck.frontDeck,
          TOLERANCE,
        ),
      ).toBe(true);
    },
  );

  it('keeps the dolly between its axle, the turntable and the drawbar eye', async () => {
    const { mesh } = (await load(id)).dolly;
    const box = new Box3().setFromObject(mesh);
    const positions = mesh.geometry.getAttribute('position');
    expect(positions.count).toBeGreaterThanOrEqual(MIN_VERTICES.dolly);
    expect(box.min.x).toBeCloseTo(-PLATE_RADIUS, 2); // the turntable plate
    expect(box.max.x).toBeLessThanOrEqual(f.a.eye.x + EYE_BLOCK.front + TOLERANCE);
    expect(box.max.x).toBeCloseTo(f.a.eye.x + EYE_BLOCK.front, 2);
    expect(Math.max(-box.min.z, box.max.z)).toBeCloseTo(f.track / 2, 2);
    expect(box.min.y).toBeCloseTo(f.axleZ[0], 2);
    expect(box.max.y).toBeCloseTo(Math.max(f.plateTop, f.a.eye.z + EYE_BLOCK.halfHeight), 2);
    // within the body's swing the drawbar stays below the plate, so it clears the deck
    const point = new Vector3();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      if (point.x <= f.kink - TOLERANCE) {
        expect(point.y, `vertex ${i}`).toBeLessThanOrEqual(f.plateTop + TOLERANCE);
      }
    }
  });

  it('keeps everything below the underside out of the swing of the dolly tyres', async () => {
    const { mesh } = (await load(id)).trailer;
    const { geometry } = mesh;
    const positions = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const reach =
      Math.hypot(f.radius + Math.abs(f.a.frontAxle.x), f.track / 2 + TRAILER_WHEEL_WIDTH / 2) +
      SWING_MARGIN;
    const corners = (triangle: number): Vector3[] =>
      [0, 1, 2].map((k) =>
        new Vector3()
          .fromBufferAttribute(positions, index ? index.getX(triangle * 3 + k) : triangle * 3 + k)
          .applyMatrix4(mesh.matrixWorld),
      );
    const triangles = index ? index.count / 3 : positions.count / 3;
    let low = 0;
    for (let t = 0; t < triangles; t++) {
      const [a, b, c] = corners(t);
      if (a === undefined || b === undefined || c === undefined) continue;
      // three space: y is up, the plan is x and z, and the turntable sits on the x axis
      if (Math.min(a.y, b.y, c.y) >= f.underside - TOLERANCE) continue;
      low++;
      for (const [p, q] of [
        [a, b],
        [b, c],
        [c, a],
      ] as const) {
        expect(
          planDistance(f.a.turntable.x, p, q),
          `triangle ${t} reaches the dolly tyres' swing`,
        ).toBeGreaterThanOrEqual(reach - TOLERANCE);
      }
    }
    expect(low).toBeGreaterThan(0);
  });

  it.each(['trailer', 'dolly'] as const)(
    'keeps every %s vertex colour on a livery hue, linear as tint() does',
    async (name) => {
      const { mesh } = (await load(id))[name];
      const hues = Object.values(params.hues).map((hex) => new Color(hex));
      expect(hues.length).toBeGreaterThan(0);
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
      // the trailer shows every hue the livery declares; the dolly at least the base colour
      for (const hue of name === 'trailer' ? hues : hues.slice(0, 1)) {
        expect(
          [...distinct.values()].some((c) => near(c, hue)),
          `${id} ${name} lacks the hue ${hue.getHexString()}`,
        ).toBe(true);
      }
    },
  );
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
    for (const group of [trailer, dolly]) {
      const index = visual.object.children.indexOf(group);
      const moved = (before[index] ?? []).filter(
        ([m, mask]) => group.children.includes(m) && m.layers.mask !== mask,
      );
      expect(moved.length).toBeGreaterThan(0);
      for (const [m] of moved) expect(m.layers.mask).toBe(1 << AIDS_LAYER);
      const added = meshesOf(group).filter((m) => !(before[index] ?? []).some(([b]) => b === m));
      expect(added.length).toBeGreaterThan(0);
      for (const mesh of added) {
        expect(mesh.layers.mask).toBe(1 << PERSPECTIVE_LAYER);
        expect(sees.cockpit.test(mesh.layers)).toBe(true);
        expect(sees.chase.test(mesh.layers)).toBe(true);
        expect(sees.mirror.test(mesh.layers)).toBe(true);
        expect(sees.topDown.test(mesh.layers)).toBe(false);
      }
    }
    // what the top-down camera draws is the same set of meshes
    expect(seenBy(visual.object, sees.topDown)).toEqual(topDownBefore);
  });

  it(
    isBox
      ? 'replaces the detail by one without the swap body marking, and adds the shell'
      : 'replaces the detail by one that follows the deck, and adds the shell',
    async () => {
      const d = deferred(await load(id));
      const visual = proceduralTrailer(spec, palette, d.shells);
      const { trailer } = partsOf(visual);
      const perspective = (): Mesh[] =>
        meshesOf(trailer).filter((m) => m.layers.mask === 1 << PERSPECTIVE_LAYER);
      const before = perspective();
      d.apply();
      const after = perspective();
      const added = after.filter((m) => !before.includes(m));
      const removed = before.filter((m) => !after.includes(m));
      expect(removed).toHaveLength(1);
      // the shell and the new detail, and the lafette's lens mesh
      expect(added).toHaveLength(isBox ? 3 : 2);
      if (isBox) {
        const vertices = (m: Mesh): number => m.geometry.getAttribute('position').count;
        const bare = added.find((m) => vertices(m) < vertices(removed[0] ?? m));
        expect(bare).toBeDefined();
      }
    },
  );

  it.runIf(!isBox)(
    'puts the tail lamps and side contour on the low-loader deck in the shell detail',
    () => {
      const f = trailerFrame(spec);
      const deck = lowLoaderDeck(spec);
      const { shellGeometry } = trailerDetail({
        spec,
        halfWidth: f.hw,
        rearX: f.a.rearX,
        frontX: f.a.frontX,
        deck: f.deck,
        underside: f.underside,
        bodyTop: f.deck,
        isBox: false,
        radius: f.radius,
        track: f.track,
        wheelWidth: TRAILER_WHEEL_WIDTH,
        rearAxleXs: f.a.rearAxles.map((axle) => axle.x),
        shellDeck: deck,
      });
      if (shellGeometry === null) throw new Error('a low-loader has shell detail');
      const heights = (hue: number, xMax: number, reach = Infinity): number[] => {
        const wanted = new Color(hue);
        const colours = shellGeometry.getAttribute('color');
        const positions = shellGeometry.getAttribute('position');
        const out: number[] = [];
        for (let i = 0; i < positions.count; i++) {
          const same =
            Math.abs(colours.getX(i) - wanted.r) < COLOUR_TOLERANCE &&
            Math.abs(colours.getY(i) - wanted.g) < COLOUR_TOLERANCE &&
            Math.abs(colours.getZ(i) - wanted.b) < COLOUR_TOLERANCE;
          const inside = positions.getX(i) <= xMax && Math.abs(positions.getZ(i)) <= reach + 1e-6;
          if (same && inside) out.push(positions.getY(i));
        }
        return out;
      };
      const sill = spec.tailLamp.sill.value / 1000;
      // the clusters, without the end-outline markers outboard of them
      const lamp = heights(
        REALISM_HUES.tailLamp,
        Infinity,
        f.hw - spec.tailLamp.inset.value / 1000,
      );
      expect(lamp.length).toBeGreaterThan(0);
      expect(Math.min(...lamp)).toBeCloseTo(deck.rearDeck + sill, 3);
      expect(Math.max(...lamp)).toBeCloseTo(
        deck.rearDeck + sill + spec.tailLamp.height.value / 1000,
        3,
      );
      // behind the slope the contour strip sits as far below the flat deck's as the rear deck does
      const strip = heights(REALISM_HUES.contourSide, deck.slopeEnd + 1e-3);
      expect(strip.length).toBeGreaterThan(0);
      expect(Math.min(...strip)).toBeCloseTo(
        (f.deck + f.underside) / 2 +
          deck.rearDeck -
          f.deck -
          trailerShellParams(spec).marking.strip / 2,
        3,
      );
    },
  );

  it('restores the procedural meshes, layers and order in both groups when switched off, follows vehicleGlb only, and logs no three.js error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    visual.setQuality({ ...QUALITY_FLAGS.balanced, cabGlb: true, vehicleGlb: false });
    expect(stateOf(visual.object)).toEqual(procedural);
    visual.setQuality({ ...QUALITY_FLAGS.balanced, cabGlb: false, vehicleGlb: true });
    expect(stateOf(visual.object)).toEqual(shown);
    visual.setQuality(QUALITY_FLAGS.low);
    visual.dispose();
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
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

  it('reverts the pair and warns when switching it on fails midway, then succeeds on the next try', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const d = deferred(await load(id));
    const visual = proceduralTrailer(spec, palette, d.shells);
    const procedural = stateOf(visual.object);
    visual.setQuality(QUALITY_FLAGS.low);
    d.apply();
    const { dolly } = partsOf(visual);
    const stuck = vi.spyOn(dolly, 'add').mockImplementation(() => {
      throw new Error('stuck');
    });
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(warn).toHaveBeenCalledOnce();
    expect(stateOf(visual.object)).toEqual(procedural);
    expect(d.attached).toEqual([]);

    stuck.mockRestore();
    visual.setQuality(QUALITY_FLAGS.balanced);
    expect(stateOf(visual.object)).not.toEqual(procedural);
    expect(d.attached).toEqual([[`${id}-trailer`, true]]);
    warn.mockRestore();
  });

  it('loads through startShells, reports the shell once both halves show, and clears it on dispose', async () => {
    const key = `${id}-trailer`;
    const attached: [string, boolean][] = [];
    const shells = startShells<TrailerShell>(TRAILER_SHELL_URLS, {
      load: (url, loaded) => {
        expect(url).toBe(TRAILER_SHELL_URLS[loaded as keyof typeof TRAILER_SHELL_URLS]);
        const owner = TRAILER_IDS.find((other) => `${other}-trailer` === loaded);
        if (owner === undefined) throw new Error(`no trailer for ${loaded}`);
        return load(owner);
      },
      onAttached: (loaded, on) => attached.push([loaded, on]),
    });
    const visual = proceduralTrailer(spec, palette, shells);
    const procedural = stateOf(visual.object);
    await vi.waitFor(() => expect(attached).toEqual([[key, true]]));
    expect(stateOf(visual.object)).not.toEqual(procedural);
    visual.dispose();
    expect(attached).toEqual([
      [key, true],
      [key, false],
    ]);
    expect(stateOf(visual.object)).toEqual(procedural);
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

/** A glb with one coloured triangle per name, for the shapes `parseTrailerShell` must refuse. */
function glbOf(names: readonly string[]): ArrayBuffer {
  const data = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const json = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: names.map((_, i) => i) }],
    nodes: names.map((name, i) => ({ name, mesh: i })),
    meshes: names.map((name) => ({
      name,
      primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 } }],
    })),
    buffers: [{ byteLength: data.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
    ],
  });
  const text = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const out = new Uint8Array(12 + 8 + text.length + 8 + data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, text.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  view.setUint32(20 + text.length, data.byteLength, true);
  view.setUint32(24 + text.length, 0x004e4942, true);
  out.set(new Uint8Array(data.buffer), 28 + text.length);
  return out.buffer;
}

describe('parseTrailerShell', () => {
  it('accepts exactly a trailer and a dolly', async () => {
    const shell = await parseTrailerShell(glbOf(['dolly', 'trailer']));
    expect([shell.trailer.mesh.name, shell.dolly.mesh.name]).toEqual(['trailer', 'dolly']);
    expect([shell.trailer.lens, shell.dolly.lens]).toEqual([null, null]);
  });

  it('accepts a lens mesh for the trailer', async () => {
    const shell = await parseTrailerShell(glbOf(['dolly', 'trailer', 'trailer-lens']));
    expect(shell.trailer.lens?.name).toBe('trailer-lens');
  });

  it.each([
    ['only a trailer', ['trailer']],
    ['only a dolly', ['dolly']],
    ['an extra mesh', ['trailer', 'dolly', 'extra']],
    ['a lens twice', ['trailer', 'dolly', 'trailer-lens', 'trailer-lens']],
    ['another asset', ['cab']],
  ])('rejects a glb with %s', async (_label, names) => {
    await expect(parseTrailerShell(glbOf(names))).rejects.toThrow('expected [dolly, trailer]');
  });
});
