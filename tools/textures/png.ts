import { inflateSync } from 'node:zlib';

export type PngImage = {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  /** Row-major, `channels` per pixel, each sample 0..65535 (8-bit samples are scaled by 257). */
  readonly samples: Uint16Array;
};

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };
const MAX_SIDE = 8192;

/** Paeth predictor of PNG filter type 4. */
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Decodes a non-interlaced greyscale, grey+alpha, RGB or RGBA PNG at 8 or 16 bits. Anything else
 * throws: the registered sources are checked by hash, so this is not a general decoder.
 */
export function decodePng(file: Uint8Array): PngImage {
  if (!SIGNATURE.every((byte, i) => file[i] === byte)) throw new Error('not a PNG');
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let header: { width: number; height: number; depth: number; channels: number } | null = null;
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= file.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + length);
    if (body.length !== length) throw new Error('truncated PNG chunk');
    if (type === 'IHDR') {
      const channels = CHANNELS[body[9] ?? -1];
      const depth = body[8] ?? 0;
      if (channels === undefined || (depth !== 8 && depth !== 16) || body[12] !== 0) {
        throw new Error('unsupported PNG: need non-interlaced grey, RGB or alpha at 8 or 16 bits');
      }
      header = {
        width: new DataView(body.buffer, body.byteOffset).getUint32(0),
        height: new DataView(body.buffer, body.byteOffset).getUint32(4),
        depth,
        channels,
      };
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (header === null) throw new Error('PNG has no IHDR');
  const { width, height, depth, channels } = header;
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
    throw new Error(`PNG size ${width}x${height} is out of range`);
  }
  const bytes = depth / 8;
  const stride = width * channels * bytes;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length !== (stride + 1) * height) throw new Error('PNG data has the wrong length');

  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bytes * channels ? (rows[dst + x - bytes * channels] ?? 0) : 0;
      const up = y > 0 ? (rows[dst + x - stride] ?? 0) : 0;
      const upLeft =
        y > 0 && x >= bytes * channels ? (rows[dst + x - stride - bytes * channels] ?? 0) : 0;
      const value = raw[src + x] ?? 0;
      const predicted =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? (left + up) >> 1
                : filter === 4
                  ? paeth(left, up, upLeft)
                  : -1;
      if (predicted < 0) throw new Error(`PNG filter ${filter} is unknown`);
      rows[dst + x] = (value + predicted) & 0xff;
    }
  }

  const samples = new Uint16Array(width * height * channels);
  for (let i = 0; i < samples.length; i++) {
    samples[i] =
      depth === 8
        ? (rows[i] ?? 0) * 257
        : (((rows[2 * i] ?? 0) << 8) | (rows[2 * i + 1] ?? 0)) & 0xffff;
  }
  return { width, height, channels, samples };
}
