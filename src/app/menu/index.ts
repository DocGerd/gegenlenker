import { EXERCISE_IDS, type InputLog } from '../../contracts/exercise';
import { t } from '../../i18n/i18n';
import { isAction } from '../../input/keymap';
import { exerciseDone } from '../../scoring/best';
import { ignoreMultiClicks } from '../click-guard';
import type { RunConfig } from '../drive';
import { ignoreHeldBrakeKeys } from '../held-keys';
import { currentSettings } from '../settings';
import { bestResults } from '../storage';
import { runConfigOf, type EntryKind, type EntryRef } from './catalogue';
import { CONTENT } from './content';
import { continueEntry, lastEntryOf } from './continue';
import { screenOf, type ActionId, type Item, type MenuState } from './graph';
import { arrowFocus } from './keys';
import './menu.css';
import {
  holdsEntry,
  navigate,
  TITLE,
  topOf,
  type Level,
  type NavEvent,
  type NavState,
} from './nav';
import { entriesScreen } from './screens/entries';
import { screenFrame } from './screens/frame';
import { optionsScreen } from './screens/options';
import { setupScreen } from './screens/setup';
import { titleScreen } from './screens/title';

export type MenuDeps = {
  /** `entry` is what the run was started from, stored as the last entry. */
  readonly start: (run: RunConfig, entry: EntryRef) => void;
  readonly replay: { readonly log: InputLog; readonly start: () => void } | null;
  /** Re-read whenever the title renders. */
  readonly hasNews: () => Promise<boolean>;
  /** Holds the app's history entry; `onBack` runs when it is popped. */
  readonly hold: (onBack: () => void) => void;
  readonly release: () => void;
  /** A content screen failed to load; `retry` reopens the menu where it was. */
  readonly failed: (error: unknown, retry: NavState) => void;
};

export type MenuHandle = { readonly close: () => void };

type ScreenView = {
  readonly root: HTMLElement;
  readonly focus: (remembered: string | null) => void;
  readonly close?: () => void;
};

const ITEMS = '.menu-item';

function headingOf(level: Level): string {
  const { title } = screenOf(level.screen);
  return title === null ? '' : t(title);
}

/** Closing leaves the history entry alone: whatever replaces the menu takes it over. */
export function showMenu(root: HTMLElement, deps: MenuDeps, initial: NavState = TITLE): MenuHandle {
  let nav = initial;
  let teardown: (() => void)[] = [];
  let closed = false;
  // Set by Start and Continue until the drive replaces the menu (or a failure notice does): nothing navigates meanwhile.
  let busy = false;
  // Where focus goes on the next `show` instead of the level's remembered one.
  let refocus: string | null = null;

  const state = (): MenuState => {
    const best = bestResults();
    return {
      done: EXERCISE_IDS.filter((id) => exerciseDone(best, id)),
      replayable: deps.replay !== null,
      hasNews: false,
      lastEntry: lastEntryOf(currentSettings().lastEntry, deps.replay?.log ?? null),
    };
  };

  const go = (event: NavEvent): boolean => {
    if (busy) return false;
    const next = navigate(nav, event);
    if (next === nav) return false;
    nav = next;
    show();
    return true;
  };
  const back = (): void => {
    go({ type: 'back' });
  };
  // The popped entry is gone, so the new level holds a fresh one unless it is the title.
  const onPop = (): void => {
    if (busy) {
      deps.hold(onPop);
      return;
    }
    nav = navigate(nav, { type: 'back' });
    show();
  };

  const startRun = (button: HTMLButtonElement, run: RunConfig, entry: EntryRef): void => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    // The drive reads the stored settings when it mounts, so the screen's options freeze with Start.
    const screen = button.closest('[data-screen]');
    for (const row of screen?.querySelectorAll('fieldset') ?? []) row.disabled = true;
    // Nothing else on the screen may start or open anything meanwhile.
    for (const item of screen?.querySelectorAll<HTMLButtonElement>('.menu-item') ?? [])
      item.disabled = true;
    deps.start(run, entry);
  };

  const actions: Readonly<Record<ActionId, (button?: HTMLButtonElement) => void>> = {
    replayLast: () => deps.replay?.start(),
    continue: (button) => {
      if (button === undefined) throw new Error('Continue needs the control that was activated');
      const { done, lastEntry } = state();
      const entry = continueEntry(lastEntry, done);
      if (entry !== null) startRun(button, runConfigOf(entry, currentSettings()), entry);
    },
  };
  const activate = (item: Item, button?: HTMLButtonElement): void => {
    if (busy) return;
    if ('screen' in item.target) {
      go({ type: 'open', item: item.id });
      return;
    }
    actions[item.target.action](button);
  };

  /** The row a list opens on: the exercise Continue would start, or the last driven yard. */
  const listFocus = (kind: EntryKind | undefined): EntryRef | null => {
    const { done, lastEntry } = state();
    const entry = kind === 'exercise' ? continueEntry(lastEntry, done) : lastEntry;
    return entry?.kind === kind ? entry : null;
  };

  const contentScreen = (level: Level): ScreenView => {
    const frame = screenFrame(level.screen, headingOf(level), back);
    const load = CONTENT[level.screen];
    if (load === undefined) throw new Error(`Content screen ${level.screen} has no loader`);
    let open = true;
    // Only the chunk load reaches `failed`; a fault in `render` is the app's own error.
    void load().then(
      (m) => {
        if (open) m.render(frame.body);
      },
      (error: unknown) => {
        if (open) deps.failed(error, nav);
      },
    );
    return {
      root: frame.root,
      focus: () => {
        frame.heading.focus();
      },
      close: () => {
        open = false;
      },
    };
  };

  const render = (level: Level): ScreenView => {
    const screen = screenOf(level.screen);
    switch (screen.kind) {
      case 'menu':
        return titleScreen({
          state: state(),
          replay: deps.replay?.log ?? null,
          hasNews: deps.hasNews,
          activate,
        });
      case 'entries':
        return entriesScreen({
          screen,
          heading: headingOf(level),
          done: state().done,
          focus: listFocus(screen.list?.kind),
          back,
          pick: (entry) => go({ type: 'pick', entry }),
        });
      case 'setup': {
        const { entry } = level;
        if (entry === undefined) throw new Error('Setup opened without an entry');
        return setupScreen({
          entry,
          step: level.step ?? 0,
          back,
          next: () => {
            go({ type: 'next' });
          },
          start: (button, run) => {
            startRun(button, run, entry);
          },
        });
      }
      case 'options':
        return optionsScreen({
          screen,
          heading: headingOf(level),
          back,
          activate,
          redraw: (id) => {
            refocus = id;
            show();
          },
        });
      default:
        return contentScreen(level);
    }
  };

  const unmount = (): void => {
    for (const release of teardown.splice(0).reverse()) release();
  };

  const show = (): void => {
    unmount();
    const level = topOf(nav);
    const remembered = refocus ?? level.focus;
    refocus = null;
    const view = render(level);
    root.append(view.root);
    teardown = [
      () => view.root.remove(),
      ...(view.close === undefined ? [] : [view.close]),
      ignoreHeldBrakeKeys(view.root),
      ignoreMultiClicks(view.root),
      arrowFocus(view.root, ITEMS),
    ];
    view.focus(remembered);
    if (holdsEntry(nav)) deps.hold(onPop);
    else deps.release();
  };

  const onEscape = (e: KeyboardEvent): void => {
    if (!isAction('escape', e) || e.repeat || e.defaultPrevented) return;
    if (go({ type: 'back' })) e.preventDefault();
  };
  window.addEventListener('keydown', onEscape);
  show();

  return {
    close: () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onEscape);
      unmount();
    },
  };
}
