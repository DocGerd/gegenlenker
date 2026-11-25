import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadSources, zipMember } from './download';
import { sha256 } from './provenance';
import type { SourceFile } from './sources';

const enc = new TextEncoder();

/** A zip with one entry per `[name, bytes]`, the second one deflated. */
function zip(entries: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const parts: number[][] = [];
  const central: number[][] = [];
  let offset = 0;
  const u16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number): number[] => [...u16(n & 0xffff), ...u16(n >>> 16)];
  entries.forEach(([name, data], i) => {
    const method = i === 1 ? 8 : 0;
    const body = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
    const nameBytes = [...enc.encode(name)];
    const local = [
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u32(0),
      ...u32(0),
      ...u32(body.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
      ...body,
    ];
    central.push([
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(method),
      ...u32(0),
      ...u32(0),
      ...u32(body.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes,
    ]);
    parts.push(local);
    offset += local.length;
  });
  const directory = central.flat();
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(directory.length),
    ...u32(offset),
    ...u16(0),
  ];
  return new Uint8Array([...parts.flat(), ...directory, ...end]);
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'assets-dl-'));
  dirs.push(dir);
  return dir;
};

describe('zipMember', () => {
  const a = enc.encode('stored member');
  const b = enc.encode('deflated member '.repeat(20));
  const archive = zip([
    ['a.jpg', a],
    ['b.jpg', b],
  ]);

  it('reads a stored and a deflated member', () => {
    expect(zipMember(archive, 'a.jpg')).toEqual(a);
    expect(zipMember(archive, 'b.jpg')).toEqual(b);
  });

  it('names a member the archive lacks', () => {
    expect(() => zipMember(archive, 'c.jpg')).toThrow('c.jpg is not in the archive');
  });
});

describe('downloadSources', () => {
  const good = enc.encode('good bytes');
  const file = (path: string, bytes: Uint8Array, member?: string): SourceFile => ({
    url: `https://example.test/${path}`,
    sha256: sha256(bytes),
    path,
    ...(member === undefined ? {} : { member }),
  });

  it('writes verified files and reads an archive once', async () => {
    const root = tmp();
    const archive = zip([
      ['a.jpg', good],
      ['b.jpg', enc.encode('other')],
    ]);
    const urls: string[] = [];
    const a = { ...file('x/a.jpg', good, 'a.jpg'), url: 'https://example.test/set.zip' };
    const b = { ...file('x/b.jpg', enc.encode('other'), 'b.jpg'), url: a.url };
    await downloadSources([a, b], root, (url) => {
      urls.push(url);
      return Promise.resolve(archive);
    });
    expect(urls).toEqual([a.url]);
    expect(readFileSync(join(root, 'x/a.jpg'))).toEqual(Buffer.from(good));
  });

  it('skips a file already present with the registered hash', async () => {
    const root = tmp();
    const source = file('x/a.bin', good);
    await downloadSources([source], root, () => Promise.resolve(good));
    await downloadSources([source], root, () => Promise.reject(new Error('fetched again')));
  });

  it('names every mismatching file and writes none of them', async () => {
    const root = tmp();
    const bad = file('x/bad.bin', good);
    const fine = file('x/fine.bin', enc.encode('fine'));
    const fetcher = (url: string): Promise<Uint8Array> =>
      Promise.resolve(url === fine.url ? enc.encode('fine') : enc.encode('tampered'));
    const run = downloadSources([bad, fine], root, fetcher);
    await expect(run).rejects.toThrow(/1 source file\(s\) failed:\nx\/bad\.bin: SHA-256 /);
    await expect(run).rejects.toThrow(bad.url);
    expect(existsSync(join(root, 'x/bad.bin'))).toBe(false);
    expect(existsSync(join(root, 'x/fine.bin'))).toBe(true);
  });

  it('names a file whose download fails', async () => {
    const source = file('x/a.bin', good);
    await expect(
      downloadSources([source], tmp(), () => Promise.reject(new Error('HTTP 404'))),
    ).rejects.toThrow('x/a.bin: HTTP 404');
  });
});
