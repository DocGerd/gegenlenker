import type { RunResult } from '../contracts/exercise';
import { formatNumber, t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { EXERCISE_TITLE } from './menu';
import './results.css';

export type ResultActions = {
  retry: () => void;
  /** Null when the run cannot be replayed. */
  replay: (() => void) | null;
  menu: () => void;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function row(label: MessageKey, value: string): HTMLDivElement {
  const el = element('div', 'result-row');
  el.append(element('dt', 'result-label', t(label)), element('dd', 'result-value mono', value));
  return el;
}

function action(label: MessageKey, onClick: () => void, primary: boolean): HTMLButtonElement {
  const button = element(
    'button',
    primary ? 'app-button app-button-primary' : 'app-button',
    t(label),
  );
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

export function showResult(
  root: HTMLElement,
  result: RunResult,
  isNewBest: boolean,
  actions: ResultActions,
): () => void {
  const container = element('div', 'result');
  const card = element('section', 'result-card');

  const header = element('header', 'result-header');
  header.append(
    element('p', 'result-eyebrow', `${t('result')} · ${t(EXERCISE_TITLE[result.exerciseId])}`),
    element('h1', 'result-title', t(result.reached ? 'targetReached' : 'targetMissed')),
  );
  if (isNewBest && result.reached) header.append(element('p', 'result-badge', t('newBest')));

  const values = element('dl', 'result-values');
  values.append(
    row('positionError', `${formatNumber(result.positionError, 2)} m`),
    row('angleError', `${formatNumber(result.angleError, 1)} °`),
    row('contacts', formatNumber(result.contacts, 0)),
    row('jackknifes', formatNumber(result.jackknifes, 0)),
    row('directionChanges', formatNumber(result.directionChanges, 0)),
    row('time', `${formatNumber(result.time, 1)} s`),
  );

  const buttons = element('div', 'result-actions');
  buttons.append(action('retry', actions.retry, true));
  if (actions.replay !== null) buttons.append(action('replay', actions.replay, false));
  buttons.append(action('menu', actions.menu, false));

  card.append(header, values, buttons);
  container.append(card);
  root.append(container);
  return () => container.remove();
}
