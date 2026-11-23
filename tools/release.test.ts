import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChangelogEntry, Release } from '../src/app/changelog-entries';
import { entryIds, buildGroups } from '../src/app/whats-new-source';
import { unseenAmong } from '../src/app/whats-new-seen';
import { compareVersions, loadReleases, releaseState, renderChangelog } from './changelog';
import {
  checkRelease,
  nextVersion,
  prepareRelease,
  releaseNotes,
  stringifyReleases,
} from './release';

const ROOT = join(import.meta.dirname, '..');
const BASE = 'https://github.com/DocGerd/gegenlenker/pull/';

const entry = (over: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  id: '1.added',
  category: 'added',
  prs: [1],
  en: 'One.',
  ...over,
});

const fragmentText = (pr: number, text = 'Pending.'): string =>
  `${text.slice(0, -1)} ([#${String(pr)}](${BASE}${String(pr)})).\n`;

interface Fixture {
  version?: string;
  releases: Release[];
  /** File name to PR-link text. */
  fragments?: Record<string, string>;
}

const makeTree = ({ version = '0.0.0', releases, fragments = {} }: Fixture): string => {
  const root = mkdtempSync(join(tmpdir(), 'release-'));
  mkdirSync(join(root, 'changelog.d'));
  writeFileSync(
    join(root, 'package.json'),
    `{\n  "name": "x",\n  "version": "${version}",\n  "scripts": {}\n}\n`,
  );
  writeFileSync(join(root, 'changelog.d', 'released.json'), stringifyReleases(releases));
  writeFileSync(join(root, 'changelog.d', 'README.md'), 'readme');
  for (const [name, text] of Object.entries(fragments))
    writeFileSync(join(root, 'changelog.d', name), text);
  writeFileSync(join(root, 'CHANGELOG.md'), renderChangelog(releases));
  return root;
};

const read = (root: string, file: string): string => readFileSync(join(root, file), 'utf8');
const snapshot = (root: string): string[] =>
  ['package.json', 'CHANGELOG.md', 'changelog.d/released.json'].map((file) => read(root, file));
const prepare = (
  root: string,
  version?: string,
  over: Partial<{ date: string; dirty: boolean; tagged: string[] }> = {},
) => prepareRelease(root, { version, date: '2026-12-01', dirty: false, tagged: [], ...over });
const TAGGED = { tagged: ['1.0.0'] };
const released = (root: string): Release[] => loadReleases(join(root, 'changelog.d')) as Release[];

const history: Release = {
  version: null,
  entries: [
    entry({ id: '13.added', prs: [13, 6, 8], en: 'Trainer.' }),
    entry({ id: '5.fixed', category: 'fixed', prs: [5], en: 'Fix.' }),
  ],
};
const shipped: Release = {
  version: '1.0.0',
  date: '2026-11-30',
  entries: [entry({ id: '9.added', prs: [9], en: 'Old.' })],
};
const fragments = {
  '20.added.md': fragmentText(20, 'Twenty.'),
  '3.fixed.md': fragmentText(3, 'Three.'),
  '100.changed.md': fragmentText(100, 'Hundred.'),
};

describe('versions', () => {
  it('compares numerically, not as strings', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  it('bumps patch for fixes only and minor otherwise', () => {
    expect(
      nextVersion('1.2.3', [entry({ category: 'fixed' }), entry({ category: 'security' })]),
    ).toBe('1.2.4');
    expect(
      nextVersion('1.2.3', [entry({ category: 'fixed' }), entry({ category: 'removed' })]),
    ).toBe('1.3.0');
  });
});

describe('stringifyReleases', () => {
  it('reproduces the real released.json byte for byte, so Prettier keeps it', () => {
    const text = readFileSync(join(ROOT, 'changelog.d', 'released.json'), 'utf8');
    expect(stringifyReleases(JSON.parse(text) as Release[])).toBe(text);
  });
});

describe('prepareRelease', () => {
  it('versions the unreleased group, folds fragments in PR order and deletes only them', () => {
    const root = makeTree({ releases: [history], fragments });
    writeFileSync(join(root, 'keep.txt'), 'x');
    const result = prepare(root, '1.0.0');
    expect(result).toEqual({
      version: '1.0.0',
      folded: ['3.fixed.md', '20.added.md', '100.changed.md'],
      changed: true,
    });

    const [group, ...rest] = released(root);
    expect(rest).toEqual([]);
    expect(group).toMatchObject({ version: '1.0.0', date: '2026-12-01' });
    expect(group?.entries.map(({ id }) => id)).toEqual([
      '13.added',
      '5.fixed',
      '3.fixed',
      '20.added',
      '100.changed',
    ]);
    expect(group?.entries[2]).toEqual({
      id: '3.fixed',
      category: 'fixed',
      prs: [3],
      en: 'Three.',
    });
    expect(readdirSync(join(root, 'changelog.d')).sort()).toEqual(['README.md', 'released.json']);
    expect(existsSync(join(root, 'keep.txt'))).toBe(true);
    expect(JSON.parse(read(root, 'package.json'))).toMatchObject({ version: '1.0.0', name: 'x' });
    expect(read(root, 'package.json')).toBe(
      '{\n  "name": "x",\n  "version": "1.0.0",\n  "scripts": {}\n}\n',
    );
    expect(read(root, 'CHANGELOG.md')).toContain('## [1.0.0] - 2026-12-01');
    expect(checkRelease(root)).toEqual([]);
  });

  it('adds a first group when the head group is already released', () => {
    const root = makeTree({ version: '1.0.0', releases: [shipped], fragments });
    expect(prepare(root, '1.1.0', TAGGED).version).toBe('1.1.0');
    const [first, second] = released(root);
    expect(first).toMatchObject({ version: '1.1.0', date: '2026-12-01' });
    expect(first?.entries.map(({ id }) => id)).toEqual(['3.fixed', '20.added', '100.changed']);
    expect(second).toEqual(shipped);
  });

  it('derives the version from the fragment categories when omitted', () => {
    const fixes = makeTree({
      version: '1.0.0',
      releases: [shipped],
      fragments: { '3.fixed.md': fragmentText(3) },
    });
    expect(prepare(fixes, undefined, TAGGED).version).toBe('1.0.1');
    const features = makeTree({ version: '1.0.0', releases: [shipped], fragments });
    expect(prepare(features, undefined, TAGGED).version).toBe('1.1.0');
    const first = makeTree({ releases: [history], fragments });
    expect(() => prepare(first)).toThrow('pass the version');
  });

  it('is idempotent: a second run changes nothing', () => {
    const root = makeTree({ releases: [history], fragments });
    prepare(root, '1.0.0');
    const before = snapshot(root);
    expect(prepare(root, '1.0.0', { date: '2027-01-01' })).toEqual({
      version: '1.0.0',
      folded: [],
      changed: false,
    });
    expect(prepare(root, undefined, { date: '2027-01-01' }).changed).toBe(false);
    expect(snapshot(root)).toEqual(before);
  });

  it('folds a fragment added after the first run into the same group, keeping its date', () => {
    const root = makeTree({ releases: [history], fragments });
    prepare(root, '1.0.0');
    writeFileSync(join(root, 'changelog.d', '30.fixed.md'), fragmentText(30, 'Late fix.'));
    expect(prepare(root, '1.0.0', { date: '2027-01-01' }).folded).toEqual(['30.fixed.md']);
    const groups = released(root);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ version: '1.0.0', date: '2026-12-01' });
    expect(groups[0]?.entries.at(-1)?.id).toBe('30.fixed');
    expect(checkRelease(root)).toEqual([]);
  });

  it('refuses a dirty tree, writing nothing', () => {
    const root = makeTree({ releases: [history], fragments });
    const before = snapshot(root);
    expect(() => prepare(root, '1.0.0', { dirty: true })).toThrow('dirty');
    expect(snapshot(root)).toEqual(before);
    expect(readdirSync(join(root, 'changelog.d'))).toContain('3.fixed.md');
  });

  it('refuses a version that does not rise, writing nothing', () => {
    const root = makeTree({ version: '1.0.0', releases: [shipped], fragments });
    const before = snapshot(root);
    expect(() => prepare(root, '0.9.0', TAGGED)).toThrow(
      'must be above the previous release 1.0.0',
    );
    expect(snapshot(root)).toEqual(before);

    const older = makeTree({ version: '1.2.0', releases: [shipped], fragments });
    expect(() => prepare(older, '1.1.0', TAGGED)).toThrow("below package.json's 1.2.0");
    const nothing = makeTree({ version: '1.2.0', releases: [shipped] });
    expect(() => prepare(nothing, undefined, TAGGED)).toThrow("below package.json's 1.2.0");
  });

  it('never changes a tagged version', () => {
    const root = makeTree({ version: '1.0.0', releases: [shipped], fragments });
    const before = snapshot(root);
    expect(() => prepare(root, '1.0.0', TAGGED)).toThrow('v1.0.0 is already tagged');
    expect(() => prepare(root, undefined, { tagged: ['1.0.0', '1.1.0'] })).toThrow(
      'v1.1.0 is already tagged',
    );
    expect(snapshot(root)).toEqual(before);
  });

  it('refuses to stack a group on an untagged prepared one', () => {
    const root = makeTree({ releases: [history], fragments });
    prepare(root, '1.0.0');
    writeFileSync(join(root, 'changelog.d', '30.fixed.md'), fragmentText(30, 'Late fix.'));
    const before = snapshot(root);
    expect(() => prepare(root)).toThrow('pass 1.0.0 to fold into it');
    expect(() => prepare(root, '1.0.1')).toThrow('head group 1.0.0 has no tag v1.0.0');
    expect(snapshot(root)).toEqual(before);
  });

  it('refuses a malformed version, date or fragment', () => {
    const root = makeTree({ releases: [history], fragments });
    expect(() => prepare(root, '1.0')).toThrow('x.y.z');
    expect(() => prepare(root, '1.0.01')).toThrow('x.y.z');
    expect(() => prepare(root, '1.0.0', { date: 'today' })).toThrow('YYYY-MM-DD');
    writeFileSync(join(root, 'changelog.d', '4.added.md'), 'no link\n');
    expect(() => prepare(root, '1.0.0')).toThrow('4.added.md');
  });

  it('refuses when there is nothing to release', () => {
    const root = makeTree({ version: '1.0.0', releases: [shipped] });
    expect(() => prepare(root, '1.1.0')).toThrow('nothing to release as 1.1.0');
  });

  it('refuses a fragment whose id is already released', () => {
    const root = makeTree({
      version: '1.0.0',
      releases: [shipped],
      fragments: { '9.added.md': fragmentText(9) },
    });
    expect(() => prepare(root, '1.1.0')).toThrow('duplicate id 9.added');
  });

  it('keeps What’s new seen-state: the same ids, so nothing becomes unseen', () => {
    const texts = Object.fromEntries(
      Object.entries(fragments).map(([name, text]) => [`/changelog.d/${name}`, text]),
    );
    const root = makeTree({ version: '1.0.0', releases: [shipped], fragments });
    const idsBefore = entryIds(buildGroups(texts, [shipped]));
    prepare(root, '1.1.0', TAGGED);
    const idsAfter = entryIds(buildGroups({}, released(root)));
    expect([...idsAfter].sort()).toEqual([...idsBefore].sort());

    const seen = new Set(['9.added', '3.fixed']);
    expect(unseenAmong(idsAfter, seen).sort()).toEqual(unseenAmong(idsBefore, seen).sort());
    expect(unseenAmong(idsAfter, new Set(idsBefore))).toEqual([]);
  });
});

describe('checkRelease', () => {
  const prepared = (): string => {
    const root = makeTree({ releases: [history], fragments });
    prepare(root, '1.0.0');
    return root;
  };

  it('passes a prepared tree, which is also a release build', () => {
    const root = prepared();
    expect(checkRelease(root)).toEqual([]);
    expect(releaseState(root)).toEqual({ version: '1.0.0', release: true });
  });

  it('fails on a leftover fragment', () => {
    const root = prepared();
    writeFileSync(join(root, 'changelog.d', '40.added.md'), fragmentText(40));
    expect(checkRelease(root).join('\n')).toContain('40.added.md');
  });

  it('fails when package.json and the head group differ', () => {
    const root = prepared();
    writeFileSync(
      join(root, 'package.json'),
      read(root, 'package.json').replace('"1.0.0"', '"1.0.1"'),
    );
    expect(checkRelease(root).join('\n')).toContain('differs from the head group 1.0.0');
  });

  it('fails while the head group is unreleased', () => {
    const root = makeTree({ releases: [history] });
    expect(checkRelease(root).join('\n')).toContain('has no version');
  });

  it('fails unless every version is below the one before it', () => {
    const older = (version: string, id: string): Release => ({
      ...shipped,
      version,
      entries: [entry({ id })],
    });
    const equal = makeTree({ version: '1.0.0', releases: [shipped, older('1.0.0', '2.added')] });
    expect(checkRelease(equal).join('\n')).toContain('version 1.0.0 must be below 1.0.0');
    const below = makeTree({ version: '1.0.0', releases: [shipped, older('1.2.0', '2.added')] });
    expect(checkRelease(below).join('\n')).toContain('version 1.2.0 must be below 1.0.0');
    const deeper = makeTree({
      version: '1.1.0',
      releases: [older('1.1.0', '3.added'), shipped, older('1.0.1', '2.fixed')],
    });
    expect(checkRelease(deeper).join('\n')).toContain('version 1.0.1 must be below 1.0.0');
  });

  it('fails when the head version already tags another commit', () => {
    const root = prepared();
    expect(checkRelease(root, ['1.0.0']).join('\n')).toContain('v1.0.0 already tags another');
    expect(checkRelease(root, ['0.9.0'])).toEqual([]);
  });

  it('fails on a stale or missing CHANGELOG.md', () => {
    const root = prepared();
    writeFileSync(join(root, 'CHANGELOG.md'), `${read(root, 'CHANGELOG.md')}edited\n`);
    expect(checkRelease(root).join('\n')).toContain('CHANGELOG.md is stale');
    const missing = makeTree({ version: '1.0.0', releases: [shipped] });
    writeFileSync(join(missing, 'CHANGELOG.md'), '');
    expect(checkRelease(missing).join('\n')).toContain('CHANGELOG.md is stale');
  });

  it('reports schema problems of released.json', () => {
    const root = prepared();
    writeFileSync(join(root, 'changelog.d', 'released.json'), '{}');
    expect(checkRelease(root).join('\n')).toContain('must be an array');
  });
});

describe('releaseNotes', () => {
  it('equals the version’s section of CHANGELOG.md', () => {
    const root = makeTree({ releases: [history], fragments });
    prepare(root, '1.0.0');
    writeFileSync(join(root, 'changelog.d', '50.fixed.md'), fragmentText(50, 'Next.'));
    prepare(root, '1.0.1', TAGGED);
    const changelog = read(root, 'CHANGELOG.md');
    for (const version of ['1.0.0', '1.0.1']) {
      const start = changelog.indexOf(`## [${version}]`);
      const end = changelog.indexOf('\n## [', start + 1);
      const expected = changelog.slice(start, end === -1 ? undefined : end).trim();
      expect(releaseNotes(root, version)).toBe(expected);
      const heading = `## [${version}] - 2026-12-01\n\n`;
      expect(expected.startsWith(heading)).toBe(true);
      expect(releaseNotes(root, version, false)).toBe(expected.slice(heading.length));
    }
  });

  it('rejects an unknown version', () => {
    const root = makeTree({ version: '1.0.0', releases: [shipped] });
    expect(() => releaseNotes(root, '2.0.0')).toThrow('no group for version 2.0.0');
  });
});
