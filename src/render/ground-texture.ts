import {
  Float32BufferAttribute,
  LoadingManager,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  RGB_ETC1_Format,
  RGB_ETC2_Format,
  RGB_PVRTC_4BPPV1_Format,
  RGBA_ASTC_4x4_Format,
  RGBA_BPTC_Format,
  RGBA_ETC2_EAC_Format,
  RGBA_PVRTC_4BPPV1_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT5_Format,
  RGBAFormat,
  Scene,
  type Texture,
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import groundUrl from './assets/ground.ktx2?url';
import transcoderJsUrl from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import transcoderWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';
import { createGroundMaterial } from './ground-material';
import { GROUND_SHADER_MARKER } from './ground-texture-spec';
import { gpuLost } from './seams';

/*
 * The authored ground detail map (tools/textures, issue #69): a KTX2 file transcoded on the device
 * to whatever compressed format its GPU takes. The texture and the Basis transcoder are not
 * precached; the service worker caches them at runtime on first use (src/pwa/config.ts).
 */

const ANISOTROPY = 8; // three clamps this to what the GPU offers
const MAX_ATTEMPTS = 2;

const TARGET_NAMES = new Map<number, string>([
  [RGBA_ASTC_4x4_Format, 'astc'],
  [RGBA_BPTC_Format, 'bc7'],
  [RGBA_S3TC_DXT1_Format, 'bc1'],
  [RGBA_S3TC_DXT5_Format, 'bc3'],
  [RGB_ETC2_Format, 'etc2'],
  [RGBA_ETC2_EAC_Format, 'etc2'],
  [RGB_ETC1_Format, 'etc1'],
  [RGB_PVRTC_4BPPV1_Format, 'pvrtc'],
  [RGBA_PVRTC_4BPPV1_Format, 'pvrtc'],
  [RGBAFormat, 'rgba'],
]);

/** What the file was transcoded to on this device, e.g. `ktx2:bc7`; `rgba` is the uncompressed fallback. */
export const describeGroundTexture = (texture: Texture): string =>
  `ktx2:${TARGET_NAMES.get(texture.format) ?? `format-${texture.format}`}`;

export interface GroundTextures {
  /**
   * The renderer whose compressed-format support picks the transcoding target, and whose shader
   * errors are watched; a later one (after a loss) replaces it and keeps a loaded texture.
   */
  attach(renderer: WebGPURenderer): void;
  /**
   * Starts the load on the first call with `true` once a renderer is attached; nothing is downloaded
   * before. A failed load is retried by the next such call, once.
   */
  setEnabled(on: boolean): void;
  /**
   * Calls `apply` once the texture has loaded, never when it fails; the returned function cancels.
   * Always asynchronous. The texture is shared: callers must not dispose it. `revert` is called when
   * the GPU rejects the ground shader, after which the texture is not offered again.
   */
  onLoaded(apply: (texture: Texture) => void, revert?: () => void): () => void;
  /** A subscriber reports whether it currently draws the texture, for `onApplied`. */
  reportApplied(on: boolean): void;
  /** Cancels subscribers and frees the texture. */
  dispose(): void;
}

/** KTX2Loader fetches fixed file names next to `transcoderPath`; they are served as hashed app assets instead. */
export function transcoderUrls(url: string, expected = groundUrl): string {
  if (url.endsWith('basis_transcoder.js')) return transcoderJsUrl;
  if (url.endsWith('basis_transcoder.wasm')) return transcoderWasmUrl;
  if (url !== expected) console.warn('KTX2 texture: unexpected request through the loader', url);
  return url;
}

let ktx2Queue: Promise<unknown> = Promise.resolve();

/**
 * Loads `url` transcoded to `renderer`'s compressed formats, with the transcoder served locally.
 * One load at a time: three warns about concurrent KTX2Loaders, each with its own workers.
 */
export function loadKtx2(renderer: WebGPURenderer, url: string): Promise<Texture> {
  const run = async (): Promise<Texture> => {
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
    const loader = new KTX2Loader(
      new LoadingManager().setURLModifier((u) => transcoderUrls(u, url)),
    )
      // an empty path would fetch the transcoder from a CDN; the URL modifier replaces what is fetched
      .setTranscoderPath(import.meta.env.BASE_URL)
      .detectSupport(renderer);
    try {
      return await loader.loadAsync(url);
    } finally {
      loader.dispose();
    }
  };
  const next = ktx2Queue.then(run, run);
  ktx2Queue = next.catch(() => undefined);
  return next;
}

/**
 * Builds the ground material for `texture` before any ground wears it, so a node or pipeline error
 * rejects here instead of in a frame; a GLSL error also reaches the shader watch. three swaps a
 * material whose node graph throws for a plain one and only logs it, hence the marker check.
 */
export async function precompileGround(renderer: WebGPURenderer, texture: Texture): Promise<void> {
  const geometry = new PlaneGeometry();
  const vertices = geometry.getAttribute('position').count;
  geometry
    .setAttribute('color', new Float32BufferAttribute(new Float32Array(vertices * 3), 3))
    .setAttribute('groundSelect', new Float32BufferAttribute(new Float32Array(vertices * 3), 3));
  const material = createGroundMaterial(texture);
  const mesh = new Mesh(geometry, material);
  const scene = new Scene();
  scene.add(mesh);
  try {
    const { fragmentShader } = await renderer.debug.getShaderAsync(
      scene,
      new PerspectiveCamera(),
      mesh,
    );
    if (fragmentShader?.includes(GROUND_SHADER_MARKER) !== true) {
      throw new Error('the ground shader did not build');
    }
    // a compile on a lost context passes vacuously
    if (gpuLost(renderer)) throw new Error('the GPU context was lost');
  } finally {
    material.dispose();
    geometry.dispose();
  }
}

export async function loadGroundTexture(renderer: WebGPURenderer): Promise<Texture> {
  const texture = await loadKtx2(renderer, groundUrl);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = ANISOTROPY;
  try {
    await precompileGround(renderer, texture);
  } catch (error) {
    texture.dispose();
    throw error;
  }
  return texture;
}

type Subscriber = {
  readonly apply: (texture: Texture) => void;
  readonly revert?: (() => void) | undefined;
};

/**
 * A failed load warns and leaves the token ground. `onApplied` receives `describeGroundTexture`
 * while some subscriber draws the texture and `null` otherwise; the offline e2e reads it.
 */
export function startGroundTextures(
  load: (renderer: WebGPURenderer) => Promise<Texture> = loadGroundTexture,
  onApplied: (state: string | null) => void = () => undefined,
): GroundTextures {
  return startTextureAsset({
    load,
    onApplied,
    label: 'Ground texture',
    fallback: 'the token ground',
    marker: GROUND_SHADER_MARKER,
  });
}

export type TextureAssetOptions = {
  readonly load: (renderer: WebGPURenderer) => Promise<Texture>;
  readonly onApplied: (state: string | null) => void;
  /** Starts the warnings, e.g. `Ground texture`. */
  readonly label: string;
  /** What stays drawn when the texture is not, for the warnings. */
  readonly fallback: string;
  /** Names the texture's shader, so its compile error reverts every subscriber. */
  readonly marker: string;
};

/** The load, retry, shader-error and subscriber handling of one runtime-cached KTX2 texture. */
export function startTextureAsset({
  load,
  onApplied,
  label,
  fallback,
  marker,
}: TextureAssetOptions): GroundTextures {
  let renderer: WebGPURenderer | null = null;
  let enabled = false;
  let loading = false;
  let attempts = 0;
  let loaded: Texture | null = null;
  let rejected = false;
  let disposed = false;
  let applied = 0;
  let restoreShaderErrors: (() => void) | null = null;
  const subscribers = new Set<Subscriber>();

  const guarded = (what: string, run: () => void): void => {
    try {
      run();
    } catch (error) {
      console.warn(`${label} ${what} failed; keeping ${fallback}`, error);
    }
  };

  const publish = (): void => {
    onApplied(applied > 0 && loaded !== null ? describeGroundTexture(loaded) : null);
  };

  const reject = (): void => {
    if (rejected) return;
    rejected = true;
    console.warn(`${label} shader failed to compile; keeping ${fallback}`);
    for (const subscriber of subscribers) {
      if (subscriber.revert !== undefined) guarded('revert', subscriber.revert);
    }
    subscribers.clear();
    applied = 0;
    publish();
  };

  /** three skips its own report once `onShaderError` is set, so unrelated programs are logged here. */
  const watchShaderErrors = (gl: WebGPURenderer): void => {
    const previous = gl.debug.onShaderError;
    const watcher: NonNullable<typeof previous> = (context, program, vertex, fragment) => {
      if (context.getShaderSource(fragment)?.includes(marker) === true) reject();
      if (previous !== null) previous(context, program, vertex, fragment);
      else
        console.error(
          'WebGLProgram: shader error',
          context.getShaderInfoLog(vertex),
          context.getShaderInfoLog(fragment),
          context.getProgramInfoLog(program),
        );
    };
    gl.debug.onShaderError = watcher;
    restoreShaderErrors = () => {
      if (gl.debug.onShaderError === watcher) gl.debug.onShaderError = previous;
    };
  };

  const start = (): void => {
    if (loading || loaded !== null || rejected || disposed) return;
    if (!enabled || renderer === null || attempts >= MAX_ATTEMPTS) return;
    loading = true;
    attempts++;
    load(renderer)
      .then((texture) => {
        loading = false;
        if (disposed || rejected) {
          texture.dispose();
          return;
        }
        loaded = texture;
        for (const subscriber of subscribers) {
          guarded('apply', () => {
            subscriber.apply(texture);
          });
        }
      })
      .catch((error: unknown) => {
        loading = false;
        console.warn(
          `${label} load failed (attempt ${attempts} of ${MAX_ATTEMPTS}); keeping ${fallback}`,
          error,
        );
      });
  };

  return {
    attach(next) {
      if (renderer === next || disposed) return;
      restoreShaderErrors?.();
      renderer = next;
      watchShaderErrors(next);
      start();
    },
    setEnabled(on) {
      if (!on) return;
      enabled = true;
      start();
    },
    onLoaded(apply, revert) {
      const subscriber: Subscriber = { apply, revert };
      if (rejected || disposed) return () => undefined;
      subscribers.add(subscriber);
      if (loaded !== null) {
        const texture = loaded;
        void Promise.resolve().then(() => {
          if (subscribers.has(subscriber)) guarded('apply', () => apply(texture));
        });
      }
      return () => {
        subscribers.delete(subscriber);
      };
    },
    reportApplied(on) {
      applied = Math.max(0, applied + (on ? 1 : -1));
      publish();
    },
    dispose() {
      disposed = true;
      subscribers.clear();
      restoreShaderErrors?.();
      loaded?.dispose();
      loaded = null;
      applied = 0;
      publish();
    },
  };
}
