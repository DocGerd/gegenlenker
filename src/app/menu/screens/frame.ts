import { t } from '../../../i18n/i18n';
import type { ScreenId } from '../graph';

export const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

/** Back and the heading stay in view; `body` is the screen's one scroll container. */
export function screenFrame(
  id: ScreenId,
  heading: string,
  back: (() => void) | null,
): {
  readonly root: HTMLElement;
  readonly heading: HTMLHeadingElement;
  readonly body: HTMLElement;
} {
  const root = element('main', 'menu-screen menu-frame');
  root.dataset['screen'] = id;

  const head = element('div', 'menu-frame-head');
  if (back !== null) {
    const button = element('button', 'menu-back');
    button.type = 'button';
    button.dataset['menu'] = 'back';
    const mark = element('span', '', '‹');
    mark.setAttribute('aria-hidden', 'true');
    button.append(mark, t('back'));
    button.addEventListener('click', back);
    head.append(button);
  }
  const title = element('h1', 'menu-frame-title', heading);
  title.tabIndex = -1;
  head.append(title);

  const body = element('div', 'menu-screen-scroll');
  root.append(head, body);
  return { root, heading: title, body };
}
