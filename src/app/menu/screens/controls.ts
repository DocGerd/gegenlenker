import type { MessageKey } from '../../../i18n/en';
import { applyMessages, t } from '../../../i18n/i18n';
import { driveLegendRows, legendRowMarkup } from '../../../input/legend';
import { chaseViewAvailable, lookAroundAvailable } from '../../../render/quality';
import { currentSettings } from '../../settings';
import { element } from './frame';
import './controls.css';

const TOUCH_ROWS: readonly (readonly [term: MessageKey, use: MessageKey])[] = [
  ['touchWheel', 'touchWheelUse'],
  ['touchLever', 'touchLeverUse'],
  ['stop', 'touchStopUse'],
  ['touchButtons', 'touchButtonsUse'],
];

const group = (heading: MessageKey, id: string, ...content: HTMLElement[]): HTMLElement => {
  const section = element('section', 'menu-controls-group');
  const title = element('h2', 'menu-controls-heading', t(heading));
  title.id = id;
  section.setAttribute('aria-labelledby', id);
  section.append(title, ...content);
  return section;
};

/** The keys of the drive for the saved graphics and driving view, then the pointer controls. */
export function render(body: HTMLElement): void {
  const { graphics, mirrorsOnly } = currentSettings();
  const keys = element('dl', 'menu-controls-list');
  keys.innerHTML = driveLegendRows({
    chase: chaseViewAvailable(graphics),
    look: lookAroundAvailable(graphics),
    mirrorsOnly,
  })
    .map(legendRowMarkup)
    .join('');
  applyMessages(keys);

  const touch = element('dl', 'menu-controls-list');
  for (const [term, use] of TOUCH_ROWS)
    touch.append(element('dt', '', t(term)), element('dd', '', t(use)));

  const layout = element('div', 'menu-controls');
  layout.append(
    group('controlsKeyboard', 'controls-keyboard', keys),
    group('controlsTouch', 'controls-touch', touch, element('p', 'menu-note', t('touchTwoThumbs'))),
  );
  body.append(layout);
}
