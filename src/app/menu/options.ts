import {
  GRAPHICS_PRESETS,
  LIGHTING_MODES,
  type GraphicsPreset,
  type LightingMode,
} from '../../contracts/render';
import { setLanguage, type Lang } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';
import { trailers, trucks } from '../../vehicles/registry';
import { updateSettings, type Settings } from '../settings';
import { applyTheme } from '../theme';

export type OptionId =
  | 'truck'
  | 'trailer'
  | 'lighting'
  | 'driveView'
  | 'language'
  | 'theme'
  | 'graphics'
  | 'wideMirrors';

export type Applies = 'live' | 'nextStart' | 'menuOnly' | 'run';

export type Choice = {
  readonly value: string;
  /** Vehicle names are data, not translated. */
  readonly label: MessageKey | { readonly text: string };
};

export type OptionField = {
  readonly id: OptionId;
  readonly label: MessageKey;
  readonly group: 'run' | 'general' | 'graphics';
  readonly choices: readonly Choice[];
  readonly applies: Applies;
};

type SettingsPatch = Partial<Omit<Settings, 'version'>>;

const LANG_NAME: Readonly<Record<Lang, MessageKey>> = { de: 'langDe', en: 'langEn' };
const THEME_NAME: Readonly<Record<Settings['theme'], MessageKey>> = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
};
const GRAPHICS_NAME: Readonly<Record<GraphicsPreset, MessageKey>> = {
  low: 'graphicsLow',
  balanced: 'graphicsBalanced',
  high: 'graphicsHigh',
};
const LIGHTING_NAME: Readonly<Record<LightingMode, MessageKey>> = {
  day: 'lightingDay',
  night: 'lightingNight',
};
const DRIVE_VIEW_NAME = { standard: 'driveViewStandard', mirrors: 'driveViewMirrors' } as const;
const SWITCH_NAME = { on: 'settingOn', off: 'settingOff' } as const;

const LANGS: readonly Lang[] = ['de', 'en'];
const THEMES: readonly Settings['theme'][] = ['system', 'light', 'dark'];
const DRIVE_VIEWS: readonly (keyof typeof DRIVE_VIEW_NAME)[] = ['standard', 'mirrors'];
const SWITCH: readonly (keyof typeof SWITCH_NAME)[] = ['on', 'off'];
const TRUCKS = trucks.map((s) => s.id);
const TRAILERS = trailers.map((s) => s.id);

const named = <T extends string>(
  values: readonly T[],
  names: Readonly<Record<T, MessageKey>>,
): readonly Choice[] => values.map((value) => ({ value, label: names[value] }));

export const OPTION_FIELDS: Readonly<Record<OptionId, OptionField>> = {
  truck: {
    id: 'truck',
    label: 'truck',
    group: 'run',
    choices: trucks.map((s) => ({ value: s.id, label: { text: s.name } })),
    applies: 'run',
  },
  trailer: {
    id: 'trailer',
    label: 'trailer',
    group: 'run',
    choices: trailers.map((s) => ({ value: s.id, label: { text: s.name } })),
    applies: 'run',
  },
  lighting: {
    id: 'lighting',
    label: 'lighting',
    group: 'run',
    choices: named(LIGHTING_MODES, LIGHTING_NAME),
    applies: 'run',
  },
  driveView: {
    id: 'driveView',
    label: 'driveView',
    group: 'run',
    choices: named(DRIVE_VIEWS, DRIVE_VIEW_NAME),
    applies: 'run',
  },
  language: {
    id: 'language',
    label: 'language',
    group: 'general',
    choices: named(LANGS, LANG_NAME),
    applies: 'menuOnly',
  },
  theme: {
    id: 'theme',
    label: 'theme',
    group: 'general',
    choices: named(THEMES, THEME_NAME),
    applies: 'live',
  },
  graphics: {
    id: 'graphics',
    label: 'graphics',
    group: 'graphics',
    choices: named(GRAPHICS_PRESETS, GRAPHICS_NAME),
    applies: 'nextStart',
  },
  wideMirrors: {
    id: 'wideMirrors',
    label: 'wideMirrors',
    group: 'graphics',
    choices: named(SWITCH, SWITCH_NAME),
    applies: 'live',
  },
};

export function optionValue(settings: Settings, id: OptionId): string {
  switch (id) {
    case 'truck':
      return settings.truckId;
    case 'trailer':
      return settings.trailerId;
    case 'lighting':
      return settings.lighting;
    case 'driveView':
      return settings.mirrorsOnly ? 'mirrors' : 'standard';
    case 'language':
      return settings.language;
    case 'theme':
      return settings.theme;
    case 'graphics':
      return settings.graphics;
    case 'wideMirrors':
      return settings.wideMirrors ? 'on' : 'off';
  }
}

const patchOf = <T extends string>(
  values: readonly T[],
  value: string,
  make: (v: T) => SettingsPatch,
): SettingsPatch | null => {
  const v = values.find((x) => x === value);
  return v === undefined ? null : make(v);
};

export function optionPatch(id: OptionId, value: string): SettingsPatch | null {
  switch (id) {
    case 'truck':
      return patchOf(TRUCKS, value, (truckId) => ({ truckId }));
    case 'trailer':
      return patchOf(TRAILERS, value, (trailerId) => ({ trailerId }));
    case 'lighting':
      return patchOf(LIGHTING_MODES, value, (lighting) => ({ lighting }));
    case 'driveView':
      return patchOf(DRIVE_VIEWS, value, (v) => ({ mirrorsOnly: v === 'mirrors' }));
    case 'language':
      return patchOf(LANGS, value, (language) => ({ language }));
    case 'theme':
      return patchOf(THEMES, value, (theme) => ({ theme }));
    case 'graphics':
      return patchOf(GRAPHICS_PRESETS, value, (graphics) => ({ graphics }));
    case 'wideMirrors':
      return patchOf(SWITCH, value, (v) => ({ wideMirrors: v === 'on' }));
  }
}

/** Validates, stores, and runs `setLanguage` / `applyTheme`; false for an unknown value. */
export function applyOption(id: OptionId, value: string): boolean {
  const patch = optionPatch(id, value);
  if (patch === null) return false;
  const settings = updateSettings(patch);
  if (id === 'language') setLanguage(settings.language);
  if (id === 'theme') applyTheme(settings.theme);
  return true;
}
