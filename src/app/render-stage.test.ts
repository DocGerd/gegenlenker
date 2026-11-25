import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Pending = { resolve: () => void; reject: (error: unknown) => void };

const fake = vi.hoisted(() => ({
  created: 0,
  disposed: 0,
  inits: [] as Pending[],
  lost: new Set<() => void>(),
  lighting: [] as string[],
}));

vi.mock('../render', () => ({
  createSceneRenderer: () => {
    fake.created++;
    return {
      init: () =>
        new Promise<void>((resolve, reject) => {
          fake.inits.push({ resolve, reject });
        }),
      onLost: (listener: () => void) => {
        fake.lost.add(listener);
        return () => fake.lost.delete(listener);
      },
      setQuality: () => undefined,
      setLighting: (mode: string) => void fake.lighting.push(mode),
      resize: () => undefined,
      dispose: () => {
        fake.disposed++;
        fake.lost.clear();
      },
    };
  },
}));
vi.mock('./settings', () => ({ currentSettings: () => ({ graphics: 'low', lighting: 'day' }) }));
const showNotice = vi.hoisted(() =>
  vi.fn((_parent: unknown, key: string) => ({ key, remove: () => undefined })),
);
vi.mock('./notice', () => ({ showNotice }));

const doc = {
  documentElement: { dataset: {} as Record<string, string> },
  visibilityState: 'visible' as DocumentVisibilityState,
  listeners: new Set<{ type: string; fn: () => void }>(),
  createElement: () => element(),
  addEventListener(type: string, fn: () => void, options?: { signal?: AbortSignal }) {
    const entry = { type, fn };
    this.listeners.add(entry);
    options?.signal?.addEventListener('abort', () => this.listeners.delete(entry));
  },
  removeEventListener(type: string, fn: () => void) {
    for (const entry of this.listeners) {
      if (entry.type === type && entry.fn === fn) this.listeners.delete(entry);
    }
  },
  show() {
    this.visibilityState = 'visible';
    for (const entry of [...this.listeners]) if (entry.type === 'visibilitychange') entry.fn();
  },
};
let now = 0;

function element(): HTMLElement {
  const noop = (): void => undefined;
  return {
    className: '',
    clientWidth: 0,
    clientHeight: 0,
    append: noop,
    replaceChildren: noop,
    remove: noop,
  } as unknown as HTMLElement;
}

vi.stubGlobal('document', doc);
vi.stubGlobal('window', { addEventListener: () => undefined });
vi.stubGlobal('performance', { now: () => now });
const scheduled: FrameRequestCallback[] = [];
vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  scheduled.push(callback);
  return scheduled.length;
});
const cancelled: number[] = [];
vi.stubGlobal('cancelAnimationFrame', (id: number) => void cancelled.push(id));
vi.stubGlobal('location', { reload: () => undefined });
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = (): void => undefined;
    disconnect = (): void => undefined;
  },
);

/** From the same module instance as the stage under test, which `vi.resetModules` renews. */
async function startError(reason: 'unavailable' | 'superseded'): Promise<Error> {
  const { GraphicsStartError } = await import('../contracts/render');
  return new GraphicsStartError(reason);
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const notices = (): string[] => showNotice.mock.calls.map(([, key]) => key);

async function mount() {
  const { mountRenderStage } = await import('./render-stage');
  const hooks = { resized: vi.fn(), frame: vi.fn(), restored: vi.fn(), halted: vi.fn() };
  const stage = mountRenderStage(element(), element(), () => undefined, 'night');
  stage.start(hooks);
  return { stage, hooks };
}

/** Resolves the newest init and lets every handler run. */
async function startLatest(): Promise<void> {
  fake.inits.at(-1)?.resolve();
  await flush();
}

async function lose(): Promise<void> {
  for (const listener of [...fake.lost]) listener();
  await flush();
}

describe('render stage recovery', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    Object.assign(fake, { created: 0, disposed: 0, inits: [], lighting: [] });
    fake.lost.clear();
    doc.visibilityState = 'visible';
    doc.listeners.clear();
    now = 0;
    scheduled.length = 0;
    cancelled.length = 0;
    showNotice.mockClear();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws in the lighting it is given, not the stored one, and marks it', async () => {
    const { stage } = await mount();
    expect(fake.lighting).toEqual(['night']);
    expect(stage.lighting).toBe('night');
    expect(doc.documentElement.dataset['renderLighting']).toBe('night');
  });

  it('starts afresh after three losses within a minute and asks for a reload on the fourth', async () => {
    const { hooks } = await mount();
    await startLatest();
    for (let i = 0; i < 3; i++) {
      now += 10_000;
      await lose();
      expect(fake.inits).toHaveLength(i + 2);
      await startLatest();
    }
    expect(hooks.restored).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(3);

    now += 10_000;
    await lose();
    expect(fake.inits).toHaveLength(4);
    expect(notices()).toEqual(['contextLost']);
    expect(hooks.halted).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith('Graphics could not start', expect.any(Error));
  });

  it('counts afresh after a minute without a loss', async () => {
    await mount();
    await startLatest();
    for (const gap of [0, 10_000, 10_000, 61_000]) {
      now += gap;
      await lose();
      await startLatest();
    }
    expect(fake.inits).toHaveLength(5);
    expect(notices()).toEqual([]);
  });

  it('waits for a hidden page to be shown, and does not count its losses', async () => {
    await mount();
    await startLatest();
    for (let i = 0; i < 3; i++) {
      await lose();
      await startLatest();
    }
    doc.visibilityState = 'hidden';
    await lose();
    expect(fake.inits).toHaveLength(4);
    doc.show();
    await flush();
    expect(fake.inits).toHaveLength(5);
    expect(notices()).toEqual([]);
    expect(warn).toHaveBeenLastCalledWith('Graphics context lost while hidden; starting afresh');
  });

  it('shows noWebgl and forgets the renderer when no context can be made', async () => {
    const { hooks } = await mount();
    fake.inits[0]?.reject(await startError('unavailable'));
    await flush();
    expect(notices()).toEqual(['noWebgl']);
    expect(hooks.halted).toHaveBeenCalledOnce();
    expect(fake.disposed).toBe(1);
    await mount();
    expect(fake.created).toBe(2);
  });

  it('logs any other start failure and offers a reload', async () => {
    await mount();
    const boom = new Error('boom');
    fake.inits[0]?.reject(boom);
    await flush();
    expect(notices()).toEqual(['graphicsFailed']);
    expect(error).toHaveBeenCalledWith('Graphics could not start', boom);
  });

  it('neither logs nor halts for a superseded start', async () => {
    const { hooks } = await mount();
    fake.inits[0]?.reject(await startError('superseded'));
    await flush();
    expect(notices()).toEqual([]);
    expect(hooks.halted).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('halts a stage started after its notice', async () => {
    const { mountRenderStage } = await import('./render-stage');
    const stage = mountRenderStage(element(), element(), () => undefined, 'night');
    fake.inits[0]?.reject(await startError('unavailable'));
    await flush();
    const halted = vi.fn();
    stage.start({ resized: vi.fn(), frame: vi.fn(), restored: vi.fn(), halted });
    expect(halted).toHaveBeenCalledOnce();
  });

  it('treats a renderer that started with no stage mounted as started', async () => {
    const { stage } = await mount();
    stage.dispose();
    await startLatest();
    await lose();
    fake.inits[1]?.reject(new Error('no context this time'));
    await flush();
    await mount();
    await flush();
    expect(notices()).toEqual(['contextLost']);
    expect(fake.disposed).toBe(0);
  });

  it('stops after one throwing frame, logs it and shows the run notice', async () => {
    const { hooks } = await mount();
    const boom = new Error('boom');
    hooks.frame.mockImplementation(() => {
      throw boom;
    });
    await startLatest();
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.(16);
    expect(scheduled).toHaveLength(2);
    expect(cancelled.at(-1)).toBe(2);
    expect(hooks.frame).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith('Frame failed', boom);
    expect(notices()).toEqual(['runFailed']);
    expect(hooks.halted).toHaveBeenCalledOnce();
    doc.show();
    expect(scheduled).toHaveLength(2);
  });

  it('rethrows a frame that left the screen before it threw, for the screen-level notice', async () => {
    const { stage, hooks } = await mount();
    const boom = new Error('boom');
    hooks.frame.mockImplementation(() => {
      stage.dispose();
      throw boom;
    });
    await startLatest();
    expect(() => scheduled[0]?.(16)).toThrow(boom);
    expect(notices()).toEqual([]);
    expect(hooks.halted).not.toHaveBeenCalled();
  });
});
