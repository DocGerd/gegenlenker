import releasedJson from '../../changelog.d/released.json';
import {
  CATEGORIES,
  parseFragment,
  type Category,
  type ChangelogEntry,
  type Release,
} from './changelog-entries';

export type GroupKind = 'latest' | 'earlier' | 'release';

export interface WhatsNewGroup {
  kind: GroupKind;
  version: string | null;
  date: string | undefined;
  categories: { category: Category; entries: ChangelogEntry[] }[];
}

export interface Token {
  code: boolean;
  text: string;
}

const prNumber = (entry: ChangelogEntry): number => entry.prs[0] ?? 0;

const byCategory = (entries: readonly ChangelogEntry[]): WhatsNewGroup['categories'] =>
  CATEGORIES.map((category) => ({
    category,
    entries: entries.filter((entry) => entry.category === category),
  })).filter(({ entries: inCategory }) => inCategory.length > 0);

/** Pending fragments newest PR first, then each release in file order. Throws on a malformed fragment. */
export const buildGroups = (
  fragments: Readonly<Record<string, string>>,
  releases: readonly Release[],
): WhatsNewGroup[] => {
  const latest = Object.entries(fragments)
    .map(([name, text]) => parseFragment(name.slice(name.lastIndexOf('/') + 1), text))
    .sort((a, b) => prNumber(b) - prNumber(a) || a.id.localeCompare(b.id));

  const groups: WhatsNewGroup[] = [];
  if (latest.length > 0)
    groups.push({ kind: 'latest', version: null, date: undefined, categories: byCategory(latest) });
  for (const { version, date, entries } of releases)
    groups.push({
      kind: version === null ? 'earlier' : 'release',
      version,
      date,
      categories: byCategory(entries),
    });
  return groups.filter(({ categories }) => categories.length > 0);
};

/** Alternating text and inline-code runs of an entry line (backticks are balanced by the parser). */
export const tokens = (line: string): Token[] =>
  line
    .split('`')
    .map((text, index) => ({ code: index % 2 === 1, text }))
    .filter(({ text }) => text !== '');

const fragmentSources = import.meta.glob<string>(['/changelog.d/*.md', '!/changelog.d/README.md'], {
  eager: true,
  query: '?raw',
  import: 'default',
});

export const whatsNewGroups = (): WhatsNewGroup[] =>
  buildGroups(fragmentSources, releasedJson as unknown as readonly Release[]);
