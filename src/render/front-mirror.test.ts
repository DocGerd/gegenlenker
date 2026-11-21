import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Frustum, Matrix4, type Mesh, Raycaster, DoubleSide, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Pose2, Vec2 } from '../contracts/sim';
import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { trucks } from '../vehicles/registry';
import { cabShellParams, CAB_HEIGHT, FRAME_TOP } from './cab-dims';
import { parseShell } from './glb-shells';
import { CLASS_VI, createMirror, mirrorAnchor, mirrorFacing, mirrorMounts } from './mirror';
import { CLASS_VI_REACH, classVIField, frontMirrorMount, insidePolygon } from './mirror-fields';

const STRAIGHT: Pose2 = { x: 0, y: 0, heading: 0 };
const GRID = 0.1;
/** Metres ahead of the bumper in which the number plate may hide ground from the mirror. */
const PLATE_SHADOW = 0.3;

/** The class VI camera of `spec` placed on the straight pose as the renderer does, at the mirror's aspect. */
function frontCamera(spec: TruckSpec) {
  const mirror = createMirror(CLASS_VI);
  const position = new Vector3();
  const facing = mirrorFacing(
    STRAIGHT,
    mirrorAnchor(CLASS_VI, mirrorMounts(spec)),
    CLASS_VI.yaw,
    position,
  );
  mirror.place(position, facing);
  mirror.camera.aspect = CLASS_VI.aspect ?? 1;
  mirror.camera.updateProjectionMatrix();
  mirror.camera.updateMatrixWorld(true);
  return mirror.camera;
}

/** Ground samples of `polygon` on a `GRID` m grid, as body-frame points. */
function sample(polygon: readonly Vec2[]): Vec2[] {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const points: Vec2[] = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += GRID) {
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += GRID) {
      if (insidePolygon(polygon, { x, y })) points.push({ x, y });
    }
  }
  return points;
}

/** A body-frame ground point as a three position on the straight pose. */
const onGround = (p: Vec2, z = 0): Vector3 => new Vector3(p.x, z, -p.y);

describe.each(trucks)('class VI front mirror of $id', (spec) => {
  const { frontX } = truckAnchors(spec);
  const half = cabShellParams(spec).width / 2;
  const field = classVIField(spec);

  it('covers the R46 field: the bumper plane to 2 m ahead, the driver side to 2 m past the passenger side, the far corner rounded', () => {
    const xs = field.map((p) => p.x);
    const ys = field.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(frontX);
    expect(Math.max(...xs)).toBeCloseTo(frontX + CLASS_VI_REACH);
    expect(Math.max(...ys)).toBeCloseTo(half);
    expect(Math.min(...ys)).toBeCloseTo(-(half + CLASS_VI_REACH));
    const at = (ahead: number, aside: number): boolean =>
      insidePolygon(field, { x: frontX + ahead, y: -(half + aside) });
    expect(at(0.1, 1.9)).toBe(true);
    expect(at(1.9, 0.1)).toBe(true);
    expect(at(1.4, 1.4)).toBe(true);
    expect(at(1.5, 1.5)).toBe(false);
    expect(at(1.9, 1.9)).toBe(false);
    expect(insidePolygon(field, { x: frontX - 0.1, y: 0 })).toBe(false);
  });

  it('sits at the top front of the cab on the passenger side, ahead of the glass and 2 m or more above the ground', () => {
    const mount = frontMirrorMount(spec);
    expect(mount.x).toBeGreaterThan(frontX);
    expect(mount.y).toBeLessThan(0);
    expect(mount.y).toBeGreaterThan(-half);
    expect(mount.z).toBeGreaterThanOrEqual(2);
    expect(mount.z).toBeLessThanOrEqual(CAB_HEIGHT);
  });

  it('has every point of the field in its frustum', () => {
    const camera = frontCamera(spec);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const points = sample(field);
    expect(points.length).toBeGreaterThan(100);
    for (const p of points) {
      expect(frustum.containsPoint(onGround(p)), `(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`).toBe(
        true,
      );
    }
  });

  it('shows the bumper on the top edge and the driver side on the left, as drawn', () => {
    const camera = frontCamera(spec);
    // The composite mirrors u and keeps v: the screen's x is the camera's NDC x negated, y its NDC y.
    const seen = (p: Vec2): { x: number; y: number } => {
      const ndc = onGround(p).project(camera);
      return { x: -ndc.x, y: ndc.y };
    };
    const bumper = seen({ x: frontX, y: -half });
    const far = seen({ x: frontX + CLASS_VI_REACH, y: -half });
    expect(bumper.y).toBeGreaterThan(far.y);
    expect(bumper.y).toBeGreaterThan(0.5);
    const driver = seen({ x: frontX + 1, y: half });
    const passenger = seen({ x: frontX + 1, y: -half });
    expect(driver.x).toBeLessThan(passenger.x);
    expect(driver.x).toBeLessThan(-0.5);
  });

  it('is outside the cab shell, and the cab does not hide the field', async () => {
    const bytes = readFileSync(join(import.meta.dirname, `assets/${spec.id}-cab.glb`));
    const { mesh } = await parseShell(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      'cab',
    );
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => {
      m.side = DoubleSide;
    });
    mesh.updateMatrixWorld(true);
    const camera = frontCamera(spec);
    const raycaster = new Raycaster();
    const blocked = (target: Vector3): boolean => {
      const toTarget = target.clone().sub(camera.position);
      raycaster.set(camera.position, toTarget.clone().normalize());
      raycaster.far = toTarget.length() - 1e-3;
      return raycaster.intersectObject<Mesh>(mesh, false).length > 0;
    };
    const mount = frontMirrorMount(spec);
    const { relief, plateRelief } = cabShellParams(spec);
    expect(mount.x).toBeGreaterThan(frontX + Math.max(relief, plateRelief));
    const points = sample(field);
    // only the number plate, a hand's breadth ahead of the bumper, stands in the way
    const hidden = points.filter((p) => blocked(onGround(p)));
    expect(hidden.filter((p) => p.x > frontX + PLATE_SHADOW)).toEqual([]);
    expect(hidden.length / points.length).toBeLessThan(0.01);
    // the bumper itself is in frame, so the picture shows where the truck ends
    const bumper = onGround({ x: frontX, y: 0 }, 0.5).project(camera);
    expect(Math.abs(bumper.x)).toBeLessThan(1);
    expect(bumper.y).toBeLessThan(1);
    expect(bumper.y).toBeGreaterThan(0.5);
  });

  it('is not the R46 15.2.4.6.2 exemption: the driver cannot see 300 mm ahead at 1.2 m through the cab front', () => {
    const { eye } = truckAnchors(spec);
    const { relief } = cabShellParams(spec);
    const sill = FRAME_TOP + cabShellParams(spec).cab.glassSill;
    for (let y = -half; y <= half; y += 0.25) {
      const target = { x: frontX + 0.3, y, z: 1.2 };
      // where the sight line crosses the cab's front face
      const t = (frontX + relief - eye.x) / (target.x - eye.x);
      const z = eye.z + t * (target.z - eye.z);
      expect(z, `y = ${y}`).toBeLessThan(sill);
    }
  });
});
