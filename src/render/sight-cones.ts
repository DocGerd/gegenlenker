import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import type { ResolvedLayout } from '../contracts/layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import type { Obb, SimSnapshot } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import {
  bodyOccluders,
  bodyPoints,
  layoutOccluders,
  type Occluder,
  type SightGeometry,
  sightField,
  sightGeometry,
} from '../einweiser/sight';
import { STEP_HEIGHT } from '../einweiser/walk';
import type { Look } from './look';
import { AIDS_LAYER, SIGHT_GROUND_LAYER } from './seams';
import type { SightFlags } from './scene-renderer';
import { hasTopDown } from './viewports';

/** What a frame may spend on sampling (ms), checked after each cell: the rest follows on the next frames. */
const BUDGET_MS = 4;
/** Side of a ground cell (m), and how far the sampled area reaches past the vehicle's bodies. */
export const CELL = 0.5;
export const REACH = 12;
const MAX_RUNS = 4096;
const SIGHT_Y = 0.02;
const OPACITY = 0.4;
/** The vehicle must move this far (m) or turn this far (rad) before the footprint is sampled again. */
const MOVE = 0.25;
const TURN = 0.03;

/** A row of equal cells: x from `from` to `to`, y from `y` to `y + CELL`. */
export type Run = { readonly from: number; readonly to: number; readonly y: number };
export type SightRuns = { readonly direct: Run[]; readonly mirror: Run[] };

type Snapshot = Pick<SimSnapshot, 'truck' | 'coupling' | 'dolly' | 'trailer'>;

/** Where a ground point stands in `obb`, with the heading's cosine and sine read once. */
const standIn = ({ cx, cy, halfLength, halfWidth, heading }: Obb) => {
  const [c, s] = [Math.cos(heading), Math.sin(heading)];
  return (x: number, y: number): boolean => {
    const [dx, dy] = [x - cx, y - cy];
    return Math.abs(c * dx + s * dy) <= halfLength && Math.abs(-s * dx + c * dy) <= halfWidth;
  };
};

function bounds(obbs: readonly Obb[]): { x0: number; x1: number; y0: number; y1: number } {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const { cx, cy, halfLength, halfWidth, heading } of obbs) {
    const [c, s] = [Math.cos(heading), Math.sin(heading)];
    const ex = Math.abs(c) * halfLength + Math.abs(s) * halfWidth;
    const ey = Math.abs(s) * halfLength + Math.abs(c) * halfWidth;
    b.x0 = Math.min(b.x0, cx - ex);
    b.x1 = Math.max(b.x1, cx + ex);
    b.y0 = Math.min(b.y0, cy - ey);
    b.y1 = Math.max(b.y1, cy + ey);
  }
  return b;
}

/**
 * The ground around the vehicle where the driver sees an Einweiser standing: `direct` through the
 * glass, `mirror` only in a mirror. Each cell is the sight check at its centre for his head and chest
 * (`bodyPoints`), the very check the sign reading and the fault scoring make, so the drawing and
 * the scoring agree. Cells he cannot stand in, inside the bodies and the blockers he cannot step
 * over, are left out. Yields after each cell.
 */
export function* sightCells(
  g: SightGeometry,
  s: Snapshot,
  occluders: readonly Occluder[],
  reach = REACH,
): Generator<undefined, SightRuns> {
  const bodies = bodyOccluders(g, s);
  const box = bounds(bodies.map((b) => b.obb));
  const [x0, x1] = [box.x0 - reach, box.x1 + reach];
  const [y0, y1] = [box.y0 - reach, box.y1 + reach];
  // a blocker outside the sampled area cannot cross a sight line into it
  const near = occluders.filter((o) => {
    const b = bounds([o.obb]);
    return b.x1 >= x0 && b.x0 <= x1 && b.y1 >= y0 && b.y0 <= y1;
  });
  const field = sightField(g, s, near);
  const occupied = [...bodies, ...near]
    .filter((o) => o.height >= STEP_HEIGHT)
    .map((o) => standIn(o.obb));
  const out: SightRuns = { direct: [], mirror: [] };
  for (let j = Math.floor(y0 / CELL); j < Math.ceil(y1 / CELL); j++) {
    const y = j * CELL;
    let open: { kind: 'direct' | 'mirror'; from: number } | null = null;
    const close = (to: number): void => {
      if (open !== null) out[open.kind].push({ from: open.from, to, y });
      open = null;
    };
    for (let i = Math.floor(x0 / CELL); i < Math.ceil(x1 / CELL); i++) {
      const [cx, cy] = [(i + 0.5) * CELL, y + CELL / 2];
      let kind: 'direct' | 'mirror' | null = null;
      if (!occupied.some((stands) => stands(cx, cy))) {
        const sight = field.of(bodyPoints({ x: cx, y: cy }));
        kind = sight.direct ? 'direct' : sight.mirrors.length > 0 ? 'mirror' : null;
      }
      if (open !== null && open.kind !== kind) close(i * CELL);
      if (kind !== null && open === null) open = { kind, from: i * CELL };
      yield undefined;
    }
    close(Math.ceil(x1 / CELL) * CELL);
  }
  return out;
}

/** `sightCells` run to the end. */
export function sightRuns(
  g: SightGeometry,
  s: Snapshot,
  occluders: readonly Occluder[],
  reach = REACH,
): SightRuns {
  const cells = sightCells(g, s, occluders, reach);
  for (let step = cells.next(); ; step = cells.next()) if (step.done === true) return step.value;
}

/**
 * Quads in buffers made on the first footprint, so a run that shows none holds none; its meshes stay
 * hidden until then. Sim (x, y) becomes three's (x, up, -y).
 */
class RunQuads {
  readonly geometry = new BufferGeometry();
  private attribute: BufferAttribute | null = null;

  private buffer(): BufferAttribute {
    if (this.attribute !== null) return this.attribute;
    const index = new Uint16Array(MAX_RUNS * 6);
    for (let i = 0; i < MAX_RUNS; i++) {
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    const attribute = new BufferAttribute(new Float32Array(MAX_RUNS * 12), 3);
    attribute.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', attribute);
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.attribute = attribute;
    return attribute;
  }

  set(runs: readonly Run[]): void {
    const attribute = this.buffer();
    const count = Math.min(runs.length, MAX_RUNS);
    const p = attribute.array;
    for (let i = 0; i < count; i++) {
      const { from, to, y } = runs[i] as Run;
      p.set(
        [from, SIGHT_Y, -y, from, SIGHT_Y, -(y + CELL), to, SIGHT_Y, -y, to, SIGHT_Y, -(y + CELL)],
        i * 12,
      );
    }
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, count * 12);
    attribute.needsUpdate = true;
    this.geometry.setDrawRange(0, count * 6);
  }
}

/**
 * The Einweiser's sight areas on the ground: in the top-down view (`AIDS_LAYER`) and in his own
 * first-person view (`SIGHT_GROUND_LAYER`, which no other camera enables), each its own mesh pair
 * over the same sampled geometry. A footprint is sampled over as many frames as it takes; until the
 * first one is done nothing shows, and after that the last one shows until the next is done.
 */
export type SightCones = {
  readonly object: Group;
  setFlags(flags: SightFlags): void;
  setLook(look: Look): void;
  update(frame: RenderFrame): void;
  /** Whether a footprint is still being sampled: it needs more frames to finish. */
  pending(): boolean;
  dispose(): void;
};

export function createSightCones(
  truck: TruckSpec,
  trailer: TrailerSpec,
  layout: ResolvedLayout,
  palette: ScenePalette,
  now: () => number = () => performance.now(),
): SightCones {
  const g = sightGeometry(truck, trailer);
  const occluders = layoutOccluders(layout);
  const material = (color: number): MeshBasicMaterial =>
    new MeshBasicMaterial({
      color,
      side: DoubleSide,
      transparent: true,
      opacity: OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
  const kinds = [
    { runs: 'direct', material: material(palette.einweiser), quads: new RunQuads() },
    { runs: 'mirror', material: material(palette.accent), quads: new RunQuads() },
  ] as const;
  const group = new Group();
  const top: Mesh[] = [];
  const ground: Mesh[] = [];
  for (const { material: m, quads } of kinds) {
    for (const [meshes, layer] of [
      [top, AIDS_LAYER],
      [ground, SIGHT_GROUND_LAYER],
    ] as const) {
      const mesh = new Mesh(quads.geometry, m);
      mesh.layers.set(layer);
      mesh.frustumCulled = false;
      mesh.visible = false;
      meshes.push(mesh);
      group.add(mesh);
    }
  }
  let flags: SightFlags = { top: false, ground: false };
  let sampled: Snapshot | null = null;
  /** The sampling under way and the bodies it reads; it finishes before a new one starts. */
  let job: Generator<undefined, SightRuns> | null = null;
  /** Whether the buffers hold a footprint sampled since the areas were last turned on. */
  let drawn = false;

  const moved = (s: Snapshot): boolean =>
    sampled === null ||
    (['truck', 'dolly', 'trailer'] as const).some((k) => {
      const [a, b] = [sampled?.[k], s[k]];
      return (
        a === undefined ||
        Math.hypot(a.x - b.x, a.y - b.y) > MOVE ||
        Math.abs(Math.atan2(Math.sin(a.heading - b.heading), Math.cos(a.heading - b.heading))) >
          TURN
      );
    });

  return {
    object: group,
    setFlags(next) {
      flags = next;
    },
    setLook(look: Look): void {
      const night = look.mode === 'night';
      kinds[1].material.color.set(night ? palette.nightAccent : palette.accent);
    },
    update(frame) {
      const live = frame.einweiser !== undefined;
      // the top-down pair is drawn, and so sampled for, only where there is a top view
      const showTop = live && flags.top && hasTopDown(frame.views);
      const showGround = live && flags.ground;
      if (!showTop && !showGround) {
        sampled = null;
        job = null;
        drawn = false;
      } else {
        const { snapshot } = frame;
        if (job === null && moved(snapshot)) {
          sampled = {
            truck: snapshot.truck,
            coupling: snapshot.coupling,
            dolly: snapshot.dolly,
            trailer: snapshot.trailer,
          };
          job = sightCells(g, sampled, occluders);
        }
        const until = now() + BUDGET_MS;
        while (job !== null) {
          const step = job.next();
          if (step.done === true) {
            for (const { runs: key, quads } of kinds) quads.set(step.value[key]);
            job = null;
            drawn = true;
          } else if (now() > until) {
            break;
          }
        }
      }
      for (const m of top) m.visible = drawn && showTop;
      for (const m of ground) m.visible = drawn && showGround;
    },
    pending: () => job !== null,
    dispose() {
      for (const { material: m, quads } of kinds) {
        m.dispose();
        quads.geometry.dispose();
      }
    },
  };
}
