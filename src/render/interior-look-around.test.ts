import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Ray,
  Raycaster,
  Vector3,
} from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { truckAnchors } from '../vehicles/anchors';
import { trucks } from '../vehicles/registry';
import { CAB_HEIGHT, cabShellParams, FRAME_TOP } from './cab-dims';
import { COCKPIT_FOV, COCKPIT_PITCH } from './cockpit-camera';
import { parseMeshes } from './glb-shells';
import { interiorShellFrom } from './interior-glb';
import {
  B_PILLAR,
  DOOR_THICKNESS,
  GLASS_SETBACK,
  interiorShellParams,
  type InteriorMeshName,
  lookAroundSolids,
  type Solid,
  type Vec3,
} from './interior-dims';
import { computeViewports } from './viewports';

/*
 * The cab interior for looking around (#258): from the driver's eye, every ray of a camera yawed up to
 * LOOK_YAW either way hits an interior part, unless it leaves through glass the cab shell has. The
 * checks run in the body frame from the eye, not through the cockpit camera: the interior follows
 * that camera's heading, so yawing it and placing the interior again would test nothing.
 */

const LOOK_YAW = 100;
/** The camera's yaw step and its NDC grid. */
const YAW_STEP = 5;
const GRID_STEPS = 24;
/** The look-around's pitch range, read both against the horizon and against the forward view's pitch. */
const LOOK_PITCH = 10;
const BASE_PITCH = -MathUtils.radToDeg(COCKPIT_PITCH);
const AXIS_ELEVATIONS = [
  -BASE_PITCH - LOOK_PITCH,
  -LOOK_PITCH,
  -BASE_PITCH,
  0,
  LOOK_PITCH - BASE_PITCH,
  LOOK_PITCH,
];
const WINDOWS: readonly (readonly [number, number])[] = [
  [1920, 1080],
  [1350, 600],
  [1920, 360],
  [844, 390],
  [390, 844],
];

/**
 * A part's front faces in three space as flat vertex triples, in groups of `CHUNK` triangles with a box
 * each (a solid is contiguous, so a group is compact): the ray tests walk plain vectors, not
 * `Raycaster`, which rebuilds the ray in each mesh's frame for every ray.
 */
const CHUNK = 8;
type Part = {
  readonly box: Box3;
  readonly triangles: readonly Vector3[];
  readonly chunks: readonly { readonly box: Box3; readonly from: number; readonly to: number }[];
};

const partOf = (triangles: Vector3[]): Part => {
  const chunks = [];
  for (let from = 0; from < triangles.length; from += 3 * CHUNK) {
    const to = Math.min(from + 3 * CHUNK, triangles.length);
    chunks.push({ box: new Box3().setFromPoints(triangles.slice(from, to)), from, to });
  }
  return { box: new Box3().setFromPoints(triangles), triangles, chunks };
};

const meshPart = (mesh: Mesh): Part => {
  mesh.updateMatrixWorld(true);
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.getIndex();
  const count = index?.count ?? position.count;
  const found: Vector3[] = [];
  for (let i = 0; i < count; i++) {
    found.push(
      new Vector3()
        .fromBufferAttribute(position, index ? index.getX(i) : i)
        .applyMatrix4(mesh.matrixWorld),
    );
  }
  // a mirroring transform flips the winding, which the renderer culls by in the mesh's own frame
  if (mesh.matrixWorld.determinant() < 0) {
    for (let i = 0; i < found.length; i += 3) {
      [found[i + 1], found[i + 2]] = [found[i + 2] as Vector3, found[i + 1] as Vector3];
    }
  }
  return partOf(found);
};

const solidPart = (solids: readonly Solid[]): Part => {
  const found: Vector3[] = [];
  for (const { verts, faces } of solids) {
    for (const face of faces) {
      for (let i = 1; i < face.length - 1; i++) {
        for (const k of [0, i, i + 1]) {
          const [x, y, z] = verts[face[k] as number] as Vec3;
          found.push(new Vector3(x, z, -y)); // body frame to three space, which keeps the winding
        }
      }
    }
  }
  return partOf(found);
};

const ray = new Ray();
const hit = new Vector3();

/** The distance to the nearest front face along the ray, or null. */
const nearest = (parts: readonly Part[], origin: Vector3, direction: Vector3): number | null => {
  ray.set(origin, direction);
  let best: number | null = null;
  for (const { box, triangles, chunks } of parts) {
    if (!ray.intersectsBox(box)) continue;
    for (const { box: chunkBox, from, to } of chunks) {
      if (!ray.intersectsBox(chunkBox)) continue;
      for (let i = from; i < to; i += 3) {
        if (
          ray.intersectTriangle(
            triangles[i] as Vector3,
            triangles[i + 1] as Vector3,
            triangles[i + 2] as Vector3,
            true,
            hit,
          ) === null
        )
          continue;
        const distance = origin.distanceTo(hit);
        if (best === null || distance < best) best = distance;
      }
    }
  }
  return best;
};

/** Whether the ray meets any front face; stops at the first. */
const hits = (parts: readonly Part[], origin: Vector3, direction: Vector3): boolean => {
  ray.set(origin, direction);
  for (const { box, triangles, chunks } of parts) {
    if (!ray.intersectsBox(box)) continue;
    for (const { box: chunkBox, from, to } of chunks) {
      if (!ray.intersectsBox(chunkBox)) continue;
      for (let i = from; i < to; i += 3) {
        if (
          ray.intersectTriangle(
            triangles[i] as Vector3,
            triangles[i + 1] as Vector3,
            triangles[i + 2] as Vector3,
            true,
            hit,
          ) !== null
        )
          return true;
      }
    }
  }
  return false;
};

/** The body-frame direction at NDC (x, y) of a camera looking `yaw` to the left and `elevation` above the horizon, degrees. */
function direction(
  [x, y]: readonly [number, number],
  yaw: number,
  elevation: number,
  aspect: number,
): Vec3 {
  const tanV = Math.tan(MathUtils.degToRad(COCKPIT_FOV / 2));
  const forward = 1;
  const left = -x * tanV * aspect;
  const up = y * tanV;
  const e = MathUtils.degToRad(elevation);
  const a = MathUtils.degToRad(yaw);
  const pitchedX = forward * Math.cos(e) - up * Math.sin(e);
  const pitchedZ = forward * Math.sin(e) + up * Math.cos(e);
  return [
    pitchedX * Math.cos(a) - left * Math.sin(a),
    pitchedX * Math.sin(a) + left * Math.cos(a),
    pitchedZ,
  ];
}

const toThree = ([x, y, z]: Vec3): Vector3 => new Vector3(x, z, -y);

const grid = (steps: number): [number, number][] => {
  const found: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) found.push([-1 + (2 * i) / steps, -1 + (2 * j) / steps]);
  }
  return found;
};

const LOOK_GRID = grid(GRID_STEPS);
const FORWARD_GRID = grid(40);

const widest = Math.max(
  ...WINDOWS.map(([w, h]) => {
    const { cockpit } = computeViewports(w, h, 'drive', null);
    return (cockpit?.width ?? 1) / (cockpit?.height ?? 1);
  }),
);

describe.each(trucks)('cab interior for looking around, $id', (spec) => {
  const { eye, frontX } = truckAnchors(spec);
  const cab = cabShellParams(spec);
  const half = cab.width / 2;
  const inner = half - DOOR_THICKNESS;
  const sill = FRAME_TOP + cab.cab.glassSill;
  const glassTop = sill + cab.cab.glassHeight;
  const glass = frontX - GLASS_SETBACK;
  const bPillarFront = eye.x - B_PILLAR.behindEye;
  const origin = toThree([eye.x, eye.y, eye.z]);

  /**
   * Whether a ray the interior lets through leaves where the cab is open: the side window from the
   * A-pillar back to the B-pillar, or anywhere ahead of the eye, which is the forward
   * view's to keep (the second test pins that it does not change). That includes its open roof
   * corners, which an upward glance to the side can still reach.
   */
  const throughGlass = ([dx, dy, dz]: Vec3): boolean => {
    const at = (t: number): Vec3 => [eye.x + t * dx, eye.y + t * dy, eye.z + t * dz];
    if (dx > 0) {
      const [, y, z] = at((frontX - eye.x) / dx);
      if (Math.abs(y) <= half && z >= FRAME_TOP && z <= CAB_HEIGHT) return true;
    }
    if (dy !== 0) {
      const [x, , z] = at(((dy > 0 ? inner : -inner) - eye.y) / dy);
      if (x >= bPillarFront && x <= eye.x && z >= sill && z <= glassTop) return true;
      if (x > eye.x && x <= glass && z >= sill) return true;
    }
    return false;
  };

  let shell: Part[] = [];
  beforeAll(async () => {
    const bytes = readFileSync(join(import.meta.dirname, `assets/${spec.id}-interior.glb`));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    shell = Object.values(interiorShellFrom(await parseMeshes(data))).map(meshPart);
  });

  it(`hits an interior part on every ray within ${LOOK_YAW} degrees of yaw and ${LOOK_PITCH} of pitch, except through the open window and the front`, () => {
    let checked = 0;
    let glass = 0;
    for (let yaw = -LOOK_YAW; yaw <= LOOK_YAW; yaw += YAW_STEP) {
      for (const elevation of AXIS_ELEVATIONS) {
        for (const ndc of LOOK_GRID) {
          const d = direction(ndc, yaw, elevation, widest);
          checked++;
          if (hits(shell, origin, toThree(d))) continue;
          glass++;
          expect(
            throughGlass(d),
            `yaw ${yaw}, axis ${elevation}, ndc ${ndc.join(', ')}: open to the outside`,
          ).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    // the side window is open to the look-around, so some rays do leave
    expect(glass).toBeGreaterThan(0);
  });

  it('leaves the forward view unchanged: no ray of it meets an added part first', () => {
    const params = interiorShellParams(spec);
    const added = lookAroundSolids(spec);
    const names = Object.keys(added) as InteriorMeshName[];
    const base = names.map((n) =>
      solidPart(params.meshes[n].slice(0, params.meshes[n].length - added[n].length)),
    );
    const all = names.map((n) => solidPart(params.meshes[n]));
    for (const [w, h] of WINDOWS) {
      const { cockpit } = computeViewports(w, h, 'drive', null);
      const aspect = (cockpit?.width ?? 1) / (cockpit?.height ?? 1);
      for (const ndc of FORWARD_GRID) {
        const d = toThree(direction(ndc, 0, -BASE_PITCH, aspect));
        expect(nearest(all, origin, d), `${w}x${h} ndc ${ndc.join(', ')}`).toBe(
          nearest(base, origin, d),
        );
      }
    }
  });
});

describe('meshPart', () => {
  it.each([1, -1])('culls like Raycaster under a scale of %i on x', (sx) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3), // faces +z
    );
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.scale.x = sx;
    mesh.updateMatrixWorld(true);
    const part = meshPart(mesh);
    for (const side of [1, -1]) {
      const origin = new Vector3(0.25 * sx, 0.25, side);
      const toward = new Vector3(0, 0, -side);
      const expected = new Raycaster(origin, toward).intersectObject(mesh).length > 0;
      expect(hits([part], origin, toward), `from z=${side}`).toBe(expected);
    }
  });
});
