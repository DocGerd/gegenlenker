import { ENCODINGS } from '../assets/encodings';
import { lfText, ROOT, sha256 } from '../assets/provenance';
import { ASSET_SOURCES } from '../assets/sources';

/** The sky HDRI's registered download; it is not committed. */
export const SKY_HDR = (() => {
  const file = ASSET_SOURCES['kloofendal-sky']?.files[0];
  if (file === undefined) throw new Error('ASSET_SOURCES has no kloofendal-sky file');
  return file;
})();

export const SKY_FILES = {
  /** Everything the pixels and the bake depend on besides the .hdr. */
  sources: ['tools/textures/sky-pixels.ts', 'tools/textures/hdri-light.ts'],
  ktx2: 'src/render/assets/sky.ktx2',
  manifest: 'src/render/assets/sky.manifest.json',
  bake: 'src/render/hdri-light.ts',
} as const;

export const ENCODER_OPTIONS = ENCODINGS.srgbUastcSingleLevel.options;

export const ENCODING_NAME = ENCODINGS.srgbUastcSingleLevel.name;

/** Source files (LF-normalised), the named encoding and the .hdr's hash. */
export const inputsSha256 = (root = ROOT): string =>
  sha256(
    JSON.stringify([
      ...SKY_FILES.sources.map((file) => [file, lfText(root, file)]),
      [ENCODING_NAME, ENCODER_OPTIONS],
      SKY_HDR.sha256,
    ]),
  );
