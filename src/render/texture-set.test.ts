import { DataTexture, RGBA_BPTC_Format, type Texture } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startGroundTextures } from './ground-texture';
import { GROUND_SHADER_MARKER } from './ground-texture-spec';
import {
  describeTranscodeTarget,
  KTX2_LOAD_TIMEOUT_MS,
  loadKtx2,
  startTextureSet,
  TEXTURE_FAILED,
  transcoderUrls,
  type TextureMaps,
} from './texture-set';

type ShaderErrorHook = NonNullable<WebGPURenderer['debug']['onShaderError']>;

const renderer = (): WebGPURenderer =>
  Object.assign(Object.create(WebGPURenderer.prototype) as WebGPURenderer, {
    debug: { onShaderError: null },
  });
const texture = (): Texture => new DataTexture(new Uint8Array(4), 1, 1);
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const shaderError = (gl: WebGPURenderer, fragment: string): void => {
  const context = {
    getShaderSource: (shader: unknown) => shader,
    getShaderInfoLog: () => 'log',
    getProgramInfoLog: () => 'log',
  } as unknown as WebGL2RenderingContext;
  const hook = gl.debug.onShaderError as ShaderErrorHook;
  hook(...([context, {}, 'vertex', fragment] as unknown as Parameters<ShaderErrorHook>));
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  loaderTexture.manual = false;
  loaderTexture.queue = [];
  loaderTexture.resolvers = [];
  loaderTexture.disposed = 0;
});

const loaderTexture = vi.hoisted(() => ({
  next: null as Texture | null,
  /** Results handed out in call order before `next`; an Error rejects. */
  queue: [] as (Texture | Error)[],
  /** When set, loads stay pending until a test resolves them, in call order. */
  manual: false,
  resolvers: [] as ((texture: Texture) => void)[],
  disposed: 0,
}));
vi.mock('three/addons/loaders/KTX2Loader.js', () => ({
  KTX2Loader: class {
    setTranscoderPath() {
      return this;
    }
    detectSupport() {
      return this;
    }
    loadAsync() {
      const queued = loaderTexture.queue.shift();
      if (queued instanceof Error) return Promise.reject(queued);
      if (queued !== undefined) return Promise.resolve(queued);
      if (!loaderTexture.manual) return Promise.resolve(loaderTexture.next);
      return new Promise<Texture>((resolve) => {
        loaderTexture.resolvers.push(resolve);
      });
    }
    dispose() {
      loaderTexture.disposed++;
    }
  },
}));

describe('texture set', () => {
  const urls = { a: 'a.ktx2', b: 'b.ktx2' };
  const options = (
    precompile: (gl: WebGPURenderer, maps: TextureMaps<'a' | 'b'>) => Promise<void>,
  ) =>
    ({
      urls,
      precompile,
      describe: () => 'set',
      onApplied: () => undefined,
      label: 'Test texture',
      fallback: 'nothing',
      marker: 'MARK',
    }) as const;

  it('precompiles once, on the full set, and delivers it', async () => {
    const a = texture();
    const b = texture();
    loaderTexture.queue = [a, b];
    const precompile = vi.fn(() => Promise.resolve());
    const set = startTextureSet(options(precompile));
    const apply = vi.fn();
    set.onLoaded(apply);
    const gl = renderer();
    set.attach(gl);
    set.setEnabled(true);
    await settle();
    expect(precompile).toHaveBeenCalledOnce();
    expect(precompile).toHaveBeenCalledWith(gl, { a, b });
    expect(apply).toHaveBeenCalledWith({ a, b });
  });

  it.each([
    ['a map fails to load', 'load'],
    ['the precompile rejects', 'precompile'],
  ])('frees the partial set, applies nothing and counts one attempt when %s', async (_, how) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const a = texture();
    const b = texture();
    const disposed = vi.fn();
    a.addEventListener('dispose', disposed);
    b.addEventListener('dispose', disposed);
    const failing = how === 'load' ? [a, new Error('offline')] : [a, b];
    loaderTexture.queue = [...failing, new Error('offline'), new Error('offline')];
    const precompile = vi.fn(() => Promise.reject(new Error('shader')));
    const states: (string | null)[] = [];
    const set = startTextureSet({ ...options(precompile), onApplied: (s) => states.push(s) });
    const apply = vi.fn();
    set.onLoaded(apply);
    set.attach(renderer());
    set.setEnabled(true);
    await settle();
    expect(apply).not.toHaveBeenCalled();
    expect(disposed).toHaveBeenCalledTimes(how === 'load' ? 1 : 2);
    expect(precompile).toHaveBeenCalledTimes(how === 'load' ? 0 : 1);
    expect(states).toEqual([]);
    set.setEnabled(true);
    await settle();
    expect(states).toEqual([TEXTURE_FAILED]);
  });
});

describe('KTX2 load queue', () => {
  it('abandons a stalled load, runs the next one, and frees a texture that arrives late', async () => {
    vi.useFakeTimers();
    loaderTexture.manual = true;
    const gl = renderer();
    const stalled = loadKtx2(gl, 'stalled.ktx2');
    const timedOut = expect(stalled).rejects.toThrow(/timed out/);
    const following = loadKtx2(gl, 'following.ktx2');
    await vi.advanceTimersByTimeAsync(KTX2_LOAD_TIMEOUT_MS);
    await timedOut;

    await vi.advanceTimersByTimeAsync(0);
    expect(loaderTexture.resolvers).toHaveLength(2);
    const fresh = texture();
    loaderTexture.resolvers[1]?.(fresh);
    await expect(following).resolves.toBe(fresh);
    expect(loaderTexture.disposed).toBe(1);

    const late = texture();
    const lateDisposed = vi.fn();
    late.addEventListener('dispose', lateDisposed);
    loaderTexture.resolvers[0]?.(late);
    await vi.advanceTimersByTimeAsync(0);
    expect(lateDisposed).toHaveBeenCalledOnce();
    expect(loaderTexture.disposed).toBe(2);
  });

  it('keeps a load that finishes in time, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    loaderTexture.manual = true;
    const loading = loadKtx2(renderer(), 'quick.ktx2');
    await vi.advanceTimersByTimeAsync(0);
    const loaded = texture();
    const disposed = vi.fn();
    loaded.addEventListener('dispose', disposed);
    loaderTexture.resolvers[0]?.(loaded);
    await expect(loading).resolves.toBe(loaded);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(KTX2_LOAD_TIMEOUT_MS);
    expect(disposed).not.toHaveBeenCalled();
  });
});

describe('ground textures', () => {
  it('downloads nothing until a renderer is attached and a preset wants the texture', async () => {
    const load = vi.fn(() => Promise.resolve(texture()));
    const textures = startGroundTextures(load);
    const gl = renderer();
    textures.setEnabled(false);
    textures.attach(gl);
    await settle();
    expect(load).not.toHaveBeenCalled();
    textures.setEnabled(true);
    textures.setEnabled(true);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(gl);
  });

  it('starts once the renderer arrives after the preset', async () => {
    const load = vi.fn(() => Promise.resolve(texture()));
    const textures = startGroundTextures(load);
    textures.setEnabled(true);
    await settle();
    expect(load).not.toHaveBeenCalled();
    textures.attach(renderer());
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('moves the shader watch to a renderer that replaces a lost one, keeping the loaded texture', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = vi.fn(() => Promise.resolve(texture()));
    const textures = startGroundTextures(load);
    const revert = vi.fn();
    textures.onLoaded(() => undefined, revert);
    const first = renderer();
    textures.attach(first);
    textures.setEnabled(true);
    await settle();
    const next = renderer();
    textures.attach(next);
    await settle();
    expect(load).toHaveBeenCalledOnce();
    expect(first.debug.onShaderError).toBeNull();
    shaderError(next, `vec3 ${GROUND_SHADER_MARKER};`);
    expect(revert).toHaveBeenCalledOnce();
  });

  it('hands the loaded texture to early and late subscribers, but not to a cancelled one', async () => {
    const loaded = texture();
    const textures = startGroundTextures(() => Promise.resolve(loaded));
    const early = vi.fn();
    const cancelled = vi.fn();
    textures.onLoaded(early);
    textures.onLoaded(cancelled)();
    textures.attach(renderer());
    textures.setEnabled(true);
    await settle();
    expect(early).toHaveBeenCalledWith({ detail: loaded });
    expect(cancelled).not.toHaveBeenCalled();
    const late = vi.fn();
    textures.onLoaded(late);
    expect(late).not.toHaveBeenCalled();
    await settle();
    expect(late).toHaveBeenCalledWith({ detail: loaded });
  });

  it('warns and calls nobody when the load fails, then retries once on the next enable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const loaded = texture();
    const load = vi
      .fn<() => Promise<Texture>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(loaded);
    const textures = startGroundTextures(load);
    const apply = vi.fn();
    textures.onLoaded(apply);
    textures.attach(renderer());
    textures.setEnabled(true);
    await settle();
    expect(apply).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    textures.setEnabled(false);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    textures.setEnabled(true);
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenCalledWith({ detail: loaded });
  });

  it('gives up after the retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = vi.fn(() => Promise.reject(new Error('offline')));
    const textures = startGroundTextures(load);
    textures.attach(renderer());
    for (let i = 0; i < 4; i++) {
      textures.setEnabled(true);
      await settle();
    }
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reports failed once the last attempt is spent, while enabled, and not before', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const states: (string | null)[] = [];
    const textures = startGroundTextures(
      () => Promise.reject(new Error('offline')),
      (state) => states.push(state),
    );
    textures.attach(renderer());
    textures.setEnabled(true);
    await settle();
    expect(states).toEqual([]);
    textures.setEnabled(true);
    await settle();
    expect(states).toEqual([TEXTURE_FAILED]);
    textures.setEnabled(false);
    expect(states.at(-1)).toBeNull();
    textures.setEnabled(true);
    expect(states.at(-1)).toBe(TEXTURE_FAILED);
    textures.dispose();
    expect(states.at(-1)).toBeNull();
  });

  it('does not report failed when the retry succeeds', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const states: (string | null)[] = [];
    const load = vi
      .fn<() => Promise<Texture>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(texture());
    const textures = startGroundTextures(load, (state) => states.push(state));
    textures.onLoaded(() => {
      textures.reportApplied(true);
    });
    textures.attach(renderer());
    textures.setEnabled(true);
    await settle();
    textures.setEnabled(true);
    await settle();
    expect(states).not.toContain(TEXTURE_FAILED);
    expect(states.at(-1)).toBe('ktx2:rgba');
  });

  it('keeps delivering when a subscriber throws, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const textures = startGroundTextures(() => Promise.resolve(texture()));
    const after = vi.fn();
    textures.onLoaded(() => {
      throw new Error('apply failed');
    });
    textures.onLoaded(after);
    textures.attach(renderer());
    textures.setEnabled(true);
    await settle();
    expect(after).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('reports the transcode target while a subscriber draws the texture', async () => {
    const loaded = texture();
    loaded.format = RGBA_BPTC_Format;
    const states: (string | null)[] = [];
    const textures = startGroundTextures(
      () => Promise.resolve(loaded),
      (state) => states.push(state),
    );
    textures.onLoaded(() => {
      textures.reportApplied(true);
    });
    textures.attach(renderer());
    textures.setEnabled(true);
    await settle();
    expect(states).toEqual(['ktx2:bc7']);
    textures.reportApplied(false);
    expect(states).toEqual(['ktx2:bc7', null]);
    expect(describeTranscodeTarget(texture())).toBe('ktx2:rgba');
  });

  describe('shader compile failure', () => {
    it('reverts the subscribers once, warns, and stops offering the texture', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const gl = renderer();
      const textures = startGroundTextures(() => Promise.resolve(texture()));
      const revert = vi.fn();
      textures.onLoaded(() => undefined, revert);
      textures.attach(gl);
      textures.setEnabled(true);
      await settle();

      shaderError(gl, `vec3 ${GROUND_SHADER_MARKER};`);
      shaderError(gl, `vec3 ${GROUND_SHADER_MARKER};`);
      expect(revert).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledOnce();

      const late = vi.fn();
      textures.onLoaded(late);
      await settle();
      expect(late).not.toHaveBeenCalled();
    });

    it('reports failed after the reject, once, and not a texture state again', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const gl = renderer();
      const states: (string | null)[] = [];
      const textures = startGroundTextures(
        () => Promise.resolve(texture()),
        (state) => states.push(state),
      );
      textures.onLoaded(() => {
        textures.reportApplied(true);
      });
      textures.attach(gl);
      textures.setEnabled(true);
      await settle();
      shaderError(gl, `vec3 ${GROUND_SHADER_MARKER};`);
      textures.reportApplied(false);
      expect(states).toEqual(['ktx2:rgba', TEXTURE_FAILED, TEXTURE_FAILED]);
    });

    it('frees a texture whose shader was rejected while it loaded, and applies nothing', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const loaded = texture();
      const disposed = vi.fn();
      loaded.addEventListener('dispose', disposed);
      const gl = renderer();
      // the precompile in the default loader is where a shader error surfaces first
      const textures = startGroundTextures(() => {
        shaderError(gl, `vec3 ${GROUND_SHADER_MARKER};`);
        return Promise.resolve(loaded);
      });
      const apply = vi.fn();
      textures.onLoaded(apply);
      textures.attach(gl);
      textures.setEnabled(true);
      await settle();
      expect(apply).not.toHaveBeenCalled();
      expect(disposed).toHaveBeenCalledOnce();
    });

    it('leaves other programs to the previous handler, or logs them', () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const gl = renderer();
      const textures = startGroundTextures(() => Promise.resolve(texture()));
      const revert = vi.fn();
      textures.onLoaded(() => undefined, revert);
      textures.attach(gl);
      shaderError(gl, 'void main() {}');
      expect(revert).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledOnce();

      const previous = vi.fn();
      const chained = renderer();
      chained.debug.onShaderError = previous;
      startGroundTextures().attach(chained);
      shaderError(chained, 'void main() {}');
      expect(previous).toHaveBeenCalledOnce();
    });
  });

  describe('dispose', () => {
    it('cancels subscribers, frees the texture and restores the shader hook', async () => {
      const loaded = texture();
      const disposed = vi.fn();
      loaded.addEventListener('dispose', disposed);
      const gl = renderer();
      const textures = startGroundTextures(() => Promise.resolve(loaded));
      const apply = vi.fn();
      textures.attach(gl);
      textures.setEnabled(true);
      await settle();
      textures.onLoaded(apply);
      textures.dispose();
      await settle();
      expect(apply).not.toHaveBeenCalled();
      expect(disposed).toHaveBeenCalledOnce();
      expect(gl.debug.onShaderError).toBeNull();
    });

    it('frees a texture that finishes loading after dispose', async () => {
      const loaded = texture();
      const disposed = vi.fn();
      loaded.addEventListener('dispose', disposed);
      let finish: (value: Texture) => void = () => undefined;
      const textures = startGroundTextures(
        () =>
          new Promise<Texture>((resolve) => {
            finish = resolve;
          }),
      );
      const apply = vi.fn();
      textures.onLoaded(apply);
      textures.attach(renderer());
      textures.setEnabled(true);
      textures.dispose();
      finish(loaded);
      await settle();
      expect(apply).not.toHaveBeenCalled();
      expect(disposed).toHaveBeenCalledOnce();
    });
  });
});

describe('transcoderUrls', () => {
  it('maps the two transcoder files to app assets and warns on anything else', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(transcoderUrls('/base/basis_transcoder.js', 'x')).not.toContain('/base/');
    expect(transcoderUrls('/base/basis_transcoder.wasm', 'x')).not.toContain('/base/');
    expect(warn).not.toHaveBeenCalled();
    expect(transcoderUrls('/base/basis_other.wasm', 'x')).toBe('/base/basis_other.wasm');
    expect(warn).toHaveBeenCalledOnce();
  });
});
