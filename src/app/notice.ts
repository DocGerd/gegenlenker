import { t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

export type NoticeAction = {
  readonly label: MessageKey;
  readonly run: () => void;
};

/** The first action is the primary one. */
export function showNotice(
  parent: HTMLElement,
  message: MessageKey,
  ...actions: readonly NoticeAction[]
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'app-notice';
  const text = document.createElement('p');
  text.textContent = t(message);
  const row = document.createElement('div');
  row.className = 'app-notice-actions';
  actions.forEach(({ label, run }, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === 0 ? 'app-button app-button-primary' : 'app-button';
    button.textContent = t(label);
    button.addEventListener('click', run);
    row.append(button);
  });
  box.append(text, row);
  parent.append(box);
  // Focus leaves what the cover hides, and Tab reaches the primary action next. Not the button itself: a key held
  // when a run halts (Space, the brake) would click it on release.
  text.tabIndex = -1;
  text.focus();
  return box;
}
