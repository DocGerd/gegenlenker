import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  PATH_FILES,
  UAT_JOBS,
  WORKFLOW_FILE,
  decide,
  findBaseline,
  yqParse,
  type ParseYaml,
} from './uat-gate';
import type { Api } from './uat-pages';

const REPO = 'DocGerd/gegenlenker';
const HEAD = 'a'.repeat(40);
const PROD = 'b'.repeat(40);
const UAT = 'c'.repeat(40);
const ROOT = join(import.meta.dirname, '..');

const at = (minute: number): string => new Date(Date.UTC(2026, 10, 1, 0, minute)).toISOString();

type Files = Record<string, string>;
interface Tree {
  files: Files;
  workflow: string;
  truncated?: boolean;
}
interface TestDeployment {
  id: number;
  sha: string;
  created_at: string;
  environment: string;
  ref: string;
  creator: { login: string };
}
interface TestRun {
  id: number;
  event: string;
  head_branch: string;
  head_sha: string;
  jobs: { id: number; name: string; conclusion: string; deployment: number }[];
}
interface Fixture {
  deployments: TestDeployment[];
  statuses: Record<number, { id: number; state: string; created_at: string }[]>;
  runs: TestRun[];
  trees: Record<string, Tree>;
}

/** A `develop` deployment of the actor who triggered the run, by default. */
const deployment = (id: number, sha: string, minute: number, own = {}): TestDeployment => ({
  id,
  sha,
  created_at: at(minute),
  environment: 'github-pages',
  ref: 'develop',
  creator: { login: 'DocGerd' },
  ...own,
});
/** The CI run of `sha` whose `deploy-uat-gated` job made deployment `id`, by default. */
const runOf = (id: number, sha: string, own: Partial<TestRun> = {}): TestRun => ({
  id: 1000 + id,
  event: 'push',
  head_branch: 'develop',
  head_sha: sha,
  jobs: [{ id: 2000 + id, name: 'deploy-uat-gated', conclusion: 'success', deployment: id }],
  ...own,
});

const job = (name: string, runsOn = 'ubuntu-latest'): string => `  ${name}: { runs-on: ${runsOn} }`;
const ci = ({ drop = '', swap = '', extra = '' } = {}): string =>
  [
    'on: { push: { branches: [main, develop] } }',
    'permissions: { contents: read }',
    extra,
    'jobs:',
    job('lint'),
    ...UAT_JOBS.filter((name) => name !== drop).map((name) =>
      job(name, name === swap ? 'macos-latest' : 'ubuntu-latest'),
    ),
  ].join('\n');
const files = (): Files =>
  Object.fromEntries(
    [...PATH_FILES, '.github/workflows/scorecard.yml'].map((path) => [path, `blob-${path}`]),
  );

/** The REST answers for these deployments, trees and blobs. */
const mockApi = ({ deployments, statuses, runs, trees }: Fixture): Api => {
  const blobs = new Map<string, string>();
  const treeOf = (commit: string): unknown => {
    const tree = trees[commit];
    if (tree === undefined) throw new Error(`GET ${commit}: 404`);
    blobs.set(`workflow-${commit}`, tree.workflow);
    return {
      truncated: tree.truncated ?? false,
      tree: [
        ...Object.entries(tree.files).map(([path, sha]) => ({ path, type: 'blob', sha })),
        { path: WORKFLOW_FILE, type: 'blob', sha: `workflow-${commit}` },
        // App source is not the deploy path: it differs per commit.
        { path: 'src/main.ts', type: 'blob', sha: `app-${commit}` },
        { path: 'src', type: 'tree', sha: `src-${commit}` },
      ],
    };
  };
  return {
    list: (path) => {
      const id = /deployments\/(\d+)\/statuses/.exec(path)?.[1];
      if (id !== undefined) return Promise.resolve(statuses[Number(id)] ?? []);
      const sha = /workflows\/ci\.yml\/runs\?head_sha=(\w+)&/.exec(path)?.[1];
      // The API filters by commit; answering with every run proves the tool does not trust it.
      if (sha !== undefined) return Promise.resolve(runs);
      const runId = /actions\/runs\/(\d+)\/jobs/.exec(path)?.[1];
      if (runId !== undefined)
        return Promise.resolve(
          (runs.find((run) => run.id === Number(runId))?.jobs ?? []).map((each) => ({
            ...each,
            check_run_url: `https://api.github.com/repos/${REPO}/check-runs/${String(each.id)}`,
          })),
        );
      if (path.includes('/deployments?environment=github-pages&'))
        return Promise.resolve(deployments);
      return Promise.reject(new Error(`unexpected list ${path}`));
    },
    get: (path) => {
      const checkRun = /check-runs\/(\d+)$/.exec(path)?.[1];
      if (checkRun !== undefined) {
        const found = runs.flatMap((run) => run.jobs).find((each) => each.id === Number(checkRun));
        return Promise.resolve({ id: found?.id, deployment: { id: found?.deployment } });
      }
      const commit = /git\/trees\/([0-9a-f]+)\?recursive=1$/.exec(path)?.[1];
      if (commit !== undefined) return Promise.resolve(treeOf(commit));
      const text = blobs.get(/git\/blobs\/(.+)$/.exec(path)?.[1] ?? '');
      if (text === undefined) return Promise.reject(new Error(`unexpected get ${path}`));
      return Promise.resolve({ encoding: 'base64', content: Buffer.from(text).toString('base64') });
    },
    download: () => Promise.reject(new Error('unexpected download')),
  };
};

/** `PROD` is the approved deployment; `HEAD` is the same deploy path. */
const approved = (): Fixture => ({
  deployments: [deployment(1, PROD, 1)],
  statuses: { 1: [{ id: 10, state: 'success', created_at: at(2) }] },
  runs: [runOf(1, PROD)],
  trees: {
    [PROD]: { files: files(), workflow: ci() },
    [HEAD]: { files: files(), workflow: ci() },
  },
});
const withHead = (head: Partial<Tree>, base: Partial<Tree> = {}): Fixture => {
  const fixture = approved();
  fixture.trees[HEAD] = { files: files(), workflow: ci(), ...head };
  fixture.trees[PROD] = { files: files(), workflow: ci(), ...base };
  return fixture;
};

describe('findBaseline', () => {
  it('takes the newest approved deployment that succeeded, even if a later deploy made it inactive', async () => {
    const fixture: Fixture = {
      deployments: [deployment(1, PROD, 1), deployment(3, HEAD, 30), deployment(2, UAT, 10)],
      statuses: {
        1: [{ id: 10, state: 'success', created_at: at(2) }],
        2: [
          { id: 20, state: 'success', created_at: at(11) },
          { id: 21, state: 'inactive', created_at: at(20) },
        ],
        3: [{ id: 30, state: 'queued', created_at: at(31) }],
      },
      runs: [runOf(1, PROD), runOf(2, UAT), runOf(3, HEAD)],
      trees: {},
    };
    // 3 never succeeded; 2 did, and `inactive` only says a later deploy replaced it.
    expect(await findBaseline(mockApi(fixture), REPO)).toBe(UAT);
  });

  it('fails when no deployment succeeded', async () => {
    const api = mockApi({ ...approved(), deployments: [] });
    await expect(findBaseline(api, REPO)).rejects.toThrow('no approved UAT github-pages');
  });

  it.each([['failure'], ['error'], ['queued'], ['in_progress'], ['inactive']])(
    'skips a history that never succeeded (%s)',
    async (state) => {
      const statuses = {
        1: [
          { id: 10, state: 'waiting', created_at: at(2) },
          { id: 11, state, created_at: at(3) },
        ],
      };
      const api = mockApi({ ...approved(), statuses });
      await expect(findBaseline(api, REPO)).rejects.toThrow('no approved UAT');
    },
  );

  // Each variant is a record that must not count as the owner's approval of the UAT deploy path.
  it.each<[string, Partial<Fixture>]>([
    ['a production deployment of main', { deployments: [deployment(1, PROD, 1, { ref: 'main' })] }],
    [
      'another environment',
      { deployments: [deployment(1, PROD, 1, { environment: 'uat-pages' })] },
    ],
    ['a run of another commit', { runs: [runOf(1, UAT)] }],
    ['a run of another branch', { runs: [runOf(1, PROD, { head_branch: 'main' })] }],
    ['a run of a pull request', { runs: [runOf(1, PROD, { event: 'pull_request' })] }],
    [
      'another job',
      {
        runs: [
          runOf(1, PROD, {
            jobs: [{ id: 2001, name: 'deploy', conclusion: 'success', deployment: 1 }],
          }),
        ],
      },
    ],
    [
      'a failed job',
      {
        runs: [
          runOf(1, PROD, {
            jobs: [{ id: 2001, name: 'deploy-uat-gated', conclusion: 'failure', deployment: 1 }],
          }),
        ],
      },
    ],
    [
      'a job of another deployment',
      {
        runs: [
          runOf(1, PROD, {
            jobs: [{ id: 2001, name: 'deploy-uat-gated', conclusion: 'success', deployment: 9 }],
          }),
        ],
      },
    ],
    ['no run', { runs: [] }],
  ])('skips %s', async (_name, change) => {
    const api = mockApi({ ...approved(), ...change });
    await expect(findBaseline(api, REPO)).rejects.toThrow('no approved UAT');
  });
});

describe('decide', () => {
  const run = (fixture: Fixture, parser: ParseYaml = parse) =>
    decide(mockApi(fixture), REPO, HEAD, parser);

  it('lets an unchanged deploy path pass, whatever else changed', async () => {
    // Comments, key order, flow or block style, jobs outside the path and app source are not it.
    const workflow = `# comment\n${ci()}`
      .replace('permissions: { contents: read }', 'permissions:\n  contents: read')
      .replace(job('lint'), job('lint', 'macos-latest'));
    expect(await run(withHead({ workflow }))).toEqual({ gated: false });
  });

  it.each([
    ['a UAT job', ci({ swap: 'build-uat' })],
    ['a workflow-level key', ci({ extra: 'env: { A: b }' })],
    ['the triggers', ci().replace('branches: [main, develop]', 'branches: [main]')],
  ])('gates a change to %s', async (_name, workflow) => {
    expect(await run(withHead({ workflow }))).toEqual({
      gated: true,
      reason: `the UAT deploy path changed since ${PROD}`,
    });
  });

  it.each([
    ['a build file', { 'pnpm-lock.yaml': 'changed' }],
    ['another workflow', { '.github/workflows/scorecard.yml': 'changed' }],
    ['a new workflow', { '.github/workflows/new.yml': 'new' }],
    ['a new local action', { '.github/actions/x/action.yml': 'new' }],
    ['a new Vite config', { 'vite.config.mjs': 'new' }],
    ['a new PostCSS config', { 'postcss.config.cjs': 'new' }],
    ['a new .postcssrc', { '.postcssrc': 'new' }],
    ['a new .postcssrc.mjs', { '.postcssrc.mjs': 'new' }],
    ['a new .npmrc', { '.npmrc': 'new' }],
    ['a new pnpm hook', { '.pnpmfile.cjs': 'new' }],
  ])('gates a change to %s', async (_name, change) => {
    const verdict = await run(withHead({ files: { ...files(), ...change } }));
    expect(verdict.gated).toBe(true);
  });

  it('gates when a config file is removed, and ignores lookalikes', async () => {
    const extra = { 'vite.config.mjs': 'x', '.npmrc': 'x' };
    const removed = await run(withHead({}, { files: { ...files(), ...extra } }));
    expect(removed.gated).toBe(true);
    const lookalikes = {
      'src/vite.config.mjs': 'x',
      'vite.config.json': 'x',
      'docs/.npmrc': 'x',
      'postcss.config.mjs.bak': 'x',
    };
    expect(await run(withHead({ files: { ...files(), ...lookalikes } }))).toEqual({
      gated: false,
    });
  });

  it('gates when the baseline lacks a UAT job, a file or a complete tree', async () => {
    const lacking = files();
    delete lacking['.nvmrc'];
    for (const base of [
      { workflow: ci({ drop: 'deploy-uat-gated' }) },
      { files: lacking },
      { truncated: true },
    ])
      expect((await run(withHead({}, base))).gated).toBe(true);
  });

  it('gates when both commits lack a UAT job, so two missing jobs never compare equal', async () => {
    const workflow = ci({ drop: 'build-uat' });
    expect(await run(withHead({ workflow }, { workflow }))).toEqual({
      gated: true,
      reason: 'ci.yml has no job build-uat',
    });
  });

  it('gates with no approved deployment, an unreadable baseline or a failing parser', async () => {
    expect((await run({ ...approved(), deployments: [] })).gated).toBe(true);
    const trees = Object.fromEntries(
      Object.entries(approved().trees).filter(([commit]) => commit !== PROD),
    );
    expect((await run({ ...approved(), trees })).gated).toBe(true);
    const failing = (): never => {
      throw new Error('yq: not found');
    };
    expect(await run(approved(), failing)).toEqual({ gated: true, reason: 'yq: not found' });
  });
});

describe('the deploy path', () => {
  it('names files and jobs that exist', () => {
    for (const path of PATH_FILES) expect(() => readFileSync(join(ROOT, path)), path).not.toThrow();
    const { jobs } = parse(readFileSync(join(ROOT, WORKFLOW_FILE), 'utf8')) as {
      jobs: Record<string, unknown>;
    };
    for (const name of UAT_JOBS) expect(Object.keys(jobs)).toContain(name);
  });

  it('cannot parse without yq', () => {
    const path = process.env['PATH'];
    process.env['PATH'] = '';
    try {
      expect(() => yqParse('a: 1')).toThrow('yq');
    } finally {
      if (path === undefined) delete process.env['PATH'];
      else process.env['PATH'] = path;
    }
  });
});
