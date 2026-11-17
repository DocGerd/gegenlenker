import type { AidFlags, CollapsedPanels, TopDownMode } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import type { Lang } from '../i18n/i18n';
import { SETTINGS_KEY, writeText } from './storage';

export type Settings = {
  readonly version: 1;
  readonly language: Lang;
  readonly theme: 'system' | 'light' | 'dark';
  readonly truckId: TruckId;
  readonly trailerId: TrailerId;
  readonly aids: AidFlags;
  readonly topDown: TopDownMode;
  readonly collapsed: CollapsedPanels;
};

const DEFAULT_AIDS: AidFlags = { pivots: true, path: true, tracks: false, ghost: true };
const DEFAULT_COLLAPSED: CollapsedPanels = { aids: false, gauges: false };
const LANGS: readonly Lang[] = ['de', 'en'];
const THEMES: readonly Settings['theme'][] = ['system', 'light', 'dark'];
const TOP_DOWN: readonly TopDownMode[] = ['follow', 'yard'];

const pick = <T extends string>(ids: readonly T[], v: unknown, fallback: T): T =>
  ids.find((id) => id === v) ?? fallback;

const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Field by field: one bad value falls back alone instead of resetting every choice. */
export function loadSettings(raw: string | null, detected: Lang): Settings {
  let data: unknown;
  try {
    data = raw === null ? null : JSON.parse(raw);
  } catch {
    data = null;
  }
  const s = isRecord(data) && data['version'] === 1 ? data : {};
  const aids = isRecord(s['aids']) ? s['aids'] : {};
  const collapsed = isRecord(s['collapsed']) ? s['collapsed'] : {};
  return {
    version: 1,
    language: pick(LANGS, s['language'], detected),
    theme: pick(THEMES, s['theme'], 'system'),
    truckId: pick(TRUCK_IDS, s['truckId'], TRUCK_IDS[0]),
    trailerId: pick(TRAILER_IDS, s['trailerId'], TRAILER_IDS[0]),
    aids: {
      pivots: flag(aids['pivots'], DEFAULT_AIDS.pivots),
      path: flag(aids['path'], DEFAULT_AIDS.path),
      tracks: flag(aids['tracks'], DEFAULT_AIDS.tracks),
      ghost: flag(aids['ghost'], DEFAULT_AIDS.ghost),
    },
    topDown: pick(TOP_DOWN, s['topDown'], 'follow'),
    collapsed: {
      aids: flag(collapsed['aids'], DEFAULT_COLLAPSED.aids),
      gauges: flag(collapsed['gauges'], DEFAULT_COLLAPSED.gauges),
    },
  };
}

// Held in memory as well, so choices survive the session when storage is unavailable.
let current: Settings | null = null;

export function initSettings(settings: Settings): void {
  current = settings;
}

export function currentSettings(): Settings {
  if (current === null) throw new Error('settings not initialised');
  return current;
}

export function updateSettings(patch: Partial<Omit<Settings, 'version'>>): Settings {
  current = { ...currentSettings(), ...patch };
  writeText(SETTINGS_KEY, JSON.stringify(current));
  return current;
}
