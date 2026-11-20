import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalJson,
  ROOT,
  type Run,
  runHashes,
  sha256,
  YARD_KIT_RUN,
} from './glb-build';
import { yardKitParams } from './kit-params';

/**
 * KTX2 encodings of the baked kit atlases (ktx2-encoder options). Albedo and masks tolerate ETC1S;
 * normals need UASTC; RDO 3 keeps the packed maps inside the download budget.
 */
export const KTX2_ENCODINGS = {
  albedo: {
    isUASTC: false,
    qualityLevel: 160,
    compressionLevel: 2,
    needSupercompression: false,
    isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true,
    generateMipmap: true,
    isKTX2File: true,
  },
  packed: {
    isUASTC: true,
    uastcLDRQualityLevel: 3,
    needSupercompression: true,
    enableRDO: true,
    rdoQualityLevel: 3,
    isNormalMap: true,
    isPerceptual: false,
    isSetKTX2SRGBTransferFunc: false,
    generateMipmap: true,
    isKTX2File: true,
  },
  cards: {
    isUASTC: true,
    uastcLDRQualityLevel: 3,
    needSupercompression: true,
    enableRDO: true,
    rdoQualityLevel: 3,
    isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true,
    generateMipmap: true,
    isKTX2File: true,
  },
  mask: {
    isUASTC: false,
    qualityLevel: 160,
    compressionLevel: 2,
    needSupercompression: false,
    isPerceptual: false,
    isSetKTX2SRGBTransferFunc: false,
    generateMipmap: true,
    isKTX2File: true,
  },
} as const;

export type Encoding = keyof typeof KTX2_ENCODINGS;

export type KitTexture = {
  /** Names the raw bake output (`<key>.rgba` + `<key>.json`), the ktx2 and its manifest. */
  readonly key: string;
  readonly run: Run;
  readonly encoding: Encoding;
  readonly size: number;
  readonly ktx2: string;
  readonly manifest: string;
};

const texture = (run: Run, key: string, encoding: Encoding, size: number): KitTexture => ({
  key,
  run,
  encoding,
  size,
  ktx2: `src/render/assets/${key}.ktx2`,
  manifest: `src/render/assets/${key}.manifest.json`,
});

const yard = yardKitParams();

export const KIT_TEXTURES: readonly KitTexture[] = [
  texture(YARD_KIT_RUN, 'yard-kit-atlas-a', 'albedo', yard.atlas.size),
  texture(YARD_KIT_RUN, 'yard-kit-atlas-b', 'packed', yard.atlas.size),
  texture(YARD_KIT_RUN, 'yard-kit-leaves', 'cards', yard.leafAtlas.size),
];

/** Download budget per bake in bytes (the visual design's asset list). */
export const KIT_BUDGETS: Readonly<Record<string, number>> = {
  'yard-kit': 2_700_000,
};

export const KV_INPUTS = 'gegenlenker.inputsSha256';

/** What the ktx2 depends on and CI can recompute: the bake's scripts and params, and the encoding. */
export const textureInputsSha256 = (t: KitTexture, root = ROOT): string =>
  sha256(
    canonicalJson({
      key: t.key,
      encoding: KTX2_ENCODINGS[t.encoding],
      run: runHashes(t.run, root),
    }),
  );

export type TextureManifest = {
  readonly scriptSha256: string;
  readonly commonSha256: string;
  readonly kitCommonSha256: string;
  readonly paramsSha256: string;
  readonly pixelsSha256: string;
  readonly blenderVersion: string;
  readonly encoderVersion: string;
  readonly inputsSha256: string;
  readonly width: number;
  readonly height: number;
  readonly mipLevels: number;
  readonly ktx2Sha256: string;
  readonly ktx2Bytes: number;
};

export const ktx2Sha256 = (t: KitTexture, root = ROOT): string =>
  sha256(readFileSync(join(root, t.ktx2)));

export function encoderVersion(root = ROOT): string {
  const file = join(root, 'node_modules/ktx2-encoder/package.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}
