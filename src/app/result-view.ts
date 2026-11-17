import { exerciseById } from '../content/registry';
import type { RunResult } from '../contracts/exercise';
import { formatNumber, t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { criteria, deltasToBest, endedMoving, type Deltas } from '../scoring/debrief';
import { EXERCISE_TITLE } from './menu';
import './results.css';

export type ResultActions = {
  /** Set after a reached run when a further exercise follows. */
  next: (() => void) | null;
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

type RowNote = {
  /** The tolerance the value is judged against, already formatted. */
  readonly limit?: string;
  readonly passed?: boolean | undefined;
  /** Run minus best; negative is better. */
  readonly delta?:
    { readonly value: number; readonly digits: number; readonly unit: string } | undefined;
  readonly bad?: boolean;
};

function signed(value: number, digits: number): string {
  const rounded = Math.round(value * 10 ** digits);
  if (rounded === 0) return formatNumber(0, digits);
  return `${rounded > 0 ? '+' : ''}${formatNumber(value, digits)}`;
}

function row(label: MessageKey, value: string, note: RowNote = {}): HTMLDivElement {
  const el = element('div', 'result-row');
  const name = element('dt', 'result-label', t(label));
  if (note.limit !== undefined) {
    name.append(element('span', 'result-limit', `${t('tolerance')} ≤ ${note.limit}`));
  }
  const figure = element(
    'dd',
    note.bad === true ? 'result-value mono result-bad' : 'result-value mono',
    value,
  );
  if (note.passed !== undefined) {
    figure.append(
      element(
        'span',
        note.passed ? 'result-status result-pass' : 'result-status result-fail',
        t(note.passed ? 'passed' : 'failed'),
      ),
    );
  }
  if (note.delta !== undefined) {
    const { value: d, digits, unit } = note.delta;
    const shown = Math.round(d * 10 ** digits);
    const tone = shown < 0 ? 'result-better' : shown > 0 ? 'result-worse' : '';
    figure.append(
      element('span', `result-delta ${tone}`.trim(), `${t('vsBest')} ${signed(d, digits)}${unit}`),
    );
  }
  el.append(name, figure);
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

export type ResultContext = {
  readonly isNewBest: boolean;
  /** The best this run competed with, same aid class; null when it was the first. */
  readonly previous: RunResult | null;
};

export function showResult(
  root: HTMLElement,
  result: RunResult,
  { isNewBest, previous }: ResultContext,
  actions: ResultActions,
): () => void {
  const exercise = exerciseById(result.exerciseId);
  const container = element('div', 'result');
  const card = element('section', 'result-card');

  const header = element('header', 'result-header');
  header.append(
    element('p', 'result-eyebrow', `${t('result')} · ${t(EXERCISE_TITLE[result.exerciseId])}`),
    element('h1', 'result-title', t(result.reached ? 'targetReached' : 'targetMissed')),
    element('p', 'result-reason', t(result.assisted ? 'runWithAids' : 'runNoAids')),
  );
  if (result.waypointMissed) header.append(element('p', 'result-reason', t('waypointMissed')));
  else if (endedMoving(result, exercise.tolerances)) {
    header.append(element('p', 'result-reason', t('endedMoving')));
  }
  if (isNewBest && result.reached) header.append(element('p', 'result-badge', t('newBest')));

  const deltas = previous === null ? null : deltasToBest(result, previous);
  const delta = (key: keyof Deltas, digits: number, unit: string): RowNote['delta'] =>
    deltas === null ? undefined : { value: deltas[key], digits, unit };
  const [position, angle] = criteria(result, exercise.tolerances);
  const values = element('dl', 'result-values');
  values.append(
    row('positionError', `${formatNumber(result.positionError, 2)} m`, {
      limit: `${formatNumber(exercise.tolerances.position, 2)} m`,
      passed: position?.passed,
      delta: delta('positionError', 2, ' m'),
    }),
    row('angleError', `${formatNumber(result.angleError, 1)} °`, {
      limit: `${formatNumber(exercise.tolerances.angle, 1)} °`,
      passed: angle?.passed,
      delta: delta('angleError', 1, ' °'),
    }),
  );
  if (exercise.waypoint !== null) {
    values.append(
      row('waypoint', t(result.waypointMissed ? 'failed' : 'passed'), {
        passed: !result.waypointMissed,
      }),
    );
  }
  values.append(
    row('contacts', formatNumber(result.contacts, 0), {
      bad: result.contacts > 0,
      delta: delta('contacts', 0, ''),
    }),
    row('jackknifes', formatNumber(result.jackknifes, 0), {
      bad: result.jackknifes > 0,
      delta: delta('jackknifes', 0, ''),
    }),
    row('directionChanges', formatNumber(result.directionChanges, 0), {
      delta: delta('directionChanges', 0, ''),
    }),
    row('time', `${formatNumber(result.time, 1)} s`, {
      delta: delta('time', 1, ' s'),
    }),
  );

  const buttons = element('div', 'result-actions');
  if (actions.next !== null) buttons.append(action('nextExercise', actions.next, true));
  buttons.append(action('retry', actions.retry, actions.next === null));
  if (actions.replay !== null) buttons.append(action('replay', actions.replay, false));
  buttons.append(action('menu', actions.menu, false));

  card.append(header, values, buttons);
  container.append(card);
  root.append(container);
  return () => container.remove();
}
