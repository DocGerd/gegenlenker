import { Box3, Frustum, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import { isKitDecor, type Rect2, type ResolvedLayout } from '../contracts/layout';
import { CHASE_AZIMUTH, CHASE_PITCH, CHASE_ZOOM } from '../contracts/render';
import type { Obb } from '../contracts/sim';
import { trailers, trucks } from '../vehicles/registry';
import {
  boundingRadius,
  cabFront,
  chaseColliders,
  combinationExtent,
  createChaseCamera,
  placeChaseCamera,
  type ChaseFrame,
} from './chase-camera';
import { kitStandInGeometry } from './kit-stand-ins';
import { QUALITY_FLAGS } from './quality';
import { sceneryBuildings } from './skyline-layout';

/*
 * Issue #526: the chase view at its farthest, every yaw and pitch it allows, from every exercise's
 * start. Rays through the frame (the vehicle masked out) are cast at boxes standing for what a preset
 * draws around the yard, and at the ground plane.
 */

type Box = { readonly obb: Obb; readonly height: number; readonly aabb: Box3 };

function box(obb: Obb, height: number): Box {
  const r = Math.hypot(obb.halfLength, obb.halfWidth);
  const min = new Vector3(obb.cx - r, 0, -obb.cy - r);
  return { obb, height, aabb: new Box3(min, new Vector3(obb.cx + r, height, -obb.cy + r)) };
}

/** Distance along the ray to the box, infinity when it misses. */
function hit(from: Vector3, dir: Vector3, { obb, height }: Box): number {
  const c = Math.cos(obb.heading);
  const s = Math.sin(obb.heading);
  // sim frame: x, y = -z, z = y; then into the box's frame
  const [ox, oy] = [from.x - obb.cx, -from.z - obb.cy];
  const [dx, dy] = [dir.x, -dir.z];
  const origin = [ox * c + oy * s, -ox * s + oy * c, from.y];
  const step = [dx * c + dy * s, -dx * s + dy * c, dir.y];
  const high = [obb.halfLength, obb.halfWidth, height];
  const low = [-obb.halfLength, -obb.halfWidth, 0];
  let enter = -Infinity;
  let leave = Infinity;
  for (let a = 0; a < 3; a++) {
    const o = origin[a] ?? 0;
    const d = step[a] ?? 0;
    const lo = low[a] ?? 0;
    const hi = high[a] ?? 0;
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    const t0 = (lo - o) / d;
    const t1 = (hi - o) / d;
    enter = Math.max(enter, Math.min(t0, t1));
    leave = Math.min(leave, Math.max(t0, t1));
  }
  return enter > 0 && enter <= leave ? enter : Infinity;
}

const inside = (r: Rect2, x: number, y: number): boolean =>
  x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;

/** What `preset` draws around the yard in perspective; kerbs are too low to count. */
function scenery(layout: ResolvedLayout, preset: 'balanced' | 'high'): Box[] {
  const flags = QUALITY_FLAGS[preset];
  const kit = layout.decor.filter(isKitDecor);
  const drawnKit = flags.yardKit
    ? kit
    : flags.kitStandIns
      ? kit.filter((d) => kitStandInGeometry([d]) !== null)
      : [];
  return [
    ...layout.obstacles.filter((o) => o.kind !== 'kerb').map((o) => box(o.obb, o.height)),
    ...layout.decor.filter((d) => !isKitDecor(d)).map((d) => box(d.footprint, d.height)),
    ...drawnKit.map((d) => box(d.footprint, d.height)),
    ...(flags.skyline ? sceneryBuildings(layout) : []).map((b) =>
      box(
        { cx: b.x, cy: b.y, halfLength: b.length / 2, halfWidth: b.depth / 2, heading: b.heading },
        b.height,
      ),
    ),
  ];
}

/** A portrait pane whose HUD leaves its lower part free, and a free rect small enough that the eye reaches `CHASE_MAX_DISTANCE`. */
const FRAMES: readonly ChaseFrame[] = [
  { width: 512, height: 800, clear: { x: 0, y: 440, width: 512, height: 360 } },
  { width: 1280, height: 800, clear: { x: 540, y: 300, width: 200, height: 200 } },
];
const RAYS = { across: 16, up: 24 };
const YAW_STEP = 15;
const PITCHES = [5, 15, 25, 35, 45, 55, 65, 75];
/** Least share of the frame scenery must cover. */
const MIN_SCENERY = 0.01;
/** Most of the frame bare verge may cover: ground outside every surface, inside or beyond the bounds. */
const MAX_BARE = 0.5;
/** Most of the frame the verge beyond the bounds may cover, where only the skyline stands. */
const MAX_BEYOND = 0.3;
/** From this pitch the frame may show only the driveable ground around the vehicle. */
const STEEP = 45;
const deg = (d: number): number => (d * Math.PI) / 180;

type Shot = { scenery: number; bare: number; drawn: number; beyond: number };

describe('chase view scenery at the farthest orbit', () => {
  const truck = trucks[0];
  const trailer = trailers[0];
  if (truck === undefined || trailer === undefined) throw new Error('no vehicles');
  const extent = combinationExtent(truck, trailer);
  const face = cabFront(truck);
  const middle = (face.bottom + face.top) / 2;
  const masked = boundingRadius(extent) * 0.7;
  const camera = createChaseCamera();
  const frustum = new Frustum();
  const matrix = new Matrix4();
  const ray = new Vector3();
  const toPivot = new Vector3();

  function shoot(layout: ResolvedLayout, boxes: readonly Box[], pivot: Vector3): Shot {
    frustum.setFromProjectionMatrix(
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const seen = boxes.filter((b) => frustum.intersectsBox(b.aabb));
    const eye = camera.position;
    const shot = { scenery: 0, bare: 0, drawn: 0, beyond: 0 };
    for (let i = 0; i < RAYS.across; i++) {
      for (let j = 0; j < RAYS.up; j++) {
        ray.set(((i + 0.5) / RAYS.across) * 2 - 1, ((j + 0.5) / RAYS.up) * 2 - 1, 0.5);
        ray.unproject(camera).sub(eye).normalize();
        toPivot.subVectors(pivot, eye);
        if (toPivot.addScaledVector(ray, -toPivot.dot(ray)).length() < masked) continue;
        shot.drawn++;
        const ground = ray.y < 0 ? -eye.y / ray.y : Infinity;
        const nearest = Math.min(...seen.map((b) => hit(eye, ray, b)));
        if (nearest < ground && nearest < camera.far) shot.scenery++;
        else if (ground < camera.far) {
          const [x, y] = [eye.x + ray.x * ground, -(eye.z + ray.z * ground)];
          if (!layout.surfaces.some((s) => inside(s.rect, x, y))) shot.bare++;
          if (!inside(layout.bounds, x, y)) shot.beyond++;
        }
      }
    }
    return shot;
  }

  it.each(exercises)(
    'shows scenery in every direction from the start of $id, and bare verge in no more than part of the frame',
    (exercise) => {
      const layout = resolveLayout(layouts[exercise.layout], exercise);
      const colliders = chaseColliders(layout);
      const centre = { x: exercise.start.x, y: exercise.start.y };
      const pivot = new Vector3(centre.x, middle, -centre.y);
      const rig = { truck: exercise.start, centre, extent, face, colliders };
      const open = { ...rig, colliders: [] };
      for (const preset of ['balanced', 'high'] as const) {
        const boxes = scenery(layout, preset);
        for (const frame of FRAMES) {
          for (const pitch of PITCHES) {
            for (let yaw = 0; yaw < 360; yaw += YAW_STEP) {
              const view = {
                zoom: CHASE_ZOOM.min,
                panX: deg(yaw) - CHASE_AZIMUTH.default,
                panY: deg(pitch) - CHASE_PITCH.default,
              };
              placeChaseCamera(camera, open, frame, view);
              const farthest = camera.position.distanceTo(pivot);
              placeChaseCamera(camera, rig, frame, view);
              // a collider that hides the vehicle draws the eye in: that view is not the farthest
              if (camera.position.distanceTo(pivot) < farthest - 1e-6) continue;
              const { scenery: drawnScenery, bare, drawn, beyond } = shoot(layout, boxes, pivot);
              if (drawn === 0) continue;
              const label = `${preset} ${String(frame.width)}x${String(frame.height)} pitch ${String(pitch)} yaw ${String(yaw)}`;
              expect(beyond / drawn, `${label}: verge beyond the bounds`).toBeLessThanOrEqual(
                MAX_BEYOND,
              );
              expect(bare / drawn, `${label}: bare verge`).toBeLessThanOrEqual(MAX_BARE);
              // only a steep look down at the driveable ground around the vehicle may lack scenery
              if (drawnScenery / drawn < MIN_SCENERY) {
                expect(pitch >= STEEP && bare === 0, `${label}: no scenery`).toBe(true);
              }
            }
          }
        }
      }
    },
  );
});
