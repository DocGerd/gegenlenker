import { BufferGeometry, Float32BufferAttribute } from 'three';
import { merge } from './vehicle-geometry';

/*
 * Soft contact shadows as vertex-alpha fans on the ground plane: no textures, lights or extra passes.
 * Footprints are in the owning body frame (x forward, y left); a mesh using them goes on SKY_LAYER.
 */

const RINGS = [
  { radius: 0.55, alpha: 0.65 },
  { radius: 1, alpha: 0 },
] as const;
const SEGMENTS = 24;

export type Blob = {
  readonly x: number;
  readonly y: number;
  /** Half-extents along and across the body. */
  readonly rx: number;
  readonly ry: number;
  /** Centre opacity. */
  readonly alpha: number;
  /** Shape exponent: 2 is an ellipse, larger approaches a rectangle. */
  readonly squareness: number;
};

const signedPower = (v: number, e: number): number => Math.sign(v) * Math.abs(v) ** e;

function blobGeometry({ x, y, rx, ry, alpha, squareness }: Blob, height: number): BufferGeometry {
  const positions: number[] = [x, height, -y];
  const colors: number[] = [0, 0, 0, alpha];
  const indices: number[] = [];
  const exponent = 2 / squareness;
  for (const ring of RINGS) {
    for (let i = 0; i < SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      const px = x + signedPower(Math.cos(angle), exponent) * rx * ring.radius;
      const py = y + signedPower(Math.sin(angle), exponent) * ry * ring.radius;
      positions.push(px, height, -py);
      colors.push(0, 0, 0, alpha * ring.alpha);
    }
  }
  const at = (ring: number, i: number): number => 1 + ring * SEGMENTS + (i % SEGMENTS);
  for (let i = 0; i < SEGMENTS; i++) {
    indices.push(0, at(0, i + 1), at(0, i));
    for (let r = 0; r < RINGS.length - 1; r++) {
      indices.push(at(r, i), at(r, i + 1), at(r + 1, i));
      indices.push(at(r, i + 1), at(r + 1, i + 1), at(r + 1, i));
    }
  }
  return new BufferGeometry()
    .setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('color', new Float32BufferAttribute(colors, 4))
    .setIndex(indices);
}

/** One geometry for all `blobs`, lying `height` above the owning frame's origin plane. */
export function blobShadow(blobs: readonly Blob[], height: number): BufferGeometry {
  return merge(blobs.map((b) => blobGeometry(b, height)));
}
