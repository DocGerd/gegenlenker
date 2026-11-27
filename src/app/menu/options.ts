import { FOV_CHOICES, MOUSE_SENSITIVITIES, type MouseSensitivity } from '../../contracts/einweiser';
import type { Role } from '../../contracts/exercise';
import {
  GRAPHICS_PRESETS,
  LIGHTING_MODES,
  type GraphicsPreset,
  type LightingMode,
} from '../../contracts/render';
import { setLanguage, t, type Lang } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/en';
import { trailers, trucks } from '../../vehicles/registry';
import { runTrailer, updateSettings, type Settings } from '../settings';
import { applyTheme } from '../theme';

export type OptionId =
  | 'truck'
  | 'trailer'
  | 'lighting'
  | 'driveView'
  | 'language'
  | 'theme'
  | 'graphics'
  | 'wideMirrors'
  | 'fov'
  | 'mouseSensitivity'
  | 'invertMouse';

export type Applies = 'live' | 'menuOnly' | 'run';

export type Choice = {
  readonly value: string;
  /** Vehicle names are data, not translated. */
  readonly label: MessageKey | { readonly text: string };
};

export type OptionField = {
  readonly id: OptionId;
  readonly label: MessageKey;
  readonly group: 'run' | 'general' | 'graphics' | 'einweiser';
  readonly choices: readonly Choice[];
  readonly applies: Applies;
};

/** What a choice row draws: an option field, or a row the setup keeps to itself. */
export type ChoiceField = Pick<OptionField, 'label' | 'choices'> & { readonly id: string };

/** A choice's name as shown: a key is translated, vehicle names are data. */
export const labelOf = ({ label }: Choice): string =>
  typeof label === 'string' ? t(label) : label.text;

/** A line under an option's row that says what the choice costs or changes. */
export const OPTION_HINTS: Readonly<Partial<Record<OptionId, MessageKey>>> = {
  graphics: 'graphicsHint',
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
const SENSITIVITY_NAME: Readonly<Record<MouseSensitivity, MessageKey>> = {
  low: 'sensitivityLow',
  medium: 'sensitivityMedium',
  high: 'sensitivityHigh',
};
const DRIVE_VIEW_NAME = { standard: 'driveViewStandard', mirrors: 'driveViewMirrors' } as const;
const EINWEISER_VIEW_NAME = {
  standard: 'driveViewStandard',
  mirrors: 'einweiserViewNoTop',
} as const;
const SWITCH_NAME = { on: 'settingOn', off: 'settingOff' } as const;

const LANGS: readonly Lang[] = ['de', 'en'];
const THEMES: readonly Settings['theme'][] = ['system', 'light', 'dark'];
const DRIVE_VIEWS: readonly (keyof typeof DRIVE_VIEW_NAME)[] = ['standard', 'mirrors'];
const SWITCH: readonly (keyof typeof SWITCH_NAME)[] = ['on', 'off'];
const OFF_ON: readonly (keyof typeof SWITCH_NAME)[] = ['off', 'on'];
const TRUCKS = trucks.map((s) => s.id);
const TRAILERS = trailers.map((s) => s.id);
/** The trailer row's value for the truck solo. */
const NO_TRAILER = 'none';
const TRAILER_CHOICES: readonly Choice[] = trailers.map((s) => ({
  value: s.id,
  label: { text: s.name },
}));

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
    choices: [...TRAILER_CHOICES, { value: NO_TRAILER, label: 'noTrailer' }],
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
    applies: 'live',
  },
  wideMirrors: {
    id: 'wideMirrors',
    label: 'wideMirrors',
    group: 'graphics',
    choices: named(SWITCH, SWITCH_NAME),
    applies: 'live',
  },
  fov: {
    id: 'fov',
    label: 'fov',
    group: 'einweiser',
    choices: FOV_CHOICES.map((fov) => ({ value: String(fov), label: { text: `${fov}°` } })),
    applies: 'live',
  },
  mouseSensitivity: {
    id: 'mouseSensitivity',
    label: 'mouseSensitivity',
    group: 'einweiser',
    choices: named(MOUSE_SENSITIVITIES, SENSITIVITY_NAME),
    applies: 'live',
  },
  invertMouse: {
    id: 'invertMouse',
    label: 'invertMouse',
    group: 'einweiser',
    choices: named(OFF_ON, SWITCH_NAME),
    applies: 'live',
  },
};

/** Where the Einweiser names a field his own way: the same setting, so the same values. He guides a combination only. */
const EINWEISER_FIELDS: Readonly<Partial<Record<OptionId, OptionField>>> = {
  trailer: { ...OPTION_FIELDS.trailer, choices: TRAILER_CHOICES },
  driveView: {
    ...OPTION_FIELDS.driveView,
    label: 'einweiserView',
    choices: named(DRIVE_VIEWS, EINWEISER_VIEW_NAME),
  },
};

/** The Trailer row of an exercise that couples: the trailer it couples to, never none. */
export const COUPLED_TRAILER_FIELD: OptionField = {
  ...OPTION_FIELDS.trailer,
  choices: TRAILER_CHOICES,
};

/** The field as the role sees it. */
export const roleField = (id: OptionId, role: Role): OptionField =>
  (role === 'einweiser' ? EINWEISER_FIELDS[id] : undefined) ?? OPTION_FIELDS[id];

const PAUSE_FIELDS: Readonly<Record<Role, readonly OptionId[]>> = {
  driver: ['theme', 'wideMirrors', 'graphics'],
  // No driver mirrors to widen
  einweiser: ['fov', 'mouseSensitivity', 'invertMouse', 'theme', 'graphics'],
};

/** What a running drive can take: shown in the pause sheet, in this order. */
export const pauseFields = (role: Role): readonly OptionId[] => PAUSE_FIELDS[role];

/** `role` matters for the trailer only. */
export function optionValue(settings: Settings, id: OptionId, role: Role = 'driver'): string {
  switch (id) {
    case 'truck':
      return settings.truckId;
    case 'trailer':
      return runTrailer(settings, role) ?? NO_TRAILER;
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
    case 'fov':
      return String(settings.fov);
    case 'mouseSensitivity':
      return settings.mouseSensitivity;
    case 'invertMouse':
      return settings.invertMouse ? 'on' : 'off';
  }
}

const patchOf = <T extends string | number>(
  values: readonly T[],
  value: string,
  make: (v: T) => SettingsPatch,
): SettingsPatch | null => {
  const v = values.find((x) => String(x) === value);
  return v === undefined ? null : make(v);
};

export function optionPatch(id: OptionId, value: string): SettingsPatch | null {
  switch (id) {
    case 'truck':
      return patchOf(TRUCKS, value, (truckId) => ({ truckId }));
    case 'trailer':
      if (value === NO_TRAILER) return { solo: true };
      return patchOf(TRAILERS, value, (trailerId) => ({ trailerId, solo: false }));
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
    case 'fov':
      return patchOf(FOV_CHOICES, value, (fov) => ({ fov }));
    case 'mouseSensitivity':
      return patchOf(MOUSE_SENSITIVITIES, value, (mouseSensitivity) => ({ mouseSensitivity }));
    case 'invertMouse':
      return patchOf(SWITCH, value, (v) => ({ invertMouse: v === 'on' }));
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
