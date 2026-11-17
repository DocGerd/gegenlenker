import {
  CircleGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ScenePalette } from '../contracts/render';
import { rectGeometry, tint } from './environment';
import { AIDS_LAYER } from './seams';

/*
 * Top-down-only drawing of the running gear. Seen straight down, every wheel sits inside an
 * opaque body footprint, so these flat parts are drawn over the vehicle without depth testing.
 * They live on the aids layer only: cockpit and mirrors never see them.
 */

const HALO = 0.08;
const SEGMENTS = 24;
const AXLE_WIDTH = 0.16;
const COUPLING_DOT_RADIUS = 0.25;
const NEEDLE_LENGTH = 3;
const NEEDLE_WIDTH = 0.12;
const DRAWBAR_WIDTH = 0.2;
const RING_RADIUS = 0.5;
const RING_WIDTH = 0.12;
const INDEX_LENGTH = 1.6;
const INDEX_WIDTH = 0.16;

/** Dolly sits under the trailer, both under the aids overlay (order 10). */
export const DOLLY_ORDER = 5;
export const VEHICLE_ORDER = 6;

/** Draws the shape grown by `grow` metres on every side. */
type Shape = (grow: number) => BufferGeometry;
type Point = readonly [x: number, y: number];

/** Body-frame rectangle (x forward, y left), `length` along the heading. */
function rect(cx: number, cy: number, length: number, width: number, heading = 0): Shape {
  return (g) =>
    rectGeometry(-length / 2 - g, length / 2 + g, -width / 2 - g, width / 2 + g)
      .rotateY(heading)
      .translate(cx, 0, -cy);
}

/** A bar between two points with square caps. */
function bar([x0, y0]: Point, [x1, y1]: Point, width: number): Shape {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return rect((x0 + x1) / 2, (y0 + y1) / 2, Math.hypot(dx, dy) + width, width, Math.atan2(dy, dx));
}

function disc(cx: number, cy: number, radius: number): Shape {
  return (g) =>
    new CircleGeometry(radius + g, SEGMENTS).rotateX(-Math.PI / 2).translate(cx, 0, -cy);
}

function ring(cx: number, cy: number, radius: number, width: number): Shape {
  return (g) =>
    new RingGeometry(radius - width / 2 - g, radius + width / 2 + g, SEGMENTS)
      .rotateX(-Math.PI / 2)
      .translate(cx, 0, -cy);
}

/** Top-down footprint of a wheel: `2 × radius` long, `width` across. */
function wheel(x: number, y: number, radius: number, width: number): Shape {
  return rect(x, y, radius * 2, width);
}

function polyline(points: readonly Point[], width: number): Shape[] {
  return points.slice(1).map((p, i) => bar(points[i] as Point, p, width));
}

/** Allocates the shared material and the merged geometries, and releases them together. */
function createSchematic(palette: ScenePalette) {
  const material = new MeshBasicMaterial({
    vertexColors: true,
    depthTest: false,
    depthWrite: false,
  });
  const geometries: BufferGeometry[] = [];
  const halo = new Color(palette.marking);
  const fill = new Color(palette.wheel);
  return {
    /** All halos precede all fills, so one merged mesh never lets a halo cover a neighbour's fill. */
    mesh(order: number, shapes: readonly Shape[]): () => Mesh {
      const geometry = mergeGeometries([
        ...shapes.map((s) => tint(s(HALO), halo)),
        ...shapes.map((s) => tint(s(0), fill)),
      ]);
      geometries.push(geometry);
      return () => {
        const mesh = new Mesh(geometry, material);
        mesh.renderOrder = order;
        mesh.layers.set(AIDS_LAYER);
        return mesh;
      };
    },
    dispose(): void {
      geometries.forEach((g) => g.dispose());
      material.dispose();
    },
  };
}

export type TruckSchematicParams = {
  readonly rearAxleX: number;
  readonly rearTrack: number;
  readonly twinOffset: number;
  readonly twinWidth: number;
  readonly frontWheelWidth: number;
  readonly wheelRadius: number;
  readonly couplingX: number;
  /** Distance from the front axle to the bumper. */
  readonly frontOverhang: number;
};

/** `rear` goes in the truck group, `front()` makes a mesh for each kingpin pivot (origin on the axle). */
export function truckSchematic(palette: ScenePalette, p: TruckSchematicParams) {
  const s = createSchematic(palette);
  const half = p.rearTrack / 2;
  const rear = s.mesh(VEHICLE_ORDER, [
    ...[-1, 1].flatMap((side) =>
      [-1, 1].map((twin) =>
        wheel(p.rearAxleX, side * half + twin * p.twinOffset, p.wheelRadius, p.twinWidth),
      ),
    ),
    bar([p.rearAxleX, -half], [p.rearAxleX, half], AXLE_WIDTH),
    disc(p.couplingX, 0, COUPLING_DOT_RADIUS),
  ]);
  // forward end at the bumper, so the angle reads against the body edge
  const front = s.mesh(VEHICLE_ORDER, [
    wheel(0, 0, p.wheelRadius, p.frontWheelWidth),
    bar([p.frontOverhang - NEEDLE_LENGTH, 0], [p.frontOverhang, 0], NEEDLE_WIDTH),
  ]);
  return { rear: rear(), front, dispose: s.dispose };
}

export type DollySchematicParams = {
  readonly frontAxleX: number;
  readonly track: number;
  readonly wheelRadius: number;
  readonly wheelWidth: number;
  /** Each arm of the A-frame as points from the turntable out to the eye. */
  readonly arms: readonly (readonly Point[])[];
};

/** Dolly frame: the turntable centre is the origin. */
export function dollySchematic(palette: ScenePalette, p: DollySchematicParams) {
  const s = createSchematic(palette);
  const half = p.track / 2;
  const mesh = s.mesh(DOLLY_ORDER, [
    ...[-1, 1].map((side) => wheel(p.frontAxleX, side * half, p.wheelRadius, p.wheelWidth)),
    bar([p.frontAxleX, -half], [p.frontAxleX, half], AXLE_WIDTH),
    ring(0, 0, RING_RADIUS, RING_WIDTH),
    ...p.arms.flatMap((arm) => polyline(arm, DRAWBAR_WIDTH)),
  ]);
  return { mesh: mesh(), dispose: s.dispose };
}

export type TrailerSchematicParams = {
  readonly rearAxleXs: readonly number[];
  readonly track: number;
  readonly wheelRadius: number;
  readonly wheelWidth: number;
  readonly turntableX: number;
};

/** Trailer frame: the effective rear axle is the origin. */
export function trailerSchematic(palette: ScenePalette, p: TrailerSchematicParams) {
  const s = createSchematic(palette);
  const half = p.track / 2;
  const mesh = s.mesh(VEHICLE_ORDER, [
    ...p.rearAxleXs.flatMap((x) =>
      [-1, 1].map((side) => wheel(x, side * half, p.wheelRadius, p.wheelWidth)),
    ),
    // forward only: the pivot rays run 4 m backward from the turntable
    bar([p.turntableX, 0], [p.turntableX + INDEX_LENGTH, 0], INDEX_WIDTH),
  ]);
  return { mesh: mesh(), dispose: s.dispose };
}
