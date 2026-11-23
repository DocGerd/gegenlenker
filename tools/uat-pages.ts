// Assembles the Pages tree of a `develop` deploy: the production dist of the live `main` deploy,
// byte-verified and never rebuilt, with the UAT build of this run under `uat/`. Every doubt fails
// closed, since a wrong production dist would roll the live site back. Plain Node (`.ts` imports,
// no packages): the deploy job runs it without installing dependencies.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { prodManifest } from './prod-manifest.ts';

export const WORKFLOW = 'ci.yml';
export const PROD_JOB = 'deploy';
export const ENVIRONMENT = 'github-pages';
/** The only branch whose deployments are not production. */
export const UAT_REF = 'develop';
export const UAT_DIR = 'uat';
const MAIN_EVENTS = new Set(['push', 'workflow_dispatch']);
// A deploy job can report success a moment before its deployment's success status lands.
const STATUS_ATTEMPTS = 6;
const STATUS_WAIT_MS = 5000;

export interface Run {
  id: number;
  event: string;
  head_branch: string | null;
  head_sha: string;
  status: string | null;
  updated_at: string;
}

export interface Job {
  id: number;
  check_run_url: string;
  name: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface Deployment {
  id: number;
  ref: string;
  sha: string;
  environment: string;
  created_at: string;
}

export interface DeploymentStatus {
  id: number;
  state: string;
  created_at: string;
}

export interface Artifact {
  id: number;
  name: string;
  expired: boolean;
  created_at: string | null;
  digest?: string | null;
}

export interface Api {
  /** Every item of a REST list, across all pages; `key` names the array of an object response. */
  list: (path: string, key?: string) => Promise<unknown[]>;
  get: (path: string) => Promise<unknown>;
  /** An artifact zip, by its REST path. */
  download: (path: string) => Promise<Buffer>;
}

const nextLink = (link: string | null): string | undefined =>
  link
    ?.split(',')
    .map((part) => /<([^>]+)>;\s*rel="next"/.exec(part)?.[1])
    .find((url) => url !== undefined);

export const restApi = (
  { token, apiUrl }: { token: string; apiUrl: string },
  fetchFn: typeof fetch = fetch,
): Api => {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const request = async (url: string): Promise<Response> => {
    const response = await fetchFn(url, { headers });
    if (!response.ok) throw new Error(`GET ${url}: ${String(response.status)}`);
    return response;
  };
  return {
    list: async (path, key) => {
      const items: unknown[] = [];
      let total: unknown;
      let url = nextLink(`<${apiUrl}${path}>; rel="next"`);
      while (url !== undefined) {
        const response = await request(url);
        const body = (await response.json()) as unknown;
        const page = key === undefined ? body : (body as Record<string, unknown>)[key];
        if (!Array.isArray(page)) throw new Error(`${path}: no list in the response`);
        if (key !== undefined) total = (body as { total_count?: unknown }).total_count;
        items.push(...(page as unknown[]));
        url = nextLink(response.headers.get('link'));
      }
      // The list order is undocumented: a list that changed while it was read, or one the API
      // truncates, is refused rather than trusted.
      const ids = new Set(items.map((item) => (item as { id?: unknown }).id));
      if (ids.size !== items.length || (key !== undefined && total !== items.length))
        throw new Error(
          `${path}: read ${String(items.length)} items (${String(ids.size)} distinct) of ${String(total)}; re-run`,
        );
      return items;
    },
    get: async (path) => (await request(`${apiUrl}${path}`)).json() as Promise<unknown>,
    download: async (path) => {
      // The redirect target is pre-signed storage, which must not receive the token.
      const response = await fetchFn(`${apiUrl}${path}`, { headers, redirect: 'manual' });
      const location = response.headers.get('location');
      if (response.status !== 302 || location === null)
        throw new Error(`GET ${path}: ${String(response.status)}, not a redirect`);
      const blob = await fetchFn(location);
      if (!blob.ok) throw new Error(`GET ${path} (redirect): ${String(blob.status)}`);
      return Buffer.from(await blob.arrayBuffer());
    },
  };
};

const time = (iso: string | null): number => (iso === null ? Number.NaN : Date.parse(iso));
const newest = <T>(items: readonly T[], at: (item: T) => string): T | undefined =>
  [...items].sort((a, b) => time(at(b)) - time(at(a)))[0];

const statusesOf = async (api: Api, repo: string, id: number): Promise<DeploymentStatus[]> =>
  (await api.list(
    `/repos/${repo}/deployments/${String(id)}/statuses?per_page=100`,
  )) as DeploymentStatus[];

export interface ProdDist {
  run: Run;
  job: Job;
  deployment: Deployment;
  artifact: Artifact & { digest: string };
}

export interface Options {
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The prod dist of the latest successful `deploy` job of a `push` or `workflow_dispatch` run on
 * `main`. Its deployment must have succeeded and no newer production deployment may have; the run
 * must hold exactly one unexpired `prod-dist-<sha>`, uploaded before the job started.
 */
export const findProdDist = async (
  api: Api,
  repo: string,
  { sleep = (ms) => delay(ms) }: Options = {},
): Promise<ProdDist> => {
  const runs = (
    (await api.list(
      `/repos/${repo}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=100`,
      'workflow_runs',
    )) as Run[]
  )
    .filter((run) => MAIN_EVENTS.has(run.event) && run.head_branch === 'main')
    .sort((a, b) => time(b.updated_at) - time(a.updated_at));
  let best: { run: Run; job: Job } | undefined;
  for (const run of runs) {
    // A finished run was last updated no earlier than its jobs finished, so older ones are skipped
    // (no documented guarantee: the deployment check below fails closed if it does not hold).
    if (
      best !== undefined &&
      run.status === 'completed' &&
      time(run.updated_at) < time(best.job.completed_at)
    )
      continue;
    const jobs = (await api.list(
      `/repos/${repo}/actions/runs/${String(run.id)}/jobs?filter=all&per_page=100`,
      'jobs',
    )) as Job[];
    for (const job of jobs) {
      if (job.name !== PROD_JOB || job.conclusion !== 'success') continue;
      const done = time(job.completed_at);
      if (Number.isNaN(done)) continue;
      const bestDone = best === undefined ? Number.NEGATIVE_INFINITY : time(best.job.completed_at);
      if (done > bestDone) best = { run, job };
    }
  }
  if (best === undefined) throw new Error(`no successful ${PROD_JOB} job on main`);
  const { run, job } = best;
  const at = `${PROD_JOB} job ${String(job.id)} (run ${String(run.id)})`;
  // A job is its check run (`check_run_url`), whose `deployment` is the environment's deployment.
  const checkRun = `/repos/${repo}/check-runs/${String(job.id)}`;
  if (!job.check_run_url.endsWith(checkRun)) throw new Error(`${at} is not ${checkRun}`);
  const { id, deployment: link } = (await api.get(checkRun)) as {
    id?: number;
    deployment?: { id?: number } | null;
  };
  const deploymentId = link?.id;
  if (id !== job.id || deploymentId === undefined) throw new Error(`${at} has no deployment`);
  const deployment = (await api.get(
    `/repos/${repo}/deployments/${String(deploymentId)}`,
  )) as Deployment;
  if (deployment.environment !== ENVIRONMENT || deployment.sha !== run.head_sha)
    throw new Error(
      `${at}: deployment ${String(deploymentId)} is not ${ENVIRONMENT} at ${run.head_sha}`,
    );
  for (let attempt = 1; ; attempt++) {
    const statuses = await statusesOf(api, repo, deployment.id);
    if (statuses.some(({ state }) => state === 'success')) break;
    // Never fall back to an older deploy: that one is no longer live.
    if (attempt === STATUS_ATTEMPTS)
      throw new Error(`${at}: deployment ${String(deployment.id)} has no success status`);
    await sleep(STATUS_WAIT_MS);
  }

  // The deployment side must agree: no newer production deployment went live or is going live
  // (one from a deleted run, or a failed job that deployed nonetheless).
  const deployments = (await api.list(
    `/repos/${repo}/deployments?environment=${ENVIRONMENT}&per_page=100`,
  )) as Deployment[];
  for (const other of deployments) {
    const newer =
      time(other.created_at) > time(deployment.created_at) ||
      (other.created_at === deployment.created_at && other.id > deployment.id);
    if (other.ref === UAT_REF || !newer) continue;
    const statuses = await statusesOf(api, repo, other.id);
    const latest = newest(statuses, (status) => status.created_at)?.state;
    if (latest === 'in_progress' || statuses.some(({ state }) => state === 'success'))
      throw new Error(
        `deployment ${String(other.id)} (${other.ref} ${other.sha}) is newer than ${at}'s and ${latest ?? 'unknown'}`,
      );
  }

  const name = `prod-dist-${run.head_sha}`;
  const dists = (
    (await api.list(
      `/repos/${repo}/actions/runs/${String(run.id)}/artifacts?per_page=100`,
      'artifacts',
    )) as Artifact[]
  ).filter((artifact) => artifact.name.startsWith('prod-dist-'));
  const [artifact] = dists;
  if (dists.length !== 1 || artifact?.name !== name)
    throw new Error(
      `run ${String(run.id)} holds [${dists.map((a) => a.name).join(', ')}], not one ${name}`,
    );
  if (artifact.expired)
    throw new Error(
      `${name} has expired: run CI with workflow_dispatch on main, then on ${UAT_REF}`,
    );
  if (!(time(artifact.created_at) < time(job.started_at)))
    throw new Error(`${name} was not uploaded before ${at} started`);
  const { digest } = artifact;
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest))
    throw new Error(`${name} has no sha256 digest`);
  return { run, job, deployment, artifact: { ...artifact, digest } };
};

/** The UAT build this run uploaded. */
export const findUatDist = async (
  api: Api,
  repo: string,
  runId: string,
  sha: string,
): Promise<Artifact & { digest: string }> => {
  const name = `uat-dist-${sha}`;
  const dists = (
    (await api.list(
      `/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`,
      'artifacts',
    )) as Artifact[]
  ).filter((artifact) => artifact.name.startsWith('uat-dist-'));
  const [artifact] = dists;
  if (dists.length !== 1 || artifact?.name !== name || artifact.expired)
    throw new Error(
      `run ${runId} holds [${dists.map((a) => a.name).join(', ')}], not one live ${name}`,
    );
  const { digest } = artifact;
  if (typeof digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(digest))
    throw new Error(`${name} has no sha256 digest`);
  return { ...artifact, digest };
};

export type Extract = (zip: Buffer, dest: string) => void;

export const unzip: Extract = (zip, dest) => {
  const dir = mkdtempSync(join(tmpdir(), 'uat-pages-'));
  try {
    const file = join(dir, 'artifact.zip');
    writeFileSync(file, zip);
    const result = spawnSync('unzip', ['-q', file, '-d', dest], { encoding: 'utf8' });
    if (result.status !== 0)
      throw new Error(`unzip into ${dest} failed: ${result.stdout}${result.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const fetchArtifact = async (
  api: Api,
  repo: string,
  artifact: Artifact & { digest: string },
  dest: string,
  extract: Extract,
): Promise<void> => {
  const zip = await api.download(`/repos/${repo}/actions/artifacts/${String(artifact.id)}/zip`);
  const digest = `sha256:${createHash('sha256').update(zip).digest('hex')}`;
  if (digest !== artifact.digest)
    throw new Error(`${artifact.name}: the download is ${digest}, not ${artifact.digest}`);
  mkdirSync(dest, { recursive: true });
  extract(zip, dest);
};

/** The path of a `sha256sum` line: after the 64 hex digits and two spaces. */
const pathOf = (line: string): string => line.slice(66).replace(/\n$/, '');
const manifestPaths = (manifest: string): string[] =>
  manifest
    .split(/(?<=\n)/)
    .filter((line) => line !== '')
    .map(pathOf);

const inUat = (path: string): boolean => path === UAT_DIR || path.startsWith(`${UAT_DIR}/`);

/** `sha256sum --check --strict` of `manifest` in `dist`, as `build-pages` wrote it. */
const sha256sumCheck = (dist: string, manifest: string): void => {
  const result = spawnSync('sha256sum', ['--check', '--quiet', '--strict', manifest], {
    cwd: dist,
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`${dist} does not match ${manifest}: ${result.stdout}${result.stderr}`);
};

/** The unpacked `prod-dist-<sha>` in `root`: exactly the manifest's files, for commit `sha`. */
export const verifyProdDist = (root: string, sha: string): string => {
  const entries = readdirSync(root).sort();
  if (entries.join(' ') !== 'dist prod-commit.txt prod-manifest.txt')
    throw new Error(`the production artifact holds ${entries.join(', ')}`);
  if (readFileSync(join(root, 'prod-commit.txt'), 'utf8') !== `${sha}\n`)
    throw new Error(`prod-commit.txt does not name ${sha}`);
  const dist = join(root, 'dist');
  const manifestFile = join(root, 'prod-manifest.txt');
  const manifest = readFileSync(manifestFile, 'utf8');
  sha256sumCheck(dist, manifestFile);
  // `sha256sum --check` ignores files the manifest does not list.
  if (prodManifest(dist) !== manifest)
    throw new Error('the production dist differs from its manifest');
  if (manifestPaths(manifest).some(inUat))
    throw new Error(
      `the production dist has a ${UAT_DIR}/ path, which the UAT build would overlay`,
    );
  return manifest;
};

/** Production verified, then the UAT build under `uat/`, then both checked again as uploaded. */
export const assemble = async (
  api: Api,
  { repo, runId, sha, out }: { repo: string; runId: string; sha: string; out: string },
  {
    extract = unzip,
    prodOnly = false,
    ...options
  }: Options & { extract?: Extract; prodOnly?: boolean } = {},
): Promise<ProdDist> => {
  if (existsSync(out)) throw new Error(`${out} exists`);
  const prod = await findProdDist(api, repo, options);
  await fetchArtifact(api, repo, prod.artifact, out, extract);
  const manifest = verifyProdDist(out, prod.run.head_sha);
  if (prodOnly) return prod;

  const dist = join(out, 'dist');
  await fetchArtifact(
    api,
    repo,
    await findUatDist(api, repo, runId, sha),
    join(dist, UAT_DIR),
    extract,
  );
  sha256sumCheck(dist, join(out, 'prod-manifest.txt'));
  const lines = prodManifest(dist).split(/(?<=\n)/);
  const outside = lines.filter((line) => !inUat(pathOf(line))).join('');
  if (outside !== manifest) throw new Error('the UAT build changed the production files');
  if (!lines.some((line) => pathOf(line) === `${UAT_DIR}/index.html`))
    throw new Error(`${UAT_DIR}/index.html is missing`);
  return prod;
};

const env = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
};

const main = async (): Promise<void> => {
  const [out, flag, ...rest] = process.argv.slice(2);
  if (out === undefined || rest.length > 0 || (flag !== undefined && flag !== '--prod-only'))
    throw new Error('usage: node tools/uat-pages.ts <out-dir> [--prod-only]');
  const prodOnly = flag === '--prod-only';
  const api = restApi({
    token: env('GH_TOKEN'),
    apiUrl: process.env['GITHUB_API_URL'] ?? 'https://api.github.com',
  });
  const prod = await assemble(
    api,
    {
      repo: env('GITHUB_REPOSITORY'),
      runId: prodOnly ? '' : env('GITHUB_RUN_ID'),
      sha: prodOnly ? '' : env('GITHUB_SHA'),
      out,
    },
    { prodOnly },
  );
  console.log(
    `::notice::production ${prod.run.head_sha} from ${PROD_JOB} job ${String(prod.job.id)} (run ${String(prod.run.id)}, deployment ${String(prod.deployment.id)})`,
  );
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
