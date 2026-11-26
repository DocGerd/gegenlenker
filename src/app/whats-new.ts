import type { MessageKey } from '../i18n/en';
import { t } from '../i18n/i18n';
import { buildLabel } from './build-info';
import { markAllSeen, unseenIds } from './whats-new-seen';
import { tokens, whatsNewGroups, type GroupKind, type WhatsNewGroup } from './whats-new-source';

const GROUP_TITLE: Readonly<Record<Exclude<GroupKind, 'release'>, MessageKey>> = {
  unseen: 'whatsNewSince',
  latest: 'whatsNewLatest',
  earlier: 'whatsNewEarlier',
};
const CATEGORY_TITLE: Readonly<
  Record<WhatsNewGroup['categories'][number]['category'], MessageKey>
> = {
  added: 'changeAdded',
  changed: 'changeChanged',
  deprecated: 'changeDeprecated',
  removed: 'changeRemoved',
  fixed: 'changeFixed',
  security: 'changeSecurity',
};

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

const groupTitle = ({ kind, version, date }: WhatsNewGroup): string =>
  kind === 'release'
    ? [version, date].filter((part) => part !== undefined).join(' · ')
    : t(GROUP_TITLE[kind]);

const entryItem = (line: string): HTMLLIElement => {
  const item = element('li', 'whats-new-entry');
  // The changelog is English only; the screen around it follows the UI language.
  item.lang = 'en';
  item.append(
    ...tokens(line).map(({ code, text }) =>
      code ? element('code', 'whats-new-code', text) : document.createTextNode(text),
    ),
  );
  return item;
};

const groupSection = (group: WhatsNewGroup): HTMLElement => {
  const section = element('section', 'whats-new-group');
  section.append(element('h2', 'whats-new-group-title', groupTitle(group)));
  for (const { category, entries } of group.categories) {
    const list = element('ul', 'whats-new-list');
    list.append(...entries.map(({ en }) => entryItem(en)));
    section.append(element('h3', 'whats-new-category', t(CATEGORY_TITLE[category])), list);
  }
  return section;
};

/** Appends the notes and the changelog groups, and marks every entry seen. */
export function render(body: HTMLElement): void {
  body.append(element('p', 'whats-new-note mono', buildLabel()));
  if (document.documentElement.lang !== 'en') {
    body.append(element('p', 'whats-new-note', t('whatsNewEnglishNote')));
  }
  body.append(...whatsNewGroups(unseenIds()).map(groupSection));
  markAllSeen();
}
