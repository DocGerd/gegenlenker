import { join } from 'node:path';
import type { AboutCredits, ThirdParty } from '../src/app/about-credits-types';
import { lfText } from './assets/provenance';
import { ASSET_SOURCES } from './assets/sources';

export type LicenceEntry = Omit<ThirdParty, 'text' | 'bundled'> & {
  /** The package file the licence is copied from, relative to the repository root. */
  readonly upstream?: string;
  readonly bundled?: readonly string[];
  /** Files or directories under `node_modules/three/examples/jsm/libs/` that this licence covers. */
  readonly libs?: readonly string[];
};

/** Every licence file in `public/licenses/`, with the runtime dependencies it covers. */
export const THIRD_PARTY: readonly LicenceEntry[] = [
  {
    name: 'three.js',
    spdx: 'MIT',
    file: 'three-MIT.txt',
    covers: ['three'],
    upstream: 'node_modules/three/LICENSE',
  },
  {
    name: 'Workbox',
    spdx: 'MIT',
    file: 'workbox-window-MIT.txt',
    covers: ['workbox-window'],
    bundled: ['workbox-core'],
    upstream: 'node_modules/workbox-window/LICENSE',
  },
  {
    name: 'Geist',
    spdx: 'OFL-1.1',
    file: 'geist-OFL.txt',
    covers: ['@fontsource/geist', '@fontsource/geist-mono'],
  },
  {
    name: 'Basis Universal',
    spdx: 'Apache-2.0',
    file: 'basis-universal-Apache-2.0.txt',
    covers: [],
    libs: ['basis'],
  },
  {
    name: 'meshoptimizer',
    spdx: 'MIT',
    file: 'meshoptimizer-MIT.txt',
    covers: [],
    libs: ['meshopt_decoder.module.js'],
    upstream: 'node_modules/meshoptimizer/LICENSE.md',
  },
  {
    name: 'ktx-parse',
    spdx: 'MIT',
    file: 'ktx-parse-MIT.txt',
    covers: [],
    libs: ['ktx-parse.module.js'],
    upstream: 'node_modules/ktx-parse/LICENSE',
  },
  {
    name: 'zstddec',
    spdx: 'MIT',
    file: 'zstddec-MIT.txt',
    covers: [],
    libs: ['zstddec.module.js'],
  },
  {
    name: 'Zstandard (in zstddec)',
    spdx: 'BSD-3-Clause',
    file: 'zstd-BSD-3-Clause.txt',
    covers: [],
  },
];

export function aboutCredits(root: string): AboutCredits {
  return {
    app: { name: 'Gegenlenker', spdx: 'Apache-2.0', text: lfText(root, 'LICENSE') },
    thirdParty: THIRD_PARTY.map(({ name, spdx, file, covers, bundled = [] }) => ({
      name,
      spdx,
      file,
      covers,
      bundled,
      text: lfText(root, join('public/licenses', file)),
    })),
    assets: Object.values(ASSET_SOURCES).map(({ title, licence, authors, page }) => ({
      title,
      licence,
      authors,
      page,
    })),
  };
}
