import { t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

export function showNotice(
  parent: HTMLElement,
  message: MessageKey,
  action: MessageKey,
  onClick: () => void,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'app-notice';
  const text = document.createElement('p');
  text.textContent = t(message);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'app-button app-button-primary';
  button.textContent = t(action);
  button.addEventListener('click', onClick);
  box.append(text, button);
  parent.append(box);
  return box;
}
