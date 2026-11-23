import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Category, ChangelogEntry, Release } from '../src/app/changelog-entries';
import {
  DATE_RE,
  VERSION_RE,
  compareVersions,
  fragmentFiles,
  loadFragments,
  loadReleases,
  releaseProblems,
  renderChangelog,
  section,
  triple,
} from './changelog';

const PACKAGE_VERSION_RE = /^( {2}"version": ")[^"]*(",?)$/m;
const PATCH_ONLY: readonly Category[] = ['fixed', 'security'];

/** Only fixed and security entries make a patch release; anything else a minor one. */
export const nextVersion = (base: string, entries: readonly ChangelogEntry[]): string => {
  const [major = 0, minor = 0, patch = 0] = triple(base);
  return entries.every(({ category }) => PATCH_ONLY.includes(category))
    ? `${String(major)}.${String(minor)}.${String(patch + 1)}`
    : `${String(major)}.${String(minor + 1)}.0`;
};

const json = (value: unknown): string => JSON.stringify(value);

/** released.json in the shape Prettier keeps: expanded objects, inline `prs`. */
export const stringifyReleases = (releases: readonly Release[]): string => {
  if (releases.length === 0) return '[]\n';
  const entry = ({ id, category, prs, en }: ChangelogEntry): string =>
    [
      '      {',
      `        "id": ${json(id)},`,
      `        "category": ${json(category)},`,
      `        "prs": [${prs.join(', ')}],`,
      `        "en": ${json(en)}`,
      '      }',
    ].join('\n');
  const group = ({ version, date, entries }: Release): string =>
    [
      '  {',
      `    "version": ${json(version)},`,
      ...(date === undefined ? [] : [`    "date": ${json(date)},`]),
      entries.length === 0
        ? '    "entries": []'
        : `    "entries": [\n${entries.map(entry).join(',\n')}\n    ]`,
      '  }',
    ].join('\n');
  return `[\n${releases.map(group).join(',\n')}\n]\n`;
};

const packageText = (root: string): string => readFileSync(join(root, 'package.json'), 'utf8');

const readPackageVersion = (root: string): string => {
  const { version } = JSON.parse(packageText(root)) as { version?: unknown };
  if (typeof version !== 'string' || !VERSION_RE.test(version))
    throw new Error('package.json: version must be x.y.z');
  return version;
};

const withPackageVersion = (text: string, version: string): string => {
  if (!PACKAGE_VERSION_RE.test(text))
    throw new Error('package.json: no top-level "version" line to replace');
  return text.replace(PACKAGE_VERSION_RE, `$1${version}$2`);
};

export interface PrepareOptions {
  /** Explicit X.Y.Z; omitted, it is derived from the entries going into the release. */
  version?: string | undefined;
  /** YYYY-MM-DD; a re-run into a head group that already has a date keeps that date. */
  date: string;
  /** The caller's `git status --porcelain` verdict; a dirty tree is refused. */
  dirty: boolean;
  /** Versions that have a `v` tag: released, so never changed. */
  tagged: readonly string[];
}

export interface PrepareResult {
  version: string;
  /** Fragment file names folded and deleted. */
  folded: string[];
  /** False when the tree already was the prepared one. */
  changed: boolean;
}

/**
 * Sets package.json to the release version, folds every pending fragment into the head group of
 * released.json (the unreleased group, the head group of the same version, else a new first group)
 * and regenerates CHANGELOG.md. Idempotent; throws before writing anything.
 */
export const prepareRelease = (root: string, options: PrepareOptions): PrepareResult => {
  if (options.dirty) throw new Error('the working tree is dirty; commit or stash first');
  if (!DATE_RE.test(options.date)) throw new Error(`date must be YYYY-MM-DD, got ${options.date}`);
  if (options.version !== undefined && !VERSION_RE.test(options.version))
    throw new Error(`version must be x.y.z, got ${options.version}`);

  const dir = join(root, 'changelog.d');
  const files = fragmentFiles(dir);
  const pending = loadFragments(dir);
  const data = loadReleases(dir);
  const schema = releaseProblems(
    data,
    pending.map(({ id }) => id),
  );
  if (schema.length > 0) throw new Error(`changelog.d/released.json:\n${schema.join('\n')}`);
  const releases = data as Release[];
  const head = releases[0];
  const packageVersion = readPackageVersion(root);

  let version: string;
  let next: Release[];
  if (pending.length === 0 && head?.version != null) {
    if (options.version !== undefined && options.version !== head.version)
      throw new Error(
        `no fragment is pending, so there is nothing to release as ${options.version}`,
      );
    version = head.version;
    next = releases;
  } else {
    const prepared = head?.version ?? null;
    if (prepared !== null && !options.tagged.includes(prepared) && options.version !== prepared)
      throw new Error(
        `head group ${prepared} has no tag v${prepared}: pass ${prepared} to fold into it, or fetch tags if it is released`,
      );
    const refold =
      head !== undefined && (head.version === null || head.version === options.version);
    const target: Release = refold ? head : { version: null, entries: [] };
    const previous = releases.find(
      (release) => release.version !== null && release !== target,
    )?.version;
    const entries = [...target.entries, ...pending];
    if (entries.length === 0) throw new Error('nothing to release: no fragment is pending');
    const derived =
      options.version ??
      (previous === undefined || previous === null ? undefined : nextVersion(previous, entries));
    if (derived === undefined)
      throw new Error('there is no earlier release to bump from; pass the version');
    version = derived;
    if (options.tagged.includes(version))
      throw new Error(`v${version} is already tagged; a released version never changes`);
    if (previous != null && compareVersions(version, previous) <= 0)
      throw new Error(`version ${version} must be above the previous release ${previous}`);
    const group: Release = {
      version,
      date: refold && target.date !== undefined ? target.date : options.date,
      entries,
    };
    next = refold ? [group, ...releases.slice(1)] : [group, ...releases];
  }
  if (compareVersions(version, packageVersion) < 0)
    throw new Error(`version ${version} is below package.json's ${packageVersion}`);

  const writes: [string, string][] = [
    [join(dir, 'released.json'), stringifyReleases(next)],
    [join(root, 'package.json'), withPackageVersion(packageText(root), version)],
    [join(root, 'CHANGELOG.md'), renderChangelog(next)],
  ];
  let changed = pending.length > 0;
  for (const [path, text] of writes) {
    if (readFileSync(path, 'utf8') === text) continue;
    writeFileSync(path, text);
    changed = true;
  }
  for (const file of files) rmSync(join(dir, file));
  return { version, folded: files, changed };
};

/**
 * Why the tree at `root` is not a consistent release; empty when it is. `taggedElsewhere`: versions
 * whose `v` tag points at another commit than the one checked.
 */
export const checkRelease = (root: string, taggedElsewhere: readonly string[] = []): string[] => {
  const dir = join(root, 'changelog.d');
  const out: string[] = [];
  const left = fragmentFiles(dir);
  if (left.length > 0) out.push(`pending fragments must be folded first: ${left.join(', ')}`);

  const data = loadReleases(dir);
  const problems = releaseProblems(data);
  if (problems.length > 0) return [...out, ...problems];
  const releases = data as Release[];

  const [head] = releases;
  const version = readPackageVersion(root);
  if (head?.version == null)
    out.push('the head group of released.json has no version, so nothing is released');
  else {
    if (head.version !== version)
      out.push(`package.json version ${version} differs from the head group ${head.version}`);
    if (taggedElsewhere.includes(head.version))
      out.push(`v${head.version} already tags another commit; a released version never changes`);
  }

  let changelog: string | undefined;
  try {
    changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  } catch {
    changelog = undefined;
  }
  if (changelog !== renderChangelog(releases))
    out.push('CHANGELOG.md is stale; run pnpm changelog');
  return out;
};

/**
 * One version's section, identical to its section in CHANGELOG.md; without `heading`, the section
 * minus its `## [X.Y.Z] - date` line, for a release whose title carries the version.
 */
export const releaseNotes = (root: string, version: string, heading = true): string => {
  const release = (loadReleases(join(root, 'changelog.d')) as Release[]).find(
    (group) => group.version === version,
  );
  if (release === undefined) throw new Error(`released.json has no group for version ${version}`);
  const text = section(`[${version}] - ${release.date ?? ''}`, release.entries);
  return heading ? text : text.split('\n\n').slice(1).join('\n\n');
};
