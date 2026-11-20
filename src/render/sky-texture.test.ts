import { DataTexture, type Texture } from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { startSkyTexture } from './sky-texture';

const renderer = (): WebGPURenderer =>
  Object.assign(Object.create(WebGPURenderer.prototype) as WebGPURenderer, {
    debug: { onShaderError: null },
  });
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('sky texture state', () => {
  it('maps a drawn texture to on', async () => {
    const states: (string | null)[] = [];
    const sky = startSkyTexture(
      () => Promise.resolve(new DataTexture(new Uint8Array(4), 1, 1)),
      (state) => states.push(state),
    );
    sky.onLoaded(() => {
      sky.reportApplied(true);
    });
    sky.attach(renderer());
    sky.setEnabled(true);
    await settle();
    sky.reportApplied(false);
    expect(states).toEqual(['on', null]);
  });

  it('reports failed once the load is given up on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const states: (string | null)[] = [];
    const sky = startSkyTexture(
      () => Promise.reject<Texture>(new Error('offline')),
      (state) => states.push(state),
    );
    sky.attach(renderer());
    sky.setEnabled(true);
    await settle();
    sky.setEnabled(true);
    await settle();
    expect(states).toEqual(['failed']);
  });
});
