import { PBR_ALBEDO_MEAN, PBR_PACKED } from '../../src/render/ground-pbr-pixels';
import type { PngImage } from './png';

export type Pixels = { readonly width: number; readonly height: number; readonly rgba: Uint8Array };

const srgbToLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (v: number): number =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

const to8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** The edge of a square image with at least three channels. */
function squareSize(image: PngImage, what: string): number {
  if (image.width !== image.height || image.channels < 3) {
    throw new Error(`${what} must be square with at least three channels`);
  }
  return image.width;
}

/**
 * `image` box-filtered down to `edge` texels, on its 16-bit samples before anything is quantised.
 * `srgb` colour is averaged in linear light, data (normal, roughness, occlusion) as it is. A texel
 * of the result is what the mip level of that size would hold.
 */
export function reduce(image: PngImage, edge: number, srgb: boolean): PngImage {
  const factor = image.width / edge;
  if (image.width !== image.height || !Number.isInteger(factor) || factor < 1) {
    throw new Error(
      `a ${String(image.width)} x ${String(image.height)} image cannot reduce to ${String(edge)} texels`,
    );
  }
  if (factor === 1) return image;
  const { channels, samples, width } = image;
  const samples16 = new Uint16Array(edge * edge * channels);
  const taps = factor * factor;
  for (let y = 0; y < edge; y++) {
    for (let x = 0; x < edge; x++) {
      for (let c = 0; c < channels; c++) {
        const colour = srgb && c < 3;
        let sum = 0;
        for (let dy = 0; dy < factor; dy++) {
          for (let dx = 0; dx < factor; dx++) {
            const v =
              (samples[((y * factor + dy) * width + x * factor + dx) * channels + c] ?? 0) / 65535;
            sum += colour ? srgbToLinear(v) : v;
          }
        }
        const mean = sum / taps;
        samples16[(y * edge + x) * channels + c] = Math.round(
          Math.min(1, Math.max(0, colour ? linearToSrgb(mean) : mean)) * 65535,
        );
      }
    }
  }
  return { width: edge, height: edge, channels, samples: samples16 };
}

/**
 * The colour of a photograph as detail: each channel is divided by its own mean, so the map is
 * neutral on average and only its variation survives, then scaled to `PBR_ALBEDO_MEAN`. sRGB out.
 */
export function albedoDetail(diffuse: PngImage): Pixels {
  const size = squareSize(diffuse, 'the diffuse map');
  const count = size * size;
  const { samples, channels } = diffuse;
  const linear = (i: number, c: number): number =>
    srgbToLinear((samples[i * channels + c] ?? 0) / 65535);
  const sums = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) sums[c] = (sums[c] ?? 0) + linear(i, c);
  }
  const rgba = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      const scaled = (linear(i, c) / ((sums[c] ?? 1) / count)) * PBR_ALBEDO_MEAN;
      rgba[i * 4 + c] = to8(linearToSrgb(Math.min(1, scaled)));
    }
    rgba[i * 4 + 3] = 255;
  }
  return { width: size, height: size, rgba };
}

/**
 * Normal XY from an OpenGL tangent-space map (green up in the image, row 0 at the top), roughness
 * from the green and occlusion from the red channel of an AO / roughness / metalness map.
 */
export function packNormalRoughnessOcclusion(normal: PngImage, arm: PngImage): Pixels {
  const size = squareSize(normal, 'the normal map');
  if (squareSize(arm, 'the AO / roughness / metalness map') !== size) {
    throw new Error('the normal and AO / roughness / metalness maps differ in size');
  }
  const count = size * size;
  const rgba = new Uint8Array(count * 4);
  const byte = (sample: number | undefined): number => Math.round((sample ?? 0) / 257);
  for (let i = 0; i < count; i++) {
    const n = i * normal.channels;
    const a = i * arm.channels;
    rgba[i * 4 + PBR_PACKED.normalX] = byte(normal.samples[n]);
    rgba[i * 4 + PBR_PACKED.normalY] = byte(normal.samples[n + 1]);
    rgba[i * 4 + PBR_PACKED.roughness] = byte(arm.samples[a + 1]);
    rgba[i * 4 + PBR_PACKED.occlusion] = byte(arm.samples[a]);
  }
  return { width: size, height: size, rgba };
}

/** What the shader reads back from one texel of a packed map; Z is rebuilt from XY. */
export function unpackTexel(
  rgba: ArrayLike<number>,
  texel: number,
): { normal: readonly [number, number, number]; roughness: number; occlusion: number } {
  const at = (channel: number): number => (rgba[texel * 4 + channel] ?? 0) / 255;
  const x = at(PBR_PACKED.normalX) * 2 - 1;
  const y = at(PBR_PACKED.normalY) * 2 - 1;
  return {
    normal: [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))],
    roughness: at(PBR_PACKED.roughness),
    occlusion: at(PBR_PACKED.occlusion),
  };
}

/** Mean linear value of each RGB channel of an sRGB map. */
export function linearMeans(rgba: ArrayLike<number>): [number, number, number] {
  const sums = [0, 0, 0];
  const count = rgba.length / 4;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      sums[c] = (sums[c] ?? 0) + srgbToLinear((rgba[i * 4 + c] ?? 0) / 255);
    }
  }
  return [(sums[0] ?? 0) / count, (sums[1] ?? 0) / count, (sums[2] ?? 0) / count];
}
