import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BufferGeometry,
  Float32BufferAttribute,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import { truckAnchors } from '../vehicles/anchors';
import { trucks } from '../vehicles/registry';
import { CAB_HEIGHT, cabShellParams, FRAME_TOP } from './cab-dims';
import { COCKPIT_FOV, COCKPIT_PITCH } from './cockpit-camera';
import { parseMeshes } from './glb-shells';
import { interiorShellFrom } from './interior-glb';
import {
  B_PILLAR,
  DOOR_THICKNESS,
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

const solidsMesh = (solids: readonly Solid[]): Mesh => {
  const position: number[] = [];
  for (const { verts, faces } of solids) {
    for (const face of faces) {
      for (let i = 1; i < face.length - 1; i++) {
        for (const k of [0, i, i + 1]) {
          const [x, y, z] = verts[face[k] as number] as Vec3;
          position.push(x, z, -y); // body frame to three space, which keeps the winding
        }
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  return new Mesh(geometry, new MeshBasicMaterial());
};

const probe = new Raycaster();
const nearest = (meshes: readonly Mesh[], origin: Vector3, direction: Vector3): number | null => {
  probe.set(origin, direction);
  return probe.intersectObjects(meshes as Mesh[], false)[0]?.distance ?? null;
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
      if (x > eye.x && x <= frontX && z >= FRAME_TOP) return true;
    }
    return false;
  };

  const shell = async () => {
    const bytes = readFileSync(join(import.meta.dirname, `assets/${spec.id}-interior.glb`));
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const protos = Object.values(interiorShellFrom(await parseMeshes(data)));
    return protos.map((proto) => {
      const mesh = new Mesh(proto.geometry, new MeshBasicMaterial({ vertexColors: true }));
      proto.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrixWorld(true);
      return mesh;
    });
  };

  it(`hits an interior part on every ray within ${LOOK_YAW} degrees of yaw and ${LOOK_PITCH} of pitch, except through the open window and the front`, async () => {
    const meshes = await shell();
    let checked = 0;
    let glass = 0;
    for (let yaw = -LOOK_YAW; yaw <= LOOK_YAW; yaw += 5) {
      for (const elevation of AXIS_ELEVATIONS) {
        for (const ndc of grid(24)) {
          const d = direction(ndc, yaw, elevation, widest);
          checked++;
          if (nearest(meshes, origin, toThree(d)) !== null) continue;
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
      solidsMesh(params.meshes[n].slice(0, params.meshes[n].length - added[n].length)),
    );
    const all = names.map((n) => solidsMesh(params.meshes[n]));
    for (const [w, h] of WINDOWS) {
      const { cockpit } = computeViewports(w, h, 'drive', null);
      const aspect = (cockpit?.width ?? 1) / (cockpit?.height ?? 1);
      for (const ndc of grid(40)) {
        const d = toThree(direction(ndc, 0, -BASE_PITCH, aspect));
        expect(nearest(all, origin, d), `${w}x${h} ndc ${ndc.join(', ')}`).toBe(
          nearest(base, origin, d),
        );
      }
    }
  });
});
