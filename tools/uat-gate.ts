// Decides whether a `develop` UAT deploy needs the owner's approval: only when the UAT deploy path
// changed since the last owner-approved UAT deployment. Every doubt gates. Both commits are read
// through the API, never checked out, and the script runs from `main`'s copy. It catches accidental
// changes to the path; the workflow that honours its verdict is `develop`'s own. Plain Node (`.ts`
// imports, no packages): YAML goes through `yq`.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  ENVIRONMENT,
  restApi,
  type Api,
  UAT_REF,
  type Deployment,
  type DeploymentStatus,
  type Job,
  type Run,
} from './uat-pages.ts';

export const WORKFLOW_FILE = '.github/workflows/ci.yml';
/** The jobs of `ci.yml` that build, vet and publish a UAT deploy. */
export const UAT_JOBS = ['preflight-uat', 'build-uat', 'deploy-uat', 'deploy-uat-gated'] as const;
/** The workflow-level keys of `ci.yml`; the first two must exist. */
export const WORKFLOW_KEYS = ['on', 'permissions', 'env', 'concurrency', 'defaults'] as const;
/**
 * What `build-uat` executes besides the app source: the toolchain and dependency pins it installs,
 * and the Vite config with the local modules it imports directly (their own imports are app code).
 */
export const PATH_FILES = [
  '.nvmrc',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'src/pwa/channel.ts',
  'src/pwa/config.ts',
  'tools/changelog.ts',
] as const;
/** Other workflows and local actions, which could publish too; `ci.yml` is compared parsed. */
export const PATH_DIRS = ['.github/workflows/', '.github/actions/'] as const;

export type ParseYaml = (text: string) => unknown;

export const yqParse: ParseYaml = (text) => {
  const result = spawnSync('yq', ['-o=json', '.'], {
    input: text,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`yq: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`yq exited ${String(result.status)}: ${result.stderr}`);
  return JSON.parse(result.stdout) as unknown;
};

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};

const time = (iso: string): number => Date.parse(iso);

/** The workflow whose runs the baseline must come from, and its job that waits for the owner. */
export const WORKFLOW = 'ci.yml';
export const GATED_JOB = 'deploy-uat-gated';
export const DEPLOYER = 'github-actions[bot]';

type Creator = Deployment & { creator?: { login?: string } | null };

/** Whether `deployment` is the one the successful `GATED_JOB` of a `develop` run of this repo made. */
const approvedByJob = async (api: Api, repo: string, deployment: Deployment): Promise<boolean> => {
  const runs = (
    (await api.list(
      `/repos/${repo}/actions/workflows/${WORKFLOW}/runs?head_sha=${deployment.sha}&per_page=100`,
      'workflow_runs',
    )) as Run[]
  ).filter(
    (run) =>
      run.head_sha === deployment.sha &&
      run.head_branch === UAT_REF &&
      (run.event === 'push' || run.event === 'workflow_dispatch'),
  );
  for (const run of runs) {
    const jobs = (await api.list(
      `/repos/${repo}/actions/runs/${String(run.id)}/jobs?filter=all&per_page=100`,
      'jobs',
    )) as Job[];
    for (const job of jobs) {
      if (job.name !== GATED_JOB || job.conclusion !== 'success') continue;
      const checkRun = `/repos/${repo}/check-runs/${String(job.id)}`;
      if (!job.check_run_url.endsWith(checkRun)) continue;
      const link = (await api.get(checkRun)) as {
        id?: number;
        deployment?: { id?: number } | null;
      };
      if (link.id === job.id && link.deployment?.id === deployment.id) return true;
    }
  }
  return false;
};

/**
 * The commit of the newest owner-approved UAT deployment: a `github-pages` deployment of `develop`
 * made by Actions, whose latest status is `success`, and which a successful `GATED_JOB` of a CI run
 * of that commit produced. A production approval, or a deployment made through the API, is no
 * approval of the UAT deploy path.
 */
export const findBaseline = async (api: Api, repo: string): Promise<string> => {
  const deployments = (
    (await api.list(
      `/repos/${repo}/deployments?environment=${ENVIRONMENT}&per_page=100`,
    )) as Creator[]
  )
    .filter(
      (deployment) =>
        deployment.environment === ENVIRONMENT &&
        deployment.ref === UAT_REF &&
        deployment.creator?.login === DEPLOYER,
    )
    .sort((a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id);
  for (const deployment of deployments) {
    const statuses = (
      (await api.list(
        `/repos/${repo}/deployments/${String(deployment.id)}/statuses?per_page=100`,
      )) as DeploymentStatus[]
    ).sort((a, b) => time(b.created_at) - time(a.created_at) || b.id - a.id);
    if (statuses[0]?.state === 'success' && (await approvedByJob(api, repo, deployment)))
      return deployment.sha;
  }
  throw new Error(`no approved UAT ${ENVIRONMENT} deployment`);
};

interface Tree {
  tree?: { path: string; type: string; sha: string }[];
  truncated?: boolean;
}

/** The blob SHAs of the path files and directories, and the SHA of `ci.yml`. */
const fileShas = async (api: Api, repo: string, commit: string): Promise<Map<string, string>> => {
  const { tree, truncated } = (await api.get(
    `/repos/${repo}/git/trees/${commit}?recursive=1`,
  )) as Tree;
  if (tree === undefined || truncated !== false)
    throw new Error(`the tree of ${commit} is partial`);
  const shas = new Map<string, string>();
  for (const { path, type, sha } of tree) {
    if (type !== 'blob') continue;
    if (
      path === WORKFLOW_FILE ||
      (PATH_FILES as readonly string[]).includes(path) ||
      PATH_DIRS.some((dir) => path.startsWith(dir))
    )
      shas.set(path, sha);
  }
  return shas;
};

const workflowPath = (workflow: unknown): Record<string, unknown> => {
  const root = workflow as Record<string, unknown> & { jobs?: Record<string, unknown> };
  const picked: Record<string, unknown> = {};
  for (const key of WORKFLOW_KEYS) {
    const value = root[key];
    if (value !== undefined) picked[key] = value;
  }
  for (const key of ['on', 'permissions'] as const)
    if (picked[key] === undefined) throw new Error(`ci.yml has no ${key}`);
  const jobs: Record<string, unknown> = {};
  for (const name of UAT_JOBS) {
    const job = root.jobs?.[name];
    if (job === undefined) throw new Error(`ci.yml has no job ${name}`);
    jobs[name] = job;
  }
  return { ...picked, jobs };
};

/** The UAT deploy path of one commit as canonical JSON; throws when a part of it is missing. */
export const deployPath = async (
  api: Api,
  repo: string,
  commit: string,
  parseYaml: ParseYaml,
): Promise<string> => {
  const shas = await fileShas(api, repo, commit);
  for (const path of [WORKFLOW_FILE, ...PATH_FILES])
    if (!shas.has(path)) throw new Error(`${commit} has no ${path}`);
  const blob = (await api.get(`/repos/${repo}/git/blobs/${shas.get(WORKFLOW_FILE) ?? ''}`)) as {
    content?: string;
    encoding?: string;
  };
  if (blob.encoding !== 'base64' || typeof blob.content !== 'string')
    throw new Error(`${WORKFLOW_FILE} of ${commit} is not base64`);
  const text = Buffer.from(blob.content, 'base64').toString('utf8');
  shas.delete(WORKFLOW_FILE);
  return JSON.stringify(
    canonical({
      files: Object.fromEntries(shas),
      workflow: workflowPath(parseYaml(text)),
    }),
  );
};

export type Verdict = { gated: false } | { gated: true; reason: string };

export const decide = async (
  api: Api,
  repo: string,
  head: string,
  parseYaml: ParseYaml = yqParse,
): Promise<Verdict> => {
  try {
    const baseline = await findBaseline(api, repo);
    const [before, after] = [
      await deployPath(api, repo, baseline, parseYaml),
      await deployPath(api, repo, head, parseYaml),
    ];
    return before === after
      ? { gated: false }
      : { gated: true, reason: `the UAT deploy path changed since ${baseline}` };
  } catch (error) {
    return { gated: true, reason: error instanceof Error ? error.message : String(error) };
  }
};

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

/** Prints `ungated` only when the owner's approval can be skipped; anything else prints nothing. */
const main = async (): Promise<void> => {
  const api = restApi({
    token: env('GH_TOKEN'),
    apiUrl: process.env['GITHUB_API_URL'] ?? 'https://api.github.com',
  });
  const verdict = await decide(api, env('GITHUB_REPOSITORY'), env('GITHUB_SHA'));
  if (verdict.gated) console.error(`::notice::UAT deploy needs approval: ${verdict.reason}`);
  else console.log('ungated');
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `::notice::UAT deploy needs approval: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
