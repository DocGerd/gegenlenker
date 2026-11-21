import type { MessageKey } from '../i18n/en';

/** Which handler family acts on a binding: driving keys, view keys, or app-level keys. */
export type Scope = 'drive' | 'view' | 'app';

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
  | 'escape'
  | 'viewFollow'
  | 'viewYard'
  | 'viewChase'
  | 'zoomIn'
  | 'zoomOut'
  | 'resetView'
  | 'splitReset';

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
  readonly viewOnly?: boolean;
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
    legend: { term: { key: 'keySpace' }, desc: 'brake' },
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
  {
    action: 'escape',
    match: { by: 'code', values: ['Escape'] },
    scope: 'app',
    legend: { term: { key: 'keyEsc' }, desc: 'pause', viewOnly: true },
  },
  {
    action: 'viewFollow',
    match: { by: 'key', values: ['f'] },
    scope: 'view',
    legend: {
      term: 'F / Y',
      desc: 'viewSwitchNoOutside',
      viewOnly: true,
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
    legend: { term: '+ / −', desc: 'zoom', viewOnly: true },
  },
  { action: 'zoomOut', match: { by: 'key', values: ['-'] }, scope: 'view' },
  { legend: { term: { key: 'keyScroll' }, desc: 'zoom', viewOnly: true } },
  { legend: { term: { key: 'keyDrag' }, desc: 'panView', viewOnly: true } },
  {
    action: 'resetView',
    match: { by: 'key', values: ['0'] },
    scope: 'view',
    legend: { term: '0 / L', desc: 'resetViewAndSize', viewOnly: true },
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

/** The key legend in display order; `chase` is whether the outside view exists. */
export function legendRows(chase: boolean): LegendRow[] {
  return KEYMAP.map(({ legend }) => legend).flatMap((spec) => {
    if (spec === undefined) return [];
    const { term, desc } = chase && spec.withChase !== undefined ? spec.withChase : spec;
    return [{ term, desc, viewOnly: spec.viewOnly ?? false }];
  });
}
