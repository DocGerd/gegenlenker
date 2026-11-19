import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probe = async () => (await import('./graphics-check')).probeGraphics;

describe('graphics probe without WebGL 2', () => {
  const destroy = vi.fn();
  const requestAdapter = vi.fn(() =>
    Promise.resolve({
      features: new Set(['core-features-and-limits']),
      info: { isFallbackAdapter: false },
      requestDevice: () => Promise.resolve({ destroy }),
    }),
  );
  const stub = (search: string, gpu: unknown) => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    vi.stubGlobal('location', { search });
    vi.stubGlobal('navigator', { gpu });
  };
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    destroy.mockClear();
    requestAdapter.mockClear();
  });

  it('asks for no adapter by default', async () => {
    stub('', { requestAdapter });
    expect(await (await probe())()).toBeNull();
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it('runs on an opted-in WebGPU, releasing the probe device', async () => {
    stub('?backend=webgpu', { requestAdapter });
    expect(await (await probe())()).toBe('webgpu');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('does not keep a miss, so a later try can still find WebGPU', async () => {
    stub('?backend=webgpu', undefined);
    const probeGraphics = await probe();
    expect(await probeGraphics()).toBeNull();
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    expect(await probeGraphics()).toBe('webgpu');
  });
});
