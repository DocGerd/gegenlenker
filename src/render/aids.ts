import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Material,
  type Object3D,
} from 'three';
import type { ResolvedLayout } from '../contracts/layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import type { Pose2, Vec2 } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { trailerAnchors } from '../vehicles/anchors';
import { placePose } from './coords';
import { outlineGeometry } from './environment';
import { AIDS_LAYER, type AidsLayer } from './seams';

const PATH_WIDTH = 0.2;
const PATH_CAPACITY = 512;
const CORRIDOR_WIDTH = 0.1;
const DASH_ON = 0.6;
const DASH_OFF = 0.4;
const TICK_WIDTH = 0.2;
const TICK_LENGTH = 1.2;
const TRACK_WIDTH = 0.1;
const TRACK_CAPACITY = 2000;
const TRACK_SPACING = 0.25;
const TRACK_JUMP = 5; // a larger gap between samples starts a new line
const PIVOT_WIDTH = 0.12;
const PIVOT_LENGTH = 4;
const GHOST_STRIP = 0.1;
const GHOST_OPACITY = 0.5;
const TRACK_Y = 0.02;
const PATH_Y = 0.03;
const GHOST_Y = 0.04;
const PIVOT_Y = 0.05;
const OVERLAY_ORDER = 10;
const mm = (v: number): number => v / 1000;

function onAidsLayer<T extends Object3D>(object: T): T {
  object.layers.set(AIDS_LAYER);
  return object;
}

/** Samples one wheel into a ring of segments; the oldest segment is overwritten when full. */
export class WheelTrack {
  readonly capacity: number;
  readonly spacing: number;
  readonly jump: number;
  count = 0;
  next = 0;
  /** Valid after `sample` returned true: the ring slot and start point of the new segment. */
  slot = 0;
  fromX = 0;
  fromY = 0;
  private lastX = 0;
  private lastY = 0;
  private has = false;

  constructor(capacity: number, spacing: number, jump: number) {
    this.capacity = capacity;
    this.spacing = spacing;
    this.jump = jump;
  }

  clear(): void {
    this.count = 0;
    this.next = 0;
    this.has = false;
  }

  /** Returns whether a segment from the previous sample to (x, y) was added. */
  sample(x: number, y: number): boolean {
    if (!this.has) {
      this.remember(x, y);
      return false;
    }
    const d = Math.hypot(x - this.lastX, y - this.lastY);
    if (d < this.spacing) return false;
    this.fromX = this.lastX;
    this.fromY = this.lastY;
    this.remember(x, y);
    if (d > this.jump) return false; // a gap starts a new line
    this.slot = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    return true;
  }

  private remember(x: number, y: number): void {
    this.lastX = x;
    this.lastY = y;
    this.has = true;
  }
}

/** The wheels' tracks; the history restarts when the simulation step goes backwards. */
export class TrackHistory {
  readonly wheels: readonly WheelTrack[];
  private lastStep = 0;

  constructor(wheelCount: number, capacity: number, spacing: number, jump: number) {
    this.wheels = Array.from({ length: wheelCount }, () => new WheelTrack(capacity, spacing, jump));
  }

  observe(step: number): void {
    if (step < this.lastStep) this.wheels.forEach((w) => w.clear());
    this.lastStep = step;
  }
}

/** Calls `emit` for the dashes of a polyline; dashes are measured along its own length, not per point. */
export function dashSegments(
  line: readonly Vec2[],
  on: number,
  off: number,
  emit: (ax: number, ay: number, bx: number, by: number) => void,
): void {
  const period = on + off;
  let phase = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    if (a === undefined || b === undefined) continue;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const [dx, dy] = length === 0 ? [0, 0] : [(b.x - a.x) / length, (b.y - a.y) / length];
    let at = 0;
    while (at < length) {
      const dashing = phase < on;
      const end = Math.min(length, at + (dashing ? on : period) - phase);
      if (dashing) emit(a.x + dx * at, a.y + dy * at, a.x + dx * end, a.y + dy * end);
      phase += end - at;
      if (phase >= period - 1e-9) phase = 0;
      at = end;
    }
  }
}

/** Segment quads in preallocated buffers; only the written slots are uploaded. */
class SegmentRibbon {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly positions: Float32Array;
  private readonly attribute: BufferAttribute;
  private readonly half: number;
  private readonly up: number;
  private dirtyMin = Infinity;
  private dirtyMax = -1;

  constructor(capacity: number, width: number, up: number, material: Material) {
    this.half = width / 2;
    this.up = up;
    this.positions = new Float32Array(capacity * 12);
    this.attribute = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    const index = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const v = i * 4;
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6);
    }
    this.geometry.setAttribute('position', this.attribute);
    this.geometry.setIndex(new BufferAttribute(index, 1));
    this.geometry.setDrawRange(0, 0);
    this.mesh = onAidsLayer(new Mesh(this.geometry, material));
    this.mesh.frustumCulled = false; // the bounds of the empty first state would cull it
  }

  /** World ground coordinates of one segment in `slot`; uploaded by the next `flush`. */
  set(slot: number, ax: number, ay: number, bx: number, by: number): void {
    const length = Math.hypot(bx - ax, by - ay);
    const nx = length < 1e-6 ? 0 : (-(by - ay) / length) * this.half;
    const ny = length < 1e-6 ? 0 : ((bx - ax) / length) * this.half;
    const p = this.positions;
    const o = slot * 12;
    const up = this.up;
    p[o] = ax + nx;
    p[o + 1] = up;
    p[o + 2] = -(ay + ny);
    p[o + 3] = ax - nx;
    p[o + 4] = up;
    p[o + 5] = -(ay - ny);
    p[o + 6] = bx + nx;
    p[o + 7] = up;
    p[o + 8] = -(by + ny);
    p[o + 9] = bx - nx;
    p[o + 10] = up;
    p[o + 11] = -(by - ny);
    if (slot < this.dirtyMin) this.dirtyMin = slot;
    if (slot > this.dirtyMax) this.dirtyMax = slot;
  }

  /** Draws the first `count` slots and uploads the range written since the last flush. */
  flush(count: number): void {
    if (this.dirtyMax >= this.dirtyMin) {
      this.attribute.clearUpdateRanges();
      this.attribute.addUpdateRange(this.dirtyMin * 12, (this.dirtyMax - this.dirtyMin + 1) * 12);
      this.attribute.needsUpdate = true;
      this.dirtyMin = Infinity;
      this.dirtyMax = -1;
    }
    this.geometry.setDrawRange(0, count * 6);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

export function proceduralAids(
  truck: TruckSpec,
  trailer: TrailerSpec,
  layout: ResolvedLayout,
  palette: ScenePalette,
): AidsLayer {
  const group = onAidsLayer(new Group());
  const materials: Material[] = [];
  const material = (color: number, overlay: boolean, opacity = 1): MeshBasicMaterial => {
    const m = new MeshBasicMaterial({
      color,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      depthTest: !overlay,
      transparent: opacity < 1,
      opacity,
      depthWrite: !overlay && opacity === 1,
    });
    materials.push(m);
    return m;
  };

  const accent = material(palette.accent, false);
  const path = new SegmentRibbon(PATH_CAPACITY, PATH_WIDTH, PATH_Y, accent);
  const corridor = [0, 1].map(
    () => new SegmentRibbon(PATH_CAPACITY, CORRIDOR_WIDTH, PATH_Y, accent),
  );
  const ticks = new SegmentRibbon(3, TICK_WIDTH, PATH_Y, accent);
  const trackMaterial = material(palette.tracks, false);
  const tracks = [0, 1, 2, 3].map(
    () => new SegmentRibbon(TRACK_CAPACITY, TRACK_WIDTH, TRACK_Y, trackMaterial),
  );
  const pivots = new SegmentRibbon(4, PIVOT_WIDTH, PIVOT_Y, material(palette.accent, true));
  pivots.mesh.renderOrder = OVERLAY_ORDER;
  group.add(
    path.mesh,
    ...corridor.map((c) => c.mesh),
    ticks.mesh,
    pivots.mesh,
    ...tracks.map((t) => t.mesh),
  );

  const geometries: BufferGeometry[] = [];
  let ghost: Mesh | null = null;
  const { target } = layout;
  if (target !== null) {
    const a = trailerAnchors(trailer);
    const geometry = outlineGeometry(a.frontX - a.rearX, mm(trailer.width.value), GHOST_STRIP);
    geometries.push(geometry);
    ghost = onAidsLayer(new Mesh(geometry, material(palette.accent, true, GHOST_OPACITY)));
    ghost.renderOrder = OVERLAY_ORDER;
    ghost.position.y = GHOST_Y;
    placePose(ghost, target.pose);
    group.add(ghost);
  }

  const truckHalf = mm(truck.rearTrack.value) / 2;
  const trailerHalf = mm(trailer.track.value) / 2;
  const history = new TrackHistory(4, TRACK_CAPACITY, TRACK_SPACING, TRACK_JUMP);
  let pivotSlot = 0;

  function sampleWheel(i: number, pose: Pose2, offset: number): void {
    const wheel = history.wheels[i];
    if (wheel === undefined) return;
    const x = pose.x - Math.sin(pose.heading) * offset;
    const y = pose.y + Math.cos(pose.heading) * offset;
    if (wheel.sample(x, y)) tracks[i]?.set(wheel.slot, wheel.fromX, wheel.fromY, x, y);
  }

  function ray(x: number, y: number, heading: number): void {
    const back = heading + Math.PI;
    pivots.set(
      pivotSlot++,
      x,
      y,
      x + Math.cos(back) * PIVOT_LENGTH,
      y + Math.sin(back) * PIVOT_LENGTH,
    );
  }

  return {
    object: group,
    update(frame: RenderFrame): void {
      const { snapshot: s, aids, predicted } = frame;
      history.observe(s.step);
      sampleWheel(0, s.truck, truckHalf);
      sampleWheel(1, s.truck, -truckHalf);
      sampleWheel(2, s.trailer, trailerHalf);
      sampleWheel(3, s.trailer, -trailerHalf);
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t === undefined) continue;
        t.mesh.visible = aids.tracks;
        if (aids.tracks) t.flush(history.wheels[i]?.count ?? 0);
      }

      const { trailer: trailerLine, end } = predicted;
      path.mesh.visible = aids.path && trailerLine.length > 1;
      if (path.mesh.visible) {
        const n = Math.min(trailerLine.length, PATH_CAPACITY + 1);
        for (let i = 1; i < n; i++) {
          const a = trailerLine[i - 1];
          const b = trailerLine[i];
          if (a !== undefined && b !== undefined) path.set(i - 1, a.x, a.y, b.x, b.y);
        }
        path.flush(n - 1);
      }

      const lines = [predicted.truckOuter, predicted.truckInner];
      corridor.forEach((ribbon, i) => {
        const line = lines[i] ?? [];
        ribbon.mesh.visible = aids.path && line.length > 1;
        if (!ribbon.mesh.visible) return;
        let count = 0;
        dashSegments(line, DASH_ON, DASH_OFF, (ax, ay, bx, by) => {
          if (count < PATH_CAPACITY) ribbon.set(count++, ax, ay, bx, by);
        });
        ribbon.flush(count);
      });

      ticks.mesh.visible = aids.path && end !== null;
      if (end !== null && aids.path) {
        let count = 0;
        const tick = (at: Vec2 | undefined, heading: number | null): void => {
          if (at === undefined || heading === null) return;
          const nx = -Math.sin(heading) * (TICK_LENGTH / 2);
          const ny = Math.cos(heading) * (TICK_LENGTH / 2);
          ticks.set(count++, at.x - nx, at.y - ny, at.x + nx, at.y + ny);
        };
        tick(trailerLine[trailerLine.length - 1], end.trailer);
        tick(predicted.truckOuter[predicted.truckOuter.length - 1], end.truck);
        tick(predicted.truckInner[predicted.truckInner.length - 1], end.truck);
        ticks.flush(count);
      }

      pivots.mesh.visible = aids.pivots;
      if (aids.pivots) {
        // rearward centre lines of the two bodies at each pivot; the angle between them is the pivot angle
        pivotSlot = 0;
        ray(s.coupling.x, s.coupling.y, s.truck.heading);
        ray(s.coupling.x, s.coupling.y, s.dolly.heading);
        ray(s.dolly.x, s.dolly.y, s.dolly.heading);
        ray(s.dolly.x, s.dolly.y, s.trailer.heading);
        pivots.flush(4);
      }

      if (ghost !== null) ghost.visible = aids.ghost;
    },
    dispose(): void {
      path.dispose();
      corridor.forEach((c) => c.dispose());
      ticks.dispose();
      pivots.dispose();
      tracks.forEach((t) => t.dispose());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
