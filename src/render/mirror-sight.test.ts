import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { Pose2 } from '../contracts/sim';
import type { Vec3 } from '../contracts/vehicle';
import { pointSight, sightGeometry } from '../einweiser/sight';
import { createSimulation } from '../sim/simulation';
import { CLASS_II_GLASS_ASPECT, mirrorMounts } from '../vehicles/mirrors';
import { trailers, trucks } from '../vehicles/registry';
import { createMirror, MIRRORS, mirrorFacing, mirrorYaw } from './mirror';

const SAMPLES = 20_000;
const MIN_FRAMED = 500;
/** NDC margin around the frustum edge, where rounding may disagree. */
const EDGE = 1e-6;
const POSE: Pose2 = { x: 3, y: -2, heading: 0.7 };

/** Deterministic samples in [0, 1). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// The core sight check reads the mirror cameras' optics; this pins it to what the cameras frame.
describe.each(trucks)('core mirror framing against the mirror cameras of $id', (truck) => {
  const trailer = trailers[0];
  if (trailer === undefined) throw new Error('no trailer');
  const geometry = sightGeometry(truck, trailer);
  const flat = { ...geometry, heights: { truck: 0, drawbar: 0, trailer: 0 } };
  const s = createSimulation(geometry.params, { truck: POSE }, () => null).snapshot();
  const mounts = mirrorMounts(truck);

  it.each(MIRRORS.map((spec) => [spec.anchor, spec] as const))('%s', (_, spec) => {
    const mirror = createMirror(spec);
    const position = new Vector3();
    const facing = mirrorFacing(POSE, mounts[spec.anchor], mirrorYaw(spec, truck.id), position);
    mirror.place(position, facing);
    const { camera } = mirror;
    camera.aspect = spec.aspect ?? CLASS_II_GLASS_ASPECT;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const ahead = camera.getWorldDirection(new Vector3());
    const next = lcg(7);
    const ndc = new Vector3();
    let framed = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const spread = new Vector3(next() - 0.5, next() - 0.5, next() - 0.5).multiplyScalar(3);
      const at = ahead
        .clone()
        .add(spread)
        .normalize()
        .multiplyScalar(0.5 + 29.5 * next() ** 2)
        .add(position);
      if (at.y <= 0) continue;
      ndc.copy(at).project(camera);
      const edge = Math.max(Math.abs(ndc.x), Math.abs(ndc.y));
      if (Math.abs(edge - 1) < EDGE) continue;
      const seen = ndc.z > -1 && ndc.z < 1 && edge < 1;
      const p: Vec3 = { x: at.x, y: -at.z, z: at.y };
      const core = pointSight(flat, s, p, []).mirrors.includes(spec.anchor);
      expect(core, `${spec.anchor} at ${p.x}, ${p.y}, ${p.z}`).toBe(seen);
      if (seen) framed++;
    }
    expect(framed).toBeGreaterThan(MIN_FRAMED);
    mirror.dispose();
  });
});
