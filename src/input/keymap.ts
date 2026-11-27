import type { SignId } from '../contracts/einweiser';
import type { Role } from '../contracts/exercise';
import type { MessageKey } from '../i18n/en';

/**
 * Which handler family acts on a binding: driving keys, view keys, or app-level keys; the Einweiser's
 * walk and sign keys, which beat the view keys that share a physical key.
 */
export type Scope = 'drive' | 'view' | 'app' | 'walk' | 'sign';

export type Action =
  | 'steerLeft'
  | 'steerRight'
  | 'resetSteer'
  | 'faster'
  | 'slower'
  | 'brake'
  | 'gearP'
  | 'gearR'
  | 'gearN'
  | 'gearD'
  | 'lights'
  | 'hazard'
  | 'uncouple'
  | 'escape'
  | 'viewFollow'
  | 'viewYard'
  | 'viewChase'
  | 'freeCamera'
  | 'zoomIn'
  | 'zoomOut'
  | 'orbitLeft'
  | 'orbitRight'
  | 'tiltUp'
  | 'tiltDown'
  | 'glanceLeft'
  | 'glanceRight'
  | 'resetView'
  | 'splitReset'
  | 'walkForward'
  | 'walkBack'
  | 'walkLeft'
  | 'walkRight'
  | 'jog'
  | 'releaseMouse'
  | 'signAchtung'
  | 'signHalt'
  | 'signHaltGefahr'
  | 'signAbfahren'
  | 'signHerkommen'
  | 'signEntfernen'
  | 'signLinks'
  | 'signRechts'
  | 'signAbstand';

/** The sign a `'sign'` action shows. */
export const SIGN_OF: Readonly<Partial<Record<Action, SignId>>> = {
  signAchtung: 'achtung',
  signHalt: 'halt',
  signHaltGefahr: 'haltGefahr',
  signAbfahren: 'abfahren',
  signHerkommen: 'herkommen',
  signEntfernen: 'entfernen',
  signLinks: 'links',
  signRechts: 'rechts',
  signAbstand: 'abstand',
};

/** View keys the Einweiser's drive does not offer: no glance (mouse look), outside view or free camera (`docs/einweiser-spike.md` §3.1). */
export const EINWEISER_DROPPED_VIEW_ACTIONS: readonly Action[] = [
  'glanceLeft',
  'glanceRight',
  'viewChase',
  'freeCamera',
  'orbitLeft',
  'orbitRight',
  'tiltUp',
  'tiltDown',
];

/**
 * `code` matches the physical key (`KeyboardEvent.code`), `key` the typed character
 * (lowercased): view letters and zoom signs follow the layout, so Y and +/- stay put on QWERTZ.
 */
export type Match = {
  readonly by: 'code' | 'key';
  readonly values: readonly string[];
};

/** A literal key name, or an i18n key where the name is translated. */
export type LegendTerm = string | { readonly key: MessageKey };

export type LegendRow = {
  readonly term: LegendTerm;
  readonly desc: MessageKey;
  /** Dropped in the compact legend. */
  readonly viewOnly: boolean;
};

type LegendSpec = {
  readonly term: LegendTerm;
  readonly desc: MessageKey;
  /** The roles whose legend lists it; the driver's alone when absent. */
  readonly roles?: readonly Role[];
  readonly viewOnly?: boolean;
  /** Dropped where the outside view does not exist. */
  readonly chaseOnly?: boolean;
  /** Dropped where the cockpit view cannot look around. */
  readonly lookOnly?: boolean;
  /** Replaces term and desc where the outside view exists. */
  readonly withChase?: { readonly term: LegendTerm; readonly desc: MessageKey };
};

export type Binding = {
  readonly action: Action;
  readonly match: Match;
  readonly scope: Scope;
  readonly legend?: LegendSpec;
};

type LegendOnly = { readonly legend: LegendSpec };

const EINWEISER: readonly Role[] = ['einweiser'];
const BOTH: readonly Role[] = ['driver', 'einweiser'];
const DRIVER: readonly Role[] = ['driver'];

/** Table order is the legend order. */
const KEYMAP: readonly (Binding | LegendOnly)[] = [
  {
    action: 'steerLeft',
    match: { by: 'code', values: ['KeyA', 'ArrowLeft'] },
    scope: 'drive',
    legend: { term: 'A / D · ← / →', desc: 'steer' },
  },
  { action: 'steerRight', match: { by: 'code', values: ['KeyD', 'ArrowRight'] }, scope: 'drive' },
  {
    action: 'resetSteer',
    match: { by: 'code', values: ['KeyC'] },
    scope: 'drive',
    legend: { term: 'C', desc: 'resetSteer' },
  },
  {
    action: 'faster',
    match: { by: 'code', values: ['KeyW', 'ArrowUp'] },
    scope: 'drive',
    legend: { term: 'W / S · ↑ / ↓', desc: 'speed' },
  },
  { action: 'slower', match: { by: 'code', values: ['KeyS', 'ArrowDown'] }, scope: 'drive' },
  {
    action: 'brake',
    match: { by: 'code', values: ['Space'] },
    scope: 'drive',
    legend: { term: { key: 'keySpace' }, desc: 'stop' },
  },
  {
    action: 'gearP',
    match: { by: 'code', values: ['Digit1', 'Numpad1'] },
    scope: 'drive',
    legend: { term: '1–4 = P / R / N / D', desc: 'gear' },
  },
  { action: 'gearR', match: { by: 'code', values: ['Digit2', 'Numpad2'] }, scope: 'drive' },
  { action: 'gearN', match: { by: 'code', values: ['Digit3', 'Numpad3'] }, scope: 'drive' },
  { action: 'gearD', match: { by: 'code', values: ['Digit4', 'Numpad4'] }, scope: 'drive' },
  {
    action: 'lights',
    match: { by: 'code', values: ['KeyH'] },
    scope: 'drive',
    legend: { term: 'H / X', desc: 'lampKeys', viewOnly: true },
  },
  { action: 'hazard', match: { by: 'code', values: ['KeyX'] }, scope: 'drive' },
  // shown on the HUD's uncouple button, which only a coupling run has
  { action: 'uncouple', match: { by: 'code', values: ['KeyU'] }, scope: 'drive' },
  // The Einweiser's keys: after the driver's, before the shared ones, which is the order of his legend.
  {
    action: 'walkForward',
    match: { by: 'code', values: ['KeyW', 'ArrowUp'] },
    scope: 'walk',
    legend: { term: 'W A S D · ← ↑ ↓ →', desc: 'walk', roles: EINWEISER },
  },
  { action: 'walkBack', match: { by: 'code', values: ['KeyS', 'ArrowDown'] }, scope: 'walk' },
  { action: 'walkLeft', match: { by: 'code', values: ['KeyA', 'ArrowLeft'] }, scope: 'walk' },
  { action: 'walkRight', match: { by: 'code', values: ['KeyD', 'ArrowRight'] }, scope: 'walk' },
  {
    action: 'jog',
    match: { by: 'code', values: ['ShiftLeft', 'ShiftRight'] },
    scope: 'walk',
    legend: { term: { key: 'keyShift' }, desc: 'jog', roles: EINWEISER },
  },
  { action: 'releaseMouse', match: { by: 'code', values: ['KeyP'] }, scope: 'walk' },
  { legend: { term: { key: 'keyMouse' }, desc: 'mouseLook', roles: EINWEISER } },
  {
    action: 'signAchtung',
    match: { by: 'code', values: ['Digit1', 'Numpad1'] },
    scope: 'sign',
    legend: { term: '1–9', desc: 'signKeys', roles: EINWEISER },
  },
  {
    action: 'signHalt',
    match: { by: 'code', values: ['Digit2', 'Numpad2', 'Space'] },
    scope: 'sign',
    legend: { term: { key: 'keySpace' }, desc: 'signHalt', roles: EINWEISER },
  },
  { action: 'signHaltGefahr', match: { by: 'code', values: ['Digit3', 'Numpad3'] }, scope: 'sign' },
  { action: 'signAbfahren', match: { by: 'code', values: ['Digit4', 'Numpad4'] }, scope: 'sign' },
  { action: 'signHerkommen', match: { by: 'code', values: ['Digit5', 'Numpad5'] }, scope: 'sign' },
  { action: 'signEntfernen', match: { by: 'code', values: ['Digit6', 'Numpad6'] }, scope: 'sign' },
  {
    action: 'signLinks',
    match: { by: 'code', values: ['Digit7', 'Numpad7', 'KeyQ'] },
    scope: 'sign',
    legend: { term: 'Q / E', desc: 'signLeftRight', roles: EINWEISER },
  },
  {
    action: 'signRechts',
    match: { by: 'code', values: ['Digit8', 'Numpad8', 'KeyE'] },
    scope: 'sign',
  },
  { action: 'signAbstand', match: { by: 'code', values: ['Digit9', 'Numpad9'] }, scope: 'sign' },
  { legend: { term: { key: 'keyMouseButtons' }, desc: 'signMouse', roles: EINWEISER } },
  {
    action: 'escape',
    match: { by: 'code', values: ['Escape'] },
    scope: 'app',
    legend: { term: { key: 'keyEsc' }, desc: 'pause', viewOnly: true, roles: BOTH },
  },
  {
    action: 'viewFollow',
    match: { by: 'key', values: ['f'] },
    scope: 'view',
    legend: {
      term: 'F / Y',
      desc: 'viewSwitchNoOutside',
      viewOnly: true,
      roles: BOTH,
      withChase: { term: 'F / Y / O', desc: 'viewSwitch' },
    },
  },
  { action: 'viewYard', match: { by: 'key', values: ['y'] }, scope: 'view' },
  { action: 'viewChase', match: { by: 'key', values: ['o'] }, scope: 'view' },
  { legend: { term: { key: 'keyWheel' }, desc: 'steer', viewOnly: true } },
  { legend: { term: { key: 'keyLever' }, desc: 'speed', viewOnly: true } },
  {
    action: 'zoomIn',
    match: { by: 'key', values: ['+', '='] },
    scope: 'view',
    legend: { term: '+ / −', desc: 'zoom', viewOnly: true, roles: BOTH },
  },
  { action: 'zoomOut', match: { by: 'key', values: ['-'] }, scope: 'view' },
  { legend: { term: { key: 'keyScroll' }, desc: 'zoom', viewOnly: true } },
  { legend: { term: { key: 'keyDrag' }, desc: 'panView', viewOnly: true } },
  {
    action: 'orbitLeft',
    match: { by: 'key', values: [','] },
    scope: 'view',
    legend: { term: { key: 'keyOrbitTilt' }, desc: 'orbitTilt', viewOnly: true, chaseOnly: true },
  },
  { action: 'orbitRight', match: { by: 'key', values: ['.'] }, scope: 'view' },
  { action: 'tiltUp', match: { by: 'code', values: ['PageUp'] }, scope: 'view' },
  { action: 'tiltDown', match: { by: 'code', values: ['PageDown'] }, scope: 'view' },
  {
    action: 'freeCamera',
    match: { by: 'key', values: ['k'] },
    scope: 'view',
  },
  {
    action: 'glanceLeft',
    match: { by: 'code', values: ['KeyQ'] },
    scope: 'view',
    legend: { term: 'Q / E', desc: 'lookAround', viewOnly: true, lookOnly: true },
  },
  { action: 'glanceRight', match: { by: 'code', values: ['KeyE'] }, scope: 'view' },
  {
    action: 'resetView',
    match: { by: 'key', values: ['0'] },
    scope: 'view',
    legend: { term: '0 / L', desc: 'resetViewAndSize', viewOnly: true, roles: BOTH },
  },
  { action: 'splitReset', match: { by: 'code', values: ['KeyL'] }, scope: 'view' },
];

const hasMatch = (entry: Binding | LegendOnly): entry is Binding => 'match' in entry;

export const BINDINGS: readonly Binding[] = KEYMAP.filter(hasMatch);

type KeyLike = Pick<KeyboardEvent, 'code' | 'key'>;

const matches = ({ match }: Binding, e: KeyLike): boolean =>
  match.values.includes(match.by === 'code' ? e.code : e.key.toLowerCase());

/** The action the key event is bound to in `scope`, if any. */
export const actionFor = (scope: Scope, e: KeyLike): Action | undefined =>
  BINDINGS.find((b) => b.scope === scope && matches(b, e))?.action;

export const isAction = (action: Action, e: KeyLike): boolean =>
  BINDINGS.some((b) => b.action === action && matches(b, e));

/** The key legend of `role` in display order; `chase` is whether the outside view exists, `look` whether the cockpit view looks around. */
export function legendRows(chase: boolean, look = false, role: Role = 'driver'): LegendRow[] {
  return KEYMAP.map(({ legend }) => legend).flatMap((spec) => {
    if (spec === undefined || !(spec.roles ?? DRIVER).includes(role)) return [];
    if ((spec.chaseOnly === true && !chase) || (spec.lookOnly === true && !look)) return [];
    const { term, desc } = chase && spec.withChase !== undefined ? spec.withChase : spec;
    return [{ term, desc, viewOnly: spec.viewOnly ?? false }];
  });
}
