import { exercises } from '../content/registry';
import type { InputLog, RunResult } from '../contracts/exercise';
import { detectLanguage, setLanguage } from '../i18n/i18n';
import { requestPersistentStorage } from '../pwa/persist';
import { startUpdatePrompt } from '../pwa/update-prompt';
import './app.css';
import type { DriveOutcome, RunConfig } from './drive';
import { showMenu } from './menu';
import { showNotice } from './notice';
import { showResult, type ResultContext } from './result-view';
import { currentSettings, initSettings, loadSettings } from './settings';
import {
  isReplayable,
  lastRun,
  readText,
  SETTINGS_KEY,
  storeLastRun,
  storeResult,
} from './storage';
import { applyTheme } from './theme';

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
    onBack = null;
    if (!held) return;
    held = false;
    ownBack = true;
    history.back();
  };
  const loadFailed = (error: unknown, retry: () => void): void => {
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
      { label: 'back', run: dismiss(menu) },
    );
  };

  // Loaded on demand so the menu paints without parsing three.js.
  const drive = (run: RunConfig): void => {
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
      })
      .catch((error: unknown) => loadFailed(error, () => drive(run)));
  };
  const replay = (log: InputLog, onExit: () => void): void => {
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
  const menu = (): void => {
    const log = lastRun();
    const close = showMenu(
      screen,
      (run) => {
        close();
        drive(run);
      },
      log === null
        ? null
        : {
            log,
            start: () => {
              close();
              replay(log, () => {
                leave();
                menu();
              });
            },
          },
    );
  };

  menu();
  startUpdatePrompt(root);
  void requestPersistentStorage();
}
