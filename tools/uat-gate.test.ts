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
interface Fixture {
  deployments: { id: number; sha: string; created_at: string }[];
  statuses: Record<number, { id: number; state: string; created_at: string }[]>;
  trees: Record<string, Tree>;
}

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
const mockApi = ({ deployments, statuses, trees }: Fixture): Api => {
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
      if (path.includes('/deployments?environment=github-pages&'))
        return Promise.resolve(deployments);
      return Promise.reject(new Error(`unexpected list ${path}`));
    },
    get: (path) => {
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
  deployments: [{ id: 1, sha: PROD, created_at: at(1) }],
  statuses: { 1: [{ id: 10, state: 'success', created_at: at(2) }] },
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
  it('takes the newest deployment whose latest status is a success', async () => {
    const api = mockApi({
      deployments: [
        { id: 1, sha: PROD, created_at: at(1) },
        { id: 3, sha: HEAD, created_at: at(30) },
        { id: 2, sha: UAT, created_at: at(10) },
      ],
      statuses: {
        1: [{ id: 10, state: 'success', created_at: at(2) }],
        2: [
          { id: 20, state: 'success', created_at: at(11) },
          { id: 21, state: 'inactive', created_at: at(20) },
        ],
        3: [{ id: 30, state: 'queued', created_at: at(31) }],
      },
      trees: {},
    });
    // 3 is still pending and 2 was superseded, so only 1 is both live and approved.
    expect(await findBaseline(api, REPO)).toBe(PROD);
  });

  it('fails when no deployment succeeded', async () => {
    const api = mockApi({ deployments: [], statuses: {}, trees: {} });
    await expect(findBaseline(api, REPO)).rejects.toThrow('no successful github-pages');
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
  ])('gates a change to %s', async (_name, change) => {
    const verdict = await run(withHead({ files: { ...files(), ...change } }));
    expect(verdict.gated).toBe(true);
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
