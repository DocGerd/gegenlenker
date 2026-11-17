import { BoxGeometry, type BufferGeometry, CylinderGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WHEEL_SEGMENTS = 20;

/** Body-frame extents (x forward, y left, z up) as a Three-space box. */
export function box(
  [x0, x1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  [z0, z1]: readonly [number, number],
): BufferGeometry {
  return new BoxGeometry(x1 - x0, z1 - z0, y1 - y0).translate(
    (x0 + x1) / 2,
    (z0 + z1) / 2,
    -(y0 + y1) / 2,
  );
}

/** Axis along body y, built at the origin. */
export function wheelGeometry(radius: number, width: number): BufferGeometry {
  return new CylinderGeometry(radius, radius, width, WHEEL_SEGMENTS).rotateX(Math.PI / 2);
}

export function merge(parts: BufferGeometry[]): BufferGeometry {
  // The typings omit the null returned for mismatched attributes.
  const merged = mergeGeometries(parts) as BufferGeometry | null;
  if (merged === null) throw new Error('Vehicle parts have mismatched attributes');
  parts.forEach((p) => p.dispose());
  return merged;
}
