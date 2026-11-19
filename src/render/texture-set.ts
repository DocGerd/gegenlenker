import {
  LoadingManager,
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
} from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import transcoderJsUrl from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import transcoderWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';

/*
 * Runtime-cached KTX2 textures: authored files transcoded on the device to whatever compressed
 * format its GPU takes. Neither they nor the Basis transcoder are precached; the service worker
 * caches them on first use (src/pwa/config.ts).
 */

const MAX_ATTEMPTS = 2;
/** A queued KTX2 load that takes longer is abandoned, so one stalled fetch cannot block the next texture. */
export const KTX2_LOAD_TIMEOUT_MS = 60_000;

/** What `onApplied` receives once the texture is given up on: attempts spent or its shader rejected. */
export const TEXTURE_FAILED = 'failed';

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
export const describeTranscodeTarget = (texture: Texture): string =>
  `ktx2:${TARGET_NAMES.get(texture.format) ?? `format-${texture.format}`}`;

/** The textures of one asset, by role; they load, apply and are freed together. */
export type TextureMaps<K extends string> = Readonly<Record<K, Texture>>;

export interface TextureSet<K extends string> {
  /**
   * The renderer whose compressed-format support picks the transcoding target, and whose shader
   * errors are watched; a later one (after a loss) replaces it and keeps a loaded set.
   */
  attach(renderer: WebGPURenderer): void;
  /**
   * Starts the load on the first call with `true` once a renderer is attached; nothing is downloaded
   * before. A failed load is retried by the next such call, once.
   */
  setEnabled(on: boolean): void;
  /**
   * Calls `apply` once the whole set has loaded, never when it fails; the returned function cancels.
   * Always asynchronous. The textures are shared: callers must not dispose them. `revert` is called
   * when the GPU rejects the shader, after which the set is not offered again.
   */
  onLoaded(apply: (maps: TextureMaps<K>) => void, revert?: () => void): () => void;
  /** A subscriber reports whether it currently draws the set, for `onApplied`. */
  reportApplied(on: boolean): void;
  /** Cancels subscribers and frees the set. */
  dispose(): void;
}

/** KTX2Loader fetches fixed file names next to `transcoderPath`; they are served as hashed app assets instead. */
export function transcoderUrls(url: string, expected: string): string {
  if (url.endsWith('basis_transcoder.js')) return transcoderJsUrl;
  if (url.endsWith('basis_transcoder.wasm')) return transcoderWasmUrl;
  if (url !== expected) console.warn('KTX2 texture: unexpected request through the loader', url);
  return url;
}

let ktx2Queue: Promise<unknown> = Promise.resolve();

/**
 * Loads `url` transcoded to `renderer`'s compressed formats, with the transcoder served locally.
 * One load at a time: three warns about concurrent KTX2Loaders, each with its own workers. A load
 * past `KTX2_LOAD_TIMEOUT_MS` rejects and frees the queue; a texture arriving late is disposed.
 */
export function loadKtx2(renderer: WebGPURenderer, url: string): Promise<Texture> {
  const run = async (): Promise<Texture> => {
    const manager = new LoadingManager().setURLModifier((u) => transcoderUrls(u, url));
    const timedOutError = (): Error => new Error(`KTX2 load of ${url} timed out`);
    let timedOut = false;
    const abandoned = (): boolean => timedOut;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        // the fetches end; a transcode already under way finishes and is disposed below
        manager.abort();
        reject(timedOutError());
      }, KTX2_LOAD_TIMEOUT_MS);
    });
    const load = (async (): Promise<Texture> => {
      const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
      if (abandoned()) throw timedOutError();
      // an empty path would fetch the transcoder from a CDN; the URL modifier replaces what is fetched
      const loader = new KTX2Loader(manager).setTranscoderPath(import.meta.env.BASE_URL);
      try {
        const texture = await loader.detectSupport(renderer).loadAsync(url);
        if (abandoned()) texture.dispose();
        return texture;
      } finally {
        loader.dispose();
      }
    })();
    try {
      return await Promise.race([load, timeout]);
    } finally {
      clearTimeout(timer);
      // the abandoned load's late failure has no one left to hear it
      load.catch(() => undefined);
    }
  };
  const next = ktx2Queue.then(run, run);
  ktx2Queue = next.catch(() => undefined);
  return next;
}

type Subscriber<K extends string> = {
  readonly apply: (maps: TextureMaps<K>) => void;
  readonly revert?: (() => void) | undefined;
};

export type TextureSetOptions<K extends string> = {
  /** One KTX2 file per role; they load one after another. */
  readonly urls: Readonly<Record<K, string>>;
  /** Sets wrapping and filtering on a texture as it arrives. */
  readonly prepare?: (key: K, texture: Texture) => void;
  /** Builds the shader before any subscriber wears the full set, so an error rejects the whole set. */
  readonly precompile: (renderer: WebGPURenderer, maps: TextureMaps<K>) => Promise<void>;
  /** What `onApplied` receives while some subscriber draws the set. */
  readonly describe: (maps: TextureMaps<K>) => string;
  /** Replaces loading `urls`, for tests. */
  readonly load?: (renderer: WebGPURenderer) => Promise<TextureMaps<K>>;
  readonly onApplied: (state: string | null) => void;
  /** Starts the warnings, e.g. `Ground texture`. */
  readonly label: string;
  /** What stays drawn when the set is not, for the warnings. */
  readonly fallback: string;
  /** Names the set's shader, so its compile error reverts every subscriber. */
  readonly marker: string;
};

const disposeMaps = (maps: Readonly<Record<string, Texture>>): void => {
  for (const texture of Object.values(maps)) texture.dispose();
};

/**
 * The load, retry, shader-error and subscriber handling of one runtime-cached set of KTX2 textures.
 * A failure of any texture or of the precompile frees what loaded and counts as one attempt.
 */
export function startTextureSet<K extends string>({
  urls,
  prepare,
  precompile,
  describe,
  load: override,
  onApplied,
  label,
  fallback,
  marker,
}: TextureSetOptions<K>): TextureSet<K> {
  let renderer: WebGPURenderer | null = null;
  let enabled = false;
  let loading = false;
  let attempts = 0;
  let loaded: TextureMaps<K> | null = null;
  let rejected = false;
  let exhausted = false;
  let disposed = false;
  let applied = 0;
  let restoreShaderErrors: (() => void) | null = null;
  const subscribers = new Set<Subscriber<K>>();

  const loadSet = async (gl: WebGPURenderer): Promise<TextureMaps<K>> => {
    const maps: Partial<Record<K, Texture>> = {};
    try {
      for (const key of Object.keys(urls) as K[]) {
        const texture = await loadKtx2(gl, urls[key]);
        maps[key] = texture;
        prepare?.(key, texture);
      }
      const full = maps as TextureMaps<K>;
      await precompile(gl, full);
      return full;
    } catch (error) {
      disposeMaps(maps as Readonly<Record<string, Texture>>);
      throw error;
    }
  };
  const load = override ?? loadSet;

  const guarded = (what: string, run: () => void): void => {
    try {
      run();
    } catch (error) {
      console.warn(`${label} ${what} failed; keeping ${fallback}`, error);
    }
  };

  const publish = (): void => {
    if (enabled && (rejected || exhausted)) onApplied(TEXTURE_FAILED);
    else onApplied(applied > 0 && loaded !== null ? describe(loaded) : null);
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
      .then((maps) => {
        loading = false;
        if (disposed || rejected) {
          disposeMaps(maps);
          return;
        }
        loaded = maps;
        for (const subscriber of subscribers) {
          guarded('apply', () => {
            subscriber.apply(maps);
          });
        }
      })
      .catch((error: unknown) => {
        loading = false;
        console.warn(
          `${label} load failed (attempt ${attempts} of ${MAX_ATTEMPTS}); keeping ${fallback}`,
          error,
        );
        if (attempts >= MAX_ATTEMPTS && !disposed) {
          exhausted = true;
          publish();
        }
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
      enabled = on;
      if (on) start();
      if (rejected || exhausted) publish();
    },
    onLoaded(apply, revert) {
      const subscriber: Subscriber<K> = { apply, revert };
      if (rejected || disposed) return () => undefined;
      subscribers.add(subscriber);
      if (loaded !== null) {
        const maps = loaded;
        void Promise.resolve().then(() => {
          if (subscribers.has(subscriber)) guarded('apply', () => apply(maps));
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
      enabled = false;
      subscribers.clear();
      restoreShaderErrors?.();
      if (loaded !== null) disposeMaps(loaded);
      loaded = null;
      applied = 0;
      publish();
    },
  };
}
