import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pwaOptions } from './config';

const colors = { themeColor: '#ffffff', backgroundColor: '#ffffff' };
const manifest = pwaOptions('/gegenlenker/', colors).manifest;

/** Width and height from the PNG IHDR chunk. */
function pngSize(file: string): string {
  const bytes = readFileSync(resolve(import.meta.dirname, '../../public', file));
  return `${String(bytes.readUInt32BE(16))}x${String(bytes.readUInt32BE(20))}`;
}

describe('web app manifest', () => {
  it('declares icons that exist at their stated size, including a maskable one', () => {
    const icons = manifest === false ? [] : (manifest?.icons ?? []);
    expect(icons.map((i) => i.purpose)).toEqual(expect.arrayContaining(['any', 'maskable']));
    for (const icon of icons) expect(pngSize(icon.src), icon.src).toBe(icon.sizes);
  });

  it('keeps start_url, scope and id on the base path', () => {
    expect(manifest).toMatchObject({
      scope: '/gegenlenker/',
      start_url: '/gegenlenker/',
      id: '/gegenlenker/',
    });
  });
});
