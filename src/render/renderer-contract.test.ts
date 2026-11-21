import { Group, type RenderTarget } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import {
  GraphicsStartError,
  type RenderFrame,
  type SceneRenderer,
  type ScenePalette,
} from '../contracts/render';
import { createContactQuery } from '../sim/collision';
import { NO_PREDICTION } from '../sim/predict';
import { createSimulation } from '../sim/simulation';
import { resolveCombination } from '../vehicles/resolve';
import { trailerById, truckById } from '../vehicles/registry';
import { createThreeSceneRenderer } from './three-renderer';
import { computeViewports } from './viewports';

const draws = vi.hoisted(() => ({
  count: 0,
  viewports: [] as number[][],
  /** Per draw into a render target: its viewport and whether the draw cleared in its pass. */
  passes: [] as { viewport: number[]; autoClear: boolean }[],
  clears: 0,
  webgpu: false,
  loseInInit: false,
}));

vi.mock('three/webgpu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three/webgpu')>();
  // Called with `new`; any method not listed is a no-op, and `then` stays absent so a promise
  // does not take the renderer for a thenable. Like three's WebGL 2 backend, it reports a lost
  // context of its canvas through `onDeviceLost` until disposed.
  function FakeWebGPURenderer({ canvas }: { canvas: HTMLCanvasElement }): object {
    let bound: RenderTarget | null = null;
    const own: Record<PropertyKey, unknown> = {
      info: { autoReset: true, reset: () => undefined, render: { drawCalls: 0 } },
      backend: { isWebGLBackend: !draws.webgpu },
      getContext: () => ({ getExtension: () => null }),
      init: () => {
        if (draws.loseInInit) (own['onDeviceLost'] as () => void)();
        return Promise.resolve();
      },
      onDeviceLost: () => undefined,
      setRenderTarget: (target: RenderTarget | null) => {
        bound = target;
      },
      // a render target keeps its own viewport: three ignores the renderer's for it
      autoClear: false,
      clear: () => {
        draws.clears++;
      },
      render: () => {
        draws.count++;
        if (bound === null) return;
        draws.viewports.push(bound.viewport.toArray());
        draws.passes.push({
          viewport: bound.viewport.toArray(),
          autoClear: own['autoClear'] === true,
        });
      },
    };
    const lost = (): void => {
      (own['onDeviceLost'] as () => void)();
    };
    canvas.addEventListener('webglcontextlost', lost);
    own['dispose'] = () => {
      canvas.removeEventListener('webglcontextlost', lost);
      return Promise.resolve();
    };
    return new Proxy(own, {
      get: (target, key) =>
        key in target || key === 'then' ? target[key] : (target[key] = () => undefined),
    });
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

vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
vi.stubGlobal('window', { devicePixelRatio: 1 });

type Harness = {
  readonly create: () => SceneRenderer;
  readonly canvas: () => HTMLCanvasElement;
  /** The GPU API reports `canvas`'s context lost. */
  readonly lose: (canvas: HTMLCanvasElement) => void;
  readonly draws: () => number;
};

const part = () => ({
  object: new Group(),
  update: () => undefined,
  setLook: () => undefined,
  dispose: () => undefined,
});

const interior = () => ({ ...part(), frame: 'eye' as const, place: () => undefined });

const three: Harness = {
  create: () =>
    createThreeSceneRenderer({
      truck: part,
      trailer: part,
      environment: part,
      interior,
      aids: part,
    }),
  canvas: () => {
    const listeners = new Map<string, Set<() => void>>();
    return {
      width: 300,
      height: 150,
      addEventListener: (type: string, fn: () => void) => {
        const set = listeners.get(type) ?? new Set();
        set.add(fn);
        listeners.set(type, set);
      },
      removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
      dispatch: (type: string) => {
        for (const fn of [...(listeners.get(type) ?? [])]) fn();
      },
    } as unknown as HTMLCanvasElement;
  },
  lose: (canvas) => {
    (canvas as unknown as { dispatch: (type: string) => void }).dispatch('webglcontextlost');
  },
  draws: () => draws.count,
};

const truck = truckById('man-le-18-280');
const trailer = trailerById('krone-azw-18');
const layout = resolveLayout(layouts.depot, null);
const frame: RenderFrame = {
  snapshot: createSimulation(
    resolveCombination(truck, trailer),
    { truck: layouts.depot.start },
    createContactQuery(layout.obstacles),
  ).snapshot(),
  views: computeViewports(800, 600, 'replay'),
  topDown: 'yard',
  aids: { pivots: false, path: false, tracks: false, ghost: false },
  predicted: NO_PREDICTION,
};

describe.each([['three', three]] as const)('SceneRenderer contract: %s', (_, h) => {
  async function started(): Promise<{ renderer: SceneRenderer; canvas: HTMLCanvasElement }> {
    const renderer = h.create();
    renderer.setScene(layout, truck, trailer);
    renderer.resize(800, 600);
    const canvas = h.canvas();
    await renderer.init(canvas);
    return { renderer, canvas };
  }

  it('projects nothing before the first render, then a point on screen', async () => {
    const { renderer } = await started();
    expect(renderer.project(0, 0)).toBeNull();
    renderer.render(frame);
    expect(renderer.project(0, 0)).not.toBeNull();
  });

  it('stops drawing on a loss and tells each listener once, until it unsubscribes', async () => {
    const { renderer, canvas } = await started();
    const kept = vi.fn();
    const dropped = vi.fn();
    renderer.onLost(kept);
    const unsubscribe = renderer.onLost(dropped);
    unsubscribe();
    h.lose(canvas);
    h.lose(canvas);
    expect(renderer.stats().contextLost).toBe(true);
    expect(kept).toHaveBeenCalledOnce();
    expect(dropped).not.toHaveBeenCalled();

    const before = h.draws();
    renderer.render(frame);
    renderer.skipFrame();
    expect(h.draws()).toBe(before);
  });

  it('draws the kept scene again once started on a fresh canvas', async () => {
    const { renderer, canvas } = await started();
    const lost = vi.fn();
    renderer.onLost(lost);
    h.lose(canvas);
    const fresh = h.canvas();
    await renderer.init(fresh);
    expect(renderer.stats().contextLost).toBe(false);
    const before = h.draws();
    renderer.render(frame);
    expect(h.draws()).toBeGreaterThan(before);

    h.lose(canvas);
    expect(lost).toHaveBeenCalledOnce();
    h.lose(fresh);
    expect(lost).toHaveBeenCalledTimes(2);
  });

  it('rejects a start that lost its context, and starts afresh on the next canvas', async () => {
    const renderer = h.create();
    const lost = vi.fn();
    renderer.onLost(lost);
    draws.loseInInit = true;
    const error: unknown = await renderer.init(h.canvas()).catch((e: unknown) => e);
    draws.loseInInit = false;
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GraphicsStartError);
    expect(lost).not.toHaveBeenCalled();
    await renderer.init(h.canvas());
    expect(renderer.stats()).toMatchObject({ contextLost: false, backend: 'webgl2' });
  });

  it('draws each pane into the frame target within its CSS rect, origin top left', async () => {
    const { renderer } = await started();
    draws.viewports.length = 0;
    renderer.render(frame);
    const { cockpit, topDown } = frame.views;
    for (const rect of [cockpit, topDown]) {
      if (rect === null) continue;
      expect(draws.viewports).toContainEqual([rect.x, rect.y, rect.width, rect.height]);
    }
  });

  it('can be disposed twice and draws nothing after', async () => {
    const { renderer } = await started();
    renderer.dispose();
    renderer.dispose();
    const before = h.draws();
    renderer.render(frame);
    expect(h.draws()).toBe(before);
  });
});

describe('pane clears', () => {
  const adapterInfo = {
    vendor: 'test',
    architecture: 'test',
    description: '',
    isFallbackAdapter: false,
  };
  async function draw(
    webgpu: boolean,
  ): Promise<{ cockpit: boolean; topDown: boolean; clears: number }> {
    draws.webgpu = webgpu;
    draws.passes.length = 0;
    draws.clears = 0;
    const renderer = createThreeSceneRenderer({
      truck: part,
      trailer: part,
      environment: part,
      interior,
      aids: part,
      gpuDevice: () =>
        Promise.resolve({
          device: webgpu
            ? ({ adapterInfo, destroy: () => undefined } as unknown as GPUDevice)
            : null,
          fallback: null,
        }),
    });
    renderer.setScene(layout, truck, trailer);
    renderer.resize(800, 600);
    await renderer.init(three.canvas());
    expect(renderer.stats().backend).toBe(webgpu ? 'webgpu' : 'webgl2');
    const driving = {
      ...frame,
      views: {
        cockpit: { x: 0, y: 200, width: 800, height: 400 },
        mirrorLeft: null,
        mirrorRight: null,
        front: null,
        topDown: { x: 0, y: 0, width: 800, height: 200 },
      },
    };
    renderer.render(driving);
    renderer.dispose();
    draws.webgpu = false;
    const { cockpit, topDown } = driving.views;
    const clearedIn = (rect: { x: number; y: number; width: number; height: number } | null) =>
      draws.passes.find(
        (p) =>
          rect !== null && p.viewport.join() === [rect.x, rect.y, rect.width, rect.height].join(),
      )?.autoClear;
    return {
      cockpit: clearedIn(cockpit) === true,
      topDown: clearedIn(topDown) === true,
      clears: draws.clears,
    };
  }

  it('clears each pane inside its own pass on WebGL 2, where the scissor keeps it to the pane', async () => {
    expect(await draw(false)).toEqual({ cockpit: true, topDown: true, clears: 0 });
  });

  it('clears the whole target once on WebGPU, whose in-pass clear ignores the scissor and would wipe the panes drawn before', async () => {
    expect(await draw(true)).toEqual({ cockpit: false, topDown: false, clears: 1 });
  });
});
