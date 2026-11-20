import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, sha256 } from '../assets/provenance';
import type { TextureAsset, TexturePixels } from '../assets/textures';
import { type Run, runHashes, YARD_KIT_RUN } from './glb-build';
import { yardKitParams } from './kit-params';

/**
 * KTX2 encodings of the baked kit atlases (ktx2-encoder options). Albedo tolerates ETC1S; normals
 * need UASTC; RDO 3 keeps the packed maps inside the download budget.
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
} as const;

export type Encoding = keyof typeof KTX2_ENCODINGS;

/** Where a bake writes its raw atlases (`<key>.rgba` and `<key>.json`); not committed. */
export const KIT_BAKE_DIR = 'tools/blender/bake';

type BakeRecord = Readonly<Record<string, unknown>>;

/** The raw atlas a bake wrote, once it is known to come from the current scripts and params. */
export function bakedPixels(run: Run, key: string, size: number, root: string): TexturePixels {
  const rgbaFile = join(root, KIT_BAKE_DIR, `${key}.rgba`);
  const recordFile = join(root, KIT_BAKE_DIR, `${key}.json`);
  if (!existsSync(rgbaFile) || !existsSync(recordFile)) {
    throw new Error(
      `${key}: no bake in ${KIT_BAKE_DIR}; run ${run.script} through the blender MCP with OUT_PATH in that directory`,
    );
  }
  const record = JSON.parse(readFileSync(recordFile, 'utf8')) as BakeRecord;
  const stale = Object.entries(runHashes(run, root)).filter(([k, v]) => record[k] !== v);
  if (stale.length > 0) {
    throw new Error(`${key}: baked from other inputs (${stale.map(([k]) => k).join(', ')})`);
  }
  const rgba = new Uint8Array(readFileSync(rgbaFile));
  if (sha256(rgba) !== record.pixelsSha256)
    throw new Error(`${key}: pixels differ from the bake record`);
  if (record.width !== size || record.height !== size || rgba.length !== size * size * 4) {
    throw new Error(
      `${key}: baked at ${String(record.width)}x${String(record.height)}, expected ${size}²`,
    );
  }
  return { width: size, height: size, rgba };
}

const kitTexture = (
  run: Run,
  key: string,
  encoding: Encoding,
  size: number,
  sources: readonly string[],
): TextureAsset => ({
  key,
  ktx2: `src/render/assets/${key}.ktx2`,
  manifest: `src/render/assets/${key}.manifest.json`,
  encoding: { name: encoding, options: KTX2_ENCODINGS[encoding] },
  /** The bake's scripts and params (which embed the source hashes) and the encoding. */
  inputsSha256: (root) =>
    sha256(
      canonicalJson({
        key,
        encoding: KTX2_ENCODINGS[encoding],
        run: runHashes(run, root),
      }),
    ),
  pixels: (root) => bakedPixels(run, key, size, root),
  uncommitted: `${KIT_BAKE_DIR}/${key}.rgba`,
  sources,
});

const yard = yardKitParams();

const TILE_SOURCES = [
  'corrugated-iron-02',
  'corrugated-steel-007a',
  'concrete-floor-02',
  'facade-001',
  'container-side',
];

export const KIT_TEXTURES: Readonly<Record<string, TextureAsset>> = Object.fromEntries(
  [
    kitTexture(YARD_KIT_RUN, 'yard-kit-atlas-a', 'albedo', yard.atlas.size, TILE_SOURCES),
    kitTexture(YARD_KIT_RUN, 'yard-kit-atlas-b', 'packed', yard.atlas.size, TILE_SOURCES),
    kitTexture(YARD_KIT_RUN, 'yard-kit-leaves', 'cards', yard.leafAtlas.size, [
      'leaf-set-009',
      'foliage-001',
    ]),
  ].map((texture) => [texture.key, texture]),
);

/** Download budget in bytes of the yard kit's glb and atlases together. */
export const KIT_BUDGET_BYTES = 2_700_000;
