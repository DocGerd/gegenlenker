/**
 * Named KTX2 encodings, shared by every texture build. The option objects are hashed into each
 * texture's inputs, so keep their key order and values.
 */
export type Encoding = {
  readonly name: string;
  readonly options: Readonly<Record<string, boolean | number>>;
};

/** Linear data packed into the channels (ground detail; normal XY, roughness and occlusion), so no sRGB transfer and no perceptual weighting. */
const LINEAR_UASTC_MIPS = {
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

/** sRGB colour, no mips: the dome's u wraps at one azimuth, where a mip chain would draw a seam. */
const SRGB_UASTC_SINGLE_LEVEL = {
  isUASTC: true,
  uastcLDRQualityLevel: 3,
  needSupercompression: true,
  enableRDO: true,
  rdoQualityLevel: 3,
  generateMipmap: false,
  isPerceptual: true,
  isSetKTX2SRGBTransferFunc: true,
  isKTX2File: true,
} as const;

/** sRGB colour that tiles: ETC1S is a fraction of UASTC's size, and a luminance-normalised albedo detail hides its blockiness. */
const SRGB_ETC1S_MIPS = {
  isUASTC: false,
  qualityLevel: 255,
  compressionLevel: 4,
  generateMipmap: true,
  isPerceptual: true,
  isSetKTX2SRGBTransferFunc: true,
  isKTX2File: true,
} as const;

export const ENCODINGS = {
  linearUastcMips: { name: 'linear-uastc-mips', options: LINEAR_UASTC_MIPS },
  srgbUastcSingleLevel: { name: 'srgb-uastc-single-level', options: SRGB_UASTC_SINGLE_LEVEL },
  srgbEtc1sMips: { name: 'srgb-etc1s-mips', options: SRGB_ETC1S_MIPS },
} as const satisfies Readonly<Record<string, Encoding>>;
