import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PBR_ROLES,
  PBR_SIZE,
  PBR_SURFACE_IDS,
  type PbrRole,
  type PbrSurface,
} from '../../src/render/ground-pbr-pixels';
import { ENCODINGS, type Encoding } from '../assets/encodings';
import { lfText, ROOT, sha256 } from '../assets/provenance';
import { ASSET_SOURCES, type SourceFile } from '../assets/sources';
import { albedoDetail, packNormalRoughnessOcclusion, type Pixels, reduce } from './pbr-pack';
import { decodePng, type PngImage } from './png';

/** The `ASSET_SOURCES` id of each surface's photoscan. */
export const PBR_SOURCE_IDS: Readonly<Record<PbrSurface, string>> = {
  concrete: 'polyhaven-brushed-concrete',
  asphalt: 'polyhaven-asphalt-02',
  pavers: 'polyhaven-concrete-pavers-02',
};

/** Which file of a source is which: the end of its registered path. */
const SOURCE_FILES = {
  diffuse: '_diff_2k.png',
  normal: '_nor_gl_2k.png',
  arm: '_arm_2k.png',
} as const;

type SourceRole = keyof typeof SOURCE_FILES;

/** The photograph files each map is built from. */
const ROLE_SOURCES: Readonly<Record<PbrRole, readonly SourceRole[]>> = {
  albedo: ['diffuse'],
  packed: ['normal', 'arm'],
};

export const PBR_ENCODINGS: Readonly<Record<PbrRole, Encoding>> = {
  albedo: ENCODINGS.srgbEtc1sMips,
  packed: ENCODINGS.linearUastcMips,
};

/** Everything the pixels depend on besides the downloaded files, which enter by their registered hashes. */
export const PBR_BUILD_SOURCES = [
  'tools/textures/pbr-build.ts',
  'tools/textures/pbr-pack.ts',
  'tools/textures/png.ts',
  'src/render/ground-pbr-pixels.ts',
] as const;

export const pbrKey = (surface: PbrSurface, role: PbrRole): string => `${surface}-${role}`;

export const PBR_MAPS: readonly { key: string; surface: PbrSurface; role: PbrRole }[] =
  PBR_SURFACE_IDS.flatMap((surface) =>
    PBR_ROLES.map((role) => ({ key: pbrKey(surface, role), surface, role })),
  );

function sourceFile(surface: PbrSurface, which: SourceRole): SourceFile {
  const id = PBR_SOURCE_IDS[surface];
  const file = ASSET_SOURCES[id]?.files.find((f) => f.path.endsWith(SOURCE_FILES[which]));
  if (file === undefined) throw new Error(`${id} registers no ${which} file`);
  return file;
}

/** Whether every download a map is built from is on disk. */
export const pbrSourcesPresent = (surface: PbrSurface, role: PbrRole, root = ROOT): boolean =>
  ROLE_SOURCES[role].every((which) => existsSync(join(root, sourceFile(surface, which).path)));

/** A source reduced to `PBR_SIZE`; only the diffuse colour is sRGB. */
function readImage(root: string, surface: PbrSurface, which: SourceRole): PngImage {
  const file = sourceFile(surface, which);
  const path = join(root, file.path);
  if (!existsSync(path)) throw new Error(`${file.path} is missing: download ${file.url}`);
  const bytes = new Uint8Array(readFileSync(path));
  if (sha256(bytes) !== file.sha256) {
    throw new Error(`${file.path} is not the registered file (${file.url})`);
  }
  return reduce(decodePng(bytes), PBR_SIZE, which === 'diffuse');
}

export function pbrPixels(surface: PbrSurface, role: PbrRole, root = ROOT): Pixels {
  const pixels =
    role === 'albedo'
      ? albedoDetail(readImage(root, surface, 'diffuse'))
      : packNormalRoughnessOcclusion(
          readImage(root, surface, 'normal'),
          readImage(root, surface, 'arm'),
        );
  if (pixels.width !== PBR_SIZE) {
    throw new Error(`${pbrKey(surface, role)} must be ${PBR_SIZE} texels wide`);
  }
  return pixels;
}

/** Builder sources (LF-normalised), the named encoding and the registered hashes of the downloads. */
export const pbrInputsSha256 = (surface: PbrSurface, role: PbrRole, root = ROOT): string =>
  sha256(
    JSON.stringify([
      ...PBR_BUILD_SOURCES.map((file) => [file, lfText(root, file)]),
      role,
      [PBR_ENCODINGS[role].name, PBR_ENCODINGS[role].options],
      ...ROLE_SOURCES[role].map((which) => sourceFile(surface, which).sha256),
    ]),
  );
