import { BufferGeometry, Color, Float32BufferAttribute } from 'three';
import type { Lamp } from './lamp-layout';

/*
 * The amber pool a side marker throws on the ground beside its vehicle: one merged decal per
 * vehicle, additive, fading to nothing at its rim. Perspective only and drawn at night, so no
 * light is added to the scene.
 */

export const GLOW = {
  /** Half extent along and across the vehicle, metres. */
  radiusX: 1.1,
  radiusY: 0.8,
  /** Metres the pool's centre lies outboard of the lens. */
  outboard: 0.3,
  /** Share of the marker colour at the centre. */
  strength: 0.1,
  segments: 12,
} as const;

/** Share of the centre's strength at each ring, from the centre out; the rim is black. */
const RINGS: readonly (readonly [radius: number, share: number])[] = [
  [0.5, 0.4],
  [1, 0],
];

const AMBER = new Color(0xff9000);

/** Where a marker's pool is centred, in its part's frame (x forward, y left). */
export function glowCentre(lamp: Lamp): { x: number; y: number } {
  const [x0, x1] = lamp.box[0];
  const [y0, y1] = lamp.box[1];
  const outer = lamp.side > 0 ? y1 : y0;
  return { x: (x0 + x1) / 2, y: outer + lamp.side * GLOW.outboard };
}

/**
 * One fan of rings per side marker of `lamps`, at height `lift` in the part's frame; null where
 * the part has none.
 */
export function markerGlowGeometry(lamps: readonly Lamp[], lift: number): BufferGeometry | null {
  const markers = lamps.filter((l) => l.side !== 0 && l.fns.includes('side-marker'));
  if (markers.length === 0) return null;
  const positions: number[] = [];
  const colours: number[] = [];
  const index: number[] = [];
  const centre = AMBER.clone().multiplyScalar(GLOW.strength);
  for (const lamp of markers) {
    const at = glowCentre(lamp);
    const first = positions.length / 3;
    positions.push(at.x, lift, -at.y);
    colours.push(centre.r, centre.g, centre.b);
    for (const [radius, share] of RINGS) {
      for (let i = 0; i < GLOW.segments; i++) {
        const a = (2 * Math.PI * i) / GLOW.segments;
        positions.push(
          at.x + GLOW.radiusX * radius * Math.cos(a),
          lift,
          -(at.y + GLOW.radiusY * radius * Math.sin(a)),
        );
        colours.push(centre.r * share, centre.g * share, centre.b * share);
      }
    }
    const ring = (r: number, i: number): number =>
      first + 1 + r * GLOW.segments + (i % GLOW.segments);
    for (let i = 0; i < GLOW.segments; i++) {
      index.push(first, ring(0, i), ring(0, i + 1));
      for (let r = 0; r + 1 < RINGS.length; r++) {
        index.push(ring(r, i), ring(r + 1, i), ring(r + 1, i + 1));
        index.push(ring(r, i), ring(r + 1, i + 1), ring(r, i + 1));
      }
    }
  }
  return new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('color', new Float32BufferAttribute(colours, 3))
    .setIndex(index);
}
