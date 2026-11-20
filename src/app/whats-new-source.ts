import releasedJson from '../../changelog.d/released.json';
import {
  CATEGORIES,
  parseFragment,
  type Category,
  type ChangelogEntry,
  type Release,
} from './changelog-entries';

export type GroupKind = 'unseen' | 'latest' | 'earlier' | 'release';

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

const NONE: ReadonlySet<string> = new Set();

const prNumber = (entry: ChangelogEntry): number => entry.prs[0] ?? 0;

const byCategory = (entries: readonly ChangelogEntry[]): WhatsNewGroup['categories'] =>
  CATEGORIES.map((category) => ({
    category,
    entries: entries.filter((entry) => entry.category === category),
  })).filter(({ entries: inCategory }) => inCategory.length > 0);

/**
 * Entries whose id is in `unseen` come first in their own group; the rest are pending fragments
 * newest PR first, then each release in file order. Throws on a malformed fragment.
 */
export const buildGroups = (
  fragments: Readonly<Record<string, string>>,
  releases: readonly Release[],
  unseen: ReadonlySet<string> = NONE,
): WhatsNewGroup[] => {
  const latest = Object.entries(fragments)
    .map(([name, text]) => parseFragment(name.slice(name.lastIndexOf('/') + 1), text))
    .sort((a, b) => prNumber(b) - prNumber(a) || a.id.localeCompare(b.id));

  const isNew = ({ id }: ChangelogEntry): boolean => unseen.has(id);
  const isSeen = ({ id }: ChangelogEntry): boolean => !unseen.has(id);
  const groups: WhatsNewGroup[] = [
    {
      kind: 'unseen',
      version: null,
      date: undefined,
      categories: byCategory(
        [...latest, ...releases.flatMap(({ entries }) => entries)].filter(isNew),
      ),
    },
    {
      kind: 'latest',
      version: null,
      date: undefined,
      categories: byCategory(latest.filter(isSeen)),
    },
    ...releases.map(({ version, date, entries }) => ({
      kind: version === null ? ('earlier' as const) : ('release' as const),
      version,
      date,
      categories: byCategory(entries.filter(isSeen)),
    })),
  ];
  return groups.filter(({ categories }) => categories.length > 0);
};

/** Every entry id of the changelog, whether pending or released. */
export const entryIds = (groups: readonly WhatsNewGroup[]): string[] =>
  groups.flatMap(({ categories }) =>
    categories.flatMap(({ entries }) => entries.map(({ id }) => id)),
  );

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

export const whatsNewGroups = (unseen: ReadonlySet<string> = NONE): WhatsNewGroup[] =>
  buildGroups(fragmentSources, releasedJson as unknown as readonly Release[], unseen);
