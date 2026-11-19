import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('reads the query and falls back to WebGL 2, warning once per unknown value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readBackendRequest('?backend=webgpu')).toBe('webgpu');
    expect(readBackendRequest('?perf=1&backend=auto')).toBe('auto');
    expect(readBackendRequest('')).toBe('webgl2');
    expect(warn).not.toHaveBeenCalled();
    expect(readBackendRequest('?backend=vulkan')).toBe('webgl2');
    expect(readBackendRequest('?backend=vulkan')).toBe('webgl2');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('WebGPU device', () => {
  const quiet = () => ({
    info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for no adapter on WebGL 2', async () => {
    const { gpu: g } = gpu(core);
    expect(await requestGpuDevice('webgl2', g)).toEqual({ device: null, fallback: null });
    expect(g.requestAdapter).not.toHaveBeenCalled();
  });

  it('takes a core hardware adapter on auto, with every feature so the device is core too', async () => {
    const { gpu: g, device, requestDevice } = gpu(core);
    expect(await requestGpuDevice('auto', g)).toEqual({ device, fallback: null });
    expect(g.requestAdapter).toHaveBeenCalledWith({
      featureLevel: 'compatibility',
      powerPreference: 'high-performance',
    });
    expect(requestDevice).toHaveBeenCalledWith({ requiredFeatures: core.features });
  });

  it('leaves software and compatibility-mode adapters to WebGL 2 on auto, but not when asked for', async () => {
    const { info: log } = quiet();
    const software = { ...core, info: info({ isFallbackAdapter: true }) };
    const compat = { features: ['texture-compression-bc'], info: info() };
    for (const adapter of [software, compat]) {
      expect(await requestGpuDevice('auto', gpu(adapter).gpu)).toEqual({
        device: null,
        fallback: null,
      });
      expect((await requestGpuDevice('webgpu', gpu(adapter).gpu)).device).not.toBeNull();
    }
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('says why there is no device: a choice on auto, a fallback when WebGPU was asked for', async () => {
    const { info: log } = quiet();
    for (const g of [undefined, gpu(null).gpu]) {
      expect(await requestGpuDevice('auto', g)).toEqual({ device: null, fallback: null });
      expect(await requestGpuDevice('webgpu', g)).toEqual({
        device: null,
        fallback: 'unavailable',
      });
    }
    expect(log).toHaveBeenCalledTimes(4);
  });

  it('counts a rejected adapter or device as failed', async () => {
    const { warn } = quiet();
    const device = gpu(core);
    device.requestDevice.mockRejectedValue(new Error('lost'));
    const adapter = gpu(core);
    adapter.gpu.requestAdapter.mockRejectedValue(new Error('blocked'));
    for (const g of [device.gpu, adapter.gpu]) {
      expect(await requestGpuDevice('auto', g)).toEqual({ device: null, fallback: 'failed' });
    }
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('names the adapter and flags a fallback one', () => {
    expect(describeAdapter(info({ description: 'd' }))).toBe('v a d');
    expect(describeAdapter(info({ vendor: '', architecture: '', isFallbackAdapter: true }))).toBe(
      'unknown (fallback)',
    );
  });
});
