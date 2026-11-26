import type { GraphicsPreset } from '../contracts/render';
import arocsBodyUrl from './assets/arocs-1835-ak-body.glb?url';
import arocsCabUrl from './assets/arocs-1835-ak-cab.glb?url';
import arocsInteriorUrl from './assets/arocs-1835-ak-interior.glb?url';
import asphaltAlbedoUrl from './assets/asphalt-albedo.ktx2?url';
import asphaltPackedUrl from './assets/asphalt-packed.ktx2?url';
import concreteAlbedoUrl from './assets/concrete-albedo.ktx2?url';
import concretePackedUrl from './assets/concrete-packed.ktx2?url';
import groundUrl from './assets/ground.ktx2?url';
import hueffermannUrl from './assets/hueffermann-hpa-24-81-l-trailer.glb?url';
import kroneUrl from './assets/krone-azw-18-trailer.glb?url';
import manBodyUrl from './assets/man-le-18-280-body.glb?url';
import manCabUrl from './assets/man-le-18-280-cab.glb?url';
import manInteriorUrl from './assets/man-le-18-280-interior.glb?url';
import paversAlbedoUrl from './assets/pavers-albedo.ktx2?url';
import paversPackedUrl from './assets/pavers-packed.ktx2?url';
import skyUrl from './assets/sky.ktx2?url';
import atlasAUrl from './assets/yard-kit-atlas-a.ktx2?url';
import atlasBUrl from './assets/yard-kit-atlas-b.ktx2?url';
import leavesUrl from './assets/yard-kit-leaves.ktx2?url';
import kitUrl from './assets/yard-kit.glb?url';
import { ASSET_REGISTRY } from './asset-registry';
import { QUALITY_FLAGS } from './quality';

/*
 * The hashed URL of every binary in `ASSET_REGISTRY`, for the service worker to cache ahead of use
 * (src/pwa/preset-cache.ts). Only `?url` strings: no Three.js code is loaded through this file.
 */

/** Keyed like `ASSET_REGISTRY`; `asset-urls.test.ts` checks both list the same files. */
export const ASSET_URLS: Readonly<Record<string, string>> = {
  'arocs-1835-ak-cab': arocsCabUrl,
  'man-le-18-280-cab': manCabUrl,
  'arocs-1835-ak-body': arocsBodyUrl,
  'man-le-18-280-body': manBodyUrl,
  'hueffermann-hpa-24-81-l-trailer': hueffermannUrl,
  'krone-azw-18-trailer': kroneUrl,
  'arocs-1835-ak-interior': arocsInteriorUrl,
  'man-le-18-280-interior': manInteriorUrl,
  'yard-kit': kitUrl,
  'yard-kit-atlas-a': atlasAUrl,
  'yard-kit-atlas-b': atlasBUrl,
  'yard-kit-leaves': leavesUrl,
  ground: groundUrl,
  sky: skyUrl,
  'concrete-albedo': concreteAlbedoUrl,
  'concrete-packed': concretePackedUrl,
  'asphalt-albedo': asphaltAlbedoUrl,
  'asphalt-packed': asphaltPackedUrl,
  'pavers-albedo': paversAlbedoUrl,
  'pavers-packed': paversPackedUrl,
};

/** Every binary in `ASSET_REGISTRY` that `preset` draws; the Basis transcoder they need is precached. */
export function presetAssetUrls(preset: GraphicsPreset): readonly string[] {
  const flags = QUALITY_FLAGS[preset];
  return Object.entries(ASSET_REGISTRY).flatMap(([stem, { flag }]) => {
    const url = ASSET_URLS[stem];
    return flags[flag] && url !== undefined ? [url] : [];
  });
}
