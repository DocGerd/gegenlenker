import { t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

export type PauseActions = {
  continue: () => void;
  restart: () => void;
  finish: () => void;
};

function action(label: MessageKey, onClick: () => void, primary: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'app-button app-button-primary' : 'app-button';
  button.textContent = t(label);
  button.addEventListener('click', onClick);
  return button;
}

/** Modal over the drive; `finishLabel` names what ends the run. Returns the close function. */
export function showPauseSheet(
  parent: HTMLElement,
  finishLabel: MessageKey,
  actions: PauseActions,
): () => void {
  const box = document.createElement('div');
  box.className = 'pause';
  const sheet = document.createElement('div');
  sheet.className = 'pause-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'pause-title');

  const title = document.createElement('h2');
  title.id = 'pause-title';
  title.className = 'pause-title';
  title.textContent = t('paused');
  const hint = document.createElement('p');
  hint.className = 'pause-hint';
  hint.textContent = t('restartHint');
  const resume = action('continue', actions.continue, true);
  const buttons = document.createElement('div');
  buttons.className = 'pause-actions';
  buttons.append(
    resume,
    action('restart', actions.restart, false),
    action(finishLabel, actions.finish, false),
  );

  sheet.append(title, buttons, hint);
  box.append(sheet);
  parent.append(box);
  resume.focus();
  return () => box.remove();
}
