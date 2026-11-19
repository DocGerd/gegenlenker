import { describe, expect, it, vi } from 'vitest';
import { describeAdapter, readBackendRequest, requestGpuDevice } from './gpu-backend';

const info = (over: Partial<GPUAdapterInfo> = {}): GPUAdapterInfo =>
  ({
    vendor: 'v',
    architecture: 'a',
    description: '',
    isFallbackAdapter: false,
    ...over,
  }) as GPUAdapterInfo;

function gpu(adapter: { features: string[]; info: GPUAdapterInfo } | null) {
  const device = {} as GPUDevice;
  const requestDevice = vi.fn(() => Promise.resolve(device));
  const requestAdapter = vi.fn(() =>
    Promise.resolve(
      adapter === null
        ? null
        : {
            features: new Set(adapter.features) as unknown as GPUSupportedFeatures,
            info: adapter.info,
            requestDevice,
          },
    ),
  );
  return { gpu: { requestAdapter }, device, requestDevice };
}

const core = { features: ['core-features-and-limits', 'texture-compression-bc'], info: info() };

describe('backend request', () => {
  it('reads the query and falls back to WebGL 2', () => {
    expect(readBackendRequest('?backend=webgpu')).toBe('webgpu');
    expect(readBackendRequest('?perf=1&backend=auto')).toBe('auto');
    expect(readBackendRequest('?backend=vulkan')).toBe('webgl2');
    expect(readBackendRequest('')).toBe('webgl2');
  });
});

describe('WebGPU device', () => {
  it('asks for no adapter on WebGL 2', async () => {
    const { gpu: g } = gpu(core);
    expect(await requestGpuDevice('webgl2', g)).toBeNull();
    expect(g.requestAdapter).not.toHaveBeenCalled();
  });

  it('takes a core hardware adapter on auto, with every feature so the device is core too', async () => {
    const { gpu: g, device, requestDevice } = gpu(core);
    expect(await requestGpuDevice('auto', g)).toBe(device);
    expect(requestDevice).toHaveBeenCalledWith({ requiredFeatures: core.features });
  });

  it('leaves software and compatibility-mode adapters to WebGL 2 on auto, but not when asked for', async () => {
    const software = { ...core, info: info({ isFallbackAdapter: true }) };
    const compat = { features: ['texture-compression-bc'], info: info() };
    for (const adapter of [software, compat]) {
      expect(await requestGpuDevice('auto', gpu(adapter).gpu)).toBeNull();
      expect(await requestGpuDevice('webgpu', gpu(adapter).gpu)).not.toBeNull();
    }
  });

  it('gives null without WebGPU or when the device fails', async () => {
    expect(await requestGpuDevice('webgpu', undefined)).toBeNull();
    expect(await requestGpuDevice('webgpu', gpu(null).gpu)).toBeNull();
    const failing = gpu(core);
    failing.requestDevice.mockRejectedValue(new Error('lost'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await requestGpuDevice('webgpu', failing.gpu)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('names the adapter and flags a fallback one', () => {
    expect(describeAdapter(info({ description: 'd' }))).toBe('v a d');
    expect(describeAdapter(info({ vendor: '', architecture: '', isFallbackAdapter: true }))).toBe(
      'unknown (fallback)',
    );
  });
});
