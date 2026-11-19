import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HDRI_LIGHT } from '../../src/render/hdri-light';
import {
  ENCODER_OPTIONS as GROUND_ENCODER,
  GROUND_FILES,
  inputsSha256 as groundInputsSha256,
} from '../textures/ground-build';
import { generateGroundTexture } from '../textures/ground-texture';
import { parseRadianceHdr } from '../textures/hdri-light';
import {
  ENCODER_OPTIONS as SKY_ENCODER,
  inputsSha256 as skyInputsSha256,
  SKY_FILES,
  SKY_HDR,
  skyPixels,
} from '../textures/sky-build';
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
  /** Set when a separate generator writes the ktx2 and a baked constant together. */
  readonly bake?: {
    readonly file: string;
    readonly script: string;
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
    manifest: 'src/render/assets/sky.manifest.json',
    encoding: { name: 'srgb-uastc-single-level', options: SKY_ENCODER },
    inputsSha256: skyInputsSha256,
    pixels: (root) => {
      const hdr = join(root, SKY_HDR.path);
      if (!existsSync(hdr)) throw new Error(`${SKY_HDR.path} is missing: download ${SKY_HDR.url}`);
      return skyPixels(parseRadianceHdr(new Uint8Array(readFileSync(hdr))));
    },
    sources: ['kloofendal-sky'],
    bake: { file: SKY_FILES.bake, script: 'tools/textures/sky-build.ts', bakedSha256 },
  },
};
