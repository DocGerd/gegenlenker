import { WebGPURenderer } from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { gpuLost, markLost } from './seams';

// A canvas that gave out a `webgpu` context refuses `webgl2`, so the WebGL 2 retry after a failed
// WebGPU start in three-renderer.ts is sound only while three takes that context lazily.
describe('three WebGPU start', () => {
  it('takes no canvas context until the first frame, and neither does the loss check', async () => {
    const getContext = vi.fn(() => null);
    const canvas = {
      width: 300,
      height: 150,
      style: {},
      getContext,
      setAttribute: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const device = {
      features: new Set<string>(),
      limits: {},
      lost: new Promise(() => undefined),
      destroy: vi.fn(),
    } as unknown as GPUDevice;
    const gpu = new WebGPURenderer({ canvas, device });
    await gpu.init();
    expect(gpu.backend).toMatchObject({ isWebGPUBackend: true });
    expect(gpuLost(gpu)).toBe(false);
    expect(getContext).not.toHaveBeenCalled();
    markLost(gpu);
    expect(gpuLost(gpu)).toBe(true);

    expect(() => gpu.getContext()).toThrow();
    expect(getContext).toHaveBeenCalledWith('webgpu');
  });
});
