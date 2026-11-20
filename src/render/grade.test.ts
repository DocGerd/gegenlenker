import { Mesh } from 'three';
import { MeshLambertNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { output, vec4 } from 'three/tsl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSerially,
  createGradeCheck,
  GRADE_SHADER_MARKER,
  precompileGrade,
  setGraded,
  setGradeDisabled,
  toneMapRgb,
  type GradeSample,
  type GradeState,
  type Rgb,
} from './grade';
import { markLost } from './seams';

afterEach(() => {
  setGradeDisabled(false);
  vi.restoreAllMocks();
});

describe('toneMapRgb', () => {
  it('passes colours whose peak is below the compression start unchanged', () => {
    expect(toneMapRgb([0.2, 0.5, 0.75])).toEqual([0.2, 0.5, 0.75]);
    expect(toneMapRgb([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('is continuous where the compression starts', () => {
    const below = toneMapRgb([0.7599, 0.4, 0.2]);
    const above = toneMapRgb([0.7601, 0.4, 0.2]);
    below.forEach((v, i) => {
      expect(v).toBeCloseTo(above[i] ?? NaN, 3);
    });
  });

  it('rises with the input scale and stays below white', () => {
    const base: Rgb = [1, 0.6, 0.3];
    let previous = 0;
    for (const scale of [0.5, 1, 2, 4, 16, 256, 1e6]) {
      const [r, g, b] = toneMapRgb(base.map((v) => v * scale) as unknown as Rgb);
      const peak = Math.max(r, g, b);
      expect(peak, String(scale)).toBeGreaterThan(previous);
      expect(peak, String(scale)).toBeLessThan(1);
      previous = peak;
    }
  });

  it('scales with the exposure', () => {
    expect(toneMapRgb([0.2, 0.2, 0.2], 2)).toEqual([0.4, 0.4, 0.4]);
  });
});

describe('setGraded', () => {
  it('wears the grade once and does nothing on a repeat', () => {
    const material = new MeshLambertNodeMaterial();
    setGraded(material, true);
    const graded = material.outputNode;
    const { version } = material;
    expect(graded).not.toBeNull();
    setGraded(material, true);
    expect(material.outputNode).toBe(graded);
    expect(material.version).toBe(version);
    material.dispose();
  });

  it('puts the original output back when taken off, and leaves an ungraded material alone', () => {
    const plain = new MeshLambertNodeMaterial();
    setGraded(plain, false);
    expect(plain.version).toBe(0);
    setGraded(plain, true);
    setGraded(plain, false);
    expect(plain.outputNode).toBeNull();

    const base = vec4(output.rgb, output.a);
    const based = new MeshLambertNodeMaterial();
    based.outputNode = base;
    setGraded(based, true, base);
    expect(based.outputNode).not.toBe(base);
    setGraded(based, false, base);
    expect(based.outputNode).toBe(base);
    plain.dispose();
    based.dispose();
  });

  it('wears a given grade in place of the default one', () => {
    const base = vec4(output.rgb, output.a);
    const grade = vec4(output.rgb, output.a);
    const material = new MeshLambertNodeMaterial();
    setGraded(material, true, base, grade);
    expect(material.outputNode).toBe(grade);
    material.dispose();
  });

  it('applies nothing while disabled, and restores what was wanted after', () => {
    const wanted = new MeshLambertNodeMaterial();
    const other = new MeshLambertNodeMaterial();
    setGraded(wanted, true);
    setGraded(other, false);
    const graded = wanted.outputNode;
    setGradeDisabled(true);
    expect(wanted.outputNode).toBeNull();
    setGraded(other, true);
    expect(other.outputNode).toBeNull();
    const { version } = other;
    setGradeDisabled(true);
    expect(other.version).toBe(version);
    setGradeDisabled(false);
    expect(wanted.outputNode).toBe(graded);
    expect(other.outputNode).not.toBeNull();
    wanted.dispose();
    other.dispose();
  });

  it('forgets a disposed material', () => {
    const material = new MeshLambertNodeMaterial();
    setGraded(material, true);
    material.dispose();
    const { version } = material;
    setGradeDisabled(true);
    expect(material.version).toBe(version);
  });
});

const gpu = (
  fragment: string | null,
  report?: (hook: NonNullable<WebGPURenderer['debug']['onShaderError']>) => void,
): WebGPURenderer => {
  const debug: {
    onShaderError: NonNullable<WebGPURenderer['debug']['onShaderError']> | null;
    getShaderAsync: () => Promise<object>;
  } = {
    onShaderError: null,
    getShaderAsync: () => {
      if (debug.onShaderError !== null) report?.(debug.onShaderError);
      return Promise.resolve({ fragmentShader: fragment });
    },
  };
  return { debug, backend: {}, getContext: () => null } as unknown as WebGPURenderer;
};

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

describe('precompileGrade', () => {
  const built = `vec3 ${GRADE_SHADER_MARKER};`;

  it('passes shaders that built with the marker, and restores the hook', async () => {
    const g = gpu(built);
    await expect(precompileGrade(g)).resolves.toBeUndefined();
    expect(g.debug.onShaderError).toBeNull();
  });

  it('builds every extra sample and releases it', async () => {
    const dispose = vi.fn();
    const sample = vi.fn((): GradeSample => ({ mesh: new Mesh(), dispose }));
    await precompileGrade(gpu(built), [sample]);
    expect(sample).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('rejects when three swapped in a plain material', async () => {
    const g = gpu('void main() {}');
    await expect(precompileGrade(g)).rejects.toThrow('did not build');
    expect(g.debug.onShaderError).toBeNull();
  });

  it('rejects when the GLSL of a graded shader fails', async () => {
    const context = {
      getShaderSource: (shader: unknown) => shader,
      getShaderInfoLog: () => 'log',
      getProgramInfoLog: () => 'log',
    } as unknown as WebGL2RenderingContext;
    const g = gpu(built, (hook) => {
      hook(...([context, {}, 'vertex', built] as unknown as Parameters<typeof hook>));
    });
    await expect(precompileGrade(g)).rejects.toThrow('failed to compile');
    expect(g.debug.onShaderError).toBeNull();
  });
});

describe('grade check', () => {
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));
  const setup = (compiles: (gpu: WebGPURenderer) => Promise<void>) => {
    const states: GradeState[] = [];
    const check = createGradeCheck((state) => states.push(state), compiles);
    return { check, states };
  };

  it('stays quiet and compiles nothing while the preset does not grade', async () => {
    const compiles = vi.fn(() => Promise.resolve());
    const { check, states } = setup(compiles);
    check.attach(gpu(null));
    await flush();
    expect(compiles).not.toHaveBeenCalled();
    expect(states).toEqual([]);
  });

  it('reports on after the check passed while the preset grades, and not when it stops', async () => {
    const compiles = vi.fn(() => Promise.resolve());
    const { check, states } = setup(compiles);
    check.attach(gpu(null));
    check.setWanted(true);
    expect(states).toEqual([]);
    await flush();
    expect(states).toEqual(['on']);
    check.setWanted(false);
    check.setWanted(true);
    await flush();
    expect(compiles).toHaveBeenCalledOnce();
    expect(states).toEqual(['on', null, 'on']);
  });

  it('starts when the renderer arrives after the preset', async () => {
    const { check, states } = setup(() => Promise.resolve());
    check.setWanted(true);
    check.attach(gpu(null));
    await flush();
    expect(states).toEqual(['on']);
  });

  it.each([
    ['the marker is missing', () => Promise.reject(new Error('a graded shader did not build'))],
    ['the build rejects', () => Promise.reject(new Error('pipeline'))],
  ])('turns the grade off and reports failed when %s', async (_, compiles) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const material = new MeshLambertNodeMaterial();
    setGraded(material, true);
    const { check, states } = setup(compiles);
    check.attach(gpu(null));
    check.setWanted(true);
    expect(material.outputNode).not.toBeNull();
    await flush();
    expect(states).toEqual(['failed']);
    expect(warn).toHaveBeenCalledOnce();
    expect(material.outputNode).toBeNull();
    setGraded(material, true);
    expect(material.outputNode).toBeNull();
    // sticky for the renderer, but absent where the preset does not grade
    check.setWanted(false);
    expect(states).toEqual(['failed', null]);
    check.setWanted(true);
    expect(states).toEqual(['failed', null, 'failed']);
    expect(material.outputNode).toBeNull();
    material.dispose();
  });

  it('checks a replacement renderer again and grades the wanted materials once it passes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const compiles = vi
      .fn<(gpu: WebGPURenderer) => Promise<void>>()
      .mockRejectedValueOnce(new Error('no'))
      .mockResolvedValueOnce(undefined);
    const material = new MeshLambertNodeMaterial();
    setGraded(material, true);
    const { check, states } = setup(compiles);
    check.attach(gpu(null));
    check.setWanted(true);
    await flush();
    expect(material.outputNode).toBeNull();
    check.attach(gpu(null));
    expect(material.outputNode).not.toBeNull();
    expect(states).toEqual(['failed', null]);
    await flush();
    expect(states).toEqual(['failed', null, 'on']);
    material.dispose();
  });

  it('ignores a result for a renderer that has been replaced', async () => {
    let settle: () => void = () => undefined;
    const compiles = vi
      .fn<(gpu: WebGPURenderer) => Promise<void>>()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          settle = resolve;
        }),
      )
      .mockReturnValue(new Promise(() => undefined));
    const { check, states } = setup(compiles);
    check.setWanted(true);
    check.attach(gpu(null));
    check.attach(gpu(null));
    settle();
    await flush();
    expect(compiles).toHaveBeenCalledTimes(2);
    expect(states).toEqual([]);
  });

  it('gives no verdict on a lost context, and none is kept', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const lost = gpu(null);
    markLost(lost);
    const { check, states } = setup(() => Promise.reject(new Error('lost')));
    check.attach(lost);
    check.setWanted(true);
    await flush();
    expect(states).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('clears the state on dispose', async () => {
    const { check, states } = setup(() => Promise.resolve());
    check.attach(gpu(null));
    check.setWanted(true);
    await flush();
    check.dispose();
    expect(states).toEqual(['on', null]);
  });
});
