import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  warmUp: vi.fn(),
  syncAttach: false,
  ground: null as ((state: string | null) => void) | null,
  pbr: null as ((state: 'on' | 'failed' | null) => void) | null,
  sky: null as ((state: string | null) => void) | null,
  grade: null as ((state: 'on' | 'failed' | null) => void) | null,
  skyAttach: vi.fn(),
  skySetEnabled: vi.fn(),
  skyOnLoaded: vi.fn(),
  groundAttach: vi.fn(),
  pbrAttach: vi.fn(),
  setSky: vi.fn(),
  setQuality: vi.fn(),
  onRenderer: null as ((gpu: unknown) => void) | null,
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
    return { attach: mocks.groundAttach, setEnabled: vi.fn(), dispose: vi.fn() };
  },
}));
vi.mock('./sky-texture', () => ({
  startSkyTexture: (_load: unknown, onApplied: (state: string | null) => void) => {
    mocks.sky = onApplied;
    return {
      attach: mocks.skyAttach,
      setEnabled: mocks.skySetEnabled,
      onLoaded: mocks.skyOnLoaded,
      dispose: vi.fn(),
    };
  },
}));
vi.mock('./vehicle-pbr', () => ({
  createVehicleEnvironment: (onState: (state: 'on' | 'failed' | null) => void) => {
    mocks.pbr = onState;
    if (mocks.syncAttach) onState('on');
    return {
      attach: mocks.pbrAttach,
      setSky: mocks.setSky,
      invalidate: vi.fn(),
      dispose: vi.fn(),
    };
  },
}));
vi.mock('./three-renderer', () => ({
  createThreeSceneRenderer: (options: { onRenderer: (gpu: unknown) => void }) => {
    mocks.onRenderer = options.onRenderer;
    return {
      warmUp: mocks.warmUp,
      onLost: vi.fn(),
      setQuality: mocks.setQuality,
      dispose: vi.fn(),
    };
  },
}));
vi.mock('./grade', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./grade')>()),
  createGradeCheck: (onState: (state: 'on' | 'failed' | null) => void) => {
    mocks.grade = onState;
    return { attach: vi.fn(), setWanted: vi.fn(), dispose: vi.fn() };
  },
}));
vi.mock('./aids', () => ({ proceduralAids: vi.fn() }));
vi.mock('./environment', () => ({ proceduralEnvironment: vi.fn() }));
vi.mock('./vehicle-visual', () => ({ proceduralTruck: vi.fn(), proceduralTrailer: vi.fn() }));

const { createSceneRenderer } = await import('./index');
const { QUALITY_FLAGS } = await import('./quality');

describe('scene renderer attach hooks', () => {
  beforeEach(() => {
    for (const mock of [
      mocks.warmUp,
      mocks.skyAttach,
      mocks.skySetEnabled,
      mocks.skyOnLoaded,
      mocks.groundAttach,
      mocks.pbrAttach,
      mocks.setSky,
      mocks.setQuality,
    ])
      mock.mockClear();
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

  it('attaches every GPU consumer to the renderer it creates', () => {
    createSceneRenderer();
    const gpu = {};
    mocks.onRenderer?.(gpu);
    expect(mocks.groundAttach).toHaveBeenCalledWith(gpu);
    expect(mocks.skyAttach).toHaveBeenCalledWith(gpu);
    expect(mocks.pbrAttach).toHaveBeenCalledWith(gpu);
  });

  it('enables the HDRI sky per preset flag', () => {
    const renderer = createSceneRenderer();
    for (const preset of ['low', 'balanced', 'high'] as const) {
      renderer.setQuality(preset);
      expect(mocks.skySetEnabled).toHaveBeenLastCalledWith(QUALITY_FLAGS[preset].hdriSky);
      expect(mocks.setQuality).toHaveBeenLastCalledWith(preset);
    }
    expect(QUALITY_FLAGS.high.hdriSky).toBe(true);
    expect(QUALITY_FLAGS.low.hdriSky).toBe(false);
  });

  it('gives the vehicles the loaded sky, and takes it away when the sky is reverted', () => {
    createSceneRenderer();
    const [apply, revert] = mocks.skyOnLoaded.mock.calls[0] as [(map: object) => void, () => void];
    const map = {};
    apply(map);
    expect(mocks.setSky).toHaveBeenLastCalledWith(map);
    revert();
    expect(mocks.setSky).toHaveBeenLastCalledWith(null);
  });

  it('reflects the analytic sky while the grade that tone-maps the capture has failed', () => {
    createSceneRenderer();
    const [apply] = mocks.skyOnLoaded.mock.calls[0] as [(map: object) => void];
    const map = {};
    apply(map);
    mocks.grade?.('failed');
    expect(mocks.setSky).toHaveBeenLastCalledWith(null);
    mocks.grade?.('on');
    expect(mocks.setSky).toHaveBeenLastCalledWith(map);
  });

  it('publishes the sky state, warming up for a new drawn one but not for failed', () => {
    createSceneRenderer();
    const { dataset } = document.documentElement;
    mocks.sky?.('on');
    expect(dataset['skyHdri']).toBe('on');
    expect(mocks.warmUp).toHaveBeenCalledTimes(1);
    mocks.sky?.('failed');
    expect(dataset['skyHdri']).toBe('failed');
    expect(mocks.warmUp).toHaveBeenCalledTimes(1);
    mocks.sky?.(null);
    expect(dataset['skyHdri']).toBeUndefined();
  });

  it('publishes a failed ground texture without warming up', () => {
    createSceneRenderer();
    mocks.ground?.('failed');
    expect(document.documentElement.dataset['groundTexture']).toBe('failed');
    expect(mocks.warmUp).not.toHaveBeenCalled();
  });
});
