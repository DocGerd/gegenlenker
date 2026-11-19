import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';
import { ROOT } from '../assets/provenance';

const TRANSCODER_DIR = 'node_modules/three/examples/jsm/libs/basis';
/** KTX2Loader.TranscoderFormat.RGBA32: UASTC decoded to uncompressed pixels. */
const RGBA32 = 13;

type KTX2File = {
  isValid(): boolean;
  startTranscoding(): number;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(
    dst: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    flags: number,
    channel0: number,
    channel1: number,
  ): number;
  close(): void;
  delete(): void;
};
type BasisModule = {
  wasmBinary: Uint8Array;
  onRuntimeInitialized: () => void;
  initializeBasis(): void;
  KTX2File: new (data: Uint8Array) => KTX2File;
};

/** The base level of a ground ktx2, decoded by the same Basis transcoder the app ships. */
export async function decodeGroundTexture(ktx2: Uint8Array, root = ROOT): Promise<Uint8Array> {
  const dir = join(root, TRANSCODER_DIR);
  const script = readFileSync(join(dir, 'basis_transcoder.js'), 'utf8');
  const factory = runInNewContext(`${script}\n;BASIS`, {
    require: createRequire(import.meta.url),
    __dirname: dir,
    process,
    console,
  }) as (module: Partial<BasisModule>) => void;
  const basis = await new Promise<BasisModule>((resolve) => {
    const module: Partial<BasisModule> = {
      wasmBinary: readFileSync(join(dir, 'basis_transcoder.wasm')),
    };
    module.onRuntimeInitialized = () => {
      resolve(module as BasisModule);
    };
    factory(module);
  });
  basis.initializeBasis();

  const file = new basis.KTX2File(ktx2);
  try {
    if (!file.isValid() || file.startTranscoding() === 0) throw new Error('ground.ktx2 is invalid');
    const rgba = new Uint8Array(file.getImageTranscodedSizeInBytes(0, 0, 0, RGBA32));
    if (file.transcodeImage(rgba, 0, 0, 0, RGBA32, 0, -1, -1) === 0) {
      throw new Error('ground.ktx2 failed to transcode');
    }
    return rgba;
  } finally {
    file.close();
    file.delete();
  }
}

export type ChannelFidelity = {
  /** Peak signal-to-noise ratio in dB over 8-bit values. */
  readonly psnr: number;
  /** Mean value in 0..1. */
  readonly mean: number;
};

/** Per RGB channel: how close `decoded` is to `source` and where its mean sits. */
export function channelFidelity(source: Uint8Array, decoded: Uint8Array): ChannelFidelity[] {
  const pixels = source.length / 4;
  return [0, 1, 2].map((channel) => {
    let squared = 0;
    let sum = 0;
    for (let i = channel; i < source.length; i += 4) {
      const value = decoded[i] ?? 0;
      squared += (value - (source[i] ?? 0)) ** 2;
      sum += value;
    }
    return { psnr: 10 * Math.log10(255 ** 2 / (squared / pixels)), mean: sum / pixels / 255 };
  });
}
