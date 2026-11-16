import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Material,
  type Object3D,
} from 'three';
import type { ResolvedLayout } from '../contracts/layout';
import type { RenderFrame, ScenePalette } from '../contracts/render';
import type { Pose2 } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { trailerAnchors } from '../vehicles/anchors';
import { placePose } from './coords';
import { outlineGeometry } from './environment';
import { AIDS_LAYER, type AidsLayer } from './seams';

const PATH_WIDTH = 0.2;
const PATH_CAPACITY = 512;
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

/** A ring of independent segment quads in preallocated buffers; the oldest segment is overwritten when full. */
class SegmentRibbon {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly positions: Float32Array;
  private readonly attribute: BufferAttribute;
  private readonly capacity: number;
  private readonly half: number;
  private readonly up: number;
  private count = 0;
  private next = 0;

  constructor(capacity: number, width: number, up: number, material: Material) {
    this.capacity = capacity;
    this.half = width / 2;
    this.up = up;
    this.positions = new Float32Array(capacity * 12);
    this.attribute = new BufferAttribute(this.positions, 3);
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

  clear(): void {
    this.count = 0;
    this.next = 0;
    this.geometry.setDrawRange(0, 0);
  }

  /** World ground coordinates; call `commit` after a batch. */
  add(ax: number, ay: number, bx: number, by: number): void {
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-6) return;
    const nx = (-(by - ay) / length) * this.half;
    const ny = ((bx - ax) / length) * this.half;
    const p = this.positions;
    const o = this.next * 12;
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
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  commit(): void {
    this.attribute.needsUpdate = true;
    this.geometry.setDrawRange(0, this.count * 6);
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

  const path = new SegmentRibbon(
    PATH_CAPACITY,
    PATH_WIDTH,
    PATH_Y,
    material(palette.accent, false),
  );
  const trackMaterial = material(palette.tracks, false);
  const tracks = [0, 1, 2, 3].map(
    () => new SegmentRibbon(TRACK_CAPACITY, TRACK_WIDTH, TRACK_Y, trackMaterial),
  );
  const pivots = new SegmentRibbon(4, PIVOT_WIDTH, PIVOT_Y, material(palette.accent, true));
  pivots.mesh.renderOrder = OVERLAY_ORDER;
  group.add(path.mesh, pivots.mesh, ...tracks.map((t) => t.mesh));

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
  const lastX = new Float64Array(4);
  const lastY = new Float64Array(4);
  const has = [false, false, false, false];
  let lastStep = 0;

  function resetTracks(): void {
    for (let i = 0; i < 4; i++) {
      has[i] = false;
      tracks[i]?.clear();
    }
  }

  /** Samples one wheel; returns whether a segment was added. */
  function sample(i: number, pose: Pose2, offset: number): boolean {
    const x = pose.x - Math.sin(pose.heading) * offset;
    const y = pose.y + Math.cos(pose.heading) * offset;
    const px = lastX[i] ?? 0;
    const py = lastY[i] ?? 0;
    const d = Math.hypot(x - px, y - py);
    if (has[i] === true && d < TRACK_SPACING) return false;
    const connected = has[i] === true && d <= TRACK_JUMP;
    if (connected) tracks[i]?.add(px, py, x, y);
    lastX[i] = x;
    lastY[i] = y;
    has[i] = true;
    return connected;
  }

  function ray(x: number, y: number, heading: number): void {
    const back = heading + Math.PI;
    pivots.add(x, y, x + Math.cos(back) * PIVOT_LENGTH, y + Math.sin(back) * PIVOT_LENGTH);
  }

  return {
    object: group,
    update(frame: RenderFrame): void {
      const { snapshot: s, aids, predicted } = frame;
      if (s.step < lastStep) resetTracks();
      lastStep = s.step;

      const added0 = sample(0, s.truck, truckHalf);
      const added1 = sample(1, s.truck, -truckHalf);
      const added2 = sample(2, s.trailer, trailerHalf);
      const added3 = sample(3, s.trailer, -trailerHalf);
      if (added0) tracks[0]?.commit();
      if (added1) tracks[1]?.commit();
      if (added2) tracks[2]?.commit();
      if (added3) tracks[3]?.commit();
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (t !== undefined) t.mesh.visible = aids.tracks;
      }

      path.mesh.visible = aids.path && predicted.length > 1;
      if (path.mesh.visible) {
        path.clear();
        const n = Math.min(predicted.length, PATH_CAPACITY + 1);
        for (let i = 1; i < n; i++) {
          const a = predicted[i - 1];
          const b = predicted[i];
          if (a !== undefined && b !== undefined) path.add(a.x, a.y, b.x, b.y);
        }
        path.commit();
      }

      pivots.mesh.visible = aids.pivots;
      if (aids.pivots) {
        pivots.clear();
        // rearward centre lines of the two bodies at each pivot; the angle between them is the pivot angle
        const hitch = s.coupling;
        const turntable = s.dolly;
        ray(hitch.x, hitch.y, s.truck.heading);
        ray(hitch.x, hitch.y, s.dolly.heading);
        ray(turntable.x, turntable.y, s.dolly.heading);
        ray(turntable.x, turntable.y, s.trailer.heading);
        pivots.commit();
      }

      if (ghost !== null) ghost.visible = aids.ghost;
    },
    dispose(): void {
      path.dispose();
      pivots.dispose();
      tracks.forEach((t) => t.dispose());
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}
