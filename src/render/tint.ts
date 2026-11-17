import { type BufferGeometry, type Color, Float32BufferAttribute } from 'three';

/** Drops uv and adds a linear vertex colour so one material serves every colour. */
export function tint(geometry: BufferGeometry, color: Color): BufferGeometry {
  geometry.deleteAttribute('uv');
  const n = geometry.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}
