import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PBR_ALBEDO_MEAN, PBR_PACKED } from '../../src/render/ground-pbr-pixels';
import { albedoDetail, linearMeans, packNormalRoughnessOcclusion, unpackTexel } from './pbr-pack';
import { decodePng, type PngImage } from './png';

const image = (width: number, channels: number, values: number[]): PngImage => ({
  width,
  height: width,
  channels,
  samples: Uint16Array.from(values),
});

/** 16-bit sample of a 0..1 value. */
const s16 = (v: number): number => Math.round(v * 65535);

describe('packed normal, roughness and occlusion map', () => {
  it('puts normal XY, roughness (arm green) and occlusion (arm red) in their channels', () => {
    // 2 x 2: texel 0 distinct per channel, texel 1 is the row-major neighbour, texel 2 starts row 1
    const normal = image(2, 3, [
      ...[0.1, 0.2, 0.9].map(s16),
      ...[0.3, 0.4, 0.8].map(s16),
      ...[0.5, 0.6, 0.7].map(s16),
      ...[0.7, 0.8, 0.6].map(s16),
    ]);
    const arm = image(2, 3, [
      ...[0.25, 0.75, 0].map(s16),
      ...[0.35, 0.65, 0].map(s16),
      ...[0.45, 0.55, 0].map(s16),
      ...[0.55, 0.45, 0].map(s16),
    ]);
    const { rgba } = packNormalRoughnessOcclusion(normal, arm);
    const texel = (i: number): number[] => [...rgba.subarray(i * 4, i * 4 + 4)];
    const b = (v: number): number => Math.round(v * 255);
    expect(texel(0)).toEqual([b(0.1), b(0.2), b(0.75), b(0.25)]);
    expect([
      PBR_PACKED.normalX,
      PBR_PACKED.normalY,
      PBR_PACKED.roughness,
      PBR_PACKED.occlusion,
    ]).toEqual([0, 1, 2, 3]);
    // rows keep their order: image row 0 stays first, so green points up the image as in the source
    expect(texel(2)).toEqual([b(0.5), b(0.6), b(0.55), b(0.45)]);
  });

  it('round-trips a unit normal through the packing and the Z rebuild', () => {
    const wanted = [0.6, -0.48, Math.sqrt(1 - 0.6 ** 2 - 0.48 ** 2)] as const;
    const encode = (v: number): number => s16((v + 1) / 2);
    const normal = image(1, 3, [encode(wanted[0]), encode(wanted[1]), encode(wanted[2])]);
    const arm = image(1, 3, [s16(0.5), s16(0.5), 0]);
    const { rgba } = packNormalRoughnessOcclusion(normal, arm);
    const { normal: back, roughness, occlusion } = unpackTexel(rgba, 0);
    // one 8-bit step is 2/255 of the range
    for (const [i, v] of wanted.entries()) expect(back[i]).toBeCloseTo(v, 1);
    expect(Math.hypot(...back)).toBeCloseTo(1, 1);
    expect(back[0]).toBeCloseTo(wanted[0], 2);
    expect(back[1]).toBeCloseTo(wanted[1], 2);
    expect(roughness).toBeCloseTo(0.5, 2);
    expect(occlusion).toBeCloseTo(0.5, 2);
  });

  it('rebuilds a non-negative Z from a texel whose XY quantised outside the unit disc', () => {
    const rgba = new Uint8Array([255, 255, 128, 128]);
    expect(unpackTexel(rgba, 0).normal[2]).toBe(0);
  });
});

describe('albedo detail map', () => {
  it('has the registered linear mean in every channel, whatever the colour cast of the photograph', () => {
    const size = 8;
    const values: number[] = [];
    for (let i = 0; i < size * size; i++) {
      const wobble = 0.35 + (0.3 * ((i * 7) % 11)) / 10;
      values.push(s16(wobble), s16(wobble * 0.6), s16(wobble * 0.3));
    }
    const { rgba } = albedoDetail(image(size, 3, values));
    for (const mean of linearMeans(rgba)) expect(mean).toBeCloseTo(PBR_ALBEDO_MEAN, 2);
  });

  it('keeps the variation: a brighter texel stays brighter', () => {
    const values = [s16(0.2), s16(0.2), s16(0.2), s16(0.6), s16(0.6), s16(0.6)];
    const { rgba } = albedoDetail(image(1, 3, [...values.slice(0, 3)]));
    expect(rgba[3]).toBe(255);
    const two = albedoDetail(image(2, 3, [...values, ...values]));
    expect(two.rgba[0]).toBeLessThan(two.rgba[4] ?? 0);
  });
});

/** The PNG filters, applied the way an encoder does. */
function filterRow(type: number, row: number[], previous: number[], bpp: number): number[] {
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  return row.map((value, x) => {
    const left = x >= bpp ? (row[x - bpp] ?? 0) : 0;
    const up = previous[x] ?? 0;
    const upLeft = x >= bpp ? (previous[x - bpp] ?? 0) : 0;
    const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][type] ?? 0;
    return (value - predicted) & 0xff;
  });
}

function encodePng(width: number, depth: 8 | 16, channels: 1 | 3, rows: number[][]): Uint8Array {
  const bpp = (depth / 8) * channels;
  let raw: number[] = [];
  rows.forEach((row, y) => {
    const type = y % 5;
    raw = [...raw, type, ...filterRow(type, row, rows[y - 1] ?? [], bpp)];
  });
  const chunk = (name: string, body: Uint8Array): number[] => {
    const length = body.length;
    return [
      length >>> 24,
      (length >>> 16) & 255,
      (length >>> 8) & 255,
      length & 255,
      ...Buffer.from(name, 'latin1'),
      ...body,
      0,
      0,
      0,
      0,
    ];
  };
  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, rows.length);
  header[8] = depth;
  header[9] = channels === 3 ? 2 : 0;
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', header),
    ...chunk('IDAT', deflateSync(Uint8Array.from(raw))),
    ...chunk('IEND', new Uint8Array()),
  ]);
}

describe('png decoder', () => {
  it('undoes every filter type at 8 bits, scaling samples to 16', () => {
    const rows = Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 12 }, (_, x) => (x * 37 + y * 91 + x * y) & 255),
    );
    const { samples, width, height, channels } = decodePng(encodePng(4, 8, 3, rows));
    expect([width, height, channels]).toEqual([4, 5, 3]);
    expect([...samples]).toEqual(rows.flat().map((v) => v * 257));
  });

  it('reads 16-bit samples big-endian', () => {
    const rows = [
      [0x12, 0x34, 0xab, 0xcd],
      [0xff, 0xff, 0x00, 0x01],
    ];
    expect([...decodePng(encodePng(2, 16, 1, rows)).samples]).toEqual([
      0x1234, 0xabcd, 0xffff, 0x0001,
    ]);
  });

  it('refuses what it does not decode', () => {
    expect(() => decodePng(new Uint8Array(16))).toThrow(/not a PNG/);
    const interlaced = encodePng(1, 8, 1, [[0]]);
    interlaced[28] = 1;
    expect(() => decodePng(interlaced)).toThrow(/unsupported/);
  });
});
