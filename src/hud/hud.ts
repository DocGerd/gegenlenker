import type { AidFlags, CollapsedPanels, Rect, TopDownMode, ViewRects } from '../contracts/render';
import type { BlockReason, Gear, SimSnapshot } from '../contracts/sim';
import type { GoalState } from '../scoring/score';
import { applyMessages, formatNumber, t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { createGauge, type Gauge } from './gauges';
import './hud.css';

export type HudAction =
  | { type: 'topDown'; mode: TopDownMode }
  | { type: 'resetView' }
  | { type: 'aid'; aid: keyof AidFlags; on: boolean }
  | { type: 'collapse'; panel: keyof CollapsedPanels; collapsed: boolean }
  | { type: 'finish' }
  | { type: 'menu' };

export type Hud = {
  update(s: SimSnapshot): void;
  layout(views: ViewRects): void;
  /** The reset-view button is enabled while the top-down view differs from its default framing. */
  setViewChanged(changed: boolean): void;
  /** Points the arrow at a target beyond the top-down view; null hides it. Positions are stage CSS px. */
  setTargetArrow(arrow: { x: number; y: number; angle: number } | null): void;
  /** The live tolerance cue; a no-op in the free yard. */
  setGoal(goal: GoalState): void;
  onAction(cb: (a: HudAction) => void): void;
  dispose(): void;
};

export type HudOptions = {
  couplingLimit: number;
  turntableLimit: number;
  mode: 'exercise' | 'yard';
  /** Title and brief shown for an exercise run. */
  exercise: { title: string; brief: string } | null;
  aids: AidFlags;
  topDown: TopDownMode;
  collapsed: CollapsedPanels;
};

const BLOCKED_KEY: Record<BlockReason, MessageKey> = {
  contact: 'blockedContact',
  coupling: 'blockedCoupling',
  turntable: 'blockedTurntable',
};

const VIEWS: readonly [TopDownMode, MessageKey][] = [
  ['follow', 'viewFollow'],
  ['yard', 'viewYard'],
];
const AIDS: readonly [keyof AidFlags, MessageKey][] = [
  ['pivots', 'aidPivots'],
  ['path', 'aidPath'],
  ['tracks', 'aidTracks'],
  ['ghost', 'aidGhost'],
];
const PANELS: readonly [keyof CollapsedPanels, MessageKey][] = [
  ['aids', 'panelAids'],
  ['gauges', 'panelGauges'],
];
const GEAR_NAMES: readonly Gear[] = ['P', 'R', 'N', 'D'];
const MS_TO_KMH = 3.6;
/**
 * Cockpit widths below which the legend drops to one column: it must fit right of the wheel and
 * gears, and where the cockpit reaches the screen's right edge, left of the lever as well.
 */
const COMPACT_WIDTH = 720;
const COMPACT_WIDTH_WITH_LEVER = 840;

const RESET_VIEW_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>';

const button = (attr: string, value: string, key: MessageKey): string =>
  `<button type="button" class="hud-toggle" ${attr}="${value}" data-i18n="${key}"></button>`;

const MARKUP = (mode: HudOptions['mode']): string => `
<div class="hud" data-hud="root">
  <div class="hud-cockpit" data-hud="cockpit" hidden>
    <span class="hud-label hud-view-label" data-i18n="labelCockpit"></span>
    <div class="hud-legend" data-hud="legend" hidden>
      <span class="hud-label" data-i18n="keys"></span>
      <dl>
        <dt class="mono">A / D · ← / →</dt><dd data-i18n="steer"></dd>
        <dt class="mono">C</dt><dd data-i18n="resetSteer"></dd>
        <dt class="mono">W / S · ↑ / ↓</dt><dd data-i18n="speed"></dd>
        <dt class="mono" data-i18n="keySpace"></dt><dd data-i18n="brake"></dd>
        <dt class="mono">1–4 = ${GEAR_NAMES.join(' / ')}</dt><dd data-i18n="gear"></dd>
        <dt class="mono hud-legend-view">+ / −</dt><dd class="hud-legend-view" data-i18n="zoom"></dd>
        <dt class="mono hud-legend-view">0</dt><dd class="hud-legend-view" data-i18n="resetView"></dd>
      </dl>
    </div>
    <div class="hud-band">
      <span class="hud-gear mono" data-hud="gear"></span>
      <span class="hud-speed mono" data-hud="speed"></span>
    </div>
  </div>
  <div class="hud-mirror" data-hud="mirrorLeft" hidden></div>
  <div class="hud-mirror" data-hud="mirrorRight" hidden></div>
  <div class="hud-toast-wrap" data-hud="toastWrap"><div class="hud-toast" data-hud="toast" hidden></div><div class="hud-goal-cue" data-hud="goalCue" hidden></div></div>
  <div class="hud-topdown" data-hud="topDown">
    <div class="hud-goal" data-hud="goal" data-chrome hidden><div class="hud-goal-title" data-hud="goalTitle"></div><div class="hud-goal-brief" data-hud="goalBrief"></div></div>
    <div class="hud-toolbar">
      <div class="hud-group" data-hud="views" data-chrome>
        <span class="hud-label hud-view-label" data-i18n="labelTopDown"></span>${VIEWS.map(([v, k]) => button('data-view', v, k)).join('')}<button type="button" class="hud-toggle hud-icon" data-hud="resetView" disabled>${RESET_VIEW_ICON}</button>${PANELS.map(([p, k]) => button('data-panel', p, k)).join('')}</div>
      <div class="hud-group" data-hud="aids" data-chrome>${AIDS.map(([a, k]) => button('data-aid', a, k)).join('')}</div>
    </div>
    <div class="hud-info">
      <div class="hud-gauges" data-hud="gauges" data-chrome></div>
      ${
        mode === 'exercise'
          ? `<dl class="hud-counters" data-hud="counters" data-chrome>
        <dt data-i18n="contacts"></dt><dd class="mono" data-hud="contacts"></dd>
        <dt data-i18n="jackknifes"></dt><dd class="mono" data-hud="jackknifes"></dd>
        <dt data-i18n="directionChanges"></dt><dd class="mono" data-hud="directionChanges"></dd>
        <dt data-i18n="time"></dt><dd class="mono" data-hud="time"></dd>
      </dl>`
          : ''
      }
    </div>
  </div>
  <div class="hud-arrow" data-hud="targetArrow" role="img" aria-label="${t('targetDirection')}" hidden><svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M-9 -8L10 0L-9 8L-4 0Z" /></svg></div>
  <button type="button" class="hud-action" data-chrome data-hud="action" data-i18n="${mode === 'exercise' ? 'finish' : 'menu'}"></button>
</div>`;

const query = <T extends Element>(
  root: ParentNode,
  name: string,
  type: abstract new () => T,
): T => {
  const el = root.querySelector(`[data-hud="${name}"]`);
  if (!(el instanceof type)) throw new Error(`hud markup lacks ${name}`);
  return el;
};

const place = (el: HTMLElement, r: Rect): void => {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
};

const setHidden = (el: HTMLElement, hidden: boolean): void => {
  if (el.hidden !== hidden) el.hidden = hidden;
};

export function createHud(root: HTMLElement, opts: HudOptions): Hud {
  const abort = new AbortController();
  const { signal } = abort;
  const listeners: ((a: HudAction) => void)[] = [];
  const emit = (a: HudAction): void => {
    for (const cb of listeners) cb(a);
  };

  root.insertAdjacentHTML('beforeend', MARKUP(opts.mode));
  const hud = query(root, 'root', HTMLElement);
  applyMessages(hud);

  const cockpit = query(hud, 'cockpit', HTMLElement);
  const legend = query(hud, 'legend', HTMLElement);
  const mirrors = [query(hud, 'mirrorLeft', HTMLElement), query(hud, 'mirrorRight', HTMLElement)];
  const toastWrap = query(hud, 'toastWrap', HTMLElement);
  const toast = query(hud, 'toast', HTMLElement);
  const topDown = query(hud, 'topDown', HTMLElement);
  const gaugeBox = query(hud, 'gauges', HTMLElement);
  const speed = query(hud, 'speed', HTMLElement);
  const gearEl = query(hud, 'gear', HTMLElement);
  const arrow = query(hud, 'targetArrow', HTMLElement);
  const goalCue = query(hud, 'goalCue', HTMLElement);
  if (opts.exercise !== null) {
    query(hud, 'goalTitle', HTMLElement).textContent = opts.exercise.title;
    query(hud, 'goalBrief', HTMLElement).textContent = opts.exercise.brief;
    setHidden(query(hud, 'goal', HTMLElement), false);
  }

  const coupling: Gauge = createGauge(t('couplingAngle'), opts.couplingLimit);
  const turntable: Gauge = createGauge(t('turntableAngle'), opts.turntableLimit);
  coupling.set(0);
  turntable.set(0);
  gaugeBox.append(coupling.el, turntable.el);

  const counter = (name: string): HTMLElement | null =>
    hud.querySelector<HTMLElement>(`[data-hud="${name}"]`);
  const contactsEl = counter('contacts');
  const jackknifesEl = counter('jackknifes');
  const directionEl = counter('directionChanges');
  const timeEl = counter('time');

  let view = opts.topDown;
  const aids = { ...opts.aids };
  const viewButtons = [...hud.querySelectorAll<HTMLElement>('[data-view]')];
  const aidButtons = [...hud.querySelectorAll<HTMLElement>('[data-aid]')];
  const panelButtons = [...hud.querySelectorAll<HTMLElement>('[data-panel]')];
  const collapsed = { ...opts.collapsed };
  const aidsBox = query(hud, 'aids', HTMLElement);
  const syncToggles = (): void => {
    for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset['view'] === view));
    for (const b of aidButtons)
      b.setAttribute('aria-pressed', String(aids[b.dataset['aid'] as keyof AidFlags]));
    for (const b of panelButtons)
      b.setAttribute(
        'aria-pressed',
        String(!collapsed[b.dataset['panel'] as keyof CollapsedPanels]),
      );
    setHidden(aidsBox, collapsed.aids);
    setHidden(gaugeBox, !aids.pivots || collapsed.gauges);
  };
  syncToggles();

  for (const b of viewButtons) {
    b.addEventListener(
      'click',
      () => {
        view = b.dataset['view'] as TopDownMode;
        syncToggles();
        emit({ type: 'topDown', mode: view });
      },
      { signal },
    );
  }
  for (const b of aidButtons) {
    b.addEventListener(
      'click',
      () => {
        const aid = b.dataset['aid'] as keyof AidFlags;
        aids[aid] = !aids[aid];
        syncToggles();
        emit({ type: 'aid', aid, on: aids[aid] });
      },
      { signal },
    );
  }
  for (const b of panelButtons) {
    b.addEventListener(
      'click',
      () => {
        const panel = b.dataset['panel'] as keyof CollapsedPanels;
        collapsed[panel] = !collapsed[panel];
        syncToggles();
        emit({ type: 'collapse', panel, collapsed: collapsed[panel] });
      },
      { signal },
    );
  }
  const resetView = query(hud, 'resetView', HTMLButtonElement);
  resetView.title = t('resetView');
  resetView.setAttribute('aria-label', t('resetView'));
  resetView.addEventListener('click', () => emit({ type: 'resetView' }), { signal });
  query(hud, 'action', HTMLElement).addEventListener(
    'click',
    () => emit({ type: opts.mode === 'exercise' ? 'finish' : 'menu' }),
    { signal },
  );

  const keyboardLike = matchMedia('(hover: hover) and (pointer: fine)');
  let typed = false;
  const syncLegend = (): void => setHidden(legend, !keyboardLike.matches && !typed);
  syncLegend();
  keyboardLike.addEventListener('change', syncLegend, { signal });
  // Registered after the controls' keyboard listener, so defaultPrevented marks a key it handled.
  window.addEventListener(
    'keydown',
    (e) => {
      if (typed || !e.defaultPrevented) return;
      typed = true;
      syncLegend();
    },
    { signal },
  );

  // Last written values; update() compares these before touching the DOM.
  let shownTenths = -1;
  let shownGear: Gear | null = 'P';
  gearEl.textContent = 'P';
  gearEl.dataset['gear'] = 'P';
  let shownBlocked: BlockReason | null = null;
  let shownGoal: GoalState = 'away';
  let shownContacts = -1;
  let shownJackknifes = -1;
  let shownDirection = -1;
  let shownSeconds = -1;

  const writeSpeed = (tenths: number): void => {
    shownTenths = tenths;
    speed.textContent = `${formatNumber(tenths / 10, 1)} km/h`;
  };
  writeSpeed(0);

  return {
    update(s) {
      const tenths = Math.round(Math.abs(s.speed) * MS_TO_KMH * 10);
      if (tenths !== shownTenths) writeSpeed(tenths);

      const gear = s.control.gear;
      if (gear !== shownGear) {
        shownGear = gear;
        gearEl.textContent = gear;
        gearEl.dataset['gear'] = gear;
      }

      coupling.set(s.couplingAngle);
      turntable.set(s.turntableAngle);

      if (s.blocked !== shownBlocked) {
        shownBlocked = s.blocked;
        if (s.blocked) toast.textContent = t(BLOCKED_KEY[s.blocked]);
        setHidden(toast, s.blocked === null);
      }

      if (contactsEl && s.contacts !== shownContacts) {
        shownContacts = s.contacts;
        contactsEl.textContent = formatNumber(s.contacts, 0);
      }
      if (jackknifesEl && s.jackknifes !== shownJackknifes) {
        shownJackknifes = s.jackknifes;
        jackknifesEl.textContent = formatNumber(s.jackknifes, 0);
      }
      if (directionEl && s.directionChanges !== shownDirection) {
        shownDirection = s.directionChanges;
        directionEl.textContent = formatNumber(s.directionChanges, 0);
      }
      const seconds = Math.floor(s.time);
      if (timeEl && seconds !== shownSeconds) {
        shownSeconds = seconds;
        const m = Math.floor(seconds / 60);
        const ss = seconds % 60;
        timeEl.textContent = `${m}:${ss < 10 ? '0' : ''}${ss}`;
      }
    },
    layout(views) {
      const { cockpit: c } = views;
      const spansRight = (r: Rect): boolean => r.x + r.width >= root.clientWidth - 1;
      setHidden(cockpit, c === null);
      if (c) {
        place(cockpit, c);
        cockpit.toggleAttribute(
          'data-compact',
          c.width < (spansRight(c) ? COMPACT_WIDTH_WITH_LEVER : COMPACT_WIDTH),
        );
      }
      const mirrorRects = [views.mirrorLeft, views.mirrorRight];
      mirrors.forEach((el, i) => {
        const r = mirrorRects[i];
        setHidden(el, !r);
        if (r) place(el, r);
      });
      const base = c ?? views.topDown;
      toastWrap.style.left = `${base.x}px`;
      toastWrap.style.top = `${base.y}px`;
      toastWrap.style.width = `${base.width}px`;
      place(topDown, views.topDown);
      // The finish/menu button sits at the screen's top-right corner.
      toastWrap.toggleAttribute('data-reserve', base.y < 1 && spansRight(base));
      topDown.toggleAttribute('data-reserve', spansRight(views.topDown));
    },
    setViewChanged(changed) {
      if (resetView.disabled === changed) resetView.disabled = !changed;
    },
    setTargetArrow(next) {
      setHidden(arrow, next === null);
      if (next === null) return;
      const x = Math.round(next.x);
      const y = Math.round(next.y);
      const deg = Math.round((next.angle * 180) / Math.PI);
      arrow.style.transform = `translate(${x}px, ${y}px) rotate(${deg}deg)`;
    },
    setGoal(goal) {
      if (goal === shownGoal) return;
      shownGoal = goal;
      goalCue.dataset['goal'] = goal;
      if (goal !== 'away')
        goalCue.textContent = t(goal === 'inside' ? 'goalInside' : 'goalOutside');
      setHidden(goalCue, goal === 'away');
    },
    onAction(cb) {
      listeners.push(cb);
    },
    dispose() {
      abort.abort();
      hud.remove();
    },
  };
}
