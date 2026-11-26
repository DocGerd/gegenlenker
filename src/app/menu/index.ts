import { EXERCISE_IDS, type InputLog } from '../../contracts/exercise';
import { t } from '../../i18n/i18n';
import { isAction } from '../../input/keymap';
import { exerciseDone } from '../../scoring/best';
import { ignoreMultiClicks } from '../click-guard';
import type { RunConfig } from '../drive';
import { ignoreHeldBrakeKeys } from '../held-keys';
import { bestResults } from '../storage';
import { CONTENT } from './content';
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
import { setupScreen } from './screens/setup';
import { titleScreen } from './screens/title';

export type MenuDeps = {
  readonly start: (run: RunConfig) => void;
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
  // Set by Start until the drive replaces the menu (or a failure notice does): nothing navigates meanwhile.
  let busy = false;

  const state = (): MenuState => {
    const best = bestResults();
    return {
      done: EXERCISE_IDS.filter((id) => exerciseDone(best, id)),
      replayable: deps.replay !== null,
      hasNews: false,
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

  const startRun = (button: HTMLButtonElement, run: RunConfig): void => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    deps.start(run);
  };

  const actions: Readonly<Record<ActionId, () => void>> = {
    replayLast: () => deps.replay?.start(),
  };
  const activate = (item: Item): void => {
    if ('screen' in item.target) {
      go({ type: 'open', item: item.id });
      return;
    }
    actions[item.target.action]();
  };

  const contentScreen = (level: Level): ScreenView => {
    const frame = screenFrame(level.screen, headingOf(level), back);
    const load = CONTENT[level.screen];
    let open = true;
    // Only the chunk load reaches `failed`; a fault in `render` is the app's own error.
    void load?.().then(
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
          back,
          pick: (entry) => go({ type: 'pick', entry }),
        });
      case 'setup':
        if (level.entry === undefined) throw new Error('Setup opened without an entry');
        return setupScreen({
          entry: level.entry,
          step: level.step ?? 0,
          back,
          next: () => {
            go({ type: 'next' });
          },
          start: startRun,
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
    const view = render(level);
    root.append(view.root);
    teardown = [
      () => view.root.remove(),
      ...(view.close === undefined ? [] : [view.close]),
      ignoreHeldBrakeKeys(view.root),
      ignoreMultiClicks(view.root),
      arrowFocus(view.root, ITEMS),
    ];
    view.focus(level.focus);
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
