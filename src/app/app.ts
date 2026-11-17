import type { InputLog, RunResult } from '../contracts/exercise';
import { detectLanguage, setLanguage } from '../i18n/i18n';
import { startUpdatePrompt } from '../pwa/update-prompt';
import './app.css';
import type { DriveOutcome, RunConfig } from './drive';
import { showMenu } from './menu';
import { showNotice } from './notice';
import { showResult } from './result-view';
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

  // Drive and replay each own a history entry, so Android back ends that screen instead of leaving the app.
  let onBack: (() => void) | null = null;
  let ownBack = false;
  window.addEventListener('popstate', () => {
    if (ownBack) {
      ownBack = false;
      return;
    }
    const exit = onBack;
    onBack = null;
    exit?.();
  });
  // A reload during a drive or replay lands on that screen's entry; drop it so back from the menu leaves.
  if ((history.state as { screen?: boolean } | null)?.screen === true) {
    ownBack = true;
    history.back();
  }
  const enter = (exit: () => void): void => {
    history.pushState({ screen: true }, '');
    onBack = exit;
  };
  const leave = (): void => {
    if (onBack === null) return;
    onBack = null;
    ownBack = true;
    history.back();
  };
  const loadFailed = (error: unknown, back: () => void): void => {
    console.error(error);
    leave();
    const notice = showNotice(screen, 'loadFailed', 'back', () => {
      notice.remove();
      back();
    });
  };

  // Loaded on demand so the menu paints without parsing three.js.
  const drive = (run: RunConfig): void => {
    import('./drive')
      .then((m) => {
        let finish: (() => void) | null = null;
        enter(() => finish?.());
        finish = m.startDrive(screen, run, currentSettings(), (outcome) => {
          leave();
          finished(run, outcome);
        });
      })
      .catch((error: unknown) => loadFailed(error, menu));
  };
  const replay = (log: InputLog, onExit: () => void): void => {
    import('./replay-view')
      .then((m) => {
        let exit: (() => void) | null = null;
        enter(() => exit?.());
        exit = m.startReplay(screen, log, () => {
          leave();
          onExit();
        });
      })
      .catch((error: unknown) => loadFailed(error, onExit));
  };
  const finished = (run: RunConfig, outcome: DriveOutcome): void => {
    const isNewBest = outcome.result !== null && storeResult(outcome.result);
    storeLastRun(outcome.log);
    if (outcome.result === null) menu();
    else result(run, outcome.result, isNewBest, outcome.log);
  };
  const result = (run: RunConfig, r: RunResult, isNewBest: boolean, log: InputLog): void => {
    const close = showResult(screen, r, isNewBest, {
      retry: () => {
        close();
        drive(run);
      },
      replay: isReplayable(log)
        ? () => {
            close();
            replay(log, () => result(run, r, isNewBest, log));
          }
        : null,
      menu: () => {
        close();
        menu();
      },
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
        : () => {
            close();
            replay(log, menu);
          },
    );
  };

  menu();
  startUpdatePrompt(root);
}
