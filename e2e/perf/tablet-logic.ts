import { parseArgs } from 'node:util';

export const PRESETS = ['low', 'balanced', 'high'] as const;
export const PAIRS = [
  ['man-le-18-280', 'krone-azw-18'],
  ['man-le-18-280', 'hueffermann-hpa-24-81-l'],
  ['arocs-1835-ak', 'krone-azw-18'],
  ['arocs-1835-ak', 'hueffermann-hpa-24-81-l'],
] as const;
export const MIN_FPS = 58;

export type Preset = (typeof PRESETS)[number];
export type Pair = (typeof PAIRS)[number];
export type Reading = { fps: number; p95: number; scale: number; calls: number; gl: string };
export type Run = { reading: Reading; errors: string[] };
export type Check = { name: string; status: 'pass' | 'fail' | 'skip'; detail: string };

export type Options = {
  help: boolean;
  throttle: number;
  runs: number;
  presets: readonly Preset[];
  pairs: readonly Pair[];
  functional: boolean;
  perf: boolean;
  allowSoftware: boolean;
  skipBuild: boolean;
};

const positive = (name: string, raw: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be an integer >= 1`);
  return value;
};

export function parseOptions(argv: readonly string[]): Options {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      throttle: { type: 'string', default: '4' },
      preset: { type: 'string', default: 'all' },
      runs: { type: 'string', default: '1' },
      quick: { type: 'boolean', default: false },
      functional: { type: 'boolean', default: false },
      'no-perf': { type: 'boolean', default: false },
      'allow-software': { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  const presets = PRESETS.filter((p) => values.preset === 'all' || values.preset === p);
  if (presets.length === 0) throw new Error(`--preset must be one of ${PRESETS.join(', ')}, all`);
  if (values['no-perf'] && !values.functional) {
    throw new Error('--no-perf needs --functional, otherwise nothing runs');
  }
  return {
    help: values.help,
    throttle: positive('throttle', values.throttle),
    runs: positive('runs', values.runs),
    presets,
    pairs: values.quick ? PAIRS.slice(0, 1) : PAIRS,
    functional: values.functional,
    perf: !values['no-perf'],
    allowSoftware: values['allow-software'],
    skipBuild: values['skip-build'],
  };
}

/** Parses the `?perf=1` overlay text written by `src/render/perf-overlay.ts`. */
export function parseOverlay(text: string): Reading | null {
  const m = /(\d+) fps\s+p95 ([\d.]+) ms\s+scale ([\d.]+)\s+calls (\d+)\n(.*)/.exec(text);
  const [, fps, p95, scale, calls, gl] = m ?? [];
  return fps && p95 && scale && calls && gl
    ? { fps: +fps, p95: +p95, scale: +scale, calls: +calls, gl }
    : null;
}

export const isSoftwareGl = (renderer: string): boolean =>
  renderer === 'no WebGL2' || /SwiftShader|llvmpipe|softpipe/i.test(renderer);

/** Problems that make a single overlay reading untrustworthy. */
export function readingProblems(r: Reading): string[] {
  const problems: string[] = [];
  if (r.gl.includes('CONTEXT LOST')) problems.push('WebGL context lost');
  if (isSoftwareGl(r.gl)) problems.push(`software GL (${r.gl.trim()})`);
  return problems;
}

export const meetsBar = (r: Reading): boolean => r.fps >= MIN_FPS && r.scale >= 1;

/** Median; the mean of the two middle values for an even count. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('median of no samples');
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export const runPasses = (run: Run): boolean => meetsBar(run.reading) && run.errors.length === 0;

export function cellVerdict(runs: readonly Run[]): { passed: number; total: number; ok: boolean } {
  const passed = runs.filter(runPasses).length;
  return { passed, total: runs.length, ok: runs.length > 0 && passed === runs.length };
}

/** A functional run must not fail, and must not skip everything. */
export const checksOk = (checks: readonly Check[]): boolean =>
  checks.some((c) => c.status === 'pass') && checks.every((c) => c.status !== 'fail');

/** Requests that may fail while offline without pointing at a missing asset. */
export const isIgnorableFailure = (url: string, failure: string): boolean =>
  failure === 'net::ERR_ABORTED' || new URL(url).pathname.endsWith('/favicon.ico');
