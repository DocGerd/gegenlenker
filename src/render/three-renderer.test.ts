import { Group, RenderTarget } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import { GraphicsStartError, type ScenePalette } from '../contracts/render';
import { trailerById, truckById } from '../vehicles/registry';
import type { GpuOffer } from './gpu-backend';
import type { QualityFlags } from './quality';
import type { Look } from './look';
import { QUALITY_FLAGS } from './quality';
import { createThreeSceneRenderer } from './three-renderer';

type Made = {
  setSize: ReturnType<typeof vi.fn>;
  shadowMap: { enabled: boolean };
  dispose: () => void;
  onDeviceLost: () => void;
  onError: (info: string) => void;
  webgpu: boolean;
};
/** How a start given a device goes wrong: init rejects, three falls back to WebGL by itself, or the device is lost during init or just after it. */
type WebgpuFault = 'reject' | 'self-fallback' | 'lose-in-init' | 'lose-after-init';
const made = vi.hoisted(() => [] as Made[]);
const fail = vi.hoisted(() => ({ next: false, webgpu: null as WebgpuFault | null }));
const threeOnError = vi.hoisted(() => vi.fn());

vi.mock('three/webgpu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three/webgpu')>();
  class FakeWebGPURenderer {
    autoClear = true;
    backend: { isWebGLBackend: boolean };
    info = { autoReset: true };
    xr = { enabled: false };
    shadowMap = { enabled: false };
    onDeviceLost = (): void => undefined;
    onError = threeOnError;
    dispose = vi.fn(() => Promise.resolve());
    readonly webgpu: boolean;
    constructor({ device }: { device?: unknown }) {
      this.webgpu = device !== undefined;
      this.backend = { isWebGLBackend: !this.webgpu || fail.webgpu === 'self-fallback' };
      made.push(this);
    }
    init(): Promise<void> {
      if (this.webgpu && fail.webgpu === 'reject')
        return Promise.reject(new Error('pipeline failed'));
      if (this.webgpu && fail.webgpu === 'lose-in-init') this.onDeviceLost();
      if (this.webgpu && fail.webgpu === 'lose-after-init') {
        // after the start's own await on this promise, before init names the renderer
        const done = Promise.resolve();
        void done.then(() => {
          queueMicrotask(() => {
            this.onDeviceLost();
          });
        });
        return done;
      }
      if (!fail.next) return Promise.resolve();
      fail.next = false;
      return Promise.reject(new Error('Error creating WebGL context.'));
    }
    getContext() {
      return { getExtension: () => null };
    }
    getDrawingBufferSize(out: { set: (x: number, y: number) => void }) {
      out.set(300, 150);
    }
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    setRenderTarget = vi.fn();
    render = vi.fn();
  }
  return { ...actual, WebGPURenderer: FakeWebGPURenderer };
});

vi.mock('./palette', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./palette')>();
  return {
    ...actual,
    readScenePalette: (): ScenePalette =>
      Object.fromEntries(Object.keys(actual.KEYS).map((k) => [k, 0x808080])) as ScenePalette,
  };
});

const layout = resolveLayout(layouts.depot, null);

function stubParts(
  onRenderer?: (gpu: WebGPURenderer) => void,
  gpuDevice?: () => Promise<GpuOffer>,
): {
  applied: QualityFlags[][];
  renderer: ReturnType<typeof create>;
} {
  const applied: QualityFlags[][] = [];
  const part = <T extends object>(extra: T) => {
    const log: QualityFlags[] = [];
    applied.push(log);
    return {
      object: new Group(),
      update: () => undefined,
      setLook: (look: Look) => void log.push(look.flags),
      dispose: () => undefined,
      ...extra,
    };
  };
  const create = () =>
    createThreeSceneRenderer({
      ...(onRenderer === undefined ? {} : { onRenderer }),
      ...(gpuDevice === undefined ? {} : { gpuDevice }),
      truck: () => part({}),
      trailer: () => part({}),
      environment: () => part({}),
      interior: () => part({ frame: 'eye' as const, place: () => undefined }),
      aids: () => ({ object: new Group(), update: () => undefined, dispose: () => undefined }),
    });
  return { applied, renderer: create() };
}

describe('renderer quality', () => {
  it('reaches the scene parts whether set before the scene or after, and ignores a repeat', () => {
    const { applied, renderer } = stubParts();
    renderer.setQuality('low');
    renderer.setScene(layout, truckById('man-le-18-280'), trailerById('krone-azw-18'));
    expect(applied).toHaveLength(4);
    for (const log of applied) expect(log).toEqual([QUALITY_FLAGS.low]);

    renderer.setQuality('high');
    renderer.setQuality('high');
    for (const log of applied) expect(log).toEqual([QUALITY_FLAGS.low, QUALITY_FLAGS.high]);
  });
});

describe('renderer lighting', () => {
  it('reaches the scene parts through the look whether set before the scene or after, and ignores a repeat', () => {
    const looks: Look[] = [];
    const part = () => ({
      object: new Group(),
      update: () => undefined,
      setLook: (look: Look) => void looks.push(look),
      dispose: () => undefined,
    });
    const renderer = createThreeSceneRenderer({
      truck: part,
      trailer: part,
      environment: part,
      interior: () => ({ ...part(), frame: 'eye' as const, place: () => undefined }),
      aids: () => ({ object: new Group(), update: () => undefined, dispose: () => undefined }),
    });
    renderer.setLighting('night');
    renderer.setScene(layout, truckById('man-le-18-280'), trailerById('krone-azw-18'));
    expect(looks.map((l) => l.mode)).toEqual(['night', 'night', 'night', 'night']);

    looks.length = 0;
    renderer.setLighting('night');
    expect(looks).toEqual([]);
    renderer.setLighting('day');
    expect(looks.map((l) => l.mode)).toEqual(['day', 'day', 'day', 'day']);
  });
});

describe('renderer interior', () => {
  it('builds one interior per scene, hangs a truck-frame one on the truck, and disposes it with the scene', () => {
    const interiors: { object: Group; dispose: ReturnType<typeof vi.fn> }[] = [];
    const trucks: Group[] = [];
    const part = () => ({
      object: new Group(),
      update: () => undefined,
      setLook: () => undefined,
      dispose: () => undefined,
    });
    const renderer = createThreeSceneRenderer({
      truck: () => {
        const truck = part();
        trucks.push(truck.object);
        return truck;
      },
      trailer: part,
      environment: part,
      interior: () => {
        const interior = {
          object: new Group(),
          frame: 'truck' as const,
          place: () => undefined,
          setLook: () => undefined,
          dispose: vi.fn(),
        };
        interiors.push(interior);
        return interior;
      },
      aids: () => ({ object: new Group(), update: () => undefined, dispose: () => undefined }),
    });
    const set = () =>
      renderer.setScene(layout, truckById('man-le-18-280'), trailerById('krone-azw-18'));
    set();
    expect(interiors[0]?.object.parent).toBe(trucks[0]);
    set();
    expect(interiors).toHaveLength(2);
    expect(interiors[0]?.dispose).toHaveBeenCalledOnce();
    expect(interiors[1]?.dispose).not.toHaveBeenCalled();
    renderer.dispose();
    expect(interiors[1]?.dispose).toHaveBeenCalledOnce();
  });
});

describe('renderer start', () => {
  const canvas = (): HTMLCanvasElement =>
    ({
      width: 300,
      height: 150,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as HTMLCanvasElement;
  const truck = truckById('man-le-18-280');
  const trailer = trailerById('krone-azw-18');

  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  afterEach(() => {
    vi.clearAllMocks();
    made.length = 0;
    fail.webgpu = null;
  });

  it('hands the renderer to the parts and re-applies the quality only once init resolves', async () => {
    const onRenderer = vi.fn();
    const { applied, renderer } = stubParts(onRenderer);
    renderer.setScene(layout, truck, trailer);
    const started = renderer.init(canvas());
    expect(onRenderer).not.toHaveBeenCalled();
    await started;
    expect(onRenderer).toHaveBeenCalledOnce();
    for (const log of applied) expect(log).toHaveLength(2);
    expect(made[0]?.shadowMap.enabled).toBe(true);
  });

  const superseded = new GraphicsStartError('superseded');

  it('rejects a start that a later init or dispose superseded and drops its renderer', async () => {
    const onRenderer = vi.fn();
    const { renderer } = stubParts(onRenderer);
    const first = renderer.init(canvas());
    const second = renderer.init(canvas());
    await expect(first).rejects.toEqual(superseded);
    await second;
    expect(onRenderer).toHaveBeenCalledOnce();
    expect(onRenderer).toHaveBeenCalledWith(made[1]);
    expect(made[0]?.dispose).toHaveBeenCalledOnce();
    expect(made[1]?.dispose).not.toHaveBeenCalled();

    const late = renderer.init(canvas());
    renderer.dispose();
    await expect(late).rejects.toEqual(superseded);
    expect(onRenderer).toHaveBeenCalledOnce();
    expect(made[1]?.dispose).toHaveBeenCalledOnce();
    expect(made[2]?.dispose).toHaveBeenCalledOnce();
  });

  it('rejects as unavailable when no context can be made', async () => {
    fail.next = true;
    const { renderer } = stubParts();
    const error: unknown = await renderer.init(canvas()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphicsStartError);
    expect(error).toMatchObject({ reason: 'unavailable' });
  });

  it('passes the failure on when the canvas has a WebGL 2 context, so it is no missing API', async () => {
    fail.next = true;
    const { renderer } = stubParts();
    const target = Object.assign(canvas(), { getContext: () => ({}) });
    const error: unknown = await renderer.init(target).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(GraphicsStartError);
    expect(error).toMatchObject({ message: 'Error creating WebGL context.' });
  });

  it('draws into a frame target of its own, sized with the canvas and released with the renderer', async () => {
    const dispose = vi.spyOn(RenderTarget.prototype, 'dispose');
    const { renderer } = stubParts();
    await renderer.init(canvas());
    renderer.resize(150, 75);
    expect(made[0]?.setSize).toHaveBeenCalledWith(150, 75, false);
    expect(dispose).toHaveBeenCalledOnce();
    dispose.mockClear();
    renderer.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    dispose.mockRestore();
  });

  it('shrinks a canvas it lets go of, so a restored context there holds no backing store', async () => {
    const { renderer } = stubParts();
    const old = canvas();
    await renderer.init(old);
    await renderer.init(canvas());
    expect([old.width, old.height]).toEqual([0, 0]);
  });

  describe('backend', () => {
    const adapterInfo = {
      vendor: 'nvidia',
      architecture: 'ada',
      description: '',
      isFallbackAdapter: false,
    } as GPUAdapterInfo;
    const devices = () => {
      const made: { destroy: () => void }[] = [];
      const next = vi.fn(() => {
        const device = { adapterInfo, destroy: vi.fn() };
        made.push(device);
        return Promise.resolve({ device: device as unknown as GPUDevice, fallback: null });
      });
      return { made, next };
    };
    const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    it('draws through the device it is given and names its adapter', async () => {
      const { next } = devices();
      const { renderer } = stubParts(undefined, next);
      await renderer.init(canvas());
      expect(renderer.stats()).toMatchObject({
        backend: 'webgpu',
        webgpuFallback: null,
        glRenderer: 'nvidia ada',
      });
    });

    it.each([
      ['reject', [true, false]],
      ['lose-in-init', [true, false]],
      ['self-fallback', [true]],
    ] as const)(
      'goes on with WebGL 2 when WebGPU does not start (%s), and does not try it again',
      async (fault, starts) => {
        fail.webgpu = fault;
        const warn = quiet();
        const { made: given, next } = devices();
        const { renderer } = stubParts(undefined, next);
        await renderer.init(canvas());
        expect(made.map((m) => m.webgpu)).toEqual(starts);
        expect(renderer.stats()).toMatchObject({ backend: 'webgl2', webgpuFallback: 'failed' });
        await vi.waitFor(() => {
          expect(given[0]?.destroy).toHaveBeenCalled();
        });
        await renderer.init(canvas());
        expect(next).toHaveBeenCalledOnce();
        warn.mockRestore();
      },
    );

    it('drops a device that arrives after a later init or dispose', async () => {
      const { made: given, next } = devices();
      const { renderer } = stubParts(undefined, next);
      const first = renderer.init(canvas());
      renderer.dispose();
      await expect(first).rejects.toEqual(superseded);
      expect(given[0]?.destroy).toHaveBeenCalledOnce();
      expect(made).toEqual([]);
    });

    it('starts again on WebGL 2 after the WebGPU device is lost', async () => {
      const { next } = devices();
      const { renderer } = stubParts(undefined, next);
      const lost = vi.fn();
      renderer.onLost(lost);
      await renderer.init(canvas());
      made[0]?.onDeviceLost();
      expect(lost).toHaveBeenCalledOnce();
      expect(renderer.stats().contextLost).toBe(true);
      await renderer.init(canvas());
      expect(renderer.stats()).toMatchObject({ backend: 'webgl2', webgpuFallback: 'lost' });
      expect(next).toHaveBeenCalledOnce();
    });

    it('counts a WebGPU loss that lands before init names the renderer', async () => {
      fail.webgpu = 'lose-after-init';
      const { next } = devices();
      const { renderer } = stubParts(undefined, next);
      const lost = vi.fn();
      renderer.onLost(lost);
      await renderer.init(canvas());
      expect(lost).toHaveBeenCalledOnce();
      fail.webgpu = null;
      await renderer.init(canvas());
      expect(renderer.stats()).toMatchObject({ backend: 'webgl2', webgpuFallback: 'lost' });
      expect(next).toHaveBeenCalledOnce();
    });

    it('skips WebGPU on the next start after an uncaptured WebGPU error, still logged by three', async () => {
      const { next } = devices();
      const { renderer } = stubParts(undefined, next);
      await renderer.init(canvas());
      made[0]?.onError('validation');
      expect(threeOnError).toHaveBeenCalledWith('validation');
      made[0]?.onDeviceLost();
      await renderer.init(canvas());
      expect(next).toHaveBeenCalledOnce();
    });

    it('asks for WebGPU again after a WebGL 2 loss', async () => {
      const next = vi.fn(() => Promise.resolve<GpuOffer>({ device: null, fallback: null }));
      const { renderer } = stubParts(undefined, next);
      await renderer.init(canvas());
      made[0]?.onDeviceLost();
      await renderer.init(canvas());
      expect(next).toHaveBeenCalledTimes(2);
    });

    it('stays on WebGL 2 when no device is offered, and says why', async () => {
      const { renderer } = stubParts(undefined, () =>
        Promise.resolve({ device: null, fallback: 'unavailable' }),
      );
      await renderer.init(canvas());
      expect(made.map((m) => m.webgpu)).toEqual([false]);
      expect(renderer.stats().webgpuFallback).toBe('unavailable');
    });
  });
});
