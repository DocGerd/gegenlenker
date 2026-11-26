import {
  DEFAULT_GRAPHICS,
  DEFAULT_LIGHTING,
  DEFAULT_TOP_DOWN_LAYOUT,
  GRAPHICS_PRESETS,
  LIGHTING_MODES,
  TOP_DOWN_SHARE_LIMITS,
  type AidFlags,
  type CollapsedPanels,
  type GraphicsPreset,
  type LightingMode,
  type DrivingView,
  type Orientation,
  type TopDownLayout,
} from '../contracts/render';
import { EXERCISE_IDS } from '../contracts/exercise';
import { LAYOUT_IDS } from '../contracts/layout';
import { TRAILER_IDS, TRUCK_IDS, type TrailerId, type TruckId } from '../contracts/vehicle';
import type { Lang } from '../i18n/i18n';
import type { EntryRef } from './menu/catalogue';
import { SETTINGS_KEY, writeText } from './storage';

export type Settings = {
  readonly version: 1;
  readonly language: Lang;
  readonly theme: 'system' | 'light' | 'dark';
  readonly truckId: TruckId;
  readonly trailerId: TrailerId;
  readonly aids: AidFlags;
  readonly topDown: DrivingView;
  readonly topDownLayout: TopDownLayout;
  readonly collapsed: CollapsedPanels;
  readonly graphics: GraphicsPreset;
  readonly lighting: LightingMode;
  readonly wideMirrors: boolean;
  /** Drives without the top-down view; chosen in the menu like the lighting. */
  readonly mirrorsOnly: boolean;
  /** What the last drive was, so the title can offer to continue it. */
  readonly lastEntry: EntryRef | null;
};

const DEFAULT_AIDS: AidFlags = { pivots: true, path: true, tracks: false, ghost: true };
const DEFAULT_COLLAPSED: CollapsedPanels = { aids: false, gauges: false, keys: false };
const LANGS: readonly Lang[] = ['de', 'en'];
const THEMES: readonly Settings['theme'][] = ['system', 'light', 'dark'];
const TOP_DOWN: readonly DrivingView[] = ['follow', 'yard'];

const pick = <T extends string>(ids: readonly T[], v: unknown, fallback: T): T =>
  ids.find((id) => id === v) ?? fallback;

/** A finite number clamped to the orientation's limits; anything else is the default. */
const share = (orientation: Orientation, v: unknown): number => {
  const { min, max } = TOP_DOWN_SHARE_LIMITS[orientation];
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, v))
    : DEFAULT_TOP_DOWN_LAYOUT[orientation];
};

const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Role, kind and id must all be known; anything else is no last entry. */
const entryRef = (v: unknown): EntryRef | null => {
  if (!isRecord(v) || v['role'] !== 'driver') return null;
  const { kind, id } = v;
  if (kind === 'exercise') {
    const known = EXERCISE_IDS.find((e) => e === id);
    return known === undefined ? null : { role: 'driver', kind, id: known };
  }
  if (kind === 'yard') {
    const known = LAYOUT_IDS.find((l) => l === id);
    return known === undefined ? null : { role: 'driver', kind, id: known };
  }
  return null;
};

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
  const layout = isRecord(s['topDownLayout']) ? s['topDownLayout'] : {};
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
    topDownLayout: {
      landscape: share('landscape', layout['landscape']),
      portrait: share('portrait', layout['portrait']),
    },
    collapsed: {
      aids: flag(collapsed['aids'], DEFAULT_COLLAPSED.aids),
      gauges: flag(collapsed['gauges'], DEFAULT_COLLAPSED.gauges),
      keys: flag(collapsed['keys'], DEFAULT_COLLAPSED.keys),
    },
    graphics: pick(GRAPHICS_PRESETS, s['graphics'], DEFAULT_GRAPHICS),
    lighting: pick(LIGHTING_MODES, s['lighting'], DEFAULT_LIGHTING),
    wideMirrors: flag(s['wideMirrors'], true),
    mirrorsOnly: flag(s['mirrorsOnly'], false),
    lastEntry: entryRef(s['lastEntry']),
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
