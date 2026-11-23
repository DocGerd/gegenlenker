import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Release } from '../src/app/changelog-entries';
import { renderChangelog } from './changelog';
import { stringifyReleases } from './release';
import {
  backMerge,
  closingLines,
  hotfixCut,
  isPatchRelease,
  nodeExec,
  releaseCut,
  verifyBackMerge,
  type Exec,
  type Flow,
} from './release-flow';

const PR_URL = 'https://github.com/DocGerd/gegenlenker/pull/';
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const group = (version: string | null, ids: string[]): Release => ({
  version,
  ...(version === null ? {} : { date: '2026-01-01' }),
  entries: ids.map((id) => ({ id, category: 'added', prs: [Number.parseInt(id, 10)], en: 'One.' })),
});

const treeFiles = (version: string, releases: Release[]): Record<string, string | null> => ({
  'package.json': `{\n  "name": "x",\n  "version": "${version}",\n  "scripts": {}\n}\n`,
  'changelog.d/released.json': stringifyReleases(releases),
  'changelog.d/README.md': 'readme',
  'CHANGELOG.md': renderChangelog(releases),
});

const fragment = (pr: number, category: string): Record<string, string> => ({
  [`changelog.d/${String(pr)}.${category}.md`]: `Pending ([#${String(pr)}](${PR_URL}${String(pr)})).\n`,
});

interface Repo {
  work: string;
  bare: string;
  /** Commits `files` (null deletes) on `branch` and pushes it; leaves develop checked out. */
  commitOn: (branch: string, files: Record<string, string | null>, message: string) => void;
}

const writeFiles = (root: string, files: Record<string, string | null>): void => {
  for (const [file, text] of Object.entries(files)) {
    const path = join(root, file);
    if (text === null) rmSync(path, { force: true });
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }
  }
};

interface RepoOptions {
  /** main already holds a tagged release 1.0.0; otherwise only the unreleased history. */
  released?: boolean;
  /** Category of the one pending fragment on develop; null for none. */
  pending?: string | null;
  develop?: boolean;
}

const makeRepo = ({
  released = true,
  pending = 'added',
  develop = true,
}: RepoOptions = {}): Repo => {
  const root = mkdtempSync(join(tmpdir(), 'release-flow-test-'));
  dirs.push(root);
  const bare = join(root, 'origin.git');
  const work = join(root, 'work');
  git(root, 'init', '--bare', '-b', 'main', bare);
  git(root, 'init', '-b', 'main', work);
  git(work, 'remote', 'add', 'origin', bare);
  const releases = released ? [group('1.0.0', ['1.added'])] : [group(null, ['1.added'])];
  writeFiles(work, treeFiles(released ? '1.0.0' : '0.0.0', releases));
  git(work, 'add', '-A');
  git(work, 'commit', '-m', 'main');
  git(work, 'push', 'origin', 'main');
  // Newer git creates origin/HEAD on the first fetch, which a dry run must not be seen to do.
  git(work, 'remote', 'set-head', 'origin', 'main');
  if (released) {
    git(work, 'tag', 'v1.0.0');
    git(work, 'push', 'origin', 'v1.0.0');
  }
  if (develop) {
    git(work, 'switch', '-c', 'develop');
    if (pending !== null) {
      writeFiles(work, fragment(7, pending));
      git(work, 'add', '-A');
      git(work, 'commit', '-m', 'pending');
    } else git(work, 'commit', '--allow-empty', '-m', 'develop');
    git(work, 'push', 'origin', 'develop');
  }
  const home = develop ? 'develop' : 'main';
  return {
    work,
    bare,
    commitOn: (branch, files, message) => {
      git(work, 'switch', branch);
      writeFiles(work, files);
      git(work, 'add', '-A');
      git(work, 'commit', '-m', message);
      git(work, 'push', 'origin', branch);
      git(work, 'switch', home);
    },
  };
};

/** What GitHub would do for a release or hotfix: merge commit into main, tag, branch deleted. */
const land = (repo: Repo, kind: 'release' | 'hotfix', version: string, tag = true): void => {
  const { work } = repo;
  const branch = `${kind}/${version}`;
  const base = kind === 'release' ? 'origin/develop' : 'origin/main';
  git(work, 'fetch', 'origin');
  git(work, 'switch', '-c', branch, base);
  writeFiles(work, {
    ...treeFiles(version, [group(version, ['9.fixed']), group('1.0.0', ['1.added'])]),
    'changelog.d/7.added.md': null,
    'changelog.d/7.fixed.md': null,
  });
  git(work, 'add', '-A');
  git(work, 'commit', '-m', `prepare ${version}`);
  git(work, 'push', 'origin', branch);
  git(work, 'switch', 'main');
  git(work, 'merge', '--no-ff', branch, '-m', `Merge ${branch}`);
  git(work, 'push', 'origin', 'main');
  if (tag) {
    git(work, 'tag', `v${version}`);
    git(work, 'push', 'origin', `v${version}`);
  }
  git(work, 'push', 'origin', '--delete', branch);
  git(work, 'branch', '-D', branch);
  git(work, 'switch', 'develop');
};

const mergeMainInto = (repo: Repo, branch: string, how: 'merge' | 'squash'): void => {
  const { work } = repo;
  git(work, 'fetch', 'origin');
  git(work, 'switch', '-C', branch, `origin/${branch}`);
  if (how === 'merge') git(work, 'merge', '--no-ff', 'origin/main', '-m', 'back-merge');
  else {
    git(work, 'merge', '--squash', 'origin/main');
    git(work, 'commit', '-m', 'back-merge (squashed)');
  }
  git(work, 'push', 'origin', branch);
  git(work, 'switch', 'develop');
};

interface Gh {
  calls: string[][];
  /** Tags that have a published GitHub Release. */
  releases: Set<string>;
  /** `base:<branch>` or `head:<branch>` to merged PRs. */
  prs: Record<string, { number: number; body: string | null }[]>;
}

const makeGh = (releases: string[] = []): Gh => ({
  calls: [],
  releases: new Set(releases),
  prs: {},
});

const makeFlow = (repo: Repo, gh: Gh = makeGh(), dryRun = false): { flow: Flow; log: string[] } => {
  const log: string[] = [];
  const real = nodeExec(repo.work, ENV);
  const exec: Exec = (tool, args) => {
    if (tool === 'git') return real(tool, args);
    gh.calls.push([...args]);
    const [group, verb] = args;
    if (group === 'release' && verb === 'view') {
      const tag = args[2] ?? '';
      return gh.releases.has(tag)
        ? { status: 0, stdout: JSON.stringify({ tagName: tag, isDraft: false }), stderr: '' }
        : { status: 1, stdout: '', stderr: 'release not found' };
    }
    if (group === 'pr' && verb === 'list') {
      const kind = args.includes('--base') ? '--base' : '--head';
      const branch = args[args.indexOf(kind) + 1] ?? '';
      return {
        status: 0,
        stdout: JSON.stringify(gh.prs[`${kind.slice(2)}:${branch}`] ?? []),
        stderr: '',
      };
    }
    return { status: 0, stdout: 'https://example.test/pull/1\n', stderr: '' };
  };
  return { flow: { exec, dryRun, log: (line) => log.push(line) }, log };
};

const ghWrites = (gh: Gh): string[][] => gh.calls.filter(([, verb]) => verb === 'create');

const remoteHeads = (repo: Repo): string =>
  git(repo.bare, 'for-each-ref', '--format=%(refname) %(objectname)');

/** Everything a dry run must leave alone. */
const snapshot = (repo: Repo): string[] => [
  remoteHeads(repo),
  git(repo.work, 'for-each-ref', '--format=%(refname) %(objectname)'),
  git(repo.work, 'rev-parse', 'HEAD'),
  git(repo.work, 'status', '--porcelain'),
];

/** The git and gh writes a flow printed, with the `$ ` or `[dry-run] ` marker removed. */
const writes = (log: string[], prefix: '$ ' | '[dry-run] '): string[] =>
  log
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length))
    .filter((line) => line.startsWith('git push') || line.startsWith('gh pr create'));

describe('closingLines', () => {
  it('normalises, dedupes and sorts closing keywords, ignoring plain references', () => {
    expect(
      closingLines(['Fixes #14\nPart of #9', 'closes #3, resolved: #14', null, 'Resolves #3']),
    ).toEqual(['Closes #3', 'Closes #14']);
  });
});

describe('isPatchRelease', () => {
  it('is a patch release when major and minor match the released version', () => {
    expect(isPatchRelease('1.0.2', '1.0.0')).toBe(true);
    expect(isPatchRelease('1.1.0', '1.0.0')).toBe(false);
    expect(isPatchRelease('2.0.0', '1.0.5')).toBe(false);
  });
});

describe('release:cut', { timeout: 60_000 }, () => {
  it('derives the version from the pending fragments and pushes release/x.y.z from develop', () => {
    const repo = makeRepo();
    const head = git(repo.work, 'rev-parse', 'HEAD');
    const { flow } = makeFlow(repo);
    expect(releaseCut(flow)).toBe('1.1.0');
    expect(git(repo.bare, 'rev-parse', 'release/1.1.0').trim()).toBe(head.trim());
    expect(git(repo.work, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('derives a patch from fixed-only fragments and takes an explicit version', () => {
    const fixed = makeRepo({ pending: 'fixed' });
    expect(releaseCut(makeFlow(fixed).flow)).toBe('1.0.1');
    const explicit = makeRepo();
    expect(releaseCut(makeFlow(explicit).flow, '2.0.0')).toBe('2.0.0');
    expect(remoteHeads(explicit)).toContain('refs/heads/release/2.0.0');
  });

  it('needs the version for the first release', () => {
    const repo = makeRepo({ released: false });
    expect(() => releaseCut(makeFlow(repo).flow)).toThrow(/pass the version/);
    expect(releaseCut(makeFlow(repo).flow, '1.0.0')).toBe('1.0.0');
  });

  it('refuses when origin/main is not an ancestor of origin/develop', () => {
    const repo = makeRepo();
    repo.commitOn('main', { 'later.txt': 'x' }, 'hotfix on main only');
    expect(() => releaseCut(makeFlow(repo).flow)).toThrow(/not an ancestor of origin\/develop/);
    expect(remoteHeads(repo)).not.toContain('release/');
  });

  it('refuses a dirty tree', () => {
    const repo = makeRepo();
    writeFiles(repo.work, { 'untracked.txt': 'x' });
    expect(() => releaseCut(makeFlow(repo).flow)).toThrow(/working tree is dirty/);
  });

  it('refuses a version not above main', () => {
    const repo = makeRepo();
    expect(() => releaseCut(makeFlow(repo).flow, '1.0.0')).toThrow(/must be above main's 1.0.0/);
    expect(() => releaseCut(makeFlow(repo).flow, '0.9.0')).toThrow(/must be above main's 1.0.0/);
    expect(() => releaseCut(makeFlow(repo).flow, 'v1.2')).toThrow(/version must be x.y.z/);
  });

  it('refuses an existing branch or tag, another open release and nothing to release', () => {
    const branch = makeRepo();
    git(branch.work, 'push', 'origin', 'HEAD:refs/heads/release/1.1.0');
    expect(() => releaseCut(makeFlow(branch).flow, '1.1.0')).toThrow(
      /branch release\/1.1.0 already exists/,
    );
    expect(() => releaseCut(makeFlow(branch).flow, '1.2.0')).toThrow(
      /release\/1.1.0 is still open/,
    );

    const tag = makeRepo();
    git(tag.work, 'tag', 'v1.1.0');
    expect(() => releaseCut(makeFlow(tag).flow, '1.1.0')).toThrow(/tag v1.1.0 already exists/);

    const empty = makeRepo({ pending: null });
    expect(() => releaseCut(makeFlow(empty).flow)).toThrow(/nothing to release/);
  });

  it('refuses a patch release while hotfix/x.y.z takes that version', () => {
    const repo = makeRepo({ pending: 'fixed' });
    git(repo.work, 'push', 'origin', 'main:refs/heads/hotfix/1.0.1');
    expect(() => releaseCut(makeFlow(repo).flow)).toThrow(/branch hotfix\/1.0.1 already exists/);
  });

  it('refuses a stale origin/develop instead of cutting at an old commit', () => {
    const repo = makeRepo();
    git(repo.work, 'config', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
    repo.commitOn('develop', fragment(8, 'fixed'), 'later work');
    expect(() => releaseCut(makeFlow(repo).flow)).toThrow(
      /origin\/develop differs from the remote/,
    );
    expect(remoteHeads(repo)).not.toContain('release/');
  });

  it('refuses before the gitflow cutover', () => {
    const repo = makeRepo({ develop: false });
    expect(() => releaseCut(makeFlow(repo).flow)).toThrow(/origin\/develop does not exist/);
  });

  it('is blocked by a skipped back-merge and goes on after it, keeping a fragment added meanwhile', () => {
    const repo = makeRepo();
    land(repo, 'release', '1.1.0');
    expect(() => releaseCut(makeFlow(repo).flow, '1.2.0')).toThrow(
      /not an ancestor of origin\/develop/,
    );
    repo.commitOn('develop', fragment(8, 'fixed'), 'fix during the freeze');
    mergeMainInto(repo, 'develop', 'merge');
    expect(releaseCut(makeFlow(repo).flow)).toBe('1.1.1');
  });

  it('prints the same writes in a dry run as a real run, and changes nothing', () => {
    const repo = makeRepo();
    const before = snapshot(repo);
    const dry = makeFlow(repo, makeGh(), true);
    releaseCut(dry.flow);
    expect(snapshot(repo)).toEqual(before);
    const real = makeFlow(repo);
    releaseCut(real.flow);
    expect(writes(dry.log, '[dry-run] ')).toEqual(writes(real.log, '$ '));
    expect(writes(dry.log, '[dry-run] ')).toEqual([
      'git push origin refs/remotes/origin/develop:refs/heads/release/1.1.0',
    ]);
  });
});

describe('hotfix:cut', { timeout: 60_000 }, () => {
  it('pushes hotfix/x.y.z, the next patch above main, from origin/main', () => {
    const repo = makeRepo();
    const main = git(repo.work, 'rev-parse', 'main').trim();
    expect(hotfixCut(makeFlow(repo).flow)).toBe('1.0.1');
    expect(git(repo.bare, 'rev-parse', 'hotfix/1.0.1').trim()).toBe(main);
  });

  it('refuses while an open release is a patch release, with guidance', () => {
    const repo = makeRepo();
    git(repo.work, 'push', 'origin', 'HEAD:refs/heads/release/1.0.1');
    expect(() => hotfixCut(makeFlow(repo).flow)).toThrow(
      /release\/1\.0\.1 is a patch release.*into that release branch/,
    );
  });

  it('is fine beside an open minor release', () => {
    const repo = makeRepo();
    git(repo.work, 'push', 'origin', 'HEAD:refs/heads/release/1.1.0');
    expect(hotfixCut(makeFlow(repo).flow)).toBe('1.0.1');
  });

  it('refuses before the first release and when the branch or tag exists', () => {
    expect(() => hotfixCut(makeFlow(makeRepo({ released: false })).flow)).toThrow(
      /no release to patch/,
    );
    const taken = makeRepo();
    git(taken.work, 'push', 'origin', 'HEAD:refs/heads/hotfix/1.0.1');
    expect(() => hotfixCut(makeFlow(taken).flow)).toThrow(/branch hotfix\/1.0.1 already exists/);
    const tagged = makeRepo();
    git(tagged.work, 'tag', 'v1.0.1');
    expect(() => hotfixCut(makeFlow(tagged).flow)).toThrow(/tag v1.0.1 already exists/);
  });

  it('refuses a dirty tree', () => {
    const repo = makeRepo();
    writeFiles(repo.work, { 'untracked.txt': 'x' });
    expect(() => hotfixCut(makeFlow(repo).flow)).toThrow(/working tree is dirty/);
  });

  it('prints its push in a dry run and changes nothing', () => {
    const repo = makeRepo();
    const before = snapshot(repo);
    const { flow, log } = makeFlow(repo, makeGh(), true);
    hotfixCut(flow);
    expect(snapshot(repo)).toEqual(before);
    expect(writes(log, '[dry-run] ')).toEqual([
      'git push origin refs/remotes/origin/main:refs/heads/hotfix/1.0.1',
    ]);
  });
});

describe('release:backmerge', { timeout: 60_000 }, () => {
  const released = (): { repo: Repo; gh: Gh } => {
    const repo = makeRepo();
    land(repo, 'release', '1.1.0');
    return { repo, gh: makeGh(['v1.1.0']) };
  };

  it('pushes feature/back-merge-x.y.z from main and opens the PR into develop with the closing lines', () => {
    const { repo, gh } = released();
    gh.prs['base:release/1.1.0'] = [
      { number: 12, body: 'Fixes #3\nPart of #4' },
      { number: 13, body: null },
    ];
    gh.prs['head:hotfix/1.1.0'] = [{ number: 14, body: 'Closes #9' }];
    const main = git(repo.work, 'rev-parse', 'main').trim();
    const { flow } = makeFlow(repo, gh);
    expect(backMerge(flow)).toBe('develop');
    expect(git(repo.bare, 'rev-parse', 'feature/back-merge-1.1.0').trim()).toBe(main);
    const [create] = ghWrites(gh);
    expect(create?.slice(0, 7)).toEqual([
      'pr',
      'create',
      '--base',
      'develop',
      '--head',
      'feature/back-merge-1.1.0',
      '--title',
    ]);
    expect(create?.at(-1)).toMatch(/\n\nCloses #3\nCloses #9$/);
  });

  it('carries the closing lines of every version main has and the target lacks', () => {
    const { repo, gh } = released();
    land(repo, 'hotfix', '1.1.1');
    gh.releases.add('v1.1.1');
    gh.prs['base:release/1.1.0'] = [{ number: 12, body: 'Fixes #3' }];
    gh.prs['base:hotfix/1.1.1'] = [{ number: 15, body: 'Closes #11' }];
    gh.prs['head:hotfix/1.1.1'] = [{ number: 16, body: 'Closes #9' }];
    expect(backMerge(makeFlow(repo, gh).flow)).toBe('develop');
    expect(ghWrites(gh)[0]?.at(-1)).toMatch(/\n\nCloses #3\nCloses #9\nCloses #11$/);
  });

  it('refuses until the tag and the GitHub Release exist', () => {
    const untagged = makeRepo();
    land(untagged, 'release', '1.1.0', false);
    expect(() => backMerge(makeFlow(untagged, makeGh(['v1.1.0'])).flow)).toThrow(
      /tag v1.1.0 does not exist/,
    );
    const { repo } = released();
    expect(() => backMerge(makeFlow(repo, makeGh()).flow)).toThrow(
      /no published GitHub Release v1.1.0/,
    );
    expect(remoteHeads(repo)).not.toContain('feature/back-merge');
  });

  it('refuses when the target already has main, or the head exists', () => {
    const { repo, gh } = released();
    git(repo.work, 'push', 'origin', 'main:refs/heads/feature/back-merge-1.1.0');
    expect(() => backMerge(makeFlow(repo, gh).flow)).toThrow(
      /branch feature\/back-merge-1.1.0 already exists/,
    );
    mergeMainInto(repo, 'develop', 'merge');
    expect(() => backMerge(makeFlow(repo, gh).flow)).toThrow(
      /develop already contains origin\/main/,
    );
  });

  it('targets the open release after a hotfix, and verifies against it', () => {
    const repo = makeRepo();
    git(repo.work, 'push', 'origin', 'develop:refs/heads/release/1.2.0');
    land(repo, 'hotfix', '1.0.1');
    const gh = makeGh(['v1.0.1']);
    expect(backMerge(makeFlow(repo, gh).flow)).toBe('release/1.2.0');
    expect(ghWrites(gh)[0]).toContain('release/1.2.0');
    expect(() => verifyBackMerge(makeFlow(repo, gh).flow)).toThrow(
      /not an ancestor of origin\/release\/1.2.0/,
    );
    mergeMainInto(repo, 'release/1.2.0', 'merge');
    expect(verifyBackMerge(makeFlow(repo, gh).flow)).toBe('release/1.2.0');
  });

  it('refuses when more than one release is open', () => {
    const { repo, gh } = released();
    repo.commitOn('develop', fragment(8, 'fixed'), 'next work');
    git(repo.work, 'push', 'origin', 'develop:refs/heads/release/1.2.0');
    git(repo.work, 'push', 'origin', 'develop:refs/heads/release/1.3.0');
    expect(() => backMerge(makeFlow(repo, gh).flow)).toThrow(/more than one release is open/);
  });

  it('verifies a merge-commit back-merge and detects a squashed one', () => {
    const { repo, gh } = released();
    expect(() => verifyBackMerge(makeFlow(repo, gh).flow)).toThrow(
      /not an ancestor of origin\/develop/,
    );
    mergeMainInto(repo, 'develop', 'squash');
    expect(() => verifyBackMerge(makeFlow(repo, gh).flow)).toThrow(/squashed or rebased/);

    const merged = released();
    mergeMainInto(merged.repo, 'develop', 'merge');
    expect(verifyBackMerge(makeFlow(merged.repo, merged.gh).flow)).toBe('develop');
  });

  it('prints its push and PR in a dry run, runs neither, and changes nothing', () => {
    const { repo, gh } = released();
    const before = snapshot(repo);
    const dry = makeFlow(repo, gh, true);
    backMerge(dry.flow);
    expect(snapshot(repo)).toEqual(before);
    expect(ghWrites(gh)).toEqual([]);
    const printed = writes(dry.log, '[dry-run] ');
    expect(printed).toHaveLength(2);
    expect(printed[0]).toBe(
      'git push origin refs/remotes/origin/main:refs/heads/feature/back-merge-1.1.0',
    );
    expect(printed[1]).toMatch(/^gh pr create --base develop --head feature\/back-merge-1.1.0 /);

    const real = makeFlow(repo, gh);
    backMerge(real.flow);
    expect(writes(real.log, '$ ')).toEqual(printed);
  });
});
