import { DataTexture, type Texture, WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startGroundTextures } from './ground-texture';

const renderer = Object.create(WebGLRenderer.prototype) as WebGLRenderer;
const texture = (): Texture => new DataTexture(new Uint8Array(4), 1, 1);
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.restoreAllMocks());

describe('ground textures', () => {
  it('downloads nothing until a renderer is attached and a preset wants the texture', async () => {
    const load = vi.fn(() => Promise.resolve(texture()));
    const textures = startGroundTextures(load);
    textures.setEnabled(false);
    textures.attach(renderer);
    await settle();
    expect(load).not.toHaveBeenCalled();
    textures.setEnabled(true);
    textures.setEnabled(true);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(renderer);
  });

  it('starts once the renderer arrives after the preset', async () => {
    const load = vi.fn(() => Promise.resolve(texture()));
    const textures = startGroundTextures(load);
    textures.setEnabled(true);
    await settle();
    expect(load).not.toHaveBeenCalled();
    textures.attach(renderer);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('hands the loaded texture to early and late subscribers, but not to a cancelled one', async () => {
    const loaded = texture();
    const textures = startGroundTextures(() => Promise.resolve(loaded));
    const early = vi.fn();
    const cancelled = vi.fn();
    textures.onLoaded(early);
    textures.onLoaded(cancelled)();
    textures.attach(renderer);
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

  it('warns and calls nobody when the load fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const textures = startGroundTextures(() => Promise.reject(new Error('offline')));
    const apply = vi.fn();
    textures.onLoaded(apply);
    textures.attach(renderer);
    textures.setEnabled(true);
    await settle();
    expect(apply).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });
});
