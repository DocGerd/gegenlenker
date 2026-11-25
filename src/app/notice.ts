import { t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

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
  // A run ends while a brake key (Space, Enter) may still be held; its repeats and release must not click the focused
  // button. A code is free after its next fresh press or release.
  const held = new Set(['Space', 'Enter', 'NumpadEnter']);
  const guardHeld = (e: KeyboardEvent): void => {
    if (!held.has(e.code)) return;
    if (e.type === 'keydown' && !e.repeat) {
      held.delete(e.code);
      return;
    }
    if (e.type === 'keyup') held.delete(e.code);
    e.preventDefault();
  };
  box.addEventListener('keydown', guardHeld, true);
  box.addEventListener('keyup', guardHeld, true);
  // Focus leaves what the cover hides.
  buttons[0]?.focus();
  return box;
}
