import { LoadingManager, RepeatWrapping, type Texture, type WebGLRenderer } from 'three';
import groundUrl from './assets/ground.ktx2?url';
import transcoderJsUrl from 'three/examples/jsm/libs/basis/basis_transcoder.js?url';
import transcoderWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url';

/*
 * The authored ground detail map (tools/textures, issue #69): a KTX2 file transcoded on the device
 * to whatever compressed format its GPU takes. The Basis transcoder ships with the app and is
 * precached, so the texture loads offline too.
 */

const ANISOTROPY = 8; // three clamps this to what the GPU offers

export interface GroundTextures {
  /** The renderer whose compressed-format support picks the transcoding target. */
  attach(renderer: WebGLRenderer): void;
  /** Starts the load on the first call with `true` once a renderer is attached; nothing is downloaded before. */
  setEnabled(on: boolean): void;
  /**
   * Calls `apply` once the texture has loaded, never when it fails; the returned function cancels.
   * Always asynchronous. The texture is shared: callers must not dispose it.
   */
  onLoaded(apply: (texture: Texture) => void): () => void;
}

/** KTX2Loader fetches fixed file names next to `transcoderPath`; they are served as hashed app assets instead. */
function transcoderUrls(url: string): string {
  if (url.endsWith('basis_transcoder.js')) return transcoderJsUrl;
  if (url.endsWith('basis_transcoder.wasm')) return transcoderWasmUrl;
  return url;
}

export async function loadGroundTexture(renderer: WebGLRenderer): Promise<Texture> {
  const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
  const loader = new KTX2Loader(new LoadingManager().setURLModifier(transcoderUrls))
    // a non-empty path keeps the loader off its CDN default
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

/** A failed load warns and leaves the token ground; `onReady` reports the loaded texture, for tests and diagnostics. */
export function startGroundTextures(
  load: (renderer: WebGLRenderer) => Promise<Texture> = loadGroundTexture,
  onReady: (texture: Texture) => void = () => undefined,
): GroundTextures {
  let renderer: WebGLRenderer | null = null;
  let enabled = false;
  let started = false;
  let loaded: Texture | null = null;
  const waiting = new Set<(texture: Texture) => void>();

  const start = (): void => {
    if (started || !enabled || renderer === null) return;
    started = true;
    load(renderer).then(
      (texture) => {
        loaded = texture;
        onReady(texture);
        for (const apply of waiting) apply(texture);
        waiting.clear();
      },
      (error: unknown) => {
        console.warn('Ground texture failed to load; keeping the token ground', error);
      },
    );
  };

  return {
    attach(next) {
      renderer = next;
      start();
    },
    setEnabled(on) {
      if (on) enabled = true;
      start();
    },
    onLoaded(apply) {
      let cancelled = false;
      const call = (texture: Texture): void => {
        if (!cancelled) apply(texture);
      };
      if (loaded === null) waiting.add(call);
      else {
        const texture = loaded;
        void Promise.resolve().then(() => {
          call(texture);
        });
      }
      return () => {
        cancelled = true;
        waiting.delete(call);
      };
    },
  };
}
