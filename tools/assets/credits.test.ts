import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKY_HDR } from '../textures/sky-build';
import { ROOT } from './provenance';
import { ASSET_SOURCES, creditsSection, type AssetSource } from './sources';
import { TEXTURE_ASSETS } from './textures';

const START = '<!-- credits:start -->';
const END = '<!-- credits:end -->';

describe('asset credits', () => {
  it('is the generated section of docs/asset-credits.md (run `pnpm credits` when red)', () => {
    const doc = readFileSync(join(ROOT, 'docs/asset-credits.md'), 'utf8');
    const section = doc.slice(doc.indexOf(START) + START.length, doc.indexOf(END));
    expect(section).toBe(creditsSection(ASSET_SOURCES));
  });

  it('only lists CC0 sources, because no attribution page exists', () => {
    for (const source of Object.values(ASSET_SOURCES)) expect(source.licence).toBe('CC0-1.0');
  });

  it('refuses to generate a source that needs attribution', () => {
    const sky = ASSET_SOURCES['kloofendal-sky'];
    if (sky === undefined) throw new Error('no sky source is registered');
    const attributed: AssetSource = { ...sky, licence: 'CC-BY-4.0' };
    expect(() => creditsSection({ attributed })).toThrow(/not CC0/);
  });

  it('is referenced by the texture registry, and only that', () => {
    const used = Object.values(TEXTURE_ASSETS).flatMap((asset) => asset.sources);
    for (const id of used) expect(ASSET_SOURCES).toHaveProperty([id]);
    expect([...new Set(used)].sort()).toEqual(Object.keys(ASSET_SOURCES).sort());
  });

  it('records the sky HDRI hash the build checks', () => {
    const [file] = ASSET_SOURCES['kloofendal-sky']?.files ?? [];
    expect(file).toMatchObject({
      url: SKY_HDR.url,
      sha256: SKY_HDR.sha256,
      path: SKY_HDR.path,
    });
  });
});
