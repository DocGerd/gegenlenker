import { t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { choiceRow } from './menu/choice-row';
import {
  applyOption,
  OPTION_FIELDS,
  optionValue,
  type ChoiceField,
  type OptionId,
} from './menu/options';
import { ignoreHeldBrakeKeys } from './held-keys';
import { currentSettings } from './settings';

/** A row the drive keeps to itself rather than a stored option: it reads and changes its own state. */
export type PauseRow = {
  readonly field: ChoiceField;
  readonly value: () => string;
  readonly change: (value: string) => void;
  /** Drawn under the values. */
  readonly hint?: MessageKey;
};

export type PauseActions = {
  continue: () => void;
  restart: () => void;
  finish: () => void;
  /** Drops the run without a result or replay; null where finishing already does that. */
  leave: (() => void) | null;
  /** The options the running drive can take (`pauseFields`) and its own rows, in this order. */
  fields: readonly (OptionId | PauseRow)[];
  /** Called after a Settings change was stored. */
  settingChanged: (id: OptionId) => void;
};

export type PauseSheet = {
  readonly close: () => void;
  /** True when it stepped from Settings back to the actions. */
  readonly back: () => boolean;
};

let hintCount = 0;

function hinted(button: HTMLButtonElement, hint: MessageKey): HTMLElement {
  const item = document.createElement('div');
  item.className = 'pause-item';
  const text = document.createElement('p');
  text.className = 'pause-hint';
  text.textContent = t(hint);
  text.id = `pause-hint-${String(hintCount++)}`;
  button.setAttribute('aria-describedby', text.id);
  item.append(button, text);
  return item;
}

function action(label: MessageKey, onClick: () => void, primary: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'app-button app-button-primary' : 'app-button';
  button.textContent = t(label);
  button.addEventListener('click', onClick);
  return button;
}

// One tab stop per radio group: its checked radio, which also holds the focus inside the group.
const tabStops = (level: HTMLElement): HTMLElement[] => [
  ...level.querySelectorAll<HTMLElement>('button, input[type="radio"]:checked'),
];

/** The level with Back and the options a running drive can take; a change is stored at once. */
function settingsLevel(
  back: () => void,
  fields: readonly (OptionId | PauseRow)[],
  settingChanged: (id: OptionId) => void,
): {
  readonly root: HTMLElement;
  readonly first: HTMLElement | null;
} {
  const root = document.createElement('div');
  root.className = 'pause-level pause-settings';
  const backButton = action('back', back, false);
  backButton.classList.add('pause-back');
  const mark = document.createElement('span');
  mark.setAttribute('aria-hidden', 'true');
  mark.textContent = '‹';
  backButton.prepend(mark);
  const heading = document.createElement('h2');
  heading.className = 'pause-title';
  heading.textContent = t('settings');
  root.append(backButton, heading);

  const settings = currentSettings();
  for (const entry of fields) {
    if (typeof entry === 'string') {
      const row = choiceRow(OPTION_FIELDS[entry], optionValue(settings, entry), (value) => {
        if (applyOption(entry, value)) settingChanged(entry);
      });
      root.append(row);
    } else {
      const { field, value, change, hint } = entry;
      root.append(choiceRow(field, value(), change, hint === undefined ? undefined : t(hint)));
    }
  }
  return { root, first: root.querySelector<HTMLElement>('input:checked') };
}

/** Modal over the drive; `finishLabel` names what ends the run. */
export function showPauseSheet(
  parent: HTMLElement,
  finishLabel: MessageKey,
  actions: PauseActions,
): PauseSheet {
  const box = document.createElement('div');
  box.className = 'pause';
  const sheet = document.createElement('div');
  sheet.className = 'pause-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  // Not labelled by a heading: the Settings level swaps it out.
  sheet.setAttribute('aria-label', t('paused'));

  const main = document.createElement('div');
  main.className = 'pause-level';
  const title = document.createElement('h2');
  title.className = 'pause-title';
  title.textContent = t('paused');
  const resume = action('continue', actions.continue, true);
  const buttons = document.createElement('div');
  buttons.className = 'pause-actions';
  const restart = action('restart', actions.restart, false);
  const finish = action(finishLabel, actions.finish, false);
  // Nothing is scored in the free yard, so there is nothing to warn about.
  if (actions.leave === null) {
    buttons.append(resume, restart, finish);
  } else {
    buttons.append(
      resume,
      hinted(restart, 'restartHint'),
      hinted(finish, 'finishHint'),
      hinted(action('leaveUnscored', actions.leave, false), 'leaveHint'),
    );
  }
  const openSettings = action(
    'settings',
    () => {
      const next = settingsLevel(back, actions.fields, actions.settingChanged);
      swap(next.root, next.first);
    },
    false,
  );
  buttons.append(openSettings);

  main.append(title, buttons);

  let level: HTMLElement = main;
  // Focus moves into the new level before the old one leaves, so the focusout guard never sees it drop.
  // A brake key held through a swap must not click the control that took the focus.
  let releaseHeld: (() => void) | null = null;
  const swap = (next: HTMLElement, focus: HTMLElement | null): void => {
    const previous = level;
    level = next;
    releaseHeld?.();
    releaseHeld = ignoreHeldBrakeKeys(next);
    sheet.append(next);
    (focus ?? tabStops(next)[0])?.focus();
    previous.remove();
  };
  const back = (): boolean => {
    if (level === main) return false;
    swap(main, openSettings);
    return true;
  };

  // Focus must stay here: outside the dialog the driving keys would reach the paused run.
  const abort = new AbortController();
  box.addEventListener(
    'focusout',
    (e) => {
      if (!(e.relatedTarget instanceof Node && sheet.contains(e.relatedTarget))) {
        tabStops(level)[0]?.focus();
      }
    },
    { signal: abort.signal },
  );
  // Tab from the last control would leave the page, and the focusout guard only sees focus already gone.
  box.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Tab') return;
      const focusable = tabStops(level);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) return;
      const from = document.activeElement;
      if (from === (e.shiftKey ? first : last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!(from instanceof Node && level.contains(from))) {
        e.preventDefault();
        first.focus();
      }
    },
    { signal: abort.signal },
  );
  sheet.append(main);
  box.append(sheet);
  parent.append(box);
  resume.focus();
  // Dropped first: removing the focused button would otherwise refocus it while detached.
  return {
    close: () => {
      releaseHeld?.();
      abort.abort();
      box.remove();
    },
    back,
  };
}
