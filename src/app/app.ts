import { detectLanguage, setLanguage } from '../i18n/i18n';
import { startUpdatePrompt } from '../pwa/update-prompt';
import './app.css';
import type { DriveOutcome, RunConfig } from './drive';
import { showMenu } from './menu';
import { currentSettings, initSettings, loadSettings } from './settings';
import { LAST_RUN_KEY, readText, SETTINGS_KEY, storeResult, writeText } from './storage';
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

  const finished = (outcome: DriveOutcome): void => {
    if (outcome.result !== null) storeResult(outcome.result);
    if (outcome.log.steps > 0) writeText(LAST_RUN_KEY, JSON.stringify(outcome.log));
    menu();
  };
  // Loaded on demand so the menu paints without parsing three.js.
  const drive = (run: RunConfig): void => {
    import('./drive')
      .then((m) => m.startDrive(screen, run, currentSettings(), finished))
      .catch((error: unknown) => {
        console.error(error);
        menu();
      });
  };
  const menu = (): void => {
    const close = showMenu(screen, (run) => {
      close();
      drive(run);
    });
  };

  menu();
  startUpdatePrompt(root);
}
