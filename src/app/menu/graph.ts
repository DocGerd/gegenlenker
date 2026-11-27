import type { ExerciseId } from '../../contracts/exercise';
import type { MessageKey } from '../../i18n/en';
import type { EntryKind, EntryRef, Role } from './catalogue';
import type { OptionId } from './options';

export type ScreenId =
  'title' | 'exercises' | 'yards' | 'setup' | 'settings' | 'controls' | 'whatsNew' | 'about';
export type ScreenKind = 'menu' | 'entries' | 'setup' | 'options' | 'content';
export type ActionId = 'replayLast' | 'continue';
export type ConditionId = 'canReplay' | 'hasNews' | 'canContinue';

export type Item = {
  readonly id: string;
  readonly label: MessageKey;
  readonly tier: 'primary' | 'main' | 'secondary';
  readonly target: { readonly screen: ScreenId } | { readonly action: ActionId };
  readonly showWhen?: ConditionId;
  readonly badgeWhen?: ConditionId;
};

export type OptionGroup = {
  readonly label: MessageKey;
  readonly fields: readonly OptionId[];
  /** Listed only where the Einweiser role is offered (`offeredRoles`). */
  readonly einweiser?: true;
};

/** Plain data, so it stays JSON-serialisable: conditions and actions are named, not functions. */
export type Screen = {
  readonly id: ScreenId;
  readonly kind: ScreenKind;
  /** Null where the `h1` comes from the content (setup names its entry). */
  readonly title: MessageKey | null;
  readonly items: readonly Item[];
  /** Loaded on demand. */
  readonly lazy: boolean;
  /** Item ids to focus on open, first shown wins. */
  readonly focus?: readonly string[];
  readonly list?: { readonly role: Role; readonly kind: EntryKind };
  readonly groups?: readonly OptionGroup[];
};

export const GRAPH: readonly Screen[] = [
  {
    id: 'title',
    kind: 'menu',
    title: 'appName',
    items: [
      {
        id: 'continue',
        label: 'continue',
        tier: 'primary',
        target: { action: 'continue' },
        showWhen: 'canContinue',
      },
      {
        id: 'replay',
        label: 'replayLastRun',
        tier: 'primary',
        target: { action: 'replayLast' },
        showWhen: 'canReplay',
      },
      { id: 'exercises', label: 'exercises', tier: 'main', target: { screen: 'exercises' } },
      { id: 'freeYard', label: 'freeYard', tier: 'main', target: { screen: 'yards' } },
      { id: 'settings', label: 'settings', tier: 'main', target: { screen: 'settings' } },
      { id: 'controls', label: 'controls', tier: 'secondary', target: { screen: 'controls' } },
      {
        id: 'whatsNew',
        label: 'whatsNew',
        tier: 'secondary',
        target: { screen: 'whatsNew' },
        badgeWhen: 'hasNews',
      },
      { id: 'about', label: 'about', tier: 'secondary', target: { screen: 'about' } },
    ],
    lazy: false,
    focus: ['continue', 'exercises'],
  },
  {
    id: 'exercises',
    kind: 'entries',
    title: 'exercises',
    items: [],
    lazy: false,
    list: { role: 'driver', kind: 'exercise' },
  },
  {
    id: 'yards',
    kind: 'entries',
    title: 'freeYard',
    items: [],
    lazy: false,
    list: { role: 'driver', kind: 'yard' },
  },
  { id: 'setup', kind: 'setup', title: null, items: [], lazy: false },
  {
    id: 'settings',
    kind: 'options',
    title: 'settings',
    items: [{ id: 'controls', label: 'controls', tier: 'main', target: { screen: 'controls' } }],
    lazy: false,
    groups: [
      { label: 'settingsGeneral', fields: ['language', 'theme'] },
      { label: 'settingsGraphics', fields: ['graphics', 'wideMirrors'] },
      {
        label: 'settingsEinweiser',
        fields: ['fov', 'mouseSensitivity', 'invertMouse'],
        einweiser: true,
      },
    ],
  },
  { id: 'controls', kind: 'content', title: 'controls', items: [], lazy: true },
  { id: 'whatsNew', kind: 'content', title: 'whatsNew', items: [], lazy: true },
  { id: 'about', kind: 'content', title: 'about', items: [], lazy: true },
];

export function screenOf(id: ScreenId): Screen {
  const screen = GRAPH.find((s) => s.id === id);
  if (screen === undefined) throw new Error(`Screen ${id} is not in the menu graph`);
  return screen;
}

/** A snapshot read by conditions, so the graph stays data. */
export type MenuState = {
  readonly done: readonly ExerciseId[];
  readonly replayable: boolean;
  readonly hasNews: boolean;
  /** The stored last entry, else the last run's: Continue starts from it. */
  readonly lastEntry: EntryRef | null;
};

export function holds(condition: ConditionId, state: MenuState): boolean {
  switch (condition) {
    case 'canReplay':
      return state.replayable;
    case 'hasNews':
      return state.hasNews;
    case 'canContinue':
      return state.lastEntry !== null;
  }
}

export function shownItems(screen: Screen, state: MenuState): readonly Item[] {
  return screen.items.filter((i) => i.showWhen === undefined || holds(i.showWhen, state));
}
