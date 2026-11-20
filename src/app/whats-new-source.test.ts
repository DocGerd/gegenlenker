import { describe, expect, it } from 'vitest';
import { CATEGORIES, PR_URL, type Release } from './changelog-entries';
import { buildGroups, tokens, whatsNewGroups } from './whats-new-source';

const fragment = (pr: number, line: string): string => `${line} ([#${pr}](${PR_URL}${pr}))\n`;

describe('buildGroups', () => {
  const releases: Release[] = [
    {
      version: '1.0.0',
      date: '2030-01-01',
      entries: [{ id: 'a', category: 'fixed', prs: [1], en: 'Fixed a thing.' }],
    },
    {
      version: null,
      entries: [
        { id: 'b', category: 'fixed', prs: [2], en: 'Fixed `x`.' },
        { id: 'c', category: 'added', prs: [3], en: 'Added a thing.' },
      ],
    },
  ];

  it('lists fragments newest PR first, then releases in file order', () => {
    const groups = buildGroups(
      {
        '/changelog.d/9.added.md': fragment(9, 'Nine.'),
        '/changelog.d/10.added.md': fragment(10, 'Ten.'),
        '/changelog.d/4.fixed.md': fragment(4, 'Four.'),
      },
      releases,
    );
    expect(groups.map(({ kind, version }) => [kind, version])).toEqual([
      ['latest', null],
      ['release', '1.0.0'],
      ['earlier', null],
    ]);
    expect(groups[0]?.categories.map(({ category }) => category)).toEqual(['added', 'fixed']);
    expect(groups[0]?.categories[0]?.entries.map(({ id }) => id)).toEqual(['10.added', '9.added']);
  });

  it('orders categories as Keep a Changelog and drops empty groups', () => {
    const groups = buildGroups({}, releases);
    expect(groups.map(({ kind }) => kind)).toEqual(['release', 'earlier']);
    expect(groups[1]?.categories.map(({ category }) => category)).toEqual(['added', 'fixed']);
    expect(buildGroups({}, [{ version: null, entries: [] }])).toEqual([]);
  });

  it('rejects a malformed fragment', () => {
    expect(() => buildGroups({ '/changelog.d/5.added.md': 'No link.' }, [])).toThrow();
  });
});

describe('tokens', () => {
  it('splits text and inline code without markup', () => {
    expect(tokens('Use `a b` or `c`.')).toEqual([
      { code: false, text: 'Use ' },
      { code: true, text: 'a b' },
      { code: false, text: ' or ' },
      { code: true, text: 'c' },
      { code: false, text: '.' },
    ]);
  });
});

describe('the shipped changelog', () => {
  const groups = whatsNewGroups();
  const entries = groups.flatMap(({ categories }) => categories.flatMap((c) => c.entries));

  it('parses every fragment and is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const { category } of groups.flatMap(({ categories }) => categories))
      expect(CATEGORIES).toContain(category);
  });

  it('renders every entry as text and code tokens only', () => {
    for (const { en } of entries) {
      const parts = tokens(en);
      expect(parts.map(({ text }) => text).join('')).toBe(en.replaceAll('`', ''));
      for (const { text } of parts) expect(text).not.toMatch(/[<>]/);
    }
  });
});
