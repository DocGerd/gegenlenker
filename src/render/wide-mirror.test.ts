import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Frustum, Matrix4, type Mesh, Object3D, Scene, Triangle, Vector3 } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import type { Pose2, Vec2 } from '../contracts/sim';
import { TRAILER_IDS, type TrailerId, type TruckSpec } from '../contracts/vehicle';
import { joints, type KinematicState } from '../sim/kinematics';
import { truckAnchors } from '../vehicles/anchors';
import { trailerById, trucks } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { cabShellParams } from './cab-dims';
import { placePose } from './coords';
import { parseTrailerShell } from './glb-shells';
import {
  CLASS_IV_LEFT,
  CLASS_IV_RIGHT,
  createMirror,
  type MirrorSpec,
  mirrorAnchor,
  mirrorFacing,
  mirrorMounts,
} from './mirror';
import {
  CLASS_IV_FAR,
  CLASS_IV_NARROW,
  CLASS_IV_NEAR,
  CLASS_IV_START,
  CLASS_IV_WIDTH,
  classIVField,
  classVField,
  classVIField,
  insidePolygon,
} from './mirror-fields';
import { MIN_WIDE_WIDTH, WIDE_ASPECT } from './viewports';

const STRAIGHT: Pose2 = { x: 0, y: 0, heading: 0 };
const GRID = 0.25;
const SIDES = [
  ['left', CLASS_IV_LEFT],
  ['right', CLASS_IV_RIGHT],
] as const;

/** The class IV camera of `spec` placed on the straight pose as the renderer does, at the mirror's aspect. */
function wideCamera(truck: TruckSpec, spec: MirrorSpec, pose: Pose2 = STRAIGHT) {
  const mirror = createMirror(spec);
  const position = new Vector3();
  const facing = mirrorFacing(pose, mirrorAnchor(spec, mirrorMounts(truck)), spec.yaw, position);
  mirror.place(position, facing);
  mirror.camera.aspect = spec.aspect ?? 1;
  mirror.camera.updateProjectionMatrix();
  mirror.camera.updateMatrixWorld(true);
  return mirror.camera;
}

const frustumOf = (camera: ReturnType<typeof wideCamera>): Frustum =>
  new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );

/** Ground samples of `polygon` on a `GRID` m grid, as body-frame points. */
function sample(polygon: readonly Vec2[], grid = GRID): Vec2[] {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const points: Vec2[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs) + 1e-9; x += grid) {
    for (let y = Math.min(...ys); y <= Math.max(...ys) + 1e-9; y += grid) {
      if (insidePolygon(polygon, { x, y })) points.push({ x, y });
    }
  }
  return points;
}

/** A body-frame ground point as a three position on the straight pose. */
const onGround = (p: Vec2, z = 0): Vector3 => new Vector3(p.x, z, -p.y);

describe.each(trucks)('class IV mirrors of $id', (truck) => {
  const half = cabShellParams(truck).width / 2;
  const { eye, wideLeft, mirrorLeft, wideRight, mirrorRight } = truckAnchors(truck);

  it('sits under the class II mirror, on the same line', () => {
    expect(wideLeft.z).toBeCloseTo(mirrorLeft.z - truck.mirror.wideBelow.value / 1000);
    expect(wideLeft.z).toBeLessThan(mirrorLeft.z);
    expect({ ...wideLeft, z: 0 }).toEqual({ ...mirrorLeft, z: 0 });
    expect({ ...wideRight, z: 0 }).toEqual({ ...mirrorRight, z: 0 });
    expect(wideRight.y).toBe(-wideLeft.y);
  });

  describe.each(SIDES)('%s', (side, spec) => {
    const field = classIVField(truck, side);
    const sign = side === 'left' ? 1 : -1;

    it('is the R46 field: 15 m wide from 10 to 25 m behind the ocular points, 4.5 m wide from 1.5 m', () => {
      const at = (behind: number, out: number): boolean =>
        insidePolygon(field, { x: eye.x - behind, y: sign * (half + out) });
      expect(at(CLASS_IV_START + 0.1, 0.1)).toBe(true);
      expect(at(CLASS_IV_START - 0.1, 0.1)).toBe(false);
      expect(at(CLASS_IV_NEAR - 0.1, CLASS_IV_NARROW - 0.1)).toBe(true);
      expect(at(CLASS_IV_NEAR - 0.1, CLASS_IV_NARROW + 0.1)).toBe(false);
      expect(at(CLASS_IV_NEAR + 0.1, CLASS_IV_WIDTH - 0.1)).toBe(true);
      expect(at(CLASS_IV_NEAR + 0.1, CLASS_IV_WIDTH + 0.1)).toBe(false);
      expect(at(CLASS_IV_FAR - 0.1, CLASS_IV_WIDTH - 0.1)).toBe(true);
      expect(at(CLASS_IV_FAR + 0.1, 0.1)).toBe(false);
      // the other side's ground is not this mirror's
      expect(insidePolygon(field, { x: eye.x - 15, y: -sign * (half + 1) })).toBe(false);
    });

    it('has every point of the field in its frustum', () => {
      const frustum = frustumOf(wideCamera(truck, spec));
      const points = [...sample(field), ...field];
      expect(points.length).toBeGreaterThan(500);
      for (const p of points) {
        expect(frustum.containsPoint(onGround(p)), `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).toBe(
          true,
        );
      }
    });

    it('shows the truck on the inner edge and the field outward, as drawn', () => {
      const camera = wideCamera(truck, spec);
      // The composite mirrors u and keeps v: the screen's x is the camera's NDC x negated.
      const seenX = (p: Vec2): number => -onGround(p).project(camera).x;
      const hull = seenX({ x: eye.x - 4, y: sign * half });
      const outer = seenX({ x: eye.x - 4, y: sign * (half + CLASS_IV_NARROW) });
      // a left mirror's inner edge is its right one
      expect(Math.sign(outer - hull)).toBe(-sign);
      expect(Math.abs(hull)).toBeLessThan(1);
      expect(Math.abs(outer)).toBeLessThan(1);
      // the truck's own side, 1.5 m behind the ocular plane, is the picture's inner part
      expect(Math.sign(seenX({ x: eye.x - 3, y: sign * half }))).toBe(sign);
    });
  });
});

describe('class IV minimum width', () => {
  it('shows a 0.5 m wide road user across 2 px anywhere in the 4.5 m strip at the narrowest width, and not at two px less', () => {
    // A cone base 0.3 m wide across 6 px, as the class VI mirror is sized, cannot be met: the ground
    // at 25 m shrinks to 0.5 px per 0.3 m at 100 px, and what lies along the line of sight to far less.
    // The strip beside the truck, to the far end of its 4.5 m width, is where a cyclist is overlooked.
    const WIDTH = 0.5;
    /** Screen px a `WIDTH` m wide object at `p` spans across the line of sight from the mirror, in a mirror `width` px wide. */
    const across = (camera: ReturnType<typeof wideCamera>, p: Vec2, width: number): number => {
      const at = onGround(p);
      const dx = at.x - camera.position.x;
      const dz = at.z - camera.position.z;
      const length = Math.hypot(dx, dz);
      const side = new Vector3((-dz / length) * (WIDTH / 2), 0, (dx / length) * (WIDTH / 2));
      const a = at.clone().add(side).project(camera);
      const b = at.clone().sub(side).project(camera);
      return (Math.abs(a.x - b.x) * width) / 2;
    };
    const least = (width: number): number =>
      Math.min(
        ...trucks.flatMap((truck) =>
          SIDES.flatMap(([side, spec]) => {
            const { eye } = truckAnchors(truck);
            const half = cabShellParams(truck).width / 2;
            const camera = wideCamera(truck, spec);
            const field = classIVField(truck, side);
            const sign = side === 'left' ? 1 : -1;
            const strip = [...sample(field, 0.1), ...field].filter(
              (p) =>
                p.x >= eye.x - CLASS_IV_NEAR &&
                Math.abs(p.y - sign * half) <= CLASS_IV_NARROW + 1e-9,
            );
            expect(strip.length).toBeGreaterThan(500);
            return strip.map((p) => across(camera, p, width));
          }),
        ),
      );
    expect(MIN_WIDE_WIDTH % 2).toBe(0);
    expect(least(MIN_WIDE_WIDTH)).toBeGreaterThanOrEqual(2);
    expect(least(MIN_WIDE_WIDTH - 2)).toBeLessThan(2);
  });
});

const readTrailer = async (id: TrailerId) => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-trailer.glb`));
  return parseTrailerShell(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
};

/** Share of a mesh's surface area, by triangle centroid, inside `frustum`; the mesh stands at `place`. */
function areaIn(frustum: Frustum, mesh: Mesh, place: Pose2): number {
  const placed = new Object3D();
  placePose(placed, place);
  placed.updateMatrixWorld(true);
  const positions = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  const count = (index ? index.count : positions.count) / 3;
  const corner = (i: number): Vector3 =>
    new Vector3()
      .fromBufferAttribute(positions, index ? index.getX(i) : i)
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(placed.matrixWorld);
  const triangle = new Triangle();
  const centroid = new Vector3();
  let seen = 0;
  let total = 0;
  for (let t = 0; t < count; t++) {
    triangle.set(corner(3 * t), corner(3 * t + 1), corner(3 * t + 2));
    const area = triangle.getArea();
    triangle.getMidpoint(centroid);
    total += area;
    if (frustum.containsPoint(centroid)) seen += area;
  }
  return seen / total;
}

/** Share of the trailer's and the dolly's surface the class IV mirror on the drawbar's side frames at the coupling limit, set below the measured share of every pairing. */
const TRAILER_FLOOR = 0.9;
const DOLLY_FLOOR = 0.9;

describe.each(trucks.flatMap((t) => TRAILER_IDS.map((r) => [t, r] as const)))(
  'class IV mirror of %s towing %s at the coupling limit',
  (truck, trailerId) => {
    it.each([-1, 1])(
      'frames the trailer and the dolly on the side the drawbar swings to (%i)',
      async (sign) => {
        const combination = resolveCombination(truck, trailerById(trailerId));
        const angle = -sign * combination.couplingLimit;
        const state: KinematicState = { x: 0, y: 0, th0: 0, th1: angle, th2: angle };
        const at = joints(combination, state);
        const { trailer, dolly } = await readTrailer(trailerId);
        // the drawbar swings to the left for a positive sign
        const spec = sign > 0 ? CLASS_IV_LEFT : CLASS_IV_RIGHT;
        const frustum = frustumOf(wideCamera(truck, spec));
        expect(areaIn(frustum, trailer.mesh, at.trailer)).toBeGreaterThan(TRAILER_FLOOR);
        expect(areaIn(frustum, dolly.mesh, at.dolly)).toBeGreaterThan(DOLLY_FLOOR);
      },
    );
  },
);

describe('class IV capture schedule', () => {
  /** Counts the scenes a mirror renders. */
  const fake = (): { gl: WebGPURenderer; passes: () => number } => {
    let passes = 0;
    const gl = {
      autoClear: false,
      setRenderTarget: () => undefined,
      setClearColor: () => undefined,
      render: () => {
        passes++;
      },
    } as unknown as WebGPURenderer;
    return { gl, passes: () => passes };
  };

  it('renders exactly one class IV pass per frame, left on even frames and right on odd ones', () => {
    const { gl, passes } = fake();
    const left = createMirror(CLASS_IV_LEFT);
    const right = createMirror(CLASS_IV_RIGHT);
    const scene = new Scene();
    const frame = (n: number): number => {
      const before = passes();
      const l = left.capture(gl, scene, 100, 60, 0, n);
      const r = right.capture(gl, scene, 100, 60, 0, n);
      expect(passes() - before).toBe(Number(l) + Number(r));
      return passes() - before;
    };
    // the first frame captures both: nothing has been drawn yet
    expect(frame(0)).toBe(2);
    expect([1, 2, 3, 4, 5].map(frame)).toEqual([1, 1, 1, 1, 1]);
    const rendered = (mirror: ReturnType<typeof createMirror>, n: number): boolean =>
      mirror.capture(gl, scene, 100, 60, 0, n);
    expect(rendered(left, 6)).toBe(true);
    expect(rendered(left, 7)).toBe(false);
    expect(rendered(right, 7)).toBe(true);
    expect(rendered(right, 8)).toBe(false);
  });

  it('captures both on the first frame after a resize, an invalidation or a hidden frame', () => {
    const { gl, passes } = fake();
    const left = createMirror(CLASS_IV_LEFT);
    const right = createMirror(CLASS_IV_RIGHT);
    const scene = new Scene();
    const frame = (n: number, w = 100): number => {
      const before = passes();
      left.capture(gl, scene, w, 60, 0, n);
      right.capture(gl, scene, w, 60, 0, n);
      return passes() - before;
    };
    frame(0);
    frame(1);
    expect(frame(2, 120)).toBe(2);
    expect(frame(3, 120)).toBe(1);
    left.invalidate();
    right.invalidate();
    expect(frame(5, 120)).toBe(2);
    expect(frame(6, 120)).toBe(1);
  });

  it('renders at half the pixel ratio of its rect', () => {
    const { gl } = fake();
    const bound: { width: number; height: number }[] = [];
    (
      gl as unknown as { setRenderTarget: (t: { width: number; height: number } | null) => void }
    ).setRenderTarget = (t) => {
      if (t !== null) bound.push(t);
    };
    createMirror(CLASS_IV_LEFT).capture(gl, new Scene(), 200, 120, 0, 0);
    expect(bound[0]).toMatchObject({ width: 100, height: 60 });
    expect(CLASS_IV_LEFT.aspect).toBe(WIDE_ASPECT);
  });
});

describe.each(trucks)('class V field of $id', (truck) => {
  const fields = {
    iv: classIVField(truck, 'right'),
    vi: classVIField(truck),
  };
  it('is the passenger side, 2 m wide, and partly outside what class IV and VI show', () => {
    const v = classVField(truck);
    const points = sample(v, 0.05);
    const covered = points.filter(
      (p) => insidePolygon(fields.iv, p) || insidePolygon(fields.vi, p),
    );
    const uncovered = 1 - covered.length / points.length;
    // reported in the PR: the class V strip a later issue has to cover
    expect(uncovered).toBeGreaterThan(0);
    expect(uncovered).toBeLessThan(1);
  });
});
