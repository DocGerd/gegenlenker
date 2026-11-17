import { exercises } from '../content/registry';
import { LAYOUT_IDS, type LayoutId } from '../contracts/layout';
import type { ExerciseDefinition, InputLog, RunResult } from '../contracts/exercise';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import { applyMessages, formatNumber, setLanguage, t, type Lang } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { bestKey, exerciseDone } from '../scoring/best';
import { trailers, trucks } from '../vehicles/registry';
import type { RunConfig } from './drive';
import { EXERCISE_BRIEF, EXERCISE_TITLE } from './exercise-text';
import { currentSettings, updateSettings, type Settings } from './settings';
import { bestResults } from './storage';
import { applyTheme } from './theme';

const LAYOUT_NAME: Readonly<Record<LayoutId, MessageKey>> = {
  depot: 'layoutDepot',
  logistics: 'layoutLogistics',
};
const LANG_NAME: Readonly<Record<Lang, MessageKey>> = { de: 'langDe', en: 'langEn' };
const THEME_NAME: Readonly<Record<Settings['theme'], MessageKey>> = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
};

const MARKUP = `
<main class="menu">
  <header class="menu-header">
    <h1 class="menu-title" data-i18n="appName"></h1>
    <p class="menu-tagline" data-i18n="tagline"></p>
  </header>
  <section class="menu-card">
    <div class="menu-fields">
      <label class="menu-field"><span class="menu-label" data-i18n="truck"></span><select class="menu-select" data-menu="truck"></select></label>
      <label class="menu-field"><span class="menu-label" data-i18n="trailer"></span><select class="menu-select" data-menu="trailer"></select></label>
    </div>
    <p class="menu-note" data-i18n="estimateNote"></p>
  </section>
  <section class="menu-section">
    <h2 class="menu-heading" data-i18n="freeYard"></h2>
    <div class="menu-grid" data-menu="yards"></div>
  </section>
  <section class="menu-section">
    <h2 class="menu-heading" data-i18n="exercises"></h2>
    <div class="menu-grid" data-menu="exercises"></div>
  </section>
  <section class="menu-section" data-menu="replaySection">
    <button type="button" class="menu-start" data-menu="replay"><span class="menu-start-title" data-i18n="replayLastRun"></span></button>
  </section>
  <section class="menu-card">
    <h2 class="menu-heading" data-i18n="settings"></h2>
    <div class="menu-fields">
      <label class="menu-field"><span class="menu-label" data-i18n="language"></span><select class="menu-select" data-menu="language"></select></label>
      <label class="menu-field"><span class="menu-label" data-i18n="theme"></span><select class="menu-select" data-menu="theme"></select></label>
    </div>
  </section>
  <footer class="menu-footer">© 2026 Patrick Kuhn</footer>
</main>`;

const query = <T extends Element>(
  root: ParentNode,
  name: string,
  type: abstract new () => T,
): T => {
  const el = root.querySelector(`[data-menu="${name}"]`);
  if (!(el instanceof type)) throw new Error(`menu markup lacks ${name}`);
  return el;
};

function fillSelect(
  select: HTMLSelectElement,
  options: readonly [string, string][],
  value: string,
) {
  select.replaceChildren(...options.map(([v, label]) => new Option(label, v, false, v === value)));
}

function span(className: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function stat(label: MessageKey, value: string): HTMLSpanElement {
  const el = span('menu-stat', `${t(label)} `);
  el.append(span('mono', value));
  return el;
}

function bestLine(result: RunResult): HTMLElement {
  const line = span('menu-best', '');
  line.append(
    span(
      'menu-stat',
      `${t('best')} · ${t(result.assisted ? 'withAids' : 'noAids')}: ${t(result.reached ? 'targetReached' : 'targetMissed')}`,
    ),
    stat('time', `${formatNumber(result.time, 1)} s`),
    stat('contacts', formatNumber(result.contacts, 0)),
    stat('jackknifes', formatNumber(result.jackknifes, 0)),
    stat('directionChanges', formatNumber(result.directionChanges, 0)),
  );
  return line;
}

/** What the stored run replays: the exercise, or the free yard it was driven in. */
function replayContext(log: InputLog): string {
  return log.exerciseId === null
    ? `${t('freeYard')} · ${t(LAYOUT_NAME[log.layoutId])}`
    : t(EXERCISE_TITLE[log.exerciseId]);
}

function startButton(title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-start';
  button.append(span('menu-start-title', title));
  button.addEventListener('click', onClick);
  return button;
}

function toleranceLine({ tolerances }: ExerciseDefinition): HTMLElement {
  const line = span('menu-meta', '');
  const { position, angle } = tolerances;
  line.append(stat('tolerance', `± ${formatNumber(position, 1)} m · ± ${formatNumber(angle, 0)}°`));
  return line;
}

export function showMenu(
  root: HTMLElement,
  onStart: (run: RunConfig) => void,
  /** Null when there is no run to replay. */
  replay: { readonly log: InputLog; readonly start: () => void } | null,
): () => void {
  const container = document.createElement('div');
  container.className = 'menu-scroll';
  root.append(container);

  const render = (focus: string | null): void => {
    const settings = currentSettings();
    container.innerHTML = MARKUP;
    applyMessages(container);

    const truck = query(container, 'truck', HTMLSelectElement);
    const trailer = query(container, 'trailer', HTMLSelectElement);
    const language = query(container, 'language', HTMLSelectElement);
    const theme = query(container, 'theme', HTMLSelectElement);
    fillSelect(
      truck,
      trucks.map((s) => [s.id, s.name]),
      settings.truckId,
    );
    fillSelect(
      trailer,
      trailers.map((s) => [s.id, s.name]),
      settings.trailerId,
    );
    fillSelect(
      language,
      (Object.keys(LANG_NAME) as Lang[]).map((l) => [l, t(LANG_NAME[l])]),
      settings.language,
    );
    fillSelect(
      theme,
      (Object.keys(THEME_NAME) as Settings['theme'][]).map((v) => [v, t(THEME_NAME[v])]),
      settings.theme,
    );

    const pair = (): Pick<RunConfig, 'truckId' | 'trailerId'> => {
      const s = currentSettings();
      return { truckId: s.truckId, trailerId: s.trailerId };
    };

    query(container, 'yards', HTMLElement).append(
      ...LAYOUT_IDS.map((layoutId) =>
        startButton(t(LAYOUT_NAME[layoutId]), () =>
          onStart({ layoutId, exercise: null, ...pair() }),
        ),
      ),
    );

    const replaySection = query(container, 'replaySection', HTMLElement);
    if (replay === null) replaySection.remove();
    else {
      const button = query(container, 'replay', HTMLElement);
      button.append(span('menu-best', replayContext(replay.log)));
      button.addEventListener('click', replay.start);
    }

    const exerciseButtons = exercises.map((exercise) => {
      const button = startButton(t(EXERCISE_TITLE[exercise.id]), () =>
        onStart({ layoutId: exercise.layout, exercise, ...pair() }),
      );
      if (exerciseDone(bestResults(), exercise.id)) {
        button
          .querySelector('.menu-start-title')
          ?.append(span('menu-done', `✓ ${t('exerciseDone')}`));
      }
      button.append(span('menu-brief', t(EXERCISE_BRIEF[exercise.id])), toleranceLine(exercise));
      return { button, exercise };
    });
    query(container, 'exercises', HTMLElement).append(...exerciseButtons.map((e) => e.button));
    const refreshBest = (): void => {
      const best = bestResults();
      const { truckId, trailerId } = pair();
      for (const { button, exercise } of exerciseButtons) {
        button.querySelectorAll('.menu-best').forEach((line) => line.remove());
        const lines = [false, true]
          .map((assisted) => best[bestKey(exercise.id, truckId, trailerId, assisted)])
          .filter((r) => r !== undefined)
          .map(bestLine);
        button.append(...(lines.length > 0 ? lines : [span('menu-best', t('noResult'))]));
      }
    };
    refreshBest();

    truck.addEventListener('change', () => {
      updateSettings({ truckId: TRUCK_IDS.find((id) => id === truck.value) ?? settings.truckId });
      refreshBest();
    });
    trailer.addEventListener('change', () => {
      updateSettings({
        trailerId: TRAILER_IDS.find((id) => id === trailer.value) ?? settings.trailerId,
      });
      refreshBest();
    });
    language.addEventListener('change', () => {
      const lang: Lang = language.value === 'en' ? 'en' : 'de';
      setLanguage(lang);
      updateSettings({ language: lang });
      render('language');
    });
    theme.addEventListener('change', () => {
      const pref = (Object.keys(THEME_NAME) as Settings['theme'][]).find((v) => v === theme.value);
      if (pref === undefined) return;
      applyTheme(pref);
      updateSettings({ theme: pref });
    });

    if (focus !== null) query(container, focus, HTMLElement).focus();
  };

  render(null);
  return () => container.remove();
}
