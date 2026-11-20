export const CATEGORIES = [
  'added',
  'changed',
  'deprecated',
  'removed',
  'fixed',
  'security',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface ChangelogEntry {
  id: string;
  category: Category;
  prs: number[];
  en: string;
}

export interface Release {
  version: string | null;
  date?: string;
  entries: ChangelogEntry[];
}

export const PR_URL = 'https://github.com/DocGerd/gegenlenker/pull/';

const NAME_RE = new RegExp(`^([1-9]\\d*)(?:-[1-9]\\d*)?\\.(${CATEGORIES.join('|')})\\.md$`);
const LINK_RE =
  /^(.*\S) \(\[#(\d+)\]\(https:\/\/github\.com\/DocGerd\/gegenlenker\/pull\/(\d+)\)\)\.?$/;
const FORBIDDEN_RE = /[<*\\[]|\]\(|``/;
const PROSE_RE = /[_~&]/;
const URL_RE = /https?:\/\//i;
const BLOCK_RE = /^(?:[-+]\s|#{1,6}(?:\s|$)|\d+\.\s|>)/;

const prose = (text: string): string =>
  text
    .split('`')
    .filter((_, i) => i % 2 === 0)
    .join(' ');

/** Plain text and inline code only; null when `text` fits. */
export const inlineProblem = (text: string): string | null => {
  if (text === '' || text !== text.trim()) return 'empty or padded with whitespace';
  if (text.includes('\n')) return 'contains a line break';
  if (BLOCK_RE.test(text)) return 'starts like a list item, heading or quote';
  if (FORBIDDEN_RE.test(text) || URL_RE.test(text) || PROSE_RE.test(prose(text)))
    return 'contains markup other than inline code';
  if ((text.match(/`/g)?.length ?? 0) % 2 !== 0) return 'has an unbalanced backtick';
  if (!text.endsWith('.')) return 'does not end with a period';
  return null;
};

/** Parses `<number>.<category>.md`: one English line ending with its PR link. Throws on a malformed fragment. */
export const parseFragment = (name: string, text: string): ChangelogEntry => {
  const named = NAME_RE.exec(name);
  const number = named?.[1];
  const category = named?.[2] as Category | undefined;
  if (number === undefined || category === undefined) throw new Error(`${name}: bad file name`);

  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const [first] = lines.map((line) => line.trim());
  if (lines.length !== 1 || first === undefined)
    throw new Error(`${name}: expected exactly one non-empty line`);

  const link = LINK_RE.exec(first);
  if (!link) throw new Error(`${name}: the line must end with its PR link`);
  const [, body = '', linked, repeated] = link;
  if (linked !== number || repeated !== number)
    throw new Error(`${name}: PR link number differs from the file name`);
  const en = body.endsWith('.') ? body : `${body}.`;

  const problem = inlineProblem(en);
  if (problem !== null) throw new Error(`${name}: text ${problem}`);

  return { id: name.slice(0, -'.md'.length), category, prs: [Number(number)], en };
};
