import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  warmUp: vi.fn(),
  syncAttach: false,
  ground: null as ((state: string | null) => void) | null,
  pbr: null as ((state: 'on' | 'failed' | null) => void) | null,
  sky: null as ((state: string | null) => void) | null,
  grade: null as ((state: 'on' | 'failed' | null) => void) | null,
  onAttached: null as ((key: string, on: boolean) => void) | null,
  skyAttach: vi.fn(),
  skySetEnabled: vi.fn(),
  skyOnLoaded: vi.fn(),
  groundAttach: vi.fn(),
  groundPbrAttach: vi.fn(),
  yardKitAttach: vi.fn(),
  yardKitSetEnabled: vi.fn(),
  yardKit: null as ((state: string | null) => void) | null,
  pbrAttach: vi.fn(),
  setSky: vi.fn(),
  setQuality: vi.fn(),
  onRenderer: null as ((gpu: unknown) => void) | null,
}));

vi.mock('./glb-shells', () => ({
  CAB_SHELL_URLS: {},
  BODY_SHELL_URLS: {},
  TRAILER_SHELL_URLS: {},
  trailerShellFrom: vi.fn(),
  startGlbAsset: (
    _urls: unknown,
    _parse: unknown,
    options: { onAttached: (key: string, on: boolean) => void },
  ) => {
    if (mocks.syncAttach) options.onAttached('cab', true);
    return { setEnabled: vi.fn() };
  },
  startShells: (_urls: unknown, options: { onAttached: (key: string, on: boolean) => void }) => {
    mocks.onAttached = options.onAttached;
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
vi.mock('./ground-pbr', () => ({
  startGroundPbrTextures: () => ({
    attach: mocks.groundPbrAttach,
    setEnabled: vi.fn(),
    dispose: vi.fn(),
  }),
}));
vi.mock('./yard-kit', () => ({
  startYardKit: (onApplied: (state: string | null) => void) => {
    mocks.yardKit = onApplied;
    return {
      attach: mocks.yardKitAttach,
      setEnabled: mocks.yardKitSetEnabled,
      dispose: vi.fn(),
    };
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
const { ATTACHMENTS } = await import('./asset-registry');

const attribute = (name: string): string | undefined =>
  (document.documentElement as unknown as { attributes: Map<string, string> }).attributes.get(name);

describe('scene renderer attach hooks', () => {
  beforeEach(() => {
    for (const mock of [
      mocks.warmUp,
      mocks.skyAttach,
      mocks.skySetEnabled,
      mocks.skyOnLoaded,
      mocks.groundAttach,
      mocks.groundPbrAttach,
      mocks.yardKitAttach,
      mocks.yardKitSetEnabled,
      mocks.pbrAttach,
      mocks.setSky,
      mocks.setQuality,
    ])
      mock.mockClear();
    mocks.syncAttach = false;
    const attributes = new Map<string, string>();
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {},
        attributes,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
      },
    });
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
    expect(mocks.groundPbrAttach).toHaveBeenCalledWith(gpu);
    expect(mocks.yardKitAttach).toHaveBeenCalledWith(gpu);
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

  it('enables the yard kit per preset flag', () => {
    const renderer = createSceneRenderer();
    for (const preset of ['low', 'balanced', 'high'] as const) {
      renderer.setQuality(preset);
      expect(mocks.yardKitSetEnabled).toHaveBeenLastCalledWith(QUALITY_FLAGS[preset].yardKit);
    }
    expect(QUALITY_FLAGS.high.yardKit).toBe(true);
    expect(QUALITY_FLAGS.balanced.yardKit).toBe(false);
  });

  it('publishes the yard kit state, warming up for a new drawn one but not for failed', () => {
    createSceneRenderer();
    mocks.yardKit?.('on');
    expect(attribute(ATTACHMENTS.yardKit.marker)).toBe('on');
    expect(mocks.warmUp).toHaveBeenCalledTimes(1);
    mocks.yardKit?.('failed');
    expect(attribute(ATTACHMENTS.yardKit.marker)).toBe('failed');
    expect(mocks.warmUp).toHaveBeenCalledTimes(1);
  });

  it('gives the vehicles the loaded sky, and takes it away when the sky is reverted', () => {
    createSceneRenderer();
    const [apply, revert] = mocks.skyOnLoaded.mock.calls[0] as [
      (maps: { sky: object }) => void,
      () => void,
    ];
    const map = {};
    apply({ sky: map });
    expect(mocks.setSky).toHaveBeenLastCalledWith(map);
    revert();
    expect(mocks.setSky).toHaveBeenLastCalledWith(null);
  });

  it('reflects the analytic sky while the grade that tone-maps the capture has failed', () => {
    createSceneRenderer();
    const [apply] = mocks.skyOnLoaded.mock.calls[0] as [(maps: { sky: object }) => void];
    const map = {};
    apply({ sky: map });
    mocks.grade?.('failed');
    expect(mocks.setSky).toHaveBeenLastCalledWith(null);
    mocks.grade?.('on');
    expect(mocks.setSky).toHaveBeenLastCalledWith(map);
  });

  it('publishes the sky state, warming up for a new drawn one but not for failed', () => {
    createSceneRenderer();
    const marker = (): string | undefined => attribute(ATTACHMENTS.sky.marker);
    mocks.sky?.('on');
    expect(marker()).toBe('on');
    expect(mocks.warmUp).toHaveBeenCalledTimes(1);
    mocks.sky?.('failed');
    expect(marker()).toBe('failed');
    expect(mocks.warmUp).toHaveBeenCalledTimes(1);
    mocks.sky?.(null);
    expect(marker()).toBeUndefined();
  });

  it('publishes a failed ground texture without warming up', () => {
    createSceneRenderer();
    mocks.ground?.('failed');
    expect(attribute(ATTACHMENTS.ground.marker)).toBe('failed');
    expect(mocks.warmUp).not.toHaveBeenCalled();
  });

  it('publishes the attached shells sorted, warming up for each new set', () => {
    createSceneRenderer();
    const marker = (): string | undefined => attribute(ATTACHMENTS.shells.marker);
    mocks.onAttached?.('man-cab', true);
    mocks.onAttached?.('krone-trailer', true);
    expect(marker()).toBe('krone-trailer man-cab');
    expect(mocks.warmUp).toHaveBeenCalledTimes(2);
    mocks.onAttached?.('man-cab', false);
    expect(marker()).toBe('krone-trailer');
    mocks.onAttached?.('krone-trailer', false);
    expect(marker()).toBeUndefined();
  });
});
