import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import type { ChangelogEntry, Release } from '../src/app/changelog-entries';
import {
  VERSION_RE,
  compareVersions,
  loadFragments,
  loadReleases,
  releaseState,
  triple,
} from './changelog';
import { nextVersion } from './release';

export type Tool = 'git' | 'gh';

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs one command; the seam the tests stub `gh` through. */
export type Exec = (tool: Tool, args: readonly string[]) => ExecResult;

export const nodeExec =
  (cwd: string, env: NodeJS.ProcessEnv = process.env): Exec =>
  (tool, args) => {
    const result = spawnSync(tool, [...args], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      killSignal: 'SIGKILL',
    });
    return {
      status: result.status ?? 127,
      stdout: result.stdout,
      stderr: result.error === undefined ? result.stderr : String(result.error),
    };
  };

export interface Flow {
  exec: Exec;
  /** Reads still run, so every refusal is real; writes are printed and skipped. */
  dryRun: boolean;
  log: (line: string) => void;
}

const MAIN = 'refs/remotes/origin/main';
const DEVELOP = 'refs/remotes/origin/develop';

const quote = (arg: string): string => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg));
const show = (tool: Tool, args: readonly string[]): string => [tool, ...args.map(quote)].join(' ');
const lines = (text: string): string[] => text.split('\n').filter((line) => line !== '');

const run = (flow: Flow, tool: Tool, args: readonly string[]): string => {
  const { status, stdout, stderr } = flow.exec(tool, args);
  if (status !== 0)
    throw new Error(`${show(tool, args)} failed (${String(status)}): ${stderr.trim()}`);
  return stdout;
};

const read = (flow: Flow, tool: Tool, args: readonly string[]): string => {
  if (flow.dryRun) flow.log(`$ ${show(tool, args)}`);
  return run(flow, tool, args);
};

const write = (flow: Flow, tool: Tool, args: readonly string[]): string => {
  if (flow.dryRun) {
    flow.log(`[dry-run] ${show(tool, args)}`);
    return '';
  }
  flow.log(`$ ${show(tool, args)}`);
  return run(flow, tool, args);
};

const probe = (flow: Flow, tool: Tool, args: readonly string[]): ExecResult => {
  if (flow.dryRun) flow.log(`$ ${show(tool, args)}`);
  return flow.exec(tool, args);
};

const refExists = (flow: Flow, ref: string): boolean =>
  probe(flow, 'git', ['rev-parse', '--verify', '--quiet', ref]).status === 0;

/** `merge-base --is-ancestor`: 1 is "no", anything else but 0 is a failure. */
const isAncestor = (flow: Flow, ancestor: string, descendant: string): boolean => {
  const { status, stderr } = probe(flow, 'git', [
    'merge-base',
    '--is-ancestor',
    ancestor,
    descendant,
  ]);
  if (status > 1)
    throw new Error(`cannot compare ${ancestor} with ${descendant}: ${stderr.trim()}`);
  return status === 0;
};

const refuse = (problems: readonly string[]): never => {
  throw new Error(`refused:\n- ${problems.join('\n- ')}`);
};

/** `package.json` and `changelog.d/` of `ref`, read from git so the working tree never matters. */
const withTree = <T>(flow: Flow, ref: string, use: (root: string) => T): T => {
  const root = mkdtempSync(join(tmpdir(), 'release-flow-'));
  try {
    if (flow.dryRun) flow.log(`$ git show ${ref}:package.json ${ref}:changelog.d/*`);
    const files = lines(
      run(flow, 'git', ['ls-tree', '-r', '--name-only', ref, '--', 'package.json', 'changelog.d']),
    );
    for (const file of files) {
      const path = join(root, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, run(flow, 'git', ['show', `${ref}:${file}`]));
    }
    return use(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

/** Branch name to tip sha, as the remote has it now (a fetch never forgets deleted branches). */
const remoteHeads = (flow: Flow): Map<string, string> => {
  const heads = new Map<string, string>();
  for (const line of lines(read(flow, 'git', ['ls-remote', '--heads', 'origin']))) {
    const [sha, ref] = line.split('\t');
    if (sha !== undefined && ref?.startsWith('refs/heads/') === true)
      heads.set(ref.slice('refs/heads/'.length), sha);
  }
  return heads;
};

/** release/* branches whose tip is not yet on main: a release in flight. */
const openReleases = (flow: Flow, heads: ReadonlyMap<string, string>): string[] =>
  [...heads]
    .filter(
      ([name, sha]) =>
        name.startsWith('release/') &&
        VERSION_RE.test(name.slice('release/'.length)) &&
        !isAncestor(flow, sha, MAIN),
    )
    .map(([name]) => name.slice('release/'.length))
    .sort(compareVersions);

/** Fetches, then requires the two long-lived branches; a dirty tree is refused when asked. */
const prelude = (flow: Flow, options: { clean: boolean }): Map<string, string> => {
  read(flow, 'git', ['fetch', '--tags', 'origin']);
  const problems: string[] = [];
  if (options.clean && read(flow, 'git', ['status', '--porcelain']) !== '')
    problems.push('the working tree is dirty; commit or stash first');
  if (!refExists(flow, MAIN)) problems.push('origin/main does not exist');
  if (!refExists(flow, DEVELOP))
    problems.push('origin/develop does not exist: the gitflow cutover has not happened');
  if (problems.length > 0) refuse(problems);
  return remoteHeads(flow);
};

const nextPatch = (version: string): string => {
  const [major = 0, minor = 0, patch = 0] = triple(version);
  return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
};

/** Same major and minor as the released version: it would take the version a hotfix needs. */
export const isPatchRelease = (release: string, released: string): boolean => {
  const [a, b] = [triple(release), triple(released)];
  return a[0] === b[0] && a[1] === b[1];
};

const CLOSING_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+#(\d+)/gi;

/** Issue numbers the bodies close, as sorted unique `Closes #n` lines. */
export const closingLines = (bodies: readonly (string | null | undefined)[]): string[] => {
  const issues = new Set<number>();
  for (const body of bodies)
    for (const match of (body ?? '').matchAll(CLOSING_RE)) issues.add(Number(match[1]));
  return [...issues].sort((a, b) => a - b).map((issue) => `Closes #${String(issue)}`);
};

const versionArg = (version: string | undefined): void => {
  if (version !== undefined && !VERSION_RE.test(version))
    throw new Error(`version must be x.y.z, got ${version}`);
};

/** Problems with creating `branch` for `version`: a branch or tag of that name exists. */
const taken = (flow: Flow, heads: ReadonlyMap<string, string>, branch: string, version: string) => {
  const out: string[] = [];
  if (heads.has(branch) || refExists(flow, `refs/heads/${branch}`))
    out.push(`branch ${branch} already exists`);
  if (refExists(flow, `refs/tags/v${version}`)) out.push(`tag v${version} already exists`);
  return out;
};

const pushBranch = (flow: Flow, from: string, branch: string): void => {
  write(flow, 'git', ['push', 'origin', `${from}:refs/heads/${branch}`]);
};

interface Pending {
  entries: ChangelogEntry[];
  /** The last versioned group: what `release:prepare` bumps from. */
  previous: string | undefined;
}

const pending = (root: string): Pending => {
  const dir = join(root, 'changelog.d');
  const releases = loadReleases(dir) as Release[];
  const [head] = releases;
  return {
    entries: [...(head?.version === null ? head.entries : []), ...loadFragments(dir)],
    previous: releases.find((release) => release.version !== null)?.version ?? undefined,
  };
};

/**
 * Creates release/x.y.z from origin/develop and pushes it; returns the version. Without an
 * argument the version comes from develop's pending entries, as `release:prepare` derives it.
 */
export const releaseCut = (flow: Flow, requested?: string): string => {
  versionArg(requested);
  const heads = prelude(flow, { clean: true });
  const problems: string[] = [];

  const released = withTree(flow, MAIN, releaseState).version;
  if (!isAncestor(flow, MAIN, DEVELOP))
    problems.push(
      'origin/main is not an ancestor of origin/develop: the last release was not back-merged (pnpm release:backmerge, then --verify)',
    );
  const open = openReleases(flow, heads);
  if (open.length > 0)
    problems.push(`release/${open.join(', release/')} is still open; finish or abandon it first`);

  const { entries, previous } = withTree(flow, DEVELOP, pending);
  let version = requested;
  if (entries.length === 0) problems.push('nothing to release: develop has no pending entry');
  else if (version === undefined) {
    if (previous === undefined)
      problems.push('there is no earlier release to bump from; pass the version');
    else version = nextVersion(previous, entries);
  }
  if (version !== undefined) {
    if (compareVersions(version, released) <= 0)
      problems.push(`version ${version} must be above main's ${released}`);
    problems.push(...taken(flow, heads, `release/${version}`, version));
  }
  if (problems.length > 0 || version === undefined) return refuse(problems);

  pushBranch(flow, DEVELOP, `release/${version}`);
  flow.log(
    `release/${version} cut from origin/develop. Next: git fetch && git switch release/${version}, then pnpm release:prepare ${version} and a PR into it.`,
  );
  return version;
};

/** Creates hotfix/x.y.z (the next patch above main) from origin/main and pushes it. */
export const hotfixCut = (flow: Flow): string => {
  const heads = prelude(flow, { clean: true });
  const problems: string[] = [];

  const released = withTree(flow, MAIN, releaseState).version;
  if (!refExists(flow, `refs/tags/v${released}`))
    return refuse([
      `main's version ${released} has no tag v${released}: there is no release to patch. Put the fix into develop and run pnpm release:cut.`,
    ]);
  const version = nextPatch(released);
  const patch = openReleases(flow, heads).filter((release) => isPatchRelease(release, released));
  if (patch.length > 0)
    problems.push(
      `release/${patch.join(', release/')} is a patch release and would take version ${version} too: put the fix into that release branch by PR instead`,
    );
  problems.push(...taken(flow, heads, `hotfix/${version}`, version));
  if (problems.length > 0) return refuse(problems);

  pushBranch(flow, MAIN, `hotfix/${version}`);
  flow.log(
    `hotfix/${version} cut from origin/main. Next: git fetch && git switch hotfix/${version}, commit the fix and its fragment, pnpm release:prepare ${version}, then a PR into main.`,
  );
  return version;
};

const prList = (flow: Flow, filter: '--base' | '--head', branch: string): unknown[] => {
  const out = read(flow, 'gh', [
    'pr',
    'list',
    '--state',
    'merged',
    filter,
    branch,
    '--limit',
    '200',
    '--json',
    'number,body',
  ]);
  const parsed: unknown = JSON.parse(out === '' ? '[]' : out);
  return Array.isArray(parsed) ? parsed : [];
};

/** The branch a back-merge of main goes into: the open release if any (hotfix), else develop. */
const backMergeTarget = (flow: Flow, heads: ReadonlyMap<string, string>): string => {
  const open = openReleases(flow, heads);
  if (open.length > 1)
    return refuse([`more than one release is open (release/${open.join(', release/')})`]);
  return open[0] === undefined ? 'develop' : `release/${open[0]}`;
};

const targetRef = (target: string): string => `refs/remotes/origin/${target}`;

/**
 * After a release or hotfix is tagged and published: cuts feature/back-merge-x.y.z from origin/main
 * and opens a PR into the open release (hotfix case) or develop. Returns the target branch.
 */
export const backMerge = (flow: Flow, requested?: string): string => {
  versionArg(requested);
  const heads = prelude(flow, { clean: false });
  const problems: string[] = [];

  const version = requested ?? withTree(flow, MAIN, releaseState).version;
  const tag = `refs/tags/v${version}`;
  if (!refExists(flow, tag))
    problems.push(`tag v${version} does not exist: the release job tags after the deploy`);
  else if (!isAncestor(flow, tag, MAIN)) problems.push(`tag v${version} is not on origin/main`);
  const release = probe(flow, 'gh', [
    'release',
    'view',
    `v${version}`,
    '--json',
    'tagName,isDraft',
  ]);
  if (
    release.status !== 0 ||
    (JSON.parse(release.stdout || '{}') as { isDraft?: boolean }).isDraft === true
  )
    problems.push(`there is no published GitHub Release v${version}`);

  const target = backMergeTarget(flow, heads);
  if (isAncestor(flow, MAIN, targetRef(target)))
    problems.push(`${target} already contains origin/main: nothing to back-merge`);
  const head = `feature/back-merge-${version}`;
  if (heads.has(head) || refExists(flow, `refs/heads/${head}`))
    problems.push(`branch ${head} already exists`);
  if (problems.length > 0) refuse(problems);

  const closing = closingLines(
    [
      ...prList(flow, '--base', `release/${version}`),
      ...prList(flow, '--head', `release/${version}`),
      ...prList(flow, '--head', `hotfix/${version}`),
    ].map((pr) => (pr as { body?: string | null }).body),
  );
  const body = [
    `Back-merge of v${version} into ${target}. Merge with a merge commit, never squash or rebase.`,
    ...(closing.length > 0 ? ['', ...closing] : []),
  ].join('\n');

  pushBranch(flow, MAIN, head);
  const url = write(flow, 'gh', [
    'pr',
    'create',
    '--base',
    target,
    '--head',
    head,
    '--title',
    `chore: back-merge v${version} into ${target}`,
    '--body',
    body,
  ]);
  if (url.trim() !== '') flow.log(url.trim());
  flow.log(
    `After it merges: pnpm release:backmerge --verify. Conflicts (released.json, CHANGELOG.md, package.json): merge origin/${target} into ${head} locally.`,
  );
  return target;
};

/** After the back-merge PR merged: origin/main must be an ancestor of the target. */
export const verifyBackMerge = (flow: Flow): string => {
  const heads = prelude(flow, { clean: false });
  const target = backMergeTarget(flow, heads);
  if (!isAncestor(flow, MAIN, targetRef(target)))
    return refuse([
      `origin/main is not an ancestor of origin/${target}: the back-merge is missing, or it was squashed or rebased. Merge origin/main into ${target} with a merge commit.`,
    ]);
  flow.log(`origin/main is an ancestor of origin/${target}.`);
  return target;
};

export type Command = 'release-cut' | 'release-backmerge' | 'hotfix-cut';

export interface Output {
  log: (line: string) => void;
  error: (line: string) => void;
}

/** The scripts' entry: parses argv, runs the command in `cwd`, returns the exit code. */
export const runCli = (
  command: Command,
  argv: readonly string[],
  cwd: string,
  out: Output,
): number => {
  try {
    const { positionals, values } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: { 'dry-run': { type: 'boolean' }, verify: { type: 'boolean' } },
    });
    const flow: Flow = { exec: nodeExec(cwd), dryRun: values['dry-run'] === true, log: out.log };
    if (values.verify === true && command !== 'release-backmerge')
      throw new Error('--verify belongs to release:backmerge');
    if (positionals.length > (command === 'hotfix-cut' ? 0 : 1))
      throw new Error('unexpected arguments');
    if (command === 'hotfix-cut') hotfixCut(flow);
    else if (command === 'release-cut') releaseCut(flow, positionals[0]);
    else if (values.verify === true) verifyBackMerge(flow);
    else backMerge(flow, positionals[0]);
    return 0;
  } catch (error) {
    out.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};
