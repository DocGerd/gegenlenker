import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { crc32 } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { prodManifest } from './prod-manifest';
import {
  assemble,
  restApi,
  type Api,
  type Artifact,
  type Deployment,
  type DeploymentStatus,
  type Extract,
  type Job,
  type Run,
} from './uat-pages';

const REPO = 'DocGerd/gegenlenker';
const MAIN_SHA = 'a'.repeat(40);
const OLD_SHA = 'b'.repeat(40);
const UAT_SHA = 'c'.repeat(40);
const UAT_RUN = 900;

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'uat-pages-test-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const at = (minute: number): string => new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString();

// A fake artifact zip: JSON of path to content, which `extractJson` writes out as `unzip` would.
type Files = Record<string, string>;
const zipOf = (files: Files): Buffer => Buffer.from(JSON.stringify(files));
const extractJson: Extract = (zip, dest) => {
  for (const [path, content] of Object.entries(JSON.parse(zip.toString()) as Files)) {
    mkdirSync(dirname(join(dest, path)), { recursive: true });
    writeFileSync(join(dest, path), content);
  }
};
const digestOf = (zip: Buffer): string =>
  `sha256:${createHash('sha256').update(zip).digest('hex')}`;

const manifestOf = (dist: Files): string => {
  const dir = tempDir();
  extractJson(zipOf(dist), dir);
  return prodManifest(dir);
};

/** The files of a `prod-dist-<sha>` artifact, as `build-pages` uploads them. */
const prodFiles = (
  sha: string,
  dist: Files = { 'index.html': sha, 'assets/app.js': 'app' },
): Files => ({
  ...Object.fromEntries(Object.entries(dist).map(([path, content]) => [`dist/${path}`, content])),
  'prod-manifest.txt': manifestOf(dist),
  'prod-commit.txt': `${sha}\n`,
});

interface World {
  runs: Run[];
  jobs: Record<number, Job[]>;
  /** Job (check run) id to deployment id, as the check run's `deployment` links them. */
  links: Record<number, number>;
  deployments: Deployment[];
  /** Successive reads of one deployment's statuses; the last repeats. */
  statuses: Record<number, DeploymentStatus[][]>;
  artifacts: Record<number, Artifact[]>;
  zips: Record<number, Buffer>;
}

const fakeApi = (world: World): Api & { paths: string[] } => {
  const paths: string[] = [];
  const reads = new Map<number, number>();
  const base = `/repos/${REPO}`;
  const route = (path: string): unknown[] => {
    let m: RegExpExecArray | null;
    if (path === `${base}/actions/workflows/ci.yml/runs?branch=main&per_page=100`)
      return world.runs;
    if ((m = /\/actions\/runs\/(\d+)\/jobs\?filter=all&per_page=100$/.exec(path)))
      return world.jobs[Number(m[1])] ?? [];
    if ((m = /\/actions\/runs\/(\d+)\/artifacts\?per_page=100$/.exec(path)))
      return world.artifacts[Number(m[1])] ?? [];
    if ((m = /\/deployments\/(\d+)\/statuses\?per_page=100$/.exec(path))) {
      const id = Number(m[1]);
      const all = world.statuses[id] ?? [[]];
      const n = reads.get(id) ?? 0;
      reads.set(id, n + 1);
      return all[Math.min(n, all.length - 1)] ?? [];
    }
    if (path === `${base}/deployments?environment=github-pages&per_page=100`)
      return world.deployments;
    throw new Error(`unexpected list ${path}`);
  };
  return {
    paths,
    list: (path) => {
      paths.push(path);
      return Promise.resolve(route(path));
    },
    get: (path) => {
      paths.push(path);
      const checkRun = new RegExp(`^${base}/check-runs/(\\d+)$`).exec(path);
      if (checkRun !== null) {
        const id = Number(checkRun[1]);
        const link = world.links[id];
        return Promise.resolve({ id, deployment: link === undefined ? null : { id: link } });
      }
      const id = Number(/\/deployments\/(\d+)$/.exec(path)?.[1]);
      const deployment = world.deployments.find((each) => each.id === id);
      if (deployment === undefined) throw new Error(`unexpected get ${path}`);
      return Promise.resolve(deployment);
    },
    download: (path) => {
      paths.push(path);
      const zip = world.zips[Number(/\/artifacts\/(\d+)\/zip$/.exec(path)?.[1])];
      if (zip === undefined) throw new Error(`unexpected download ${path}`);
      return Promise.resolve(zip);
    },
  };
};

const run = (id: number, sha: string, updated: number, extra: Partial<Run> = {}): Run => ({
  id,
  event: 'push',
  head_branch: 'main',
  head_sha: sha,
  status: 'completed',
  updated_at: at(updated),
  ...extra,
});
const job = (id: number, started: number, done: number, extra: Partial<Job> = {}): Job => ({
  id,
  check_run_url: `https://api.github.com/repos/${REPO}/check-runs/${String(id)}`,
  name: 'deploy',
  conclusion: 'success',
  started_at: at(started),
  completed_at: at(done),
  ...extra,
});
const deployment = (id: number, sha: string, created: number, ref = 'main'): Deployment => ({
  id,
  ref,
  sha,
  environment: 'github-pages',
  created_at: at(created),
});
const status = (id: number, state: string, created: number): DeploymentStatus => ({
  id,
  state,
  created_at: at(created),
});
const artifact = (id: number, name: string, created: number, zip: Buffer): Artifact => ({
  id,
  name,
  expired: false,
  created_at: at(created),
  digest: digestOf(zip),
});

const UAT_ZIP = zipOf({ 'index.html': 'uat', 'assets/uat.js': 'uat' });

/** `main` deployed OLD_SHA (run 1), then MAIN_SHA (run 2); this `develop` run built UAT_SHA. */
const world = (): World => {
  const oldZip = zipOf(prodFiles(OLD_SHA));
  const mainZip = zipOf(prodFiles(MAIN_SHA));
  return {
    runs: [run(1, OLD_SHA, 12), run(2, MAIN_SHA, 32)],
    jobs: {
      1: [job(11, 10, 11, { name: 'build-pages' }), job(12, 10, 11)],
      2: [job(21, 25, 26, { name: 'build-pages' }), job(22, 30, 31)],
    },
    links: { 12: 101, 22: 102 },
    deployments: [deployment(101, OLD_SHA, 9), deployment(102, MAIN_SHA, 27)],
    statuses: {
      101: [[status(1, 'success', 11)]],
      102: [[status(3, 'success', 31), status(2, 'in_progress', 30)]],
    },
    artifacts: {
      1: [artifact(201, `prod-dist-${OLD_SHA}`, 9, oldZip)],
      2: [artifact(202, `prod-dist-${MAIN_SHA}`, 26, mainZip)],
      [UAT_RUN]: [artifact(299, `uat-dist-${UAT_SHA}`, 40, UAT_ZIP)],
    },
    zips: { 201: oldZip, 202: mainZip, 299: UAT_ZIP },
  };
};

const sleeps: number[] = [];
const build = (w: World): ReturnType<typeof assemble> & { out?: string } => {
  sleeps.length = 0;
  const out = join(tempDir(), 'pages');
  return Object.assign(
    assemble(
      fakeApi(w),
      { repo: REPO, runId: String(UAT_RUN), sha: UAT_SHA, out },
      {
        extract: extractJson,
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
    ),
    { out },
  );
};

describe('assembling the UAT Pages tree', () => {
  it('puts the UAT build under uat/ beside the live production files, byte for byte', async () => {
    const pending = build(world());
    expect((await pending).run.id).toBe(2);
    const dist = join(pending.out ?? '', 'dist');
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).toBe(MAIN_SHA);
    expect(readFileSync(join(dist, 'uat', 'index.html'), 'utf8')).toBe('uat');
    expect(
      prodManifest(dist)
        .split('\n')
        .filter((line) => line !== '' && !line.slice(66).startsWith('uat/'))
        .join('\n') + '\n',
    ).toBe(manifestOf({ 'index.html': MAIN_SHA, 'assets/app.js': 'app' }));
  });

  it('takes the deploy job that finished last, in any attempt, of push and dispatch runs on main', async () => {
    const w = world();
    const zip = zipOf(prodFiles(OLD_SHA));
    // Run 3 redeploys OLD_SHA by dispatch: attempt 1 failed, attempt 2 finished last of all.
    w.runs.push(run(3, OLD_SHA, 52, { event: 'workflow_dispatch' }));
    w.jobs[3] = [
      job(31, 40, 41, { conclusion: 'failure' }),
      job(32, 50, 51),
      job(33, 60, 61, { name: 'deploy-uat' }),
    ];
    w.links[32] = 103;
    w.deployments.push(deployment(103, OLD_SHA, 49));
    w.statuses[103] = [[status(5, 'success', 51)]];
    w.artifacts[3] = [artifact(203, `prod-dist-${OLD_SHA}`, 38, zip)];
    w.zips[203] = zip;
    // Neither another job, nor a pull_request run with head `main`, nor another branch counts.
    w.runs.push(
      run(4, UAT_SHA, 70, { event: 'pull_request' }),
      run(5, UAT_SHA, 71, { head_branch: 'develop' }),
    );
    w.jobs[4] = [job(41, 60, 61)];
    w.jobs[5] = [job(51, 60, 61)];
    const pending = build(w);
    const prod = await pending;
    expect([prod.run.id, prod.job.id, prod.artifact.id]).toEqual([3, 32, 203]);
    expect(readFileSync(join(pending.out ?? '', 'dist', 'index.html'), 'utf8')).toBe(OLD_SHA);
  });

  it('skips the jobs of finished runs last updated before the best deploy finished, not unfinished ones', async () => {
    const w = world();
    // Run 6 is still running (its release job, say) with a stale update time and the newest deploy.
    const zip = zipOf(prodFiles(OLD_SHA));
    w.runs.push(run(6, OLD_SHA, 5, { status: 'in_progress' }));
    w.jobs[6] = [job(61, 33, 34)];
    w.links[61] = 106;
    w.deployments.push(deployment(106, OLD_SHA, 28));
    w.statuses[106] = [[status(6, 'success', 34)]];
    w.artifacts[6] = [artifact(206, `prod-dist-${OLD_SHA}`, 20, zip)];
    w.zips[206] = zip;
    const api = fakeApi(w);
    const out = join(tempDir(), 'pages');
    const prod = await assemble(
      api,
      { repo: REPO, runId: String(UAT_RUN), sha: UAT_SHA, out },
      {
        extract: extractJson,
      },
    );
    expect(prod.run.id).toBe(6);
    expect(api.paths.filter((path) => path.includes('/jobs?'))).toEqual([
      `/repos/${REPO}/actions/runs/2/jobs?filter=all&per_page=100`,
      `/repos/${REPO}/actions/runs/6/jobs?filter=all&per_page=100`,
    ]);
  });

  it('waits for the success status of the newest deploy, then never falls back to an older one', async () => {
    const w = world();
    w.statuses[102] = [
      [status(2, 'in_progress', 30)],
      [status(3, 'success', 31), status(2, 'in_progress', 30)],
    ];
    await expect(build(w)).resolves.toMatchObject({ run: { id: 2 } });
    expect(sleeps).toHaveLength(1);

    const stuck = world();
    stuck.statuses[102] = [[status(2, 'in_progress', 30)]];
    const pending = build(stuck);
    await expect(pending).rejects.toThrow(/deployment 102 has no success status/);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  it('fails closed when a newer production deployment went live or is going live outside that job', async () => {
    for (const [state, fails] of [
      ['success', true],
      ['in_progress', true],
      ['waiting', false],
      ['failure', false],
    ] as const) {
      const w = world();
      // A deployment of a deleted run, say: no job leads to it.
      w.deployments.push(deployment(107, OLD_SHA, 40));
      w.statuses[107] = [[status(7, state, 41)]];
      const pending = build(w);
      if (fails) await expect(pending, state).rejects.toThrow(/deployment 107 .* is newer/);
      else await expect(pending, state).resolves.toMatchObject({ run: { id: 2 } });
    }
    const uat = world();
    uat.deployments.push(deployment(108, UAT_SHA, 40, 'develop'));
    uat.statuses[108] = [[status(8, 'success', 41)]];
    await expect(build(uat)).resolves.toMatchObject({ run: { id: 2 } });
  });

  it('fails closed on a deploy job without a github-pages deployment of its commit', async () => {
    const unlinked = world();
    delete unlinked.links[22];
    await expect(build(unlinked)).rejects.toThrow(/has no deployment/);
    const elsewhere = world();
    elsewhere.jobs[2] = [
      job(22, 30, 31, { check_run_url: `https://api.github.com/repos/x/y/check-runs/22` }),
    ];
    await expect(build(elsewhere)).rejects.toThrow(
      /is not \/repos\/DocGerd\/gegenlenker\/check-runs\/22/,
    );
    const other = world();
    other.deployments[1] = { ...deployment(102, OLD_SHA, 27) };
    await expect(build(other)).rejects.toThrow(/is not github-pages at/);
  });

  it('needs exactly one unexpired prod-dist of the commit, uploaded before the deploy started', async () => {
    const zip = zipOf(prodFiles(MAIN_SHA));
    const cases: [string, Artifact[], RegExp][] = [
      ['none', [], /holds \[\], not one prod-dist-a+/],
      [
        'two',
        [
          artifact(202, `prod-dist-${MAIN_SHA}`, 26, zip),
          artifact(209, `prod-dist-${MAIN_SHA}`, 26, zip),
        ],
        /not one/,
      ],
      ['another commit', [artifact(202, `prod-dist-${OLD_SHA}`, 26, zip)], /not one/],
      [
        'expired',
        [{ ...artifact(202, `prod-dist-${MAIN_SHA}`, 26, zip), expired: true }],
        /expired/,
      ],
      ['uploaded after', [artifact(202, `prod-dist-${MAIN_SHA}`, 30, zip)], /not uploaded before/],
      [
        'no digest',
        [{ ...artifact(202, `prod-dist-${MAIN_SHA}`, 26, zip), digest: null }],
        /no sha256/,
      ],
    ];
    for (const [name, artifacts, error] of cases) {
      const w = world();
      w.artifacts[2] = artifacts;
      await expect(build(w), name).rejects.toThrow(error);
    }
  });

  it('refuses a download whose bytes differ from the artifact digest', async () => {
    const w = world();
    w.zips[202] = zipOf(prodFiles(MAIN_SHA, { 'index.html': 'tampered', 'assets/app.js': 'app' }));
    await expect(build(w)).rejects.toThrow(/the download is sha256:/);
  });

  it('verifies the production dist against its manifest, commit and file list', async () => {
    const good = prodFiles(MAIN_SHA);
    const cases: [string, Files, RegExp][] = [
      ['another commit', { ...good, 'prod-commit.txt': `${OLD_SHA}\n` }, /does not name/],
      ['a changed byte', { ...good, 'dist/assets/app.js': 'app!' }, /does not match/],
      ['an unlisted file', { ...good, 'dist/extra.js': 'x' }, /differs from its manifest/],
      [
        'a uat/ path',
        prodFiles(MAIN_SHA, { 'index.html': 'x', 'uat/index.html': 'old' }),
        /has a uat\/ path/,
      ],
      ['another entry', { ...good, 'notes.txt': 'x' }, /artifact holds/],
    ];
    for (const [name, files, error] of cases) {
      const w = world();
      const zip = zipOf(files);
      w.zips[202] = zip;
      w.artifacts[2] = [artifact(202, `prod-dist-${MAIN_SHA}`, 26, zip)];
      await expect(build(w), name).rejects.toThrow(error);
    }
  });

  it('checks the uploaded tree again after the UAT overlay', async () => {
    const cases: [Files, RegExp][] = [
      [{ 'index.html': 'uat', '../index.html': 'overwritten' }, /does not match/],
      [{ 'index.html': 'uat', '../extra.js': 'added' }, /changed the production files/],
      [{ 'app.js': 'uat' }, /uat\/index.html is missing/],
    ];
    for (const [files, error] of cases) {
      const w = world();
      const zip = zipOf(files);
      w.zips[299] = zip;
      w.artifacts[UAT_RUN] = [artifact(299, `uat-dist-${UAT_SHA}`, 40, zip)];
      await expect(build(w)).rejects.toThrow(error);
    }
  });

  it('takes the UAT build of this run and commit only', async () => {
    const w = world();
    w.artifacts[UAT_RUN] = [artifact(299, `uat-dist-${OLD_SHA}`, 40, UAT_ZIP)];
    await expect(build(w)).rejects.toThrow(/not one live uat-dist-c+/);
  });

  it('refuses an existing output directory', async () => {
    const out = tempDir();
    await expect(
      assemble(
        fakeApi(world()),
        { repo: REPO, runId: '1', sha: UAT_SHA, out },
        { extract: extractJson },
      ),
    ).rejects.toThrow(/exists/);
  });
});

/** A real zip of stored entries; `link` makes an entry a Unix symlink to that target. */
const realZip = (entries: readonly { name: string; data?: string; link?: string }[]): Buffer => {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const { name, data = '', link } of entries) {
    const body = Buffer.from(link ?? data);
    const path = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc32(body), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(path.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x030a, 4);
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc32(body), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(path.length, 28);
    central.writeUInt32LE((link === undefined ? 0o100644 : 0o120777) * 0x10000, 38);
    central.writeUInt32LE(offset, 42);
    parts.push(local, path, body);
    directory.push(central, path);
    offset += local.length + path.length + body.length;
  }
  const listing = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(listing.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, listing, end]);
};

// The checks after the overlay see only the Pages tree; a write elsewhere on the runner (its
// actions, say) would run in the job that holds `pages: write`. So `unzip` itself must hold.
describe('the real unzip', () => {
  const assembleReal = async (uat: Parameters<typeof realZip>[0]): Promise<string> => {
    const w = world();
    const prod = realZip(
      Object.entries(prodFiles(MAIN_SHA)).map(([name, data]) => ({ name, data })),
    );
    const uatZip = realZip(uat);
    w.zips[202] = prod;
    w.zips[299] = uatZip;
    w.artifacts[2] = [artifact(202, `prod-dist-${MAIN_SHA}`, 26, prod)];
    w.artifacts[UAT_RUN] = [artifact(299, `uat-dist-${UAT_SHA}`, 40, uatZip)];
    const out = join(tempDir(), 'pages');
    await assemble(fakeApi(w), { repo: REPO, runId: String(UAT_RUN), sha: UAT_SHA, out });
    return out;
  };

  it('unpacks both artifacts into the Pages tree', async () => {
    const out = await assembleReal([{ name: 'index.html', data: 'uat' }]);
    expect(readFileSync(join(out, 'dist', 'index.html'), 'utf8')).toBe(MAIN_SHA);
    expect(readFileSync(join(out, 'dist', 'uat', 'index.html'), 'utf8')).toBe('uat');
  });

  it('never writes outside uat/ and refuses what it cannot place there', async () => {
    const index = { name: 'index.html', data: 'uat' };
    // `../../../` from `<tmp>/pages/dist/uat` is `<tmp>`.
    const out = await assembleReal([index, { name: '../../../parent', data: 'x' }]);
    expect(existsSync(join(dirname(out), 'parent'))).toBe(false);
    expect(existsSync(join(out, 'dist', 'uat', 'parent'))).toBe(true);
    const root = tempDir();
    const escaped = join(root, 'escaped');
    for (const [name, entries, error] of [
      ['absolute', [index, { name: escaped, data: 'x' }], /stripped absolute path/],
      [
        'through a link',
        [index, { name: 'link', link: root }, { name: 'link/escaped', data: 'x' }],
        /link exists but is not directory/,
      ],
      ['a link', [index, { name: 'link', link: '/etc/passwd' }], /neither a file nor a directory/],
    ] as const) {
      await expect(assembleReal(entries), name).rejects.toThrow(error);
      expect(existsSync(escaped), name).toBe(false);
    }
  });
});

describe('the REST client', () => {
  const urlOf = (input: Parameters<typeof fetch>[0]): string =>
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const page = (body: unknown, next?: string): Response =>
    new Response(JSON.stringify(body), {
      headers:
        next === undefined ? {} : { link: `<${next}>; rel="next", <https://x/last>; rel="last"` },
    });
  const client = (responses: Record<string, Response>): Api =>
    restApi({ token: 't', apiUrl: 'https://api' }, (input) => {
      const response = responses[urlOf(input)];
      if (response === undefined) throw new Error(`unexpected ${urlOf(input)}`);
      return Promise.resolve(response);
    });

  it('reads every page of a list', async () => {
    const api = client({
      'https://api/runs?per_page=100': page(
        { total_count: 3, runs: [{ id: 1 }, { id: 2 }] },
        'https://api/p2',
      ),
      'https://api/p2': page({ total_count: 3, runs: [{ id: 3 }] }),
    });
    expect(await api.list('/runs?per_page=100', 'runs')).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('refuses a truncated list and one that changed while it was read', async () => {
    const truncated = client({
      'https://api/runs': page({ total_count: 1001, runs: [{ id: 1 }] }),
    });
    await expect(truncated.list('/runs', 'runs')).rejects.toThrow(/read 1 items .* of 1001/);
    const shifted = client({
      'https://api/d': page([{ id: 1 }, { id: 2 }], 'https://api/d2'),
      'https://api/d2': page([{ id: 2 }]),
    });
    await expect(shifted.list('/d')).rejects.toThrow(/2 distinct/);
  });

  it('downloads an artifact from its redirect without sending the token there', async () => {
    const seen: (string | null)[] = [];
    const api = restApi({ token: 't', apiUrl: 'https://api' }, (input, init) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return Promise.resolve(
        urlOf(input) === 'https://api/zip'
          ? new Response(null, { status: 302, headers: { location: 'https://blob/zip' } })
          : new Response('bytes'),
      );
    });
    expect((await api.download('/zip')).toString()).toBe('bytes');
    expect(seen).toEqual(['Bearer t', null]);
  });
});

it('runs under plain Node, as the deploy job runs it without installing packages', () => {
  const result = spawnSync(process.execPath, ['tools/uat-pages.ts', join(tempDir(), 'out')], {
    cwd: join(import.meta.dirname, '..'),
    env: { PATH: process.env['PATH'] ?? '' },
    encoding: 'utf8',
    timeout: 30_000,
    killSignal: 'SIGKILL',
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('::error::GH_TOKEN is not set');
});
