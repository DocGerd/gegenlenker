import { Group, type WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import { GraphicsStartError, type ScenePalette } from '../contracts/render';
import { trailerById, truckById } from '../vehicles/registry';
import type { QualityFlags } from './quality';
import { QUALITY_FLAGS } from './quality';
import { createThreeSceneRenderer } from './three-renderer';

const made = vi.hoisted(() => [] as { dispose: () => void }[]);
const fail = vi.hoisted(() => ({ next: false }));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    autoClear = true;
    info = { autoReset: true };
    dispose = vi.fn();
    constructor() {
      if (fail.next) {
        fail.next = false;
        throw new Error('Error creating WebGL context.');
      }
      made.push(this);
    }
    getContext() {
      return { getExtension: () => null };
    }
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
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

function stubParts(onRenderer?: (gl: WebGLRenderer) => void): {
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
      setQuality: (flags: QualityFlags) => void log.push(flags),
      dispose: () => undefined,
      ...extra,
    };
  };
  const create = () =>
    createThreeSceneRenderer({
      ...(onRenderer === undefined ? {} : { onRenderer }),
      truck: () => part({}),
      trailer: () => part({}),
      environment: () => part({}),
      aids: () => ({ object: new Group(), update: () => undefined, dispose: () => undefined }),
    });
  return { applied, renderer: create() };
}

describe('renderer quality', () => {
  it('reaches the scene parts whether set before the scene or after, and ignores a repeat', () => {
    const { applied, renderer } = stubParts();
    renderer.setQuality('low');
    renderer.setScene(layout, truckById('man-le-18-280'), trailerById('krone-azw-18'));
    expect(applied).toHaveLength(3);
    for (const log of applied) expect(log).toEqual([QUALITY_FLAGS.low]);

    renderer.setQuality('high');
    renderer.setQuality('high');
    for (const log of applied) expect(log).toEqual([QUALITY_FLAGS.low, QUALITY_FLAGS.high]);
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
  afterEach(() => {
    vi.clearAllMocks();
    made.length = 0;
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

  it('shrinks a canvas it lets go of, so a restored context there holds no backing store', async () => {
    const { renderer } = stubParts();
    const old = canvas();
    await renderer.init(old);
    await renderer.init(canvas());
    expect([old.width, old.height]).toEqual([0, 0]);
  });
});
