import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DoubleSide, Frustum, Matrix4, type Mesh, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Pose2, Vec2 } from '../contracts/sim';
import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { trucks } from '../vehicles/registry';
import { cabShellParams } from './cab-dims';
import { CLOSE_ASPECT, MIN_CLOSE_WIDTH } from './close-mirror';
import { parseShell } from './glb-shells';
import { extraMirrors } from './index';
import {
  CLASS_V_MIRROR,
  createMirror,
  type MirrorSpec,
  mirrorAnchor,
  mirrorFacing,
  MIRRORS,
  mirrorMounts,
  mirrorYaw,
} from './mirror';
import {
  CLASS_V_AHEAD,
  CLASS_V_BEHIND,
  CLASS_V_OUT,
  classVField,
  closeMirrorMount,
  insidePolygon,
} from './mirror-fields';

const STRAIGHT: Pose2 = { x: 0, y: 0, heading: 0 };
const GRID = 0.1;
const SPEC: MirrorSpec = CLASS_V_MIRROR;

/** The class V camera of `truck` placed on the straight pose as the renderer does, at the mirror's aspect. */
function closeCamera(truck: TruckSpec) {
  const mirror = createMirror(SPEC);
  const position = new Vector3();
  const facing = mirrorFacing(
    STRAIGHT,
    mirrorAnchor(SPEC, mirrorMounts(truck)),
    mirrorYaw(SPEC, truck.id),
    position,
  );
  mirror.place(position, facing);
  mirror.camera.aspect = CLOSE_ASPECT;
  mirror.camera.updateProjectionMatrix();
  mirror.camera.updateMatrixWorld(true);
  return mirror.camera;
}

/** Ground samples of `polygon` on a `GRID` m grid, as body-frame points. */
function sample(polygon: readonly Vec2[]): Vec2[] {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const points: Vec2[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs) + 1e-9; x += GRID) {
    for (let y = Math.min(...ys); y <= Math.max(...ys) + 1e-9; y += GRID) {
      if (insidePolygon(polygon, { x, y })) points.push({ x, y });
    }
  }
  return points;
}

/** A body-frame ground point as a three position on the straight pose. */
const onGround = (p: Vec2, z = 0): Vector3 => new Vector3(p.x, z, -p.y);

describe.each(trucks)('class V close mirror of $id', (truck) => {
  const { eye, frontX } = truckAnchors(truck);
  const half = cabShellParams(truck).width / 2;
  const field = classVField(truck);

  it('covers the R46 15.2.4.5.1-.4 field: the cab side to 2 m out, 1.75 m behind to 1 m ahead of the ocular plane, cut at the bumper', () => {
    const xs = field.map((p) => p.x);
    const ys = field.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(eye.x - CLASS_V_BEHIND);
    expect(Math.max(...xs)).toBeCloseTo(Math.min(eye.x + CLASS_V_AHEAD, frontX));
    expect(Math.max(...ys)).toBeCloseTo(-half);
    expect(Math.min(...ys)).toBeCloseTo(-(half + CLASS_V_OUT));
    expect(insidePolygon(field, { x: eye.x - 1.7, y: -(half + 1.9) })).toBe(true);
    expect(insidePolygon(field, { x: eye.x - 1.8, y: -(half + 1) })).toBe(false);
    expect(insidePolygon(field, { x: eye.x, y: -(half + 2.1) })).toBe(false);
    expect(insidePolygon(field, { x: eye.x, y: -(half - 0.1) })).toBe(false);
    expect(insidePolygon(field, { x: frontX + 0.1, y: -(half + 1) })).toBe(false);
  });

  it('cuts the field at the bumper plane where the ocular plane is close behind it', () => {
    const cut = classVField({
      ...truck,
      eye: { ...truck.eye, behindBumper: { ...truck.eye.behindBumper, value: 400 } },
    });
    expect(Math.max(...cut.map((p) => p.x))).toBeCloseTo(frontX);
  });

  it('sits on the passenger side, outboard of the cab, just ahead of the ocular plane, below 2.4 m and 2 m or more above the ground', () => {
    const mount = closeMirrorMount(truck);
    expect(mount.y).toBeLessThan(-half);
    expect(mount.x).toBeGreaterThan(eye.x);
    expect(mount.x).toBeLessThan(frontX);
    expect(mount.z).toBeGreaterThanOrEqual(2);
    expect(mount.z).toBeLessThan(2.4);
  });

  it('has every point of the field in its frustum', () => {
    const camera = closeCamera(truck);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const points = [...sample(field), ...field];
    expect(points.length).toBeGreaterThan(400);
    for (const p of points) {
      expect(frustum.containsPoint(onGround(p)), `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).toBe(
        true,
      );
    }
  });

  it('shows the cab side on the top edge and the front on the left, as drawn', () => {
    const camera = closeCamera(truck);
    // The composite mirrors u and keeps v: the screen's x is the camera's NDC x negated, y its NDC y.
    const seen = (p: Vec2): { x: number; y: number } => {
      const ndc = onGround(p).project(camera);
      return { x: -ndc.x, y: ndc.y };
    };
    const mid = eye.x - 0.5;
    const side = seen({ x: mid, y: -half });
    const out = seen({ x: mid, y: -(half + CLASS_V_OUT) });
    expect(side.y).toBeGreaterThan(out.y);
    expect(side.y).toBeGreaterThan(0.3);
    const front = seen({ x: eye.x + 0.5, y: -(half + 1) });
    const back = seen({ x: eye.x - 1.5, y: -(half + 1) });
    expect(front.x).toBeLessThan(back.x);
    expect(front.x).toBeLessThan(0);
    expect(back.x).toBeGreaterThan(0);
  });

  it('is not hidden by the cab at the cab side', async () => {
    const bytes = readFileSync(join(import.meta.dirname, `assets/${truck.id}-cab.glb`));
    const { mesh } = await parseShell(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      'cab',
    );
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
      m.side = DoubleSide;
    });
    mesh.updateMatrixWorld(true);
    const camera = closeCamera(truck);
    const raycaster = new Raycaster();
    const blocked = (target: Vector3): boolean => {
      const toTarget = target.clone().sub(camera.position);
      raycaster.set(camera.position, toTarget.clone().normalize());
      raycaster.far = toTarget.length() - 1e-3;
      return raycaster.intersectObject<Mesh>(mesh, false).length > 0;
    };
    const mount = closeMirrorMount(truck);
    expect(-mount.y).toBeGreaterThan(half + cabShellParams(truck).relief);
    // control: the mesh is in place, so the ground under the cab is hidden from the same camera
    expect(blocked(onGround({ x: mount.x, y: 0 }))).toBe(true);
    const points = [...sample(field), ...field];
    expect(points.filter((p) => blocked(onGround(p)))).toEqual([]);
  });
});

describe('class V minimum width', () => {
  it('shows a 0.3 m cone base across 6 texels anywhere in the field at the narrowest width, and not at two px less', () => {
    const H = 0.05;
    const px = (
      camera: ReturnType<typeof closeCamera>,
      p: Vec2,
      width: number,
    ): [number, number] => {
      const ndc = onGround(p).project(camera);
      // the mirror is `width` wide and `width / CLOSE_ASPECT` tall at a device pixel ratio of 1
      return [(ndc.x * width) / 2, (ndc.y * width) / CLOSE_ASPECT / 2];
    };
    /** Smallest px per metre over every ground direction: the least singular value of the ground-to-pixel Jacobian. */
    const least = (camera: ReturnType<typeof closeCamera>, p: Vec2, width: number): number => {
      const [x1, y1] = px(camera, { x: p.x + H, y: p.y }, width);
      const [x0, y0] = px(camera, { x: p.x - H, y: p.y }, width);
      const [u1, v1] = px(camera, { x: p.x, y: p.y + H }, width);
      const [u0, v0] = px(camera, { x: p.x, y: p.y - H }, width);
      const a = (x1 - x0) / (2 * H);
      const b = (u1 - u0) / (2 * H);
      const c = (y1 - y0) / (2 * H);
      const d = (v1 - v0) / (2 * H);
      // eigenvalues of J^T J: trace / 2 minus the root of (trace / 2)^2 - det
      const trace = a * a + b * b + c * c + d * d;
      const det = (a * d - b * c) ** 2;
      return Math.sqrt(trace / 2 - Math.sqrt((trace / 2) ** 2 - det));
    };
    const scale = (width: number): number =>
      Math.min(
        ...trucks.flatMap((truck) => {
          const camera = closeCamera(truck);
          const field = classVField(truck);
          return [...sample(field), ...field].map((p) => least(camera, p, width));
        }),
      );
    expect(MIN_CLOSE_WIDTH % 2).toBe(0);
    expect(scale(MIN_CLOSE_WIDTH) * 0.3).toBeGreaterThanOrEqual(6);
    expect(scale(MIN_CLOSE_WIDTH - 2) * 0.3).toBeLessThan(6);
  });
});

describe('class V close mirror wiring', () => {
  it('is the one mirror drawn into the close view, from the close mount', () => {
    expect(MIRRORS.filter((m) => m.view === 'close')).toEqual([CLASS_V_MIRROR]);
    expect(CLASS_V_MIRROR.anchor).toBe('close');
    for (const truck of trucks) {
      expect(mirrorAnchor(CLASS_V_MIRROR, mirrorMounts(truck))).toEqual(closeMirrorMount(truck));
    }
  });
});

describe('class V close mirror flag', () => {
  it('is drawn on Balanced and High, and not on Low, whatever the class IV setting', () => {
    for (const wide of [true, false]) {
      expect(extraMirrors('low', wide).close).toBe(false);
      expect(extraMirrors('balanced', wide).close).toBe(true);
      expect(extraMirrors('high', wide).close).toBe(true);
    }
  });
});
