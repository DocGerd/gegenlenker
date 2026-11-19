import { HDRI_LIGHT } from '../../src/render/hdri-light';
import {
  ENCODER_OPTIONS as GROUND_ENCODER,
  GROUND_FILES,
  inputsSha256 as groundInputsSha256,
} from '../textures/ground-build';
import { generateGroundTexture } from '../textures/ground-texture';
import {
  ENCODER_OPTIONS as SKY_ENCODER,
  ENCODING_NAME as SKY_ENCODING,
  inputsSha256 as skyInputsSha256,
  SKY_FILES,
} from '../textures/sky-build';
import { hdriLightModule, readSkyImage, skyPixels } from '../textures/sky-pixels';
import { canonicalJson, type Json, sha256 } from './provenance';

export type TexturePixels = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
};

export type TextureManifest = {
  readonly inputsSha256: string;
  readonly pixelsSha256: string;
  readonly encoderVersion: string;
  readonly width: number;
  readonly height: number;
  readonly mipLevels: number;
  readonly ktx2Sha256: string;
  readonly ktx2Bytes: number;
  /** Only for a texture that also bakes a runtime constant: the hash of that baked data. */
  readonly bakedSha256?: string;
};

export type TextureAsset = {
  /** The `ASSET_REGISTRY` key and the file stem. */
  readonly key: string;
  readonly ktx2: string;
  readonly manifest: string;
  readonly encoding: {
    readonly name: string;
    readonly options: Readonly<Record<string, boolean | number>>;
  };
  /** Hash of everything the pixels depend on; embedded in the ktx2 and recorded in the manifest. */
  inputsSha256(root: string): string;
  /** Throws when a source that is not committed is missing. */
  pixels(root: string): TexturePixels;
  /** Ids in `ASSET_SOURCES` of the third-party files the pixels come from. */
  readonly sources: readonly string[];
  /** Set when a runtime constant is baked from the same sources as the ktx2. */
  readonly bake?: {
    readonly file: string;
    /** The module text, given the ktx2 it is written beside. */
    source(root: string, ktx2: Uint8Array): string;
    bakedSha256(): string;
  };
};

const BAKED_HASHES = ['inputsSha256', 'hdrSha256', 'skyKtx2Sha256'] as const;

/** The committed HDRI_LIGHT minus the three hash fields, which name the files rather than the bake. */
export function bakedSha256(light: Readonly<Record<string, unknown>> = HDRI_LIGHT): string {
  const data = Object.fromEntries(
    Object.entries(light).filter(([k]) => !(BAKED_HASHES as readonly string[]).includes(k)),
  );
  return sha256(canonicalJson(data as Json));
}

export const TEXTURE_ASSETS: Readonly<Record<string, TextureAsset>> = {
  ground: {
    key: 'ground',
    ktx2: GROUND_FILES.ktx2,
    manifest: GROUND_FILES.manifest,
    encoding: { name: 'linear-uastc-mips', options: GROUND_ENCODER },
    inputsSha256: groundInputsSha256,
    pixels: () => generateGroundTexture(),
    sources: [],
  },
  sky: {
    key: 'sky',
    ktx2: SKY_FILES.ktx2,
    manifest: SKY_FILES.manifest,
    encoding: { name: SKY_ENCODING, options: SKY_ENCODER },
    inputsSha256: skyInputsSha256,
    pixels: (root) => skyPixels(readSkyImage(root)),
    sources: ['kloofendal-sky'],
    bake: { file: SKY_FILES.bake, source: hdriLightModule, bakedSha256 },
  },
};
