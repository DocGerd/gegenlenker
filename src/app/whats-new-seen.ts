import { entryIds, whatsNewGroups } from './whats-new-source';
import { WHATS_NEW_SEEN_KEY, readText, writeText } from './storage';

/** Null when nothing usable is stored: a first visit, or a value that is not a list of strings. */
export const parseSeen = (raw: string | null): ReadonlySet<string> | null => {
  if (raw === null) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return new Set(data.filter((id): id is string => typeof id === 'string'));
  } catch {
    return null;
  }
};

/** Without a stored set every current entry counts as seen, so a fresh install shows no badge. */
export const unseenAmong = (ids: readonly string[], seen: ReadonlySet<string> | null): string[] =>
  seen === null ? [] : ids.filter((id) => !seen.has(id));

// Held in memory as well, so nothing is flagged when storage is unavailable.
let seen: ReadonlySet<string> | null | undefined;

const remember = (ids: Iterable<string>): void => {
  seen = new Set(ids);
  writeText(WHATS_NEW_SEEN_KEY, JSON.stringify([...seen]));
};

const current = (ids: readonly string[]): ReadonlySet<string> | null => {
  seen ??= parseSeen(readText(WHATS_NEW_SEEN_KEY));
  if (seen === null) remember(ids);
  return seen;
};

const allIds = (): string[] => entryIds(whatsNewGroups());

export const unseenIds = (): Set<string> => {
  const ids = allIds();
  return new Set(unseenAmong(ids, current(ids)));
};

export const hasUnseen = (): boolean => unseenIds().size > 0;

export const markAllSeen = (): void => {
  const ids = allIds();
  remember([...(current(ids) ?? []), ...ids]);
};
