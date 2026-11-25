import { exercises } from '../content/registry';
import { LAYOUT_IDS } from '../contracts/layout';
import {
  GRAPHICS_PRESETS,
  LIGHTING_MODES,
  type GraphicsPreset,
  type LightingMode,
} from '../contracts/render';
import type { ExerciseDefinition, InputLog, RunResult } from '../contracts/exercise';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import {
  applyMessages,
  formatNumber,
  formatSeconds,
  setLanguage,
  t,
  type Lang,
} from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { bestKey, exerciseDone } from '../scoring/best';
import { offlineStatus, onOfflineStatus } from '../pwa/offline-status';
import { trailers, trucks } from '../vehicles/registry';
import type { RunConfig } from './drive';
import { LAYOUT_BRIEF } from './entry-keys';
import { EXERCISE_BRIEF, EXERCISE_TITLE, LAYOUT_NAME, replayContext } from './exercise-text';
import { currentSettings, updateSettings, type Settings } from './settings';
import { bestResults } from './storage';
import { buildLabel } from './build-info';
import { CHANNEL } from './channel';
import { applyTheme } from './theme';

const LANG_NAME: Readonly<Record<Lang, MessageKey>> = { de: 'langDe', en: 'langEn' };
const THEME_NAME: Readonly<Record<Settings['theme'], MessageKey>> = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
};

const GRAPHICS_NAME: Readonly<Record<GraphicsPreset, MessageKey>> = {
  low: 'graphicsLow',
  balanced: 'graphicsBalanced',
  high: 'graphicsHigh',
};

const LIGHTING_NAME: Readonly<Record<LightingMode, MessageKey>> = {
  day: 'lightingDay',
  night: 'lightingNight',
};

const MARKUP = `
<main class="menu">
  <header class="menu-header">
    <h1 class="menu-title" data-i18n="appName"></h1>
    <p class="menu-tagline" data-i18n="tagline"></p>
  </header>
  <section class="menu-section">
    <h2 class="menu-heading" data-i18n="exercises"></h2>
    <ol class="menu-grid menu-list" data-menu="exercises"></ol>
  </section>
  <section class="menu-section">
    <h2 class="menu-heading" data-i18n="freeYard"></h2>
    <div class="menu-grid" data-menu="yards"></div>
  </section>
  <section class="menu-section" data-menu="replaySection">
    <button type="button" class="menu-start" data-menu="replay"><span class="menu-start-title" data-i18n="replayLastRun"></span></button>
  </section>
  <section class="menu-card">
    <h2 class="menu-heading" data-i18n="vehicleSetup"></h2>
    <div class="menu-fields">
      <label class="menu-field"><span class="menu-label" data-i18n="truck"></span><select class="menu-select" data-menu="truck"></select></label>
      <label class="menu-field"><span class="menu-label" data-i18n="trailer"></span><select class="menu-select" data-menu="trailer"></select></label>
      <label class="menu-field"><span class="menu-label" data-i18n="lighting"></span><select class="menu-select" data-menu="lighting"></select></label>
      <label class="menu-field"><span class="menu-label" data-i18n="driveView"></span><select class="menu-select" data-menu="driveView"></select></label>
    </div>
    <p class="menu-note" data-i18n="estimateNote"></p>
  </section>
  <section class="menu-card">
    <h2 class="menu-heading" data-i18n="settings"></h2>
    <div class="menu-fields">
      <label class="menu-field"><span class="menu-label" data-i18n="language"></span><select class="menu-select" data-menu="language"></select></label>
      <label class="menu-field"><span class="menu-label" data-i18n="theme"></span><select class="menu-select" data-menu="theme"></select></label>
      <label class="menu-field"><span class="menu-label" data-i18n="graphics"></span><select class="menu-select" data-menu="graphics"></select></label>
      <label class="menu-field"><span class="menu-label" data-i18n="wideMirrors"></span><select class="menu-select" data-menu="wideMirrors"></select></label>
    </div>
  </section>
  <footer class="menu-footer">
    <span>© 2026 Patrick Kuhn</span>
    <span class="mono" data-menu="build"></span>
    <span class="menu-badge" data-menu="channel" data-i18n="channelUat" hidden></span>
    <button type="button" class="menu-link" data-menu="whatsNew"><span data-i18n="whatsNew"></span><span class="menu-badge" data-menu="whatsNewBadge" data-i18n="whatsNewBadge" hidden></span></button>
    <span class="menu-offline" data-menu="offline" role="status"></span>
  </footer>
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
    stat('time', formatSeconds(result.time)),
    stat('contacts', formatNumber(result.contacts, 0)),
    stat('jackknifes', formatNumber(result.jackknifes, 0)),
    stat('directionChanges', formatNumber(result.directionChanges, 0)),
  );
  return line;
}

/** The replay button's detail line; a night run says so, as it replays at night whatever the menu shows. */
function replayLabel(log: InputLog): string {
  const notes = [
    ...(log.lighting === 'night' ? [t('lightingNight')] : []),
    ...(log.mirrorsOnly ? [t('driveViewMirrors')] : []),
  ];
  return [replayContext(log), ...notes].join(' · ');
}

function startButton(title: string, onClick: () => void, number?: number): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-start';
  const heading = span('menu-start-title', title);
  if (number !== undefined) {
    const mark = span('menu-num', `${number}`);
    mark.setAttribute('aria-hidden', 'true');
    heading.prepend(mark);
  }
  button.append(heading);
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
  onWhatsNew: () => void,
  /** Settles true when What's new has entries the trainee has not seen; a rejection shows no badge. */
  hasNews: Promise<boolean>,
  /** The `data-menu` control that takes focus on open. */
  focus: string | null = null,
): () => void {
  const container = document.createElement('div');
  container.className = 'menu-scroll';
  root.append(container);

  const paintOffline = (): void => {
    const el = container.querySelector('[data-menu="offline"]');
    if (!(el instanceof HTMLElement)) return;
    const status = offlineStatus();
    el.textContent =
      status === 'ready' ? t('offlineReady') : status === 'failed' ? t('offlineSetupFailed') : '';
  };
  const stopOffline = onOfflineStatus(paintOffline);

  let news = false;
  const paintNews = (): void => {
    const badge = container.querySelector('[data-menu="whatsNewBadge"]');
    if (badge instanceof HTMLElement) badge.hidden = !news;
  };
  hasNews
    .then((value) => {
      news = value;
      paintNews();
    })
    .catch(() => undefined);

  const render = (focus: string | null): void => {
    const settings = currentSettings();
    container.innerHTML = MARKUP;
    applyMessages(container);
    query(container, 'build', HTMLElement).textContent = buildLabel();
    const channelBadge = query(container, 'channel', HTMLElement);
    if (CHANNEL === 'uat') channelBadge.hidden = false;
    else channelBadge.remove();

    const truck = query(container, 'truck', HTMLSelectElement);
    const trailer = query(container, 'trailer', HTMLSelectElement);
    const lighting = query(container, 'lighting', HTMLSelectElement);
    const driveView = query(container, 'driveView', HTMLSelectElement);
    const language = query(container, 'language', HTMLSelectElement);
    const theme = query(container, 'theme', HTMLSelectElement);
    const graphics = query(container, 'graphics', HTMLSelectElement);
    const wideMirrors = query(container, 'wideMirrors', HTMLSelectElement);
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
      lighting,
      LIGHTING_MODES.map((v) => [v, t(LIGHTING_NAME[v])]),
      settings.lighting,
    );
    fillSelect(
      driveView,
      [
        ['standard', t('driveViewStandard')],
        ['mirrors', t('driveViewMirrors')],
      ],
      settings.mirrorsOnly ? 'mirrors' : 'standard',
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
    fillSelect(
      graphics,
      GRAPHICS_PRESETS.map((v) => [v, t(GRAPHICS_NAME[v])]),
      settings.graphics,
    );
    fillSelect(
      wideMirrors,
      [
        ['on', t('settingOn')],
        ['off', t('settingOff')],
      ],
      settings.wideMirrors ? 'on' : 'off',
    );

    const pair = (): Pick<RunConfig, 'truckId' | 'trailerId'> => {
      const s = currentSettings();
      return { truckId: s.truckId, trailerId: s.trailerId };
    };

    query(container, 'yards', HTMLElement).append(
      ...LAYOUT_IDS.map((layoutId) => {
        const button = startButton(t(LAYOUT_NAME[layoutId]), () =>
          onStart({ layoutId, exercise: null, ...pair() }),
        );
        button.append(span('menu-brief', t(LAYOUT_BRIEF[layoutId])));
        return button;
      }),
    );

    const replaySection = query(container, 'replaySection', HTMLElement);
    if (replay === null) replaySection.remove();
    else {
      const button = query(container, 'replay', HTMLElement);
      button.append(span('menu-best', replayLabel(replay.log)));
      button.addEventListener('click', replay.start);
    }

    const exerciseButtons = exercises.map((exercise, index) => {
      const button = startButton(
        t(EXERCISE_TITLE[exercise.id]),
        () => onStart({ layoutId: exercise.layout, exercise, ...pair() }),
        index + 1,
      );
      if (exerciseDone(bestResults(), exercise.id)) {
        button
          .querySelector('.menu-start-title')
          ?.append(span('menu-done', `✓ ${t('exerciseDone')}`));
      }
      button.append(span('menu-brief', t(EXERCISE_BRIEF[exercise.id])), toleranceLine(exercise));
      return { button, exercise };
    });
    query(container, 'exercises', HTMLElement).append(
      ...exerciseButtons.map((e) => {
        const item = document.createElement('li');
        item.append(e.button);
        return item;
      }),
    );
    const refreshBest = (): void => {
      const best = bestResults();
      const { truckId, trailerId } = pair();
      const { lighting, mirrorsOnly } = currentSettings();
      for (const { button, exercise } of exerciseButtons) {
        button.querySelectorAll('.menu-best').forEach((line) => line.remove());
        const lines = [false, true]
          .map(
            (assisted) =>
              best[bestKey(exercise.id, truckId, trailerId, assisted, lighting, mirrorsOnly)],
          )
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
    lighting.addEventListener('change', () => {
      const mode = LIGHTING_MODES.find((v) => v === lighting.value);
      if (mode === undefined) lighting.value = currentSettings().lighting;
      else {
        updateSettings({ lighting: mode });
        refreshBest();
      }
    });
    driveView.addEventListener('change', () => {
      updateSettings({ mirrorsOnly: driveView.value === 'mirrors' });
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

    graphics.addEventListener('change', () => {
      const preset = GRAPHICS_PRESETS.find((v) => v === graphics.value);
      if (preset === undefined) graphics.value = currentSettings().graphics;
      else updateSettings({ graphics: preset });
    });

    wideMirrors.addEventListener('change', () => {
      updateSettings({ wideMirrors: wideMirrors.value !== 'off' });
    });

    query(container, 'whatsNew', HTMLElement).addEventListener('click', onWhatsNew);

    paintOffline();
    paintNews();
    if (focus !== null) query(container, focus, HTMLElement).focus();
  };

  render(focus);
  return () => {
    stopOffline();
    container.remove();
  };
}
