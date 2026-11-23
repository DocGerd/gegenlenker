import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ChangelogEntry, Release } from '../src/app/changelog-entries';
import {
  generateChangelog,
  loadFragments,
  loadReleases,
  releaseProblems,
  releaseState,
  renderChangelog,
} from './changelog';

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'changelog.d');

const entry = (over: Partial<ChangelogEntry> = {}): ChangelogEntry => ({
  id: 'a',
  category: 'added',
  prs: [1],
  en: 'One.',
  ...over,
});
const unreleased = (...entries: ChangelogEntry[]): Release => ({ version: null, entries });

describe('released.json', () => {
  it('matches the schema and shares no id with a pending fragment', () => {
    const ids = loadFragments(DIR).map((fragment) => fragment.id);
    expect(releaseProblems(loadReleases(DIR), ids)).toEqual([]);
  });

  it('flags schema violations', () => {
    const problems = (data: unknown, fragmentIds: string[] = []) =>
      releaseProblems(data, fragmentIds).join('\n');
    expect(problems({})).toMatch(/must be an array/);
    expect(problems([unreleased(entry(), entry())])).toMatch(/duplicate id a/);
    expect(problems([unreleased(entry())], ['a'])).toMatch(/duplicate id a/);
    expect(problems([unreleased(entry({ category: 'fix' as never }))])).toMatch(/category/);
    expect(problems([unreleased(entry({ prs: [] }))])).toMatch(/prs/);
    expect(problems([unreleased(entry({ prs: [2, 2] }))])).toMatch(/prs/);
    expect(problems([unreleased(entry({ en: '' }))])).toMatch(/en empty/);
    expect(problems([unreleased(entry({ en: 'No period' }))])).toMatch(/en does not end/);
    expect(problems([unreleased(entry({ en: 'A **bold** one.' }))])).toMatch(/en contains markup/);
    expect(problems([{ version: '1.0.0', entries: [] }])).toMatch(/needs a YYYY-MM-DD date/);
    expect(problems([{ version: '1.0.0', date: '2026-01-01', entries: [] }, unreleased()])).toMatch(
      /must come first/,
    );
  });
});

describe('renderChangelog', () => {
  it('groups by category in Keep a Changelog order and rebuilds the PR links', () => {
    const text = renderChangelog([
      unreleased(
        entry({ id: 'n', prs: [9], en: 'New.' }),
        entry({ id: 'f', category: 'fixed', prs: [5, 6], en: 'Fixed it.' }),
      ),
      {
        version: '1.0.0',
        date: '2026-01-02',
        entries: [entry({ id: 'old', en: 'Old.' })],
      },
    ]);
    const base = 'https://github.com/DocGerd/gegenlenker/pull/';
    expect(text).toContain(`## [Unreleased]\n\n### Added\n\n- New ([#9](${base}9)).`);
    expect(text.indexOf('### Added')).toBeLessThan(text.indexOf('### Fixed'));
    expect(text).toContain(`- Fixed it ([#5](${base}5), [#6](${base}6)).`);
    expect(text).toContain('## [1.0.0] - 2026-01-02');
    expect(text).not.toContain('no tagged release yet');
  });
});

describe('CHANGELOG.md', () => {
  it('is what `pnpm changelog` generates from released.json alone', () => {
    expect(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')).toBe(generateChangelog(ROOT));
  });
});

describe('releaseState', () => {
  const tree = (opts: { version: string; head: string | null; fragments: string[] }): string => {
    const root = mkdtempSync(join(tmpdir(), 'release-state-'));
    mkdirSync(join(root, 'changelog.d'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: opts.version }));
    const group =
      opts.head === null ? { version: null } : { version: opts.head, date: '2026-01-01' };
    writeFileSync(
      join(root, 'changelog.d', 'released.json'),
      JSON.stringify([{ ...group, entries: [] }]),
    );
    for (const file of opts.fragments) writeFileSync(join(root, 'changelog.d', file), 'x');
    return root;
  };

  it('reads the version from package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };
    expect(releaseState(ROOT).version).toBe(pkg.version);
  });

  it('is a release build when the head group matches and nothing is pending', () => {
    const root = tree({ version: '1.0.0', head: '1.0.0', fragments: ['README.md'] });
    expect(releaseState(root)).toEqual({ version: '1.0.0', release: true });
  });

  it('is a development build while a fragment is pending', () => {
    const root = tree({ version: '1.0.0', head: '1.0.0', fragments: ['7.added.md'] });
    expect(releaseState(root).release).toBe(false);
  });

  it('rejects a package.json without an x.y.z version', () => {
    const root = tree({ version: '1.0.0', head: '1.0.0', fragments: [] });
    writeFileSync(join(root, 'package.json'), '{}');
    expect(() => releaseState(root)).toThrow('version must be x.y.z');
  });

  it('is a development build when released.json has no usable head group', () => {
    const root = tree({ version: '1.0.0', head: '1.0.0', fragments: [] });
    writeFileSync(join(root, 'changelog.d', 'released.json'), '[]');
    expect(releaseState(root).release).toBe(false);
  });

  it('is a development build when the head group is unreleased or another version', () => {
    expect(releaseState(tree({ version: '0.0.0', head: null, fragments: [] })).release).toBe(false);
    expect(releaseState(tree({ version: '1.1.0', head: '1.0.0', fragments: [] })).release).toBe(
      false,
    );
  });
});
