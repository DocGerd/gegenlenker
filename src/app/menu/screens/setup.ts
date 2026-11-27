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
import { currentSettings, runTrailer } from '../../settings';
import { bestResults } from '../../storage';
import {
  couples,
  entryHeading,
  entryKey,
  entryOf,
  offeredRoles,
  runConfigOf,
  SETUP_STEPS,
  type EntryRef,
} from '../catalogue';
import { choiceRow } from '../choice-row';
import { applyOption, entryOption, type ChoiceField, type OptionId } from '../options';
import { element, markUnavailable, noGraphicsNote, screenFrame } from './frame';

export type SetupContext = {
  readonly entry: EntryRef;
  readonly step: number;
  readonly back: () => void;
  readonly next: () => void;
  /** No graphics backend: Start is disabled and the notice shows. */
  readonly graphicsMissing: boolean;
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
    // the truck solo has no limit stops
    ...(result.trailerId === null ? [] : [stat('jackknifes', formatNumber(result.jackknifes, 0))]),
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
  const settings = currentSettings();
  const { truckId, lighting, mirrorsOnly } = settings;
  const trailerId = couples({ kind: 'exercise', id: exercise.id })
    ? settings.trailerId
    : runTrailer(settings);
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
  const settings = currentSettings();
  const offered = offeredRoles(ctx.entry);
  // The role the last run started with, like the other rows show their stored value.
  const lastRole = settings.lastEntry?.role;
  let role: Role = lastRole !== undefined && offered.includes(lastRole) ? lastRole : ctx.entry.role;
  const entry = entryOf(ctx.entry);
  const frame = screenFrame('setup', '', ctx.back);
  const layout = element('div', 'menu-setup');

  const info = element('div', 'menu-setup-info');
  const brief = element('p', 'menu-setup-brief');
  info.append(brief);
  const exercise = ctx.entry.kind === 'exercise' ? exerciseById(ctx.entry.id) : null;
  const bests = element('div', 'menu-bests');
  bests.dataset['menu'] = 'bests';
  if (exercise !== null) info.append(toleranceLine(exercise));

  const stepId = entry.steps[ctx.step];
  if (stepId === undefined) throw new Error(`${entryKey(ctx.entry)} has no setup step ${ctx.step}`);
  const fields = SETUP_STEPS[stepId];
  const coupled = couples(ctx.entry);
  const optionRow = (id: OptionId): HTMLFieldSetElement => {
    const { field, value } = entryOption(currentSettings(), id, role, coupled);
    return choiceRow(field, value, (picked) => {
      if (applyOption(id, picked) && exercise !== null && role === 'driver')
        paintBests(bests, exercise);
    });
  };
  let rows = fields.map(optionRow);

  /** Heading, brief and bests follow the role; an Einweiser keeps no bests (owner). */
  const paint = (): void => {
    const shown: EntryRef = { ...ctx.entry, role };
    frame.heading.textContent = entryHeading(shown);
    brief.textContent = t(entryOf(shown).brief);
    if (exercise !== null && role === 'driver') {
      info.append(bests);
      paintBests(bests, exercise);
    } else bests.remove();
  };
  paint();

  const options = element('div', 'menu-setup-options');
  if (offered.length > 1) {
    options.append(
      choiceRow(ROLE_ROW, role, (value) => {
        role = offered.find((r) => r === value) ?? role;
        paint();
        // the rows name some fields the role's way
        const next = fields.map(optionRow);
        rows.forEach((row, i) => {
          const fresh = next[i];
          if (fresh !== undefined) row.replaceWith(fresh);
        });
        rows = next;
      }),
    );
  }
  options.append(...rows, element('p', 'menu-note', t('estimateNote')));

  const last = ctx.step + 1 >= entry.steps.length;
  // Only the last step starts; a `next` label joins the catalogue with a second step.
  const start = element('button', 'menu-setup-start', t('start'));
  start.type = 'button';
  start.dataset['menu'] = 'start';
  const unavailable = ctx.graphicsMissing && last;
  if (unavailable) markUnavailable(start);
  start.addEventListener('click', () => {
    if (unavailable) return;
    if (!last) {
      ctx.next();
      return;
    }
    const started: EntryRef = { ...ctx.entry, role };
    ctx.start(start, runConfigOf(started, currentSettings()), started);
  });
  options.append(start);
  if (ctx.graphicsMissing) options.append(noGraphicsNote());

  layout.append(info, options);
  frame.body.append(layout);
  return {
    root: frame.root,
    focus: () => {
      start.focus();
    },
  };
}
