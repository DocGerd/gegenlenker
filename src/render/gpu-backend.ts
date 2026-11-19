import type { GraphicsBackend } from '../contracts/render';

/**
 * Which GPU API to try: `auto` takes WebGPU on a hardware adapter with core features, `webgpu` on
 * any adapter (tests, tablet checks); either falls back to WebGL 2.
 */
export type BackendRequest = 'auto' | GraphicsBackend;

/** WebGL 2 until WebGPU passes the gate in docs/perf.md; `?backend=auto|webgpu` opts in. */
export const DEFAULT_BACKEND_REQUEST: BackendRequest = 'webgl2';

const REQUESTS: readonly BackendRequest[] = ['auto', 'webgpu', 'webgl2'];

/** `?backend=webgl2|webgpu|auto`; anything else gives the default. */
export function readBackendRequest(search: string): BackendRequest {
  const value = new URLSearchParams(search).get('backend');
  return REQUESTS.find((r) => r === value) ?? DEFAULT_BACKEND_REQUEST;
}

type AdapterLike = Pick<GPUAdapter, 'features' | 'info' | 'requestDevice'>;
type GpuLike = { requestAdapter(options?: object): Promise<AdapterLike | null> };

/** Software and compatibility-mode adapters (no canvas MSAA) draw better through WebGL 2. */
export const adapterQualifies = (adapter: Pick<GPUAdapter, 'features' | 'info'>): boolean =>
  !adapter.info.isFallbackAdapter && adapter.features.has('core-features-and-limits');

/**
 * A device for the WebGPU backend, or null for WebGL 2. Asks as three would (compatibility level),
 * but with every adapter feature so a core adapter gives a core device; never throws.
 */
export async function requestGpuDevice(
  request: BackendRequest,
  gpu: GpuLike | undefined = (navigator as { gpu?: GpuLike }).gpu,
): Promise<GPUDevice | null> {
  if (request === 'webgl2' || gpu === undefined) return null;
  try {
    const adapter = await gpu.requestAdapter({
      featureLevel: 'compatibility',
      powerPreference: 'high-performance',
    });
    if (adapter === null || (request === 'auto' && !adapterQualifies(adapter))) return null;
    return await adapter.requestDevice({
      requiredFeatures: [...adapter.features] as GPUFeatureName[],
    });
  } catch (error) {
    console.warn('WebGPU is unavailable; drawing with WebGL 2', error);
    return null;
  }
}

/** Adapter name for the perf overlay; a fallback adapter says so. */
export function describeAdapter(info: GPUAdapterInfo): string {
  const name = [info.vendor, info.architecture, info.description].filter((s) => s !== '').join(' ');
  return `${name === '' ? 'unknown' : name}${info.isFallbackAdapter ? ' (fallback)' : ''}`;
}
