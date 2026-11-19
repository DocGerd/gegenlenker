import { DataTexture, RGBA_BPTC_Format, type Texture } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  describeGroundTexture,
  loadGroundTexture,
  precompileGround,
  startGroundTextures,
  transcoderUrls,
} from './ground-texture';
import { GROUND_SHADER_MARKER } from './ground-texture-spec';

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

afterEach(() => vi.restoreAllMocks());

const loaderTexture = vi.hoisted(() => ({ next: null as Texture | null }));
vi.mock('three/addons/loaders/KTX2Loader.js', () => ({
  KTX2Loader: class {
    setTranscoderPath() {
      return this;
    }
    detectSupport() {
      return this;
    }
    loadAsync() {
      return Promise.resolve(loaderTexture.next);
    }
    dispose() {
      return undefined;
    }
  },
}));

/** A renderer whose ground build yields `fragment`, on a context that is `lost` or not. */
const building = (fragment: string | null, lost = false): WebGPURenderer =>
  Object.assign(renderer(), {
    debug: {
      onShaderError: null,
      getShaderAsync: () => Promise.resolve({ fragmentShader: fragment }),
    },
    getContext: () => ({ isContextLost: () => lost }),
  });
const marked = `vec3 ${GROUND_SHADER_MARKER};`;

describe('ground precompile', () => {
  it('passes a build that carries the marker', async () => {
    await expect(precompileGround(building(marked), texture())).resolves.toBeUndefined();
  });

  it.each([
    ['three swapped in a plain material', building('void main() {}')],
    ['the context is lost', building(marked, true)],
  ])('rejects when %s', async (_, gl) => {
    await expect(precompileGround(gl, texture())).rejects.toThrow();
  });

  it('frees the loaded texture and rethrows when the precompile fails', async () => {
    const loaded = texture();
    const disposed = vi.fn();
    loaded.addEventListener('dispose', disposed);
    loaderTexture.next = loaded;
    await expect(loadGroundTexture(building(null))).rejects.toThrow();
    expect(disposed).toHaveBeenCalledOnce();
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
    expect(early).toHaveBeenCalledWith(loaded);
    expect(cancelled).not.toHaveBeenCalled();
    const late = vi.fn();
    textures.onLoaded(late);
    expect(late).not.toHaveBeenCalled();
    await settle();
    expect(late).toHaveBeenCalledWith(loaded);
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
    expect(apply).toHaveBeenCalledWith(loaded);
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
    expect(describeGroundTexture(texture())).toBe('ktx2:rgba');
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
    expect(transcoderUrls('/base/basis_transcoder.js')).not.toContain('/base/');
    expect(transcoderUrls('/base/basis_transcoder.wasm')).not.toContain('/base/');
    expect(warn).not.toHaveBeenCalled();
    expect(transcoderUrls('/base/basis_other.wasm')).toBe('/base/basis_other.wasm');
    expect(warn).toHaveBeenCalledOnce();
  });
});
