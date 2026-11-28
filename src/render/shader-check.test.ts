import { Mesh, PerspectiveCamera, Scene } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { markLost } from './seams';
import {
  buildSerially,
  checkCompiled,
  ShaderRejectedError,
  verifyShader,
  verifyWgsl,
  WGSL_TIMEOUT_MS,
  wgslAccepted,
  type Compiled,
} from './shader-check';

afterEach(() => {
  vi.useRealTimers();
});

type Device = {
  pushErrorScope: () => void;
  createShaderModule: (descriptor: { code: string }) => void;
  popErrorScope: () => Promise<{ message: string } | null>;
};

/** A device whose module creation fails for the codes `invalid` names. */
const device = (invalid: readonly string[] = [], pop?: () => Promise<null>): Device => {
  let failed = false;
  return {
    pushErrorScope: () => {
      failed = false;
    },
    createShaderModule: ({ code }) => {
      failed = invalid.includes(code);
    },
    popErrorScope: pop ?? (() => Promise.resolve(failed ? { message: 'parse error' } : null)),
  };
};

const gpu = (fragment: string | null, options: { device?: Device } = {}): WebGPURenderer =>
  ({
    debug: {
      getShaderAsync: () => {
        return Promise.resolve({ fragmentShader: fragment, vertexShader: 'vertex' });
      },
    },
    backend: { isWebGPUBackend: true, device: options.device },
  }) as unknown as WebGPURenderer;

const compiled = (overrides: Partial<Compiled> = {}): Compiled => ({
  vertex: 'vertex',
  fragment: 'var marker;',
  ...overrides,
});
const spec = { subject: 'the shader', markers: ['marker'] };

describe('buildSerially', () => {
  it('starts a build only after the earlier ones settled, even when one rejects', async () => {
    const g = gpu(null);
    const log: string[] = [];
    const build =
      (name: string, fail = false) =>
      async (): Promise<string> => {
        log.push(`start ${name}`);
        await new Promise((resolve) => setTimeout(resolve));
        log.push(`end ${name}`);
        if (fail) throw new Error(name);
        return name;
      };
    const first = buildSerially(g, build('a', true));
    const second = buildSerially(g, build('b'));
    await expect(first).rejects.toThrow('a');
    await expect(second).resolves.toBe('b');
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
});

describe('checkCompiled', () => {
  it('passes a build with its markers', () => {
    expect(() => {
      checkCompiled(compiled(), spec);
    }).not.toThrow();
  });

  it('fails a build without a marker, as a plain error that may be retried', () => {
    const check = () => {
      checkCompiled(compiled({ fragment: 'var other;' }), spec);
    };
    expect(check).toThrow('did not build');
    expect(check).not.toThrow(ShaderRejectedError);
  });

  it('holds a build to the samplers it allows', () => {
    const samplers = (count: number): string =>
      Array.from({ length: count }, (_, i) => `uniform sampler2D s${String(i)};`).join('\n');
    const within = compiled({ fragment: `var marker;\n${samplers(2)}` });
    const over = compiled({ fragment: `var marker;\n${samplers(3)}` });
    expect(() => {
      checkCompiled(within, { ...spec, maxSamplers: 2 });
    }).not.toThrow();
    expect(() => {
      checkCompiled(over, { ...spec, maxSamplers: 2 });
    }).toThrow('3 samplers');
  });
});

describe('verifyWgsl', () => {
  it('passes valid WGSL of both stages', async () => {
    await expect(
      verifyWgsl(gpu(null, { device: device() }), [compiled()]),
    ).resolves.toBeUndefined();
  });

  it('rejects when the device rejects either stage', async () => {
    const g = gpu(null, { device: device(['vertex']) });
    await expect(verifyWgsl(g, [compiled()])).rejects.toThrow(ShaderRejectedError);
    const h = gpu(null, { device: device(['var marker;']) });
    await expect(verifyWgsl(h, [compiled()])).rejects.toThrow('parse error');
  });

  it.each([
    ['WebGL 2, which has no device', gpu(null)],
    [
      'a lost device',
      (() => {
        const g = gpu(null, { device: device(['var marker;']) });
        markLost(g);
        return g;
      })(),
    ],
  ])('checks nothing on %s', async (_, g) => {
    await expect(verifyWgsl(g, [compiled()])).resolves.toBeUndefined();
  });

  it('is inconclusive, not a failure, when the device never answers', async () => {
    vi.useFakeTimers();
    const g = gpu(null, { device: device([], () => new Promise<null>(() => undefined)) });
    const verdict = verifyWgsl(g, [compiled()]);
    await vi.advanceTimersByTimeAsync(WGSL_TIMEOUT_MS);
    await expect(verdict).resolves.toBeUndefined();
  });

  it('opens, fills and closes each scope in one synchronous turn, so no live frame error is captured', async () => {
    const calls: string[] = [];
    const recording: Device = {
      pushErrorScope: () => calls.push('push'),
      createShaderModule: () => calls.push('create'),
      popErrorScope: () => {
        calls.push('pop');
        return Promise.resolve(null);
      },
    };
    const pending = verifyWgsl(gpu(null, { device: recording }), [compiled(), compiled()]);
    // nothing awaited yet: all four modules already went through push, create, pop
    expect(calls).toEqual(Array.from({ length: 4 }, () => ['push', 'create', 'pop']).flat());
    await pending;
  });

  it('is inconclusive when the scope cannot be popped', async () => {
    const g = gpu(null, { device: device([], () => Promise.reject(new Error('lost'))) });
    await expect(verifyWgsl(g, [compiled()])).resolves.toBeUndefined();
  });
});

describe('wgslAccepted', () => {
  it('warns and reports a rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const g = gpu(null, { device: device(['var marker;']) });
    await expect(wgslAccepted(g, compiled(), 'Shader')).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('Shader failed', expect.any(ShaderRejectedError));
    await expect(wgslAccepted(gpu(null), compiled(), 'Shader')).resolves.toBe(true);
  });
});

describe('verifyShader', () => {
  const verify = (g: WebGPURenderer) =>
    verifyShader(g, new Scene(), new PerspectiveCamera(), new Mesh(), spec);

  it('returns the fragment shader of a build the GPU accepts', async () => {
    await expect(verify(gpu('var marker;', { device: device() }))).resolves.toBe('var marker;');
  });

  it('builds nothing on a lost GPU, whose texture uploads would warn', async () => {
    const g = gpu('var marker;', { device: device() });
    const build = vi.spyOn(g.debug, 'getShaderAsync');
    markLost(g);
    await expect(verify(g)).rejects.toThrow(/lost/);
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects a build whose WGSL the GPU rejects', async () => {
    const g = gpu('var marker;', { device: device(['var marker;']) });
    await expect(verify(g)).rejects.toThrow(ShaderRejectedError);
  });

  it('keeps the WGSL validation out of the build queue', async () => {
    const g = gpu('var marker;', { device: device([], () => new Promise<null>(() => undefined)) });
    vi.useFakeTimers();
    const first = verify(g);
    const settled = vi.fn();
    void first.then(settled);
    await vi.advanceTimersByTimeAsync(1);
    // the validation stalls, yet the next build runs
    await expect(buildSerially(g, () => Promise.resolve('next'))).resolves.toBe('next');
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(WGSL_TIMEOUT_MS);
    await expect(first).resolves.toBe('var marker;');
  });
});
