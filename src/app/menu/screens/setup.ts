import { exerciseById } from '../../../content/registry';
import {
  ROLES,
  type ExerciseDefinition,
  type Role,
  type RunResult,
} from '../../../contracts/exercise';
import type { MessageKey } from '../../../i18n/en';
import { formatNumber, formatSeconds, t } from '../../../i18n/i18n';
import { bestKey } from '../../../scoring/best';
import type { RunConfig } from '../../drive';
import { currentSettings } from '../../settings';
import { bestResults } from '../../storage';
import {
  entryHeading,
  entryKey,
  entryOf,
  runConfigOf,
  SETUP_STEPS,
  type EntryRef,
} from '../catalogue';
import { choiceRow } from '../choice-row';
import { applyOption, OPTION_FIELDS, optionValue, type ChoiceField } from '../options';
import { element, screenFrame } from './frame';

export type SetupContext = {
  readonly entry: EntryRef;
  readonly step: number;
  readonly back: () => void;
  readonly next: () => void;
  /** Starts the run once; the button shows the busy state until the drive takes over. */
  readonly start: (button: HTMLButtonElement, run: RunConfig, entry: EntryRef) => void;
};

const ROLE_NAME: Readonly<Record<Role, MessageKey>> = {
  driver: 'roleDriver',
  einweiser: 'roleEinweiser',
};
/** Kept to the setup, not stored: the role belongs to the entry that starts. */
const ROLE_ROW: ChoiceField = {
  id: 'role',
  label: 'role',
  choices: ROLES.map((value) => ({ value, label: ROLE_NAME[value] })),
};

function stat(label: MessageKey, value: string): HTMLSpanElement {
  const el = element('span', 'menu-stat', `${t(label)} `);
  el.append(element('span', 'mono', value));
  return el;
}

function bestLine(result: RunResult): HTMLElement {
  const line = element('p', 'menu-best');
  line.append(
    element(
      'span',
      'menu-stat',
      `${t('best')} · ${t(result.assisted ? 'withAids' : 'noAids')}: ${t(result.reached ? 'targetReached' : 'targetMissed')}`,
    ),
    stat('time', formatSeconds(result.time)),
    stat('contacts', formatNumber(result.contacts, 0)),
    stat('jackknifes', formatNumber(result.jackknifes, 0)),
    stat('directionChanges', formatNumber(result.directionChanges, 0)),
  );
  return line;
}

function toleranceLine({ tolerances }: ExerciseDefinition): HTMLElement {
  const line = element('p', 'menu-meta');
  const { position, angle } = tolerances;
  line.append(stat('tolerance', `± ${formatNumber(position, 1)} m · ± ${formatNumber(angle, 0)}°`));
  return line;
}

/** The best lines for the chosen vehicles, time of day and driving view. */
function paintBests(block: HTMLElement, exercise: ExerciseDefinition): void {
  const best = bestResults();
  const { truckId, trailerId, lighting, mirrorsOnly } = currentSettings();
  const lines = [false, true]
    .map(
      (assisted) => best[bestKey(exercise.id, truckId, trailerId, assisted, lighting, mirrorsOnly)],
    )
    .filter((r) => r !== undefined)
    .map(bestLine);
  block.replaceChildren(...(lines.length > 0 ? lines : [element('p', 'menu-best', t('noResult'))]));
}

export function setupScreen(ctx: SetupContext): {
  readonly root: HTMLElement;
  readonly focus: (remembered: string | null) => void;
} {
  const entry = entryOf(ctx.entry);
  const frame = screenFrame('setup', entryHeading(ctx.entry), ctx.back);
  const layout = element('div', 'menu-setup');

  const info = element('div', 'menu-setup-info');
  info.append(element('p', 'menu-setup-brief', t(entry.brief)));
  const exercise = ctx.entry.kind === 'exercise' ? exerciseById(ctx.entry.id) : null;
  const bests = element('div', 'menu-bests');
  bests.dataset['menu'] = 'bests';
  if (exercise !== null) {
    info.append(toleranceLine(exercise), bests);
    paintBests(bests, exercise);
  }

  const stepId = entry.steps[ctx.step];
  if (stepId === undefined) throw new Error(`${entryKey(ctx.entry)} has no setup step ${ctx.step}`);
  const settings = currentSettings();
  const options = element('div', 'menu-setup-options');
  let role = ctx.entry.role;
  if (settings.einweiserPreview) {
    options.append(
      choiceRow(ROLE_ROW, role, (value) => {
        role = ROLES.find((r) => r === value) ?? role;
      }),
    );
  }
  options.append(
    ...SETUP_STEPS[stepId].map((id) =>
      choiceRow(OPTION_FIELDS[id], optionValue(settings, id), (value) => {
        if (applyOption(id, value) && exercise !== null) paintBests(bests, exercise);
      }),
    ),
    element('p', 'menu-note', t('estimateNote')),
  );

  const last = ctx.step + 1 >= entry.steps.length;
  // Only the last step starts; a `next` label joins the catalogue with a second step.
  const start = element('button', 'menu-setup-start', t('start'));
  start.type = 'button';
  start.dataset['menu'] = 'start';
  start.addEventListener('click', () => {
    if (!last) {
      ctx.next();
      return;
    }
    const entry: EntryRef = { ...ctx.entry, role };
    ctx.start(start, runConfigOf(entry, currentSettings()), entry);
  });
  options.append(start);

  layout.append(info, options);
  frame.body.append(layout);
  return {
    root: frame.root,
    focus: () => {
      start.focus();
    },
  };
}
