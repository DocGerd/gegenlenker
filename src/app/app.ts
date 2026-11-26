import { exercises } from '../content/registry';
import type { InputLog, RunResult } from '../contracts/exercise';
import { detectLanguage, setLanguage } from '../i18n/i18n';
import { requestPersistentStorage } from '../pwa/persist';
import { startUpdatePrompt } from '../pwa/update-prompt';
import './app.css';
import type { DriveOutcome, RunConfig } from './drive';
import { entryOfRun } from './menu/continue';
import { showMenu } from './menu/index';
import type { NavState } from './menu/nav';
import { showNotice } from './notice';
import { showResult, type ResultContext } from './result-view';
import { currentSettings, initSettings, loadSettings, updateSettings } from './settings';
import {
  isReplayable,
  lastRun,
  readText,
  SETTINGS_KEY,
  storeLastRun,
  storeResult,
} from './storage';
import { probeGraphics } from './graphics-check';
import { applyTheme, setNightDrive } from './theme';

export function startApp(root: HTMLElement): void {
  const settings = loadSettings(readText(SETTINGS_KEY), detectLanguage(navigator.languages));
  initSettings(settings);
  setLanguage(settings.language);
  applyTheme(settings.theme);

  // Screens live in their own container so re-rendering never removes the update toast in root.
  const screen = document.createElement('div');
  screen.className = 'app-screen';
  root.append(screen);

  // Drive, replay and result share one history entry, so Android back acts on that screen instead of leaving the app.
  let onBack: (() => void) | null = null;
  let held = false;
  let ownBack = false;
  window.addEventListener('popstate', () => {
    if (ownBack) {
      ownBack = false;
      return;
    }
    held = false;
    const exit = onBack;
    onBack = null;
    exit?.();
    // Forward onto a dead entry would leave the title on an app entry; undo it.
    if (exit === null && (history.state as { screen?: boolean } | null)?.screen === true) {
      ownBack = true;
      history.back();
    }
  });
  // A reload during a drive or replay lands on that screen's entry; drop it so back from the menu leaves.
  if ((history.state as { screen?: boolean } | null)?.screen === true) {
    ownBack = true;
    history.back();
  }
  // Moving between those screens reuses the entry; only going to the menu pops it.
  const enter = (exit: () => void): void => {
    // A double click on the previous screen's control can leave a selection that outlives the swap.
    window.getSelection()?.removeAllRanges();
    if (held) history.replaceState({ screen: true }, '');
    else history.pushState({ screen: true }, '');
    held = true;
    onBack = exit;
  };
  const leave = (): void => {
    setNightDrive(false);
    onBack = null;
    if (!held) return;
    held = false;
    ownBack = true;
    history.back();
  };
  let closeMenu: (() => void) | null = null;
  const loadFailed = (error: unknown, retry: () => void): void => {
    closeMenu?.();
    console.error(error);
    leave();
    const dismiss = (next: () => void) => () => {
      notice.remove();
      next();
    };
    const notice = showNotice(
      screen,
      'loadFailed',
      { label: 'retry', run: dismiss(retry) },
      { label: 'back', run: dismiss(() => menu()) },
    );
  };

  const noWebgl = (): void => {
    closeMenu?.();
    leave();
    const notice = showNotice(screen, 'noWebgl', {
      label: 'back',
      run: () => {
        notice.remove();
        menu();
      },
    });
  };

  // Loaded on demand so the menu paints without parsing three.js.
  // `mounted` runs once the drive has taken over the screen and its history entry.
  const drive = (run: RunConfig, mounted?: () => void): void => {
    probeGraphics()
      .then((backend) => {
        if (backend === null) noWebgl();
        else loadDrive(run, mounted);
      })
      .catch((error: unknown) => loadFailed(error, () => drive(run, mounted)));
  };
  const loadDrive = (run: RunConfig, mounted?: () => void): void => {
    import('./drive')
      .then((m) => {
        let back: (() => void) | null = null;
        // The sheet outlives the popped entry, so the next back needs a fresh one.
        const onPop = (): void => {
          enter(onPop);
          back?.();
        };
        enter(onPop);
        back = m.startDrive(screen, run, currentSettings(), {
          onExit: (outcome) => finished(run, outcome),
          onRestart: () => drive(run),
          onLeave: () => {
            leave();
            menu();
          },
        });
        // The one write for every start: Start, Continue, Next exercise, Retry and Restart all come through here.
        updateSettings({ lastEntry: entryOfRun(run) });
        mounted?.();
      })
      .catch((error: unknown) => loadFailed(error, () => drive(run, mounted)));
  };
  const replay = (log: InputLog, onExit: () => void): void => {
    probeGraphics()
      .then((backend) => {
        if (backend === null) noWebgl();
        else loadReplay(log, onExit);
      })
      .catch((error: unknown) => loadFailed(error, () => replay(log, onExit)));
  };
  const loadReplay = (log: InputLog, onExit: () => void): void => {
    import('./replay-view')
      .then((m) => {
        let exit: (() => void) | null = null;
        enter(() => exit?.());
        exit = m.startReplay(screen, log, onExit);
      })
      .catch((error: unknown) => loadFailed(error, () => replay(log, onExit)));
  };
  const finished = (run: RunConfig, outcome: DriveOutcome): void => {
    const stored = outcome.result === null ? null : storeResult(outcome.result);
    storeLastRun(outcome.log);
    if (outcome.result === null || stored === null) {
      leave();
      menu();
    } else result(run, outcome.result, stored, outcome.log);
  };
  const result = (run: RunConfig, r: RunResult, context: ResultContext, log: InputLog): void => {
    const following =
      r.reached && run.exercise !== null
        ? exercises[exercises.indexOf(run.exercise) + 1]
        : undefined;
    const close = showResult(screen, r, context, {
      next:
        following === undefined
          ? null
          : () => {
              close();
              drive({ ...run, layoutId: following.layout, exercise: following });
            },
      retry: () => {
        close();
        drive(run);
      },
      replay: isReplayable(log)
        ? () => {
            close();
            replay(log, () => result(run, r, context, log));
          }
        : null,
      menu: () => {
        close();
        leave();
        menu();
      },
    });
    enter(() => {
      close();
      menu();
    });
  };
  const menu = (initial?: NavState): void => {
    closeMenu?.();
    const log = lastRun();
    const handle = showMenu(
      screen,
      {
        start: (run) => {
          drive(run, () => closeMenu?.());
        },
        replay:
          log === null
            ? null
            : {
                log,
                start: () => {
                  closeMenu?.();
                  replay(log, () => {
                    leave();
                    menu();
                  });
                },
              },
        hasNews: () => import('./whats-new-seen').then((m) => m.hasUnseen()),
        hold: enter,
        release: leave,
        failed: (error, retry) => {
          loadFailed(error, () => menu(retry));
        },
      },
      initial,
    );
    closeMenu = () => {
      closeMenu = null;
      handle.close();
    };
  };

  // Errors outside the frame loop (input, timers, promises) otherwise leave a stuck screen without a word.
  // Not over a drive or replay: the stage would run on blind under the cover, and its frame boundary has its own notice.
  let failed: HTMLElement | null = null;
  const runFailed = (): void => {
    if (failed?.isConnected === true || screen.querySelector('.drive, .replay') !== null) return;
    failed = showNotice(
      screen,
      'appFailed',
      { label: 'reload', run: () => location.reload() },
      {
        label: 'dismiss',
        run: () => {
          failed?.remove();
        },
      },
    );
  };
  // Not `preventDefault`ed: the browser still reports it, so the e2e console guard sees it. A null `error` is
  // a browser-internal report (such as the ResizeObserver loop notice), not a fault of the app.
  window.addEventListener('error', (event) => {
    if (event.error != null) runFailed();
  });
  window.addEventListener('unhandledrejection', runFailed);

  menu();
  startUpdatePrompt(root);
  void requestPersistentStorage();
}
