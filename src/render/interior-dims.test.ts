import { MathUtils } from 'three';
import { describe, expect, it } from 'vitest';
import { truckAnchors } from '../vehicles/anchors';
import { trucks } from '../vehicles/registry';
import { cabShellParams, CAB_HEIGHT, FRAME_TOP } from './cab-dims';
import { COCKPIT_FOV, COCKPIT_PITCH } from './cockpit-camera';
import { CLEAR_CONE_DEG } from './cockpit-interior';
import {
  CLEAR_CONE_HALF_DEG,
  DOOR_THICKNESS,
  interiorShellParams,
  type Solid,
  type Vec3,
  VIEW_FOV_DEG,
  VIEW_PITCH_DEG,
  viewCoords,
} from './interior-dims';

describe('the camera and cone copies', () => {
  it('equal the cockpit camera and the flat overlay', () => {
    expect(VIEW_FOV_DEG).toBe(COCKPIT_FOV);
    expect(VIEW_PITCH_DEG).toBeCloseTo(-MathUtils.radToDeg(COCKPIT_PITCH), 9);
    expect(CLEAR_CONE_HALF_DEG).toBe(CLEAR_CONE_DEG);
  });
});

const vertices = (solids: readonly Solid[]): Vec3[] => solids.flatMap((s) => [...s.verts]);

describe.each(trucks)('interior of $id', (spec) => {
  const { eye, frontX } = truckAnchors(spec);
  const eyePoint: Vec3 = [eye.x, eye.y, eye.z];
  const cab = cabShellParams(spec);
  const params = interiorShellParams(spec);
  const tanCone = Math.tan(MathUtils.degToRad(CLEAR_CONE_HALF_DEG));

  it('keeps the dash, door tops and wheel out of the forward sight cone', () => {
    for (const name of ['interior', 'wheel'] as const) {
      for (const v of vertices(params.meshes[name])) {
        const { across, up, depth } = viewCoords(eyePoint, v);
        if (depth <= 0 || Math.abs(across / depth) > tanCone) continue;
        expect(up / depth, `${name} ${v.join()}`).toBeLessThan(-tanCone);
      }
    }
  });

  it('keeps the dash top at or under the glass sill and every part in the cab', () => {
    const sill = FRAME_TOP + cab.cab.glassSill;
    const halfWidth = cab.width / 2;
    const rear = frontX - cab.cabLength;
    for (const name of ['interior', 'wheel'] as const) {
      for (const [x, y, z] of vertices(params.meshes[name])) {
        expect(x, name).toBeGreaterThanOrEqual(rear);
        expect(x, name).toBeLessThanOrEqual(frontX);
        expect(Math.abs(y), name).toBeLessThanOrEqual(halfWidth);
        expect(z, name).toBeGreaterThanOrEqual(FRAME_TOP);
        expect(z, name).toBeLessThanOrEqual(CAB_HEIGHT);
      }
    }
    const [top] = params.meshes.interior;
    const glassFace = Math.max(...(top?.verts.map((v) => v[0]) ?? []));
    for (const v of top?.verts ?? []) {
      if (v[0] === glassFace) expect(v[2]).toBeLessThanOrEqual(sill + 1e-6);
    }
  });

  it('seats the wheel at the eye, ahead of it', () => {
    const rim = vertices(params.meshes.wheel);
    const lateral = rim.map(([, y]) => y);
    expect((Math.max(...lateral) + Math.min(...lateral)) / 2).toBeCloseTo(eye.y, 2);
    expect(Math.min(...rim.map(([x]) => x))).toBeGreaterThan(eye.x);
  });

  it('puts the door tops against the cab sides', () => {
    const half = cab.width / 2;
    const ys = vertices(params.meshes.interior).map(([, y]) => Math.abs(y));
    expect(Math.max(...ys)).toBeCloseTo(half, 6);
    expect(ys.some((y) => Math.abs(y - (half - DOOR_THICKNESS)) < 1e-6)).toBe(true);
  });
});
