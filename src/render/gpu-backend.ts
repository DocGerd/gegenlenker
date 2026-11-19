import type { GraphicsBackend, WebgpuFallback } from '../contracts/render';

/**
 * Which GPU API to try: `auto` takes WebGPU on a hardware adapter with core features, `webgpu` on
 * any adapter (tests, tablet checks); either falls back to WebGL 2.
 */
export type BackendRequest = 'auto' | GraphicsBackend;

/** WebGL 2 until WebGPU passes the gate in docs/perf.md; `?backend=auto|webgpu` opts in. */
export const DEFAULT_BACKEND_REQUEST: BackendRequest = 'webgl2';

const REQUESTS: readonly BackendRequest[] = ['auto', 'webgpu', 'webgl2'];
const warned = new Set<string>();

/** `?backend=webgl2|webgpu|auto`; anything else gives the default, with a warning once per value. */
export function readBackendRequest(search: string): BackendRequest {
  const value = new URLSearchParams(search).get('backend');
  const request = REQUESTS.find((r) => r === value);
  if (request !== undefined) return request;
  if (value !== null && !warned.has(value)) {
    warned.add(value);
    console.warn(`Unknown ?backend=${value}; expected ${REQUESTS.join(', ')}`);
  }
  return DEFAULT_BACKEND_REQUEST;
}

type AdapterLike = Pick<GPUAdapter, 'features' | 'info' | 'requestDevice'>;
type GpuLike = { requestAdapter(options?: object): Promise<AdapterLike | null> };

/** A device for the WebGPU backend, or none, with why when WebGPU was asked for but is not there. */
export type GpuOffer =
  | { readonly device: GPUDevice; readonly fallback: null }
  | { readonly device: null; readonly fallback: WebgpuFallback | null };

/** Software and compatibility-mode adapters (no canvas MSAA) draw better through WebGL 2. */
export const adapterQualifies = (adapter: Pick<GPUAdapter, 'features' | 'info'>): boolean =>
  !adapter.info.isFallbackAdapter && adapter.features.has('core-features-and-limits');

/** `auto` treats a missing WebGPU as a choice, `webgpu` as a fallback. */
function without(request: BackendRequest, reason: string): GpuOffer {
  console.info(`WebGPU not used (${reason}); drawing with WebGL 2`);
  return { device: null, fallback: request === 'webgpu' ? 'unavailable' : null };
}

/**
 * Asks as three would (compatibility level), but with every adapter feature so a core adapter
 * gives a core device; never throws.
 */
export async function requestGpuDevice(
  request: BackendRequest,
  gpu: GpuLike | undefined = (navigator as { gpu?: GpuLike }).gpu,
): Promise<GpuOffer> {
  if (request === 'webgl2') return { device: null, fallback: null };
  if (gpu === undefined) return without(request, 'no navigator.gpu');
  try {
    const adapter = await gpu.requestAdapter({
      featureLevel: 'compatibility',
      powerPreference: 'high-performance',
    });
    if (adapter === null) return without(request, 'no adapter');
    if (request === 'auto' && !adapterQualifies(adapter)) {
      return without(request, `adapter ${describeAdapter(adapter.info)} does not qualify`);
    }
    const device = await adapter.requestDevice({
      requiredFeatures: [...adapter.features] as GPUFeatureName[],
    });
    return { device, fallback: null };
  } catch (error) {
    console.warn('WebGPU is unavailable; drawing with WebGL 2', error);
    return { device: null, fallback: 'failed' };
  }
}

/** Adapter name for the perf overlay; a fallback adapter says so. */
export function describeAdapter(info: GPUAdapterInfo): string {
  const name = [info.vendor, info.architecture, info.description].filter((s) => s !== '').join(' ');
  return `${name === '' ? 'unknown' : name}${info.isFallbackAdapter ? ' (fallback)' : ''}`;
}
