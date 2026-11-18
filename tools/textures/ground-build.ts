import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '../..');

export const GROUND_FILES = {
  /** Everything the pixels depend on; hashed into the manifest and the ktx2 itself. */
  sources: [
    'tools/textures/ground-texture.ts',
    'tools/textures/noise.ts',
    'src/render/ground-texture-pixels.ts',
  ],
  ktx2: 'src/render/assets/ground.ktx2',
  manifest: 'src/render/assets/ground.manifest.json',
} as const;

/** Linear data packed into RGB, so no sRGB transfer and no perceptual weighting. */
export const ENCODER_OPTIONS = {
  isUASTC: true,
  uastcLDRQualityLevel: 3,
  needSupercompression: true,
  enableRDO: true,
  rdoQualityLevel: 1,
  generateMipmap: true,
  isPerceptual: false,
  isSetKTX2SRGBTransferFunc: false,
  isKTX2File: true,
} as const;

export const KV_INPUTS = 'gegenlenker.inputsSha256';

export type GroundManifest = {
  readonly inputsSha256: string;
  readonly pixelsSha256: string;
  readonly encoderVersion: string;
  readonly width: number;
  readonly height: number;
  readonly mipLevels: number;
  readonly ktx2Sha256: string;
  readonly ktx2Bytes: number;
};

export const sha256 = (data: string | Uint8Array): string =>
  createHash('sha256').update(data).digest('hex');

const lf = (file: string, root: string): string =>
  readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n');

/** Source files (LF-normalised, since line endings differ per checkout) plus the encoder settings. */
export const inputsSha256 = (root = ROOT): string =>
  sha256(
    JSON.stringify([
      ...GROUND_FILES.sources.map((file) => [file, lf(file, root)]),
      ENCODER_OPTIONS,
    ]),
  );

export const ktx2Sha256 = (root = ROOT): string =>
  sha256(readFileSync(join(root, GROUND_FILES.ktx2)));

export function encoderVersion(root = ROOT): string {
  const file = join(root, 'node_modules/ktx2-encoder/package.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}
