import type { AidFlags, Rect, TopDownMode, ViewRects } from '../contracts/render';
import type { BlockReason, Gear, SimSnapshot } from '../contracts/sim';
import { applyMessages, formatNumber, t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { createGauge, type Gauge } from './gauges';
import './hud.css';

export type HudAction =
  | { type: 'topDown'; mode: TopDownMode }
  | { type: 'aid'; aid: keyof AidFlags; on: boolean }
  | { type: 'finish' }
  | { type: 'menu' };

export type Hud = {
  update(s: SimSnapshot): void;
  layout(views: ViewRects): void;
  onAction(cb: (a: HudAction) => void): void;
  dispose(): void;
};

export type HudOptions = {
  couplingLimit: number;
  turntableLimit: number;
  mode: 'exercise' | 'yard';
  aids: AidFlags;
  topDown: TopDownMode;
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
const GEAR_NAMES: readonly Gear[] = ['P', 'R', 'N', 'D'];
const MS_TO_KMH = 3.6;

const button = (attr: string, value: string, key: MessageKey): string =>
  `<button type="button" class="hud-toggle" ${attr}="${value}" data-i18n="${key}"></button>`;

const MARKUP = (mode: HudOptions['mode']): string => `
<div class="hud" data-hud="root">
  <div class="hud-cockpit" data-hud="cockpit" hidden>
    <div class="hud-legend" data-hud="legend" hidden>
      <span class="hud-label" data-i18n="keys"></span>
      <dl>
        <dt class="mono">A / D · ← / →</dt><dd data-i18n="steer"></dd>
        <dt class="mono">W / S · ↑ / ↓</dt><dd data-i18n="speed"></dd>
        <dt class="mono" data-i18n="keySpace"></dt><dd data-i18n="brake"></dd>
        <dt class="mono">1–4 = ${GEAR_NAMES.join(' / ')}</dt><dd data-i18n="gear"></dd>
      </dl>
    </div>
    <div class="hud-band">
      <span class="hud-gear mono" data-hud="gear"></span>
      <span class="hud-speed mono" data-hud="speed"></span>
    </div>
  </div>
  <div class="hud-mirror" data-hud="mirrorLeft" hidden></div>
  <div class="hud-mirror" data-hud="mirrorRight" hidden></div>
  <div class="hud-toast-wrap" data-hud="toastWrap"><div class="hud-toast" data-hud="toast" hidden></div></div>
  <div class="hud-topdown" data-hud="topDown">
    <div class="hud-toolbar">
      <div class="hud-group" data-hud="views">${VIEWS.map(([v, k]) => button('data-view', v, k)).join('')}</div>
      <div class="hud-group" data-hud="aids">${AIDS.map(([a, k]) => button('data-aid', a, k)).join('')}</div>
    </div>
    <div class="hud-info">
      <div class="hud-gauges" data-hud="gauges"></div>
      ${
        mode === 'exercise'
          ? `<dl class="hud-counters" data-hud="counters">
        <dt data-i18n="contacts"></dt><dd class="mono" data-hud="contacts"></dd>
        <dt data-i18n="jackknifes"></dt><dd class="mono" data-hud="jackknifes"></dd>
        <dt data-i18n="directionChanges"></dt><dd class="mono" data-hud="directionChanges"></dd>
        <dt data-i18n="time"></dt><dd class="mono" data-hud="time"></dd>
      </dl>`
          : ''
      }
    </div>
  </div>
  <button type="button" class="hud-action" data-hud="action" data-i18n="${mode === 'exercise' ? 'finish' : 'menu'}"></button>
</div>`;

const query = <T extends Element>(root: ParentNode, name: string): T => {
  const el = root.querySelector<T>(`[data-hud="${name}"]`);
  if (!el) throw new Error(`hud markup lacks ${name}`);
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
  const hud = query<HTMLElement>(root, 'root');
  applyMessages(hud);

  const cockpit = query<HTMLElement>(hud, 'cockpit');
  const legend = query<HTMLElement>(hud, 'legend');
  const mirrors = [query<HTMLElement>(hud, 'mirrorLeft'), query<HTMLElement>(hud, 'mirrorRight')];
  const toastWrap = query<HTMLElement>(hud, 'toastWrap');
  const toast = query<HTMLElement>(hud, 'toast');
  const topDown = query<HTMLElement>(hud, 'topDown');
  const gaugeBox = query<HTMLElement>(hud, 'gauges');
  const speed = query<HTMLElement>(hud, 'speed');
  const gearEl = query<HTMLElement>(hud, 'gear');

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
  const syncToggles = (): void => {
    for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset['view'] === view));
    for (const b of aidButtons)
      b.setAttribute('aria-pressed', String(aids[b.dataset['aid'] as keyof AidFlags]));
    setHidden(gaugeBox, !aids.pivots);
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
  query<HTMLElement>(hud, 'action').addEventListener(
    'click',
    () => emit({ type: opts.mode === 'exercise' ? 'finish' : 'menu' }),
    { signal },
  );

  const keyboardLike = matchMedia('(hover: hover) and (pointer: fine)');
  const syncLegend = (): void => setHidden(legend, !keyboardLike.matches);
  syncLegend();
  keyboardLike.addEventListener('change', syncLegend, { signal });

  // Last written values; update() compares these before touching the DOM.
  let shownTenths = -1;
  let shownGear: Gear | null = null;
  let shownBlocked: BlockReason | null = null;
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
      setHidden(cockpit, c === null);
      if (c) {
        place(cockpit, c);
        cockpit.style.setProperty('--hud-x', `${c.x}px`);
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
      const spansRight = views.topDown.x + views.topDown.width >= root.clientWidth - 1;
      topDown.toggleAttribute('data-reserve', spansRight);
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
