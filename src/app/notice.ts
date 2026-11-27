import { t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { ignoreHeldBrakeKeys } from './held-keys';

export type NoticeAction = {
  readonly label: MessageKey;
  readonly run: () => void;
};

let noticeCount = 0;

/** The first action is the primary one; it takes focus, and the notice is announced as an alert dialog. */
export function showNotice(
  parent: HTMLElement,
  message: MessageKey,
  ...actions: readonly NoticeAction[]
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'app-notice';
  const text = document.createElement('p');
  text.id = `app-notice-${(noticeCount += 1)}`;
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-labelledby', text.id);
  text.textContent = t(message);
  const row = document.createElement('div');
  row.className = 'app-notice-actions';
  const buttons = actions.map(({ label, run }, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = index === 0 ? 'app-button app-button-primary' : 'app-button';
    button.textContent = t(label);
    button.addEventListener('click', run);
    row.append(button);
    return button;
  });
  box.append(text, row);
  parent.append(box);
  ignoreHeldBrakeKeys(box);
  // Focus leaves what the cover hides.
  buttons[0]?.focus();
  return box;
}

const TOAST_MS = 5000;

/** A short message that outlives the screen it came from; it removes itself. */
export function showToast(parent: HTMLElement, message: MessageKey): void {
  const toast = document.createElement('div');
  toast.className = 'app-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = t(message);
  parent.append(toast);
  window.setTimeout(() => {
    toast.remove();
  }, TOAST_MS);
}
