import { BoxGeometry, Color, Layers, Mesh, type Object3D, Texture, Vector3 } from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AttributeNode, MeshLambertNodeMaterial, type Node, UniformArrayNode } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { parseShell, parseTrailerShell, type Shell, type Shells } from './glb-shells';
import {
  bodyLampParams,
  cabLampParams,
  type Lamp,
  LAMP_COLOURS,
  type LampColour,
  type LampFacing,
  type LampFn,
  type Range,
  trailerLampParams,
  trailerLamps,
  truckLamps,
} from './lamp-layout';
import {
  createDetailMaterial,
  createLampEmission,
  DARK_SLOT,
  LENS_SLOTS,
  SLOT_ATTRIBUTE,
  slotOf,
  slotShell,
  tagShellLenses,
  withSlot,
} from './lamp-lens';
import { lampState } from './lamp-state';
import { TRUCK_LOOKS } from './livery';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { enableLayers, TOP_DOWN_LAYERS } from './seams';
import { VehicleNodeMaterial } from './vehicle-pbr';
import { proceduralTrailer, proceduralTruck } from './vehicle-visual';

const glb = (key: string): ArrayBuffer => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${key}.glb`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const cabLenses = (id: TruckId): Lamp[] =>
  truckLamps(truckById(id), TRUCK_LOOKS[id].cab.length).lamps.filter((l) => l.part === 'cab');
const lafetteLenses = (id: TrailerId): Lamp[] =>
  trailerLamps(trailerById(id), 'shell').lamps.filter((l) => l.shell && l.part === 'trailer');

/** Each lens is one box in the glb (shell_common.py `lens_shape`). */
const BOX_TRIANGLES = 12;

const slotsOf = (mesh: Mesh): number[] => {
  const slots = mesh.geometry.getAttribute(SLOT_ATTRIBUTE);
  return Array.from({ length: slots.count }, (_, i) => slots.getX(i));
};

describe('lamp lenses', () => {
  it('give every lens of every layout a slot', () => {
    const lamps = [
      ...TRUCK_IDS.flatMap((id) => [...truckLamps(truckById(id)).lamps, ...cabLenses(id)]),
      ...TRAILER_IDS.flatMap((id) =>
        (['procedural', 'shell'] as const).flatMap((v) => trailerLamps(trailerById(id), v).lamps),
      ),
    ];
    for (const lamp of lamps) expect(slotOf(lamp.fns), lamp.id).not.toBe(DARK_SLOT);
  });

  it('put everything that is no lens in the dark slot', () => {
    const slots = withSlot(new BoxGeometry()).getAttribute(SLOT_ATTRIBUTE);
    expect(new Set(Array.from({ length: slots.count }, (_, i) => slots.getX(i)))).toEqual(
      new Set([DARK_SLOT]),
    );
  });

  const shells: readonly [string, () => Promise<Shell>, Lamp[]][] = [
    ...TRUCK_IDS.flatMap((id): [string, () => Promise<Shell>, Lamp[]][] => [
      [`${id}-cab`, () => parseShell(glb(`${id}-cab`), 'cab'), cabLenses(id)],
      [`${id}-body`, () => parseShell(glb(`${id}-body`), 'body'), []],
    ]),
    ...TRAILER_IDS.flatMap((id): [string, () => Promise<Shell>, Lamp[]][] => [
      [
        `${id}-trailer`,
        async () => (await parseTrailerShell(glb(`${id}-trailer`))).trailer,
        lafetteLenses(id),
      ],
      [`${id}-dolly`, async () => (await parseTrailerShell(glb(`${id}-trailer`))).dolly, []],
    ]),
  ];

  it.each(shells)(
    'give the %s glb a lens mesh exactly when its layout has shell lenses',
    async (_, load, lamps) => {
      expect((await load()).lens !== null).toBe(lamps.length > 0);
    },
  );

  it.each(shells.filter(([, , lamps]) => lamps.length > 0))(
    'give each lens of the %s shell its own slot on every one of its triangles',
    async (_, load, lamps) => {
      const { lens } = await load();
      if (lens === null) throw new Error('the shell has no lens mesh');
      const slots = slotsOf(new Mesh(tagShellLenses(lens.geometry, lens.matrixWorld, lamps)));
      for (let t = 0; t < slots.length; t += 3) {
        expect(new Set(slots.slice(t, t + 3)).size, `triangle ${t / 3}`).toBe(1);
      }
      const triangles = new Map<number, number>();
      for (let t = 0; t < slots.length; t += 3) {
        const slot = slots[t] ?? DARK_SLOT;
        triangles.set(slot, (triangles.get(slot) ?? 0) + 1);
      }
      const lensesPerSlot = new Map<number, number>();
      for (const l of lamps) {
        lensesPerSlot.set(slotOf(l.fns), (lensesPerSlot.get(slotOf(l.fns)) ?? 0) + 1);
      }
      expect(triangles).toEqual(
        new Map([...lensesPerSlot].map(([s, n]) => [s, n * BOX_TRIANGLES])),
      );
    },
  );

  it('refuse a shell whose lens mesh and layout disagree', async () => {
    const cab = await parseShell(glb('arocs-1835-ak-cab'), 'cab');
    expect(() => {
      slotShell({ mesh: cab.mesh, lens: null }, cabLenses('arocs-1835-ak'));
    }).toThrow('no lens mesh');
    expect(() => {
      slotShell(cab, []);
    }).toThrow('a lens mesh');
  });

  it('refuse a lafette lens triangle that lies on no lamp, or on two', async () => {
    const { lens } = (await parseTrailerShell(glb('krone-azw-18-trailer'))).trailer;
    if (lens === null) throw new Error('the lafette shell has no lens mesh');
    const lamps = lafetteLenses('krone-azw-18');
    const tag = (from: readonly Lamp[]) => tagShellLenses(lens.geometry, lens.matrixWorld, from);
    expect(() => tag(lamps)).not.toThrow();
    expect(() => tag(lamps.slice(1))).toThrow('lies on 0 lamps');
    const [first] = lamps;
    if (first === undefined) throw new Error('no lafette lenses');
    expect(() => tag([...lamps, { ...first, id: 'twin', fns: ['side-marker'] }])).toThrow(
      'lies on 2 lamps',
    );
  });

  it('light each slot in its R48 colour', () => {
    const lamps = createLampEmission();
    const levels = Object.fromEntries(Object.keys(LAMP_COLOURS).map((fn) => [fn, 1]));
    lamps.update({ levels: levels as Record<LampFn, number>, flashing: false });
    const looks: Record<LampColour, (c: Color) => boolean> = {
      white: (c) => Math.min(c.r, c.g, c.b) > 0.8,
      red: (c) => c.r > 0.5 && Math.max(c.g, c.b) < 0.05,
      amber: (c) => c.r > 0.5 && c.g > 0.1 && c.g < c.r && c.b < 0.05,
    };
    LENS_SLOTS.forEach((fns, index) => {
      const c = lamps.emission[index + 1] ?? new Color();
      expect(looks[LAMP_COLOURS[fns[0]]](c), fns.join('+')).toBe(true);
    });
  });

  it('switch only the stop and reversing slots by day, and never light the dark slot', () => {
    const lamps = createLampEmission();
    const lit = (): number[] =>
      lamps.emission.flatMap((c, slot) => (c.r + c.g + c.b > 0 ? [slot] : []));
    const drive = (brake: boolean, gear: 'D' | 'R') => ({
      time: 0,
      control: { steer: 0, lever: 0, brake, gear },
    });
    lamps.update(lampState(drive(false, 'D')));
    expect(lit()).toEqual([]);
    lamps.update(lampState(drive(true, 'R')));
    expect(lit()).toEqual(
      [slotOf(['rear-position', 'stop']), slotOf(['reversing'])].sort((a, b) => a - b),
    );
    lamps.update(lampState(drive(true, 'R'), { night: true, hazard: true }));
    expect(lamps.emission[DARK_SLOT]?.getHex()).toBe(0);
    expect(lamps.emission).toHaveLength(LENS_SLOTS.length + 1);
  });

  it('read each lens emission from the uniform array by the lampSlot attribute', () => {
    const lamps = createLampEmission();
    const found: Node[] = [];
    const walk = (node: Node): void => {
      found.push(node);
      for (const child of node.getChildren()) walk(child);
    };
    walk(lamps.node);
    expect(
      found.some((n) => n instanceof AttributeNode && Object.values(n).includes(SLOT_ATTRIBUTE)),
    ).toBe(true);
    expect(found.some((n) => n instanceof UniformArrayNode && n.array === lamps.emission)).toBe(
      true,
    );
    expect(createDetailMaterial(lamps).emissiveNode).toBe(lamps.node);
  });
});

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const topDown = new Layers();
enableLayers(topDown, TOP_DOWN_LAYERS);
const env = {
  attach: () => undefined,
  texture: () => new Texture(),
  onChange: () => () => undefined,
  reportApplied: () => undefined,
  dispose: () => undefined,
};

/** A shell source whose loaded shells are handed over by `deliver`, after the visual is built. */
function source<S>(shell: S): { shells: Shells<S>; deliver: () => void } {
  const waiting: ((s: S) => void)[] = [];
  return {
    shells: {
      setEnabled: () => undefined,
      attached: () => undefined,
      onLoaded: (_key, apply) => {
        waiting.push(apply);
        return () => undefined;
      },
    },
    deliver: () => {
      for (const apply of waiting) apply(shell);
    },
  };
}

function lampMeshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const m = o.material as unknown;
    if (
      (m instanceof MeshLambertNodeMaterial && m.vertexColors) ||
      m instanceof VehicleNodeMaterial
    )
      out.push(o as Mesh);
  });
  return out;
}

/** Every mesh that draws lenses: one valid slot per vertex, lenses off the top-down view, the layout's slots lit. */
function expectSlots(
  root: Object3D,
  layout: readonly Lamp[],
  dark: readonly Mesh[],
  pbr: boolean,
): void {
  const meshes = lampMeshes(root);
  expect(meshes.length).toBeGreaterThan(0);
  expect(meshes.some((m) => m.material instanceof VehicleNodeMaterial)).toBe(pbr);
  const shown = new Set<number>();
  const node = (meshes[0]?.material as MeshLambertNodeMaterial).emissiveNode;
  expect(node).not.toBeNull();
  for (const mesh of meshes) {
    expect((mesh.material as MeshLambertNodeMaterial).emissiveNode).toBe(node);
    const slots = slotsOf(mesh);
    expect(slots).toHaveLength(mesh.geometry.getAttribute('position').count);
    for (const s of new Set(slots)) {
      expect(Number.isInteger(s) && s >= DARK_SLOT && s <= LENS_SLOTS.length, `slot ${s}`).toBe(
        true,
      );
      if (s !== DARK_SLOT) {
        expect(mesh.layers.test(topDown), 'a lens the top-down view draws').toBe(false);
        shown.add(s);
      }
    }
  }
  expect(shown).toEqual(new Set(layout.map((l) => slotOf(l.fns))));
  for (const mesh of dark) expect(new Set(slotsOf(mesh))).toEqual(new Set([DARK_SLOT]));
}

/** The slots a visual's lamp emission lights, read from the uniform array its lens meshes draw with. */
function litSlots(root: Object3D): number[] {
  const [mesh] = lampMeshes(root);
  const node = (mesh?.material as MeshLambertNodeMaterial | undefined)?.emissiveNode ?? null;
  if (node === null) throw new Error('no lamp emission');
  const arrays: Color[][] = [];
  const walk = (n: Node): void => {
    if (n instanceof UniformArrayNode) arrays.push(n.array as Color[]);
    for (const child of n.getChildren()) walk(child);
  };
  walk(node);
  const [emission] = arrays;
  if (emission === undefined || arrays.length !== 1) throw new Error('no one uniform array');
  return emission.flatMap((c, slot) => (c.r + c.g + c.b > 0 ? [slot] : []));
}

const STOP_AND_REVERSE = [slotOf(['rear-position', 'stop']), slotOf(['reversing'])];

/** A standstill snapshot of the combination with the brake held in R, and one in D without it. */
function snapshots(truck: TruckId, trailer: TrailerId): [SimSnapshot, SimSnapshot] {
  const sim = createSimulation(
    resolveCombination(truckById(truck), trailerById(trailer)),
    { truck: { x: 0, y: 0, heading: 0 } },
    () => null,
  );
  const snapshot = sim.snapshot();
  return [
    { ...snapshot, control: { ...snapshot.control, brake: true, gear: 'R' } },
    { ...snapshot, control: { ...snapshot.control, brake: false, gear: 'D' } },
  ];
}

const shellMeshes = (root: Object3D, shells: readonly Shell[]): Mesh[] => {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh && shells.some((s) => s.mesh.geometry === o.geometry))
      out.push(o as Mesh);
  });
  return out;
};

describe.each(TRUCK_IDS)('lamp slots of the %s truck', (id) => {
  const spec = truckById(id);
  const lamps = truckLamps(spec).lamps;

  it('light the stop and reversing lamps from the snapshot', () => {
    const visual = proceduralTruck(spec, palette, undefined, env);
    const [braking, driving] = snapshots(id, TRAILER_IDS[0]);
    visual.update(braking);
    expect(litSlots(visual.object)).toEqual(STOP_AND_REVERSE);
    visual.update(driving);
    expect(litSlots(visual.object)).toEqual([]);
    visual.dispose();
  });

  it('carry the layout without shells', () => {
    const visual = proceduralTruck(spec, palette, undefined, env);
    for (const preset of ['balanced', 'high'] as const) {
      visual.setQuality(QUALITY_FLAGS[preset]);
      expectSlots(visual.object, lamps, [], preset === 'high');
    }
    visual.dispose();
  });

  it('carry the layout with shells, dark on the shells themselves', async () => {
    const [cab, body] = await Promise.all([
      parseShell(glb(`${id}-cab`), 'cab'),
      parseShell(glb(`${id}-body`), 'body'),
    ]);
    const [cabs, bodies] = [source(cab), source(body)];
    const visual = proceduralTruck(spec, palette, { cab: cabs.shells, body: bodies.shells }, env);
    cabs.deliver();
    bodies.deliver();
    for (const preset of ['balanced', 'high'] as const) {
      visual.setQuality(QUALITY_FLAGS[preset]);
      const dark = shellMeshes(visual.object, [cab, body]);
      expect(dark).toHaveLength(2);
      expectSlots(visual.object, lamps, dark, preset === 'high');
    }
    visual.dispose();
  });
});

describe.each(TRAILER_IDS)('lamp slots of the %s trailer', (id) => {
  const spec = trailerById(id);

  it('light the stop and reversing lamps from the snapshot', () => {
    const visual = proceduralTrailer(spec, palette, undefined, env);
    const [braking, driving] = snapshots(TRUCK_IDS[0], id);
    visual.update(braking);
    expect(litSlots(visual.object)).toEqual(STOP_AND_REVERSE);
    visual.update(driving);
    expect(litSlots(visual.object)).toEqual([]);
    visual.dispose();
  });

  it('carry the layout without shells', () => {
    const visual = proceduralTrailer(spec, palette, undefined, env);
    for (const preset of ['balanced', 'high'] as const) {
      visual.setQuality(QUALITY_FLAGS[preset]);
      expectSlots(visual.object, trailerLamps(spec, 'procedural').lamps, [], preset === 'high');
    }
    visual.dispose();
  });

  it('carry the layout with the shell, dark on the shell and dolly themselves', async () => {
    const shell = await parseTrailerShell(glb(`${id}-trailer`));
    const loaded = source(shell);
    const visual = proceduralTrailer(spec, palette, loaded.shells, env);
    loaded.deliver();
    for (const preset of ['balanced', 'high'] as const) {
      visual.setQuality(QUALITY_FLAGS[preset]);
      const dark = shellMeshes(visual.object, [shell.trailer, shell.dolly]);
      expect(dark).toHaveLength(2);
      expectSlots(visual.object, trailerLamps(spec, 'shell').lamps, dark, preset === 'high');
    }
    visual.dispose();
  });
});

type Seat = { readonly id: string; readonly box: readonly Range[]; readonly facing: LampFacing };

/** The face a lens stands on, per facing: its axis, which end of the lens box, the other two axes. */
const BACKS: Readonly<Record<LampFacing, readonly [number, 0 | 1, number, number]>> = {
  front: [0, 0, 1, 2],
  rear: [0, 1, 1, 2],
  left: [1, 0, 0, 2],
  right: [1, 1, 0, 2],
};
const SEAT_GRID = 7;
const SEAT_TOLERANCE = 1e-3; // above the optimiser's quantisation

/** Grid points on each lamp's back face that no triangle of the shell mesh covers. */
function unseated(shell: Shell, seats: readonly Seat[]): string[] {
  const { geometry, matrixWorld } = shell.mesh;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const corner = new Vector3();
  const at = (i: number): number[] => {
    corner
      .fromBufferAttribute(position, index === null ? i : index.getX(i))
      .applyMatrix4(matrixWorld);
    return [corner.x, -corner.z, corner.y];
  };
  const triangles: number[][][] = [];
  for (let i = 0; i < (index ?? position).count; i += 3)
    triangles.push([at(i), at(i + 1), at(i + 2)]);
  const missing: string[] = [];
  for (const seat of seats) {
    const [axis, end, u, v] = BACKS[seat.facing];
    const plane = seat.box[axis]?.[end] ?? NaN;
    const faces = triangles
      .filter((t) => t.every((p) => Math.abs((p[axis] ?? NaN) - plane) < SEAT_TOLERANCE))
      .map((t) => t.map((p) => [p[u] ?? NaN, p[v] ?? NaN] as const));
    const covered = (x: number, y: number): boolean =>
      faces.some(([a, b, c]) => {
        if (a === undefined || b === undefined || c === undefined) return false;
        const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if (Math.abs(area) < 1e-12) return false;
        const s1 = ((b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y)) / area;
        const s2 = ((c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y)) / area;
        const slack = SEAT_TOLERANCE / Math.sqrt(Math.abs(area));
        return s1 >= -slack && s2 >= -slack && 1 - s1 - s2 >= -slack;
      });
    const [[u0, u1], [v0, v1]] = [seat.box[u] ?? [0, 0], seat.box[v] ?? [0, 0]];
    for (let i = 0; i < SEAT_GRID; i++) {
      for (let j = 0; j < SEAT_GRID; j++) {
        const [fu, fv] = [(i + 0.5) / SEAT_GRID, (j + 0.5) / SEAT_GRID];
        if (!covered(u0 + (u1 - u0) * fu, v0 + (v1 - v0) * fv))
          missing.push(`${seat.id} at ${fu.toFixed(2)}, ${fv.toFixed(2)}`);
      }
    }
  }
  return missing;
}

describe('lamp seats in the shipped shells', () => {
  const cases: readonly [string, () => Promise<Shell>, readonly Seat[]][] = [
    ...TRUCK_IDS.flatMap((id): [string, () => Promise<Shell>, readonly Seat[]][] => {
      const [spec, length] = [truckById(id), TRUCK_LOOKS[id].cab.length];
      return [
        [
          `${id}-cab`,
          () => parseShell(glb(`${id}-cab`), 'cab'),
          cabLampParams(spec, length).lenses,
        ],
        [
          `${id}-body`,
          () => parseShell(glb(`${id}-body`), 'body'),
          bodyLampParams(spec, length).mounts,
        ],
      ];
    }),
    ...TRAILER_IDS.map((id): [string, () => Promise<Shell>, readonly Seat[]] => {
      const { lenses, mounts } = trailerLampParams(trailerById(id));
      return [
        `${id}-trailer`,
        async () => (await parseTrailerShell(glb(`${id}-trailer`))).trailer,
        [...lenses, ...mounts],
      ];
    }),
  ];

  it.each(cases)(
    'give every lamp the %s shell carries a face under its whole back',
    async (_, load, seats) => {
      expect(seats.length).toBeGreaterThan(0);
      expect(unseated(await load(), seats)).toEqual([]);
    },
  );

  it('refuse a lamp moved off its face', async () => {
    const id = 'krone-azw-18';
    const [lens] = trailerLampParams(trailerById(id)).lenses;
    if (lens === undefined) throw new Error('no lafette lens');
    const [x, y, [z0, z1]] = lens.box;
    const raised = { ...lens, box: [x, y, [z0 + 0.3, z1 + 0.3] as const] };
    const shell = (await parseTrailerShell(glb(`${id}-trailer`))).trailer;
    expect(unseated(shell, [raised]).length).toBeGreaterThan(0);
  });
});
