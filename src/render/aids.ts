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
import type { Pose2, Prediction, Vec2 } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { trailerAnchors } from '../vehicles/anchors';
import { placePose } from './coords';
import { outlineGeometry } from './ground-geometry';
import type { Look } from './look';
import { createEinweiserToken } from './einweiser-token';
import { AID_DASH_OFF, AID_DASH_ON, AID_STROKE, AIDS_LAYER, type AidsLayer } from './seams';

const PATH_WIDTH = AID_STROKE.path;
const PATH_CAPACITY = 512;
const CORRIDOR_WIDTH = AID_STROKE.corridor;
const BAR_WIDTH = AID_STROKE.bar;
const TRACK_WIDTH = AID_STROKE.track;
const TRACK_CAPACITY = 2000;
const TRACK_SPACING = 0.25;
const TRACK_JUMP = 5; // a larger gap between samples starts a new line
const PIVOT_WIDTH = AID_STROKE.pivot;
const PIVOT_LENGTH = 4;
const GHOST_STRIP = AID_STROKE.ghost;
const TRACK_Y = 0.02;
const PATH_Y = 0.03;
const GHOST_Y = 0.04;
const PIVOT_Y = 0.05;
const MARKER_WIDTH = 0.3;
const MARKER_RADIUS = 0.9;
const MARKER_PULSE = 0.3; // fraction of the radius the pulse adds
const MARKER_HZ = 1.5;
const MARKER_Y = 0.06;
const OVERLAY_ORDER = 10;
const CASING = AID_STROKE.casing;
const CASING_DROP = 0.005;
const mm = (v: number): number => v / 1000;

function onAidsLayer<T extends Object3D>(object: T): T {
  object.layers.set(AIDS_LAYER);
  return object;
}

/** Arm half-length of the contact cross at sim time `time`. */
const markerRadius = (time: number): number =>
  MARKER_RADIUS * (1 + MARKER_PULSE * Math.sin(2 * Math.PI * MARKER_HZ * time));

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
    const inverse = length === 0 ? 0 : 1 / length;
    const dx = (b.x - a.x) * inverse;
    const dy = (b.y - a.y) * inverse;
    let at = 0;
    while (at < length) {
      const dashing = on - phase > 1e-9; // a sliver left of the dash counts as its end, so `at` always advances
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

/** An accent ribbon on a wider dark one, so the stroke keeps its contrast on any ground. */
class CasedRibbon {
  readonly object = onAidsLayer(new Group());
  private readonly core: SegmentRibbon;
  private readonly casing: SegmentRibbon;

  constructor(
    capacity: number,
    width: number,
    up: number,
    core: Material,
    casing: Material,
    order = 0,
  ) {
    this.casing = new SegmentRibbon(capacity, width + 2 * CASING, up - CASING_DROP, casing);
    this.core = new SegmentRibbon(capacity, width, up, core);
    this.casing.mesh.renderOrder = order - 1;
    this.core.mesh.renderOrder = order;
    this.object.add(this.casing.mesh, this.core.mesh);
  }

  set(slot: number, ax: number, ay: number, bx: number, by: number): void {
    this.casing.set(slot, ax, ay, bx, by);
    this.core.set(slot, ax, ay, bx, by);
  }

  flush(count: number): void {
    this.casing.flush(count);
    this.core.flush(count);
  }

  dispose(): void {
    this.casing.dispose();
    this.core.dispose();
  }
}

/**
 * The stop bar across the corridor's last sample. A block at the first sample would put it on the
 * leading body's own edge, so then it moves clear of the body, outward along the lead direction.
 */
function stopBarEnds(
  predicted: Pick<Prediction, 'lead' | 'left' | 'right'>,
): readonly [Vec2, Vec2] | null {
  const { lead, left, right } = predicted;
  const a = left[left.length - 1];
  const b = right[right.length - 1];
  if (lead === null || a === undefined || b === undefined) return null;
  if (left.length > 1) return [a, b];
  const [dx, dy] = [a.x - b.x, a.y - b.y];
  const length = Math.hypot(dx, dy);
  const out = ((lead === 'truck' ? 1 : -1) * (BAR_WIDTH / 2 + CASING)) / length;
  const [ox, oy] = [dy * out, -dx * out];
  return [
    { x: a.x + ox, y: a.y + oy },
    { x: b.x + ox, y: b.y + oy },
  ];
}

export function proceduralAids(
  truck: TruckSpec,
  trailer: TrailerSpec,
  layout: ResolvedLayout,
  palette: ScenePalette,
): AidsLayer {
  const group = onAidsLayer(new Group());
  const materials: Material[] = [];
  const material = (
    color: number,
    overlay: boolean,
    opacity = 1,
    offset = -4,
  ): MeshBasicMaterial => {
    const m = new MeshBasicMaterial({
      color,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: offset,
      polygonOffsetUnits: offset,
      depthTest: !overlay,
      transparent: opacity < 1,
      opacity,
      depthWrite: !overlay && opacity === 1,
    });
    materials.push(m);
    return m;
  };

  // the accent and track strokes take their night colours at night; the casings and the marker keep theirs
  const accents: MeshBasicMaterial[] = [];
  const accentMaterial = (overlay: boolean): MeshBasicMaterial => {
    const m = material(palette.accent, overlay);
    accents.push(m);
    return m;
  };
  const accent = accentMaterial(false);
  const casing = material(palette.wheel, false, 1, -3);
  // the corridor's two lines: solid behind the trailer, dashed ahead of the truck
  const solid = [0, 1].map(
    () => new CasedRibbon(PATH_CAPACITY, PATH_WIDTH, PATH_Y, accent, casing),
  );
  const dashed = [0, 1].map(
    () => new CasedRibbon(PATH_CAPACITY, CORRIDOR_WIDTH, PATH_Y, accent, casing),
  );
  const stopBar = new CasedRibbon(1, BAR_WIDTH, PATH_Y, accent, casing);
  const trackMaterial = material(palette.tracks, false);
  const tracks = [0, 1, 2, 3].map(
    () => new SegmentRibbon(TRACK_CAPACITY, TRACK_WIDTH, TRACK_Y, trackMaterial),
  );
  const pivots = new CasedRibbon(
    4,
    PIVOT_WIDTH,
    PIVOT_Y,
    accentMaterial(true),
    material(palette.wheel, true, 1, -3),
    OVERLAY_ORDER,
  );
  const marker = new CasedRibbon(
    2,
    MARKER_WIDTH,
    MARKER_Y,
    material(palette.marking, true),
    material(palette.wheel, true, 1, -3),
    OVERLAY_ORDER + 2,
  );
  // shown whatever the aid toggles say, like the contact marker
  const einweiser = createEinweiserToken(palette);
  group.add(
    ...solid.map((c) => c.object),
    ...dashed.map((c) => c.object),
    stopBar.object,
    pivots.object,
    marker.object,
    einweiser.object,
    ...tracks.map((t) => t.mesh),
  );

  const geometries: BufferGeometry[] = [];
  let ghost: Group | null = null;
  const { target } = layout;
  if (target !== null) {
    const a = trailerAnchors(trailer);
    const length = a.frontX - a.rearX;
    const width = mm(trailer.width.value);
    const geometry = outlineGeometry(length, width, GHOST_STRIP);
    const casingGeometry = outlineGeometry(length, width, GHOST_STRIP + 2 * CASING);
    geometries.push(geometry, casingGeometry);
    ghost = onAidsLayer(new Group());
    const edge = onAidsLayer(new Mesh(casingGeometry, material(palette.wheel, true, 1, -3)));
    edge.renderOrder = OVERLAY_ORDER - 1;
    edge.position.y = -CASING_DROP;
    const fill = onAidsLayer(new Mesh(geometry, accentMaterial(true)));
    fill.renderOrder = OVERLAY_ORDER;
    ghost.add(edge, fill);
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
    setLook(look: Look): void {
      const night = look.mode === 'night';
      for (const m of accents) m.color.set(night ? palette.nightAccent : palette.accent);
      trackMaterial.color.set(night ? palette.nightTracks : palette.tracks);
    },
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

      const corridor = [predicted.left, predicted.right];
      const style = (ribbons: readonly CasedRibbon[], lead: 'trailer' | 'truck'): void => {
        ribbons.forEach((ribbon, i) => {
          const line = corridor[i] ?? [];
          ribbon.object.visible = aids.path && predicted.lead === lead && line.length > 1;
          if (!ribbon.object.visible) return;
          let count = 0;
          const add = (ax: number, ay: number, bx: number, by: number): void => {
            if (count < PATH_CAPACITY) ribbon.set(count++, ax, ay, bx, by);
          };
          if (lead === 'truck') dashSegments(line, AID_DASH_ON, AID_DASH_OFF, add);
          else {
            for (let k = 1; k < line.length; k++) {
              const [a, b] = [line[k - 1], line[k]];
              if (a !== undefined && b !== undefined) add(a.x, a.y, b.x, b.y);
            }
          }
          ribbon.flush(count);
        });
      };
      style(solid, 'trailer');
      style(dashed, 'truck');

      const bar = aids.path && predicted.blocked !== null ? stopBarEnds(predicted) : null;
      stopBar.object.visible = bar !== null;
      if (bar !== null) {
        stopBar.set(0, bar[0].x, bar[0].y, bar[1].x, bar[1].y);
        stopBar.flush(1);
      }

      pivots.object.visible = aids.pivots;
      if (aids.pivots) {
        // rearward centre lines of the two bodies at each pivot; the angle between them is the pivot angle
        pivotSlot = 0;
        ray(s.coupling.x, s.coupling.y, s.truck.heading);
        ray(s.coupling.x, s.coupling.y, s.dolly.heading);
        ray(s.dolly.x, s.dolly.y, s.dolly.heading);
        ray(s.dolly.x, s.dolly.y, s.trailer.heading);
        pivots.flush(4);
      }

      // a cross, so the contact reads without colour; shown whatever the aid toggles say
      marker.object.visible = s.contact !== null;
      if (s.contact !== null) {
        const { x, y } = s.contact.point;
        const r = markerRadius(s.time);
        marker.set(0, x - r, y - r, x + r, y + r);
        marker.set(1, x - r, y + r, x + r, y - r);
        marker.flush(2);
      }

      if (ghost !== null) ghost.visible = aids.ghost;
      einweiser.update(frame.einweiser);
    },
    dispose(): void {
      solid.forEach((c) => c.dispose());
      dashed.forEach((c) => c.dispose());
      stopBar.dispose();
      pivots.dispose();
      marker.dispose();
      einweiser.dispose();
      tracks.forEach((t) => t.dispose());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
