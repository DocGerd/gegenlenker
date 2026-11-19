import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  warmUp: vi.fn(),
  syncAttach: false,
  ground: null as ((state: string | null) => void) | null,
  pbr: null as ((state: 'on' | 'failed' | null) => void) | null,
}));

vi.mock('./glb-shells', () => ({
  CAB_SHELL_URLS: {},
  BODY_SHELL_URLS: {},
  TRAILER_SHELL_URLS: {},
  fetchTrailerShell: vi.fn(),
  startShells: (_urls: unknown, options: { onAttached: (key: string, on: boolean) => void }) => {
    if (mocks.syncAttach) options.onAttached('cab', true);
    return { setEnabled: vi.fn() };
  },
}));
vi.mock('./ground-texture', () => ({
  startGroundTextures: (_load: unknown, onApplied: (state: string | null) => void) => {
    mocks.ground = onApplied;
    if (mocks.syncAttach) onApplied('ktx2');
    return { attach: vi.fn(), setEnabled: vi.fn(), dispose: vi.fn() };
  },
}));
vi.mock('./vehicle-pbr', () => ({
  createVehicleEnvironment: (onState: (state: 'on' | 'failed' | null) => void) => {
    mocks.pbr = onState;
    if (mocks.syncAttach) onState('on');
    return { attach: vi.fn(), invalidate: vi.fn(), dispose: vi.fn() };
  },
}));
vi.mock('./three-renderer', () => ({
  createThreeSceneRenderer: () => ({
    warmUp: mocks.warmUp,
    onLost: vi.fn(),
    setQuality: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock('./aids', () => ({ proceduralAids: vi.fn() }));
vi.mock('./environment', () => ({ proceduralEnvironment: vi.fn() }));
vi.mock('./vehicle-visual', () => ({ proceduralTruck: vi.fn(), proceduralTrailer: vi.fn() }));

const { createSceneRenderer } = await import('./index');

describe('scene renderer attach hooks', () => {
  beforeEach(() => {
    mocks.warmUp.mockClear();
    mocks.syncAttach = false;
    vi.stubGlobal('document', { documentElement: { dataset: {} } });
  });

  it('survives attach callbacks that fire before the renderer exists, and still warms up', () => {
    mocks.syncAttach = true;
    expect(() => createSceneRenderer()).not.toThrow();
    expect(mocks.warmUp).toHaveBeenCalled();
  });

  it('does not expose the warm-up hook', () => {
    expect('warmUp' in createSceneRenderer()).toBe(false);
  });

  it('warms up once per new ground state, not on repeats or removal', () => {
    createSceneRenderer();
    mocks.ground?.('ktx2');
    mocks.ground?.('ktx2');
    expect(mocks.warmUp).toHaveBeenCalledTimes(1);
    mocks.ground?.(null);
    mocks.ground?.('ktx2');
    expect(mocks.warmUp).toHaveBeenCalledTimes(2);
  });

  it('does not warm up for a failed vehicle environment', () => {
    createSceneRenderer();
    mocks.pbr?.('failed');
    expect(mocks.warmUp).not.toHaveBeenCalled();
    mocks.pbr?.('on');
    mocks.pbr?.('on');
    expect(mocks.warmUp).toHaveBeenCalledTimes(1);
  });
});
