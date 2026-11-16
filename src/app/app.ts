import { detectLanguage, setLanguage } from '../i18n/i18n';
import { startUpdatePrompt } from '../pwa/update-prompt';
import { parseBestResults, recordBest, serializeBestResults } from '../scoring/best';
import './app.css';
import { startDrive, type DriveOutcome, type RunConfig } from './drive';
import { showMenu } from './menu';
import { currentSettings, initSettings, loadSettings } from './settings';
import { BEST_KEY, readText, SETTINGS_KEY, writeText } from './storage';
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
    if (outcome.result !== null) {
      const { best } = recordBest(parseBestResults(readText(BEST_KEY)), outcome.result);
      writeText(BEST_KEY, serializeBestResults(best));
    }
    menu();
  };
  const drive = (run: RunConfig): void => {
    startDrive(screen, run, currentSettings(), finished);
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
