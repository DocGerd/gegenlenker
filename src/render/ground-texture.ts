import {
  LoadingManager,
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
  type Texture,
  type WebGLRenderer,
} from 'three';
import groundUrl from './assets/ground.ktx2?url';
import transcoderJsUrl from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import transcoderWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';
import { GROUND_SHADER_MARKER } from './ground-texture-spec';

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
  attach(renderer: WebGLRenderer): void;
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
export function transcoderUrls(url: string): string {
  if (url.endsWith('basis_transcoder.js')) return transcoderJsUrl;
  if (url.endsWith('basis_transcoder.wasm')) return transcoderWasmUrl;
  if (url !== groundUrl) console.warn('Ground texture: unexpected request through the loader', url);
  return url;
}

export async function loadGroundTexture(renderer: WebGLRenderer): Promise<Texture> {
  const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
  const loader = new KTX2Loader(new LoadingManager().setURLModifier(transcoderUrls))
    // an empty path would fetch the transcoder from a CDN; the URL modifier replaces what is fetched
    .setTranscoderPath(import.meta.env.BASE_URL)
    .detectSupport(renderer);
  try {
    const texture = await loader.loadAsync(groundUrl);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.anisotropy = ANISOTROPY;
    return texture;
  } finally {
    loader.dispose();
  }
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
  load: (renderer: WebGLRenderer) => Promise<Texture> = loadGroundTexture,
  onApplied: (state: string | null) => void = () => undefined,
): GroundTextures {
  let renderer: WebGLRenderer | null = null;
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
      console.warn(`Ground texture ${what} failed; keeping the token ground`, error);
    }
  };

  const publish = (): void => {
    onApplied(applied > 0 && loaded !== null ? describeGroundTexture(loaded) : null);
  };

  const reject = (): void => {
    if (rejected) return;
    rejected = true;
    console.warn('Ground texture shader failed to compile; keeping the token ground');
    for (const subscriber of subscribers) {
      if (subscriber.revert !== undefined) guarded('revert', subscriber.revert);
    }
    subscribers.clear();
    applied = 0;
    publish();
  };

  /** three skips its own report once `onShaderError` is set, so unrelated programs are logged here. */
  const watchShaderErrors = (gl: WebGLRenderer): void => {
    const previous = gl.debug.onShaderError;
    const watcher: NonNullable<typeof previous> = (context, program, vertex, fragment) => {
      if (context.getShaderSource(fragment)?.includes(GROUND_SHADER_MARKER) === true) reject();
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
        if (disposed) {
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
          `Ground texture load failed (attempt ${attempts} of ${MAX_ATTEMPTS}); keeping the token ground`,
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
