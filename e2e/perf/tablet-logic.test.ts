import { describe, expect, it } from 'vitest';
import {
  type Check,
  type Reading,
  type Run,
  cellVerdict,
  checksOk,
  isIgnorableFailure,
  backendProblem,
  isSoftwareGl,
  meetsBar,
  median,
  parseOptions,
  parseOverlay,
  readingProblems,
} from './tablet-logic.ts';

const reading = (over: Partial<Reading> = {}): Reading => ({
  fps: 60,
  p95: 16.7,
  scale: 1,
  calls: 80,
  shadow: 0,
  gl: 'ANGLE (NVIDIA, D3D12)',
  ...over,
});

describe('parseOverlay', () => {
  it('reads the two-line overlay text', () => {
    const text =
      '59 fps  p95 17.2 ms  scale 0.85  calls 142  shadow 1\nANGLE (NVIDIA, D3D12)  CONTEXT LOST';
    expect(parseOverlay(text)).toEqual({
      fps: 59,
      p95: 17.2,
      scale: 0.85,
      calls: 142,
      shadow: 1,
      gl: 'ANGLE (NVIDIA, D3D12)  CONTEXT LOST',
    });
  });

  it('returns null without an overlay', () => {
    expect(parseOverlay('')).toBeNull();
    expect(parseOverlay('Paused')).toBeNull();
  });
});

describe('pass bar', () => {
  it.each([
    [57, 1, false],
    [58, 1, true],
    [58, 0.99, false],
    [60, 1, true],
  ])('fps %d at scale %d passes: %s', (fps, scale, ok) => {
    expect(meetsBar(reading({ fps, scale }))).toBe(ok);
  });

  it('flags software and missing GL, not a hardware renderer', () => {
    expect(isSoftwareGl('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe(true);
    expect(isSoftwareGl('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareGl('no WebGL2')).toBe(true);
    expect(isSoftwareGl('webgpu  Google swiftshader (fallback)')).toBe(true);
    expect(isSoftwareGl('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D12)')).toBe(false);
  });

  it('reports a lost context and software GL on a reading', () => {
    expect(readingProblems(reading())).toEqual([]);
    expect(readingProblems(reading({ gl: 'ANGLE (NVIDIA)  CONTEXT LOST' }))).toEqual([
      'WebGL context lost',
    ]);
    expect(readingProblems(reading({ gl: 'llvmpipe' }))).toHaveLength(1);
  });
});

describe('backendProblem', () => {
  it('fails a cell drawn on another backend, and auto unless it drew on WebGPU', () => {
    const gpu = 'webgpu  nvidia ada';
    const gl = 'webgl2 (WebGPU failed)  ANGLE (NVIDIA)';
    expect(backendProblem(null, gl)).toBeNull();
    expect(backendProblem('webgl2', gl)).toBeNull();
    expect(backendProblem('webgpu', gpu)).toBeNull();
    expect(backendProblem('auto', gpu)).toBeNull();
    expect(backendProblem('auto', gl)).toMatch(/not webgpu$/);
    expect(backendProblem('webgl2', gpu)).toMatch(/not webgl2$/);
  });
});

describe('median', () => {
  it('takes the middle value, averaging an even count', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('refuses to invent a value from no samples', () => {
    expect(() => median([])).toThrow();
  });
});

describe('verdicts', () => {
  const run = (over: Partial<Run> = {}): Run => ({ reading: reading(), errors: [], ...over });

  it('one failing run fails the cell', () => {
    expect(cellVerdict([run(), run()])).toEqual({ passed: 2, total: 2, ok: true });
    expect(cellVerdict([run(), run({ errors: ['pageerror: x'] })]).ok).toBe(false);
    expect(cellVerdict([run(), run({ reading: reading({ fps: 40 }) })]).ok).toBe(false);
    expect(cellVerdict([]).ok).toBe(false);
  });

  it('a functional run needs a pass and no failure', () => {
    const c = (status: Check['status']): Check => ({ name: 'x', status, detail: '' });
    expect(checksOk([c('pass'), c('skip')])).toBe(true);
    expect(checksOk([c('pass'), c('fail')])).toBe(false);
    expect(checksOk([c('skip'), c('skip')])).toBe(false);
    expect(checksOk([])).toBe(false);
  });
});

describe('parseOptions', () => {
  it('defaults to the full matrix', () => {
    const o = parseOptions([]);
    expect(o).toMatchObject({ throttle: 4, runs: 1, perf: true, functional: false, backend: null });
    expect(o.presets).toHaveLength(3);
    expect(o.pairs).toHaveLength(4);
  });

  it('--quick keeps the first vehicle pair', () => {
    expect(parseOptions(['--quick']).pairs).toEqual([['man-le-18-280', 'krone-azw-18']]);
  });

  it('rejects bad values', () => {
    expect(() => parseOptions(['--throttle', '0'])).toThrow('--throttle');
    expect(() => parseOptions(['--runs', '1.5'])).toThrow('--runs');
    expect(() => parseOptions(['--preset', 'ultra'])).toThrow('--preset');
    expect(() => parseOptions(['--backend', 'vulkan'])).toThrow('--backend');
    expect(() => parseOptions(['--bogus'])).toThrow();
  });

  it('rejects --no-perf without --functional', () => {
    expect(() => parseOptions(['--no-perf'])).toThrow('--no-perf');
    expect(parseOptions(['--no-perf', '--functional']).perf).toBe(false);
  });
});

describe('isIgnorableFailure', () => {
  it('ignores aborted requests and the favicon only', () => {
    expect(isIgnorableFailure('http://x/a.js', 'net::ERR_ABORTED')).toBe(true);
    expect(isIgnorableFailure('http://x/favicon.ico', 'net::ERR_INTERNET_DISCONNECTED')).toBe(true);
    expect(isIgnorableFailure('http://x/a.glb', 'net::ERR_INTERNET_DISCONNECTED')).toBe(false);
  });
});
