import { describe, expect, it } from 'vitest';
import { GRAPHICS_PRESETS } from '../contracts/render';
import { ASSET_REGISTRY } from './asset-registry';
import { ASSET_URLS, presetAssetUrls, TRANSCODER_URLS } from './asset-urls';
import { QUALITY_FLAGS } from './quality';

describe('ASSET_URLS', () => {
  it('lists the files of ASSET_REGISTRY, each under its own hashed name', () => {
    expect(Object.keys(ASSET_URLS).sort()).toEqual(Object.keys(ASSET_REGISTRY).sort());
    for (const [stem, { kind }] of Object.entries(ASSET_REGISTRY)) {
      expect(ASSET_URLS[stem], stem).toContain(stem);
      expect(ASSET_URLS[stem], stem).toMatch(new RegExp(`\\.${kind}$`));
    }
  });
});

describe('presetAssetUrls', () => {
  it.each(GRAPHICS_PRESETS)('names exactly what %s draws', (preset) => {
    const drawn = Object.entries(ASSET_REGISTRY)
      .filter(([, { flag }]) => QUALITY_FLAGS[preset][flag])
      .map(([stem]) => ASSET_URLS[stem]);
    const urls = presetAssetUrls(preset);
    expect(urls).toEqual(expect.arrayContaining(drawn));
    const textured = Object.values(ASSET_REGISTRY).some(
      ({ kind, flag }) => kind === 'ktx2' && QUALITY_FLAGS[preset][flag],
    );
    expect(urls.length).toBe(drawn.length + (textured ? 2 : 0));
    expect(urls.includes(TRANSCODER_URLS.wasm)).toBe(textured);
  });

  it('gives High more than Low', () => {
    expect(presetAssetUrls('high').length).toBeGreaterThan(presetAssetUrls('low').length);
  });
});
