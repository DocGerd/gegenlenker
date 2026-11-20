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
export const seenOrSeed = (
  stored: ReadonlySet<string> | null,
  ids: readonly string[],
): ReadonlySet<string> => stored ?? new Set(ids);

export const unseenAmong = (ids: readonly string[], seen: ReadonlySet<string>): string[] =>
  ids.filter((id) => !seen.has(id));

// Held in memory as well, so nothing is flagged when storage is unavailable.
let seen: ReadonlySet<string> | undefined;

const remember = (ids: Iterable<string>): ReadonlySet<string> => {
  seen = new Set(ids);
  writeText(WHATS_NEW_SEEN_KEY, JSON.stringify([...seen]));
  return seen;
};

const current = (ids: readonly string[]): ReadonlySet<string> => {
  if (seen !== undefined) return seen;
  const stored = parseSeen(readText(WHATS_NEW_SEEN_KEY));
  if (stored === null) return remember(seenOrSeed(stored, ids));
  seen = stored;
  return stored;
};

const allIds = (): string[] => entryIds(whatsNewGroups());

export const unseenIds = (): Set<string> => {
  const ids = allIds();
  return new Set(unseenAmong(ids, current(ids)));
};

export const hasUnseen = (): boolean => unseenIds().size > 0;

export const markAllSeen = (): void => {
  const ids = allIds();
  remember([...current(ids), ...ids]);
};
