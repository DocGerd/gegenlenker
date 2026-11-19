import { lfText, ROOT, sha256 } from '../assets/provenance';

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

/** Source files (LF-normalised) plus the encoder settings. */
export const inputsSha256 = (root = ROOT): string =>
  sha256(
    JSON.stringify([
      ...GROUND_FILES.sources.map((file) => [file, lfText(root, file)]),
      ENCODER_OPTIONS,
    ]),
  );
