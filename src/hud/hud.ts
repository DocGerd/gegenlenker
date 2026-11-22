import type {
  AidFlags,
  CollapsedPanels,
  LegendBox,
  Orientation,
  Rect,
  TopDownMode,
  TopDownSplit,
  ViewRects,
} from '../contracts/render';
import type { BlockReason, BodyId, Gear, SimSnapshot } from '../contracts/sim';
import type { GoalState } from '../scoring/score';
import { applyMessages, formatNumber, formatSeconds, t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { isFormField } from '../input/keyboard';
import { messageColumn } from '../render/viewports';
import { actionFor, isAction, legendRows, type Action, type LegendRow } from '../input/keymap';
import { aidSwatch } from './aid-swatches';
import { createGauge, type Gauge } from './gauges';
import './hud.css';

export type HudAction =
  | { type: 'topDown'; mode: TopDownMode }
  | { type: 'resetView' }
  /** A proposed top-down share for an orientation; `commit` ends a drag or is a key press, so it is worth storing. */
  | { type: 'split'; orientation: Orientation; share: number; commit: boolean }
  | { type: 'splitReset' }
  | { type: 'aid'; aid: keyof AidFlags; on: boolean }
  | { type: 'collapse'; panel: keyof CollapsedPanels; collapsed: boolean }
  /** The aid legend opened or closed, which changes the height of the panels. */
  | { type: 'aidLegend' }
  | { type: 'finish' }
  | { type: 'menu' };

export type Hud = {
  /** `contactAhead` is the first warning stage: the held steer leads into a contact soon. */
  update(s: SimSnapshot, contactAhead?: boolean): void;
  /** Elapsed run time in seconds; the clock starts with the first driving input, not when the drive opens. */
  setRunTime(seconds: number): void;
  layout(views: ViewRects): void;
  /** The key legend as laid out by the last `layout`; null while hidden. */
  legendBox(): LegendBox | null;
  /** Fires when the legend changes size: folding, showing, hiding, other wrapping. */
  onLegendResize(cb: () => void): void;
  /** The reset-view button is enabled while the top-down view differs from its default framing. */
  setViewChanged(changed: boolean): void;
  /** The divider between the views: its value, range and orientation. */
  setSplit(split: TopDownSplit): void;
  /** The bottom edge of the top view's panels, px below its top, were it `paneWidth` wide; the layout is left as it was. */
  panelsBottom(paneWidth: number): number;
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
  /** Offers the chase view; the preset's `chaseView` flag. */
  chase: boolean;
  /** Draws the mirror housings; the preset's `cockpitInterior` flag. */
  interior: boolean;
  collapsed: CollapsedPanels;
};

const CONTACT_KEY: Record<BodyId, MessageKey> = {
  truck: 'blockedContactTruck',
  drawbar: 'blockedContactDrawbar',
  trailer: 'blockedContactTrailer',
};

function contactKey(contact: SimSnapshot['contact']): MessageKey {
  if (contact === null) return 'blockedContactTruck';
  return contact.self ? 'blockedContactSelf' : CONTACT_KEY[contact.body];
}

const BLOCKED_KEY: Record<Exclude<BlockReason, 'contact'>, MessageKey> = {
  coupling: 'blockedCoupling',
  turntable: 'blockedTurntable',
};

type ToastLevel = 'warn' | 'danger';

/** Two stages: a predicted contact warns, a blocked vehicle states what stopped it. */
function toastFor(
  s: SimSnapshot,
  contactAhead: boolean,
): { key: MessageKey; level: ToastLevel } | null {
  if (s.blocked === 'contact') {
    return {
      key: contactKey(s.contact),
      level: 'danger',
    };
  }
  if (s.blocked !== null) return { key: BLOCKED_KEY[s.blocked], level: 'danger' };
  if (contactAhead) return { key: 'contactAhead', level: 'warn' };
  // The lever acts only in a gear, so a raised lever in P would move the truck off on shifting.
  return s.control.gear === 'P' && s.control.lever > 0
    ? { key: 'selectGear', level: 'warn' }
    : null;
}

const VIEWS: readonly [TopDownMode, MessageKey][] = [
  ['follow', 'viewFollow'],
  ['yard', 'viewYard'],
  ['chase', 'viewChase'],
];
const AIDS: readonly [keyof AidFlags, MessageKey, MessageKey][] = [
  ['pivots', 'aidPivots', 'legendPivots'],
  ['path', 'aidPath', 'legendPath'],
  ['tracks', 'aidTracks', 'legendTracks'],
  ['ghost', 'aidGhost', 'legendGhost'],
];
const PANELS: readonly [keyof CollapsedPanels, MessageKey][] = [
  ['aids', 'panelAids'],
  ['gauges', 'panelGauges'],
];
const VIEW_OF: Partial<Record<Action, TopDownMode>> = {
  viewFollow: 'follow',
  viewYard: 'yard',
  viewChase: 'chase',
};
/** Aids drawn in the top-down view only; the outside view shows none of them. */
const TOP_DOWN_AIDS: readonly (keyof AidFlags)[] = ['path', 'tracks', 'ghost'];
const MS_TO_KMH = 3.6;
/**
 * Cockpit widths below which the legend drops to one column: it must fit right of the wheel and
 * gears, and where the cockpit reaches the screen's right edge, left of the lever as well.
 */
const COMPACT_WIDTH = 720;
const COMPACT_WIDTH_WITH_LEVER = 840;

const CHEVRON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>';

const INFO_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>';

const RESET_VIEW_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>';

const SPLIT_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM14 5v14" /></svg>';
/** Key steps move the divider by this share of the screen. */
const SPLIT_STEP = 0.02;
const percent = (share: number): number => Math.round(share * 100);

const button = (attr: string, value: string, key: MessageKey): string =>
  `<button type="button" class="hud-toggle" ${attr}="${value}" data-i18n="${key}"></button>`;

/** The meaning in the legend list is the toggle's description. */
const aidButton = (aid: keyof AidFlags, key: MessageKey): string =>
  `<button type="button" class="hud-toggle" data-aid="${aid}" aria-describedby="aid-meaning-${aid}" data-i18n="${key}"></button>`;

const legendRow = ({ term, desc, viewOnly }: LegendRow): string => {
  const cls = viewOnly ? 'mono hud-legend-view' : 'mono';
  const dt =
    typeof term === 'string'
      ? `<dt class="${cls}">${term}</dt>`
      : `<dt class="${cls}" data-i18n="${term.key}"></dt>`;
  return `${dt}<dd${viewOnly ? ' class="hud-legend-view"' : ''} data-i18n="${desc}"></dd>`;
};

const MARKUP = (mode: HudOptions['mode'], chase: boolean): string => `
<div class="hud" data-hud="root">
  <div class="hud-cockpit" data-hud="cockpit" hidden>
    <span class="hud-label hud-view-label" data-i18n="labelCockpit"></span>
    <div class="hud-legend" data-hud="legend" hidden>
      <button type="button" class="hud-legend-toggle" data-hud="keysToggle"><span class="hud-label" data-i18n="keys"></span>${CHEVRON_ICON}</button>
      <dl>
        ${legendRows(chase).map(legendRow).join('')}
      </dl>
    </div>
    <div class="hud-band">
      <span class="hud-gear mono" data-hud="gear"></span>
      <span class="hud-speed mono" data-hud="speed"></span>
    </div>
  </div>
  <div class="hud-mirror" data-hud="mirrorLeft" hidden></div>
  <div class="hud-mirror" data-hud="mirrorRight" hidden></div>
  <div class="hud-mirror" data-hud="front" hidden></div>
  <div class="hud-toast-wrap" data-hud="toastWrap"><div class="hud-toast" data-hud="toast" hidden></div><div class="hud-goal-cue" data-hud="goalCue" hidden></div></div>
  <div class="hud-topdown" data-hud="topDown">
    <div class="hud-goal" data-hud="goal" data-chrome hidden><div class="hud-goal-title" data-hud="goalTitle"></div><div class="hud-goal-brief" data-hud="goalBrief"></div></div>
    <div class="hud-toolbar">
      <div class="hud-group" data-hud="views" data-chrome>
        <div class="hud-group" role="group" aria-label="${t('labelView')}">${VIEWS.map(([v, k]) => button('data-view', v, k)).join('')}</div><button type="button" class="hud-toggle hud-icon" data-hud="resetView" disabled>${RESET_VIEW_ICON}</button>${PANELS.map(([p, k]) => button('data-panel', p, k)).join('')}</div>
      <div class="hud-aids" data-hud="aids" data-chrome>
        <div class="hud-group">${AIDS.map(([a, k]) => aidButton(a, k)).join('')}<button type="button" class="hud-toggle hud-icon" data-hud="aidLegendToggle" aria-expanded="false" aria-controls="aid-legend">${INFO_ICON}</button></div>
        <ul class="hud-aid-legend" id="aid-legend" data-hud="aidLegend" hidden>${AIDS.map(([a, , k]) => `<li data-aid-legend="${a}">${aidSwatch(a)}<span id="aid-meaning-${a}" data-i18n="${k}"></span></li>`).join('')}</ul>
      </div>
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
  <div class="hud-split" data-hud="split" hidden>
    <div class="hud-split-handle" data-hud="splitHandle" role="separator" tabindex="0" ></div>
    <button type="button" class="hud-toggle hud-icon hud-split-reset" data-hud="splitReset" aria-keyshortcuts="L" disabled>${SPLIT_ICON}</button>
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

  root.insertAdjacentHTML('beforeend', MARKUP(opts.mode, opts.chase));
  const hud = query(root, 'root', HTMLElement);
  hud.toggleAttribute('data-interior', opts.interior);
  applyMessages(hud);

  const cockpit = query(hud, 'cockpit', HTMLElement);
  const legend = query(hud, 'legend', HTMLElement);
  const mirrors = [
    query(hud, 'mirrorLeft', HTMLElement),
    query(hud, 'mirrorRight', HTMLElement),
    query(hud, 'front', HTMLElement),
  ];
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
  if (!opts.chase) {
    for (const b of viewButtons) if (b.dataset['view'] === 'chase') setHidden(b, true);
  }
  const aidButtons = [...hud.querySelectorAll<HTMLButtonElement>('[data-aid]')];
  const panelButtons = [...hud.querySelectorAll<HTMLElement>('[data-panel]')];
  const collapsed = { ...opts.collapsed };
  const aidsBox = query(hud, 'aids', HTMLElement);
  const legendItems = new Map(
    AIDS.map(([aid]) => {
      const li = hud.querySelector<HTMLElement>(`[data-aid-legend="${aid}"]`);
      if (li === null) throw new Error(`no legend item for ${aid}`);
      return [aid, li] as const;
    }),
  );
  const keysToggle = query(hud, 'keysToggle', HTMLButtonElement);
  const legendToggle = query(hud, 'aidLegendToggle', HTMLButtonElement);
  const aidLegend = query(hud, 'aidLegend', HTMLElement);
  legendToggle.title = t('aidLegend');
  legendToggle.setAttribute('aria-label', t('aidLegend'));
  legendToggle.addEventListener(
    'click',
    () => {
      setHidden(aidLegend, !aidLegend.hidden);
      legendToggle.setAttribute('aria-expanded', String(!aidLegend.hidden));
      emit({ type: 'aidLegend' });
    },
    { signal },
  );
  const syncToggles = (): void => {
    for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset['view'] === view));
    for (const b of aidButtons) {
      const aid = b.dataset['aid'] as keyof AidFlags;
      b.setAttribute('aria-pressed', String(aids[aid]));
      b.disabled = view === 'chase' && TOP_DOWN_AIDS.includes(aid);
      const item = legendItems.get(aid);
      if (item === undefined) throw new Error(`no legend item for ${aid}`);
      item.toggleAttribute('data-disabled', b.disabled);
      if (b.disabled) b.title = t('aidTopViewOnly');
      else b.removeAttribute('title');
    }
    for (const b of panelButtons)
      b.setAttribute(
        'aria-pressed',
        String(!collapsed[b.dataset['panel'] as keyof CollapsedPanels]),
      );
    keysToggle.setAttribute('aria-expanded', String(!collapsed.keys));
    legend.toggleAttribute('data-collapsed', collapsed.keys);
    setHidden(aidsBox, collapsed.aids);
    setHidden(gaugeBox, !aids.pivots || collapsed.gauges);
  };
  syncToggles();

  const selectView = (mode: TopDownMode): void => {
    view = mode;
    syncToggles();
    emit({ type: 'topDown', mode });
  };
  for (const b of viewButtons) {
    b.addEventListener('click', () => selectView(b.dataset['view'] as TopDownMode), { signal });
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
  const togglePanel = (panel: keyof CollapsedPanels): void => {
    collapsed[panel] = !collapsed[panel];
    syncToggles();
    emit({ type: 'collapse', panel, collapsed: collapsed[panel] });
  };
  for (const b of panelButtons) {
    b.addEventListener('click', () => togglePanel(b.dataset['panel'] as keyof CollapsedPanels), {
      signal,
    });
  }
  keysToggle.addEventListener('click', () => togglePanel('keys'), { signal });
  const resetView = query(hud, 'resetView', HTMLButtonElement);
  resetView.title = t('resetView');
  resetView.setAttribute('aria-label', t('resetView'));
  resetView.addEventListener('click', () => emit({ type: 'resetView' }), { signal });
  query(hud, 'action', HTMLElement).addEventListener(
    'click',
    () => emit({ type: opts.mode === 'exercise' ? 'finish' : 'menu' }),
    { signal },
  );

  const split = query(hud, 'split', HTMLElement);
  const splitHandle = query(hud, 'splitHandle', HTMLElement);
  const splitReset = query(hud, 'splitReset', HTMLButtonElement);
  splitHandle.setAttribute('aria-label', t('viewSize'));
  splitReset.title = `${t('resetViewSize')} (L)`;
  splitReset.setAttribute('aria-label', t('resetViewSize'));
  let splitState: TopDownSplit | null = null;
  let hasCockpit = false;
  type Drag = {
    pointer: number;
    orientation: Orientation;
    /** Pointer position along the drag axis, at the start and latest. */
    start: number;
    current: number;
    /** The share when the drag began, and the last one proposed. */
    share: number;
    sent: number;
    frame: number | null;
  };
  let drag: Drag | null = null;
  let keyDirty = false;
  const proposeSplit = (orientation: Orientation, share: number, commit: boolean): void =>
    emit({ type: 'split', orientation, share, commit });
  const clampShare = (share: number): number =>
    splitState === null ? share : Math.min(splitState.max, Math.max(splitState.min, share));
  const along = (e: PointerEvent, orientation: Orientation): number =>
    orientation === 'landscape' ? e.clientX : e.clientY;

  /** Ends the drag without a result: the share goes back to where it began, and nothing is stored. */
  const cancelDrag = (): void => {
    const d = drag;
    if (d === null) return;
    drag = null;
    if (d.frame !== null) cancelAnimationFrame(d.frame);
    try {
      if (splitHandle.hasPointerCapture(d.pointer)) splitHandle.releasePointerCapture(d.pointer);
    } catch {
      // The pointer is already gone.
    }
    splitHandle.blur();
    // Not inline: this can run inside a layout, which a proposal would re-enter.
    if (d.sent !== d.share) queueMicrotask(() => proposeSplit(d.orientation, d.share, false));
  };
  /** The replay's full-screen pane has no divider, and a screen whose range is a single percent has nothing to drag. */
  const syncSplitHidden = (): void => {
    const hide =
      !hasCockpit || splitState === null || percent(splitState.max) <= percent(splitState.min);
    setHidden(split, hide);
    if (hide) cancelDrag();
  };
  /** One proposal per frame, however many moves came in. */
  const proposeDrag = (d: Drag): void => {
    d.frame = null;
    const extent = d.orientation === 'landscape' ? root.clientWidth : root.clientHeight;
    const moved = d.orientation === 'landscape' ? d.start - d.current : d.current - d.start;
    const next = clampShare(d.share + moved / extent);
    if (next === d.sent) return;
    d.sent = next;
    proposeSplit(d.orientation, next, false);
  };
  splitHandle.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) {
        // No focus from a right-click or a second finger: a focused divider would keep the arrow keys from steering.
        e.preventDefault();
        return;
      }
      if (splitState === null || drag !== null) return;
      try {
        splitHandle.setPointerCapture(e.pointerId);
      } catch {
        return;
      }
      const { orientation, share } = splitState;
      const start = along(e, orientation);
      drag = {
        pointer: e.pointerId,
        orientation,
        start,
        current: start,
        share,
        sent: share,
        frame: null,
      };
    },
    { signal },
  );
  splitHandle.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0) e.preventDefault();
    },
    { signal },
  );
  splitHandle.addEventListener(
    'pointermove',
    (e) => {
      const d = drag;
      if (d === null || e.pointerId !== d.pointer) return;
      d.current = along(e, d.orientation);
      d.frame ??= requestAnimationFrame(() => proposeDrag(d));
    },
    { signal },
  );
  splitHandle.addEventListener(
    'pointerup',
    (e) => {
      // A pointer-focused divider would keep the arrow keys from steering.
      splitHandle.blur();
      const d = drag;
      if (d === null || e.pointerId !== d.pointer) return;
      drag = null;
      if (d.frame !== null) cancelAnimationFrame(d.frame);
      d.current = along(e, d.orientation);
      proposeDrag(d);
      // Only a drag that moved the divider is worth storing.
      if (d.sent !== d.share) proposeSplit(d.orientation, d.sent, true);
    },
    { signal },
  );
  splitHandle.addEventListener(
    'pointercancel',
    (e) => {
      splitHandle.blur();
      if (e.pointerId === drag?.pointer) cancelDrag();
    },
    { signal },
  );
  splitHandle.addEventListener(
    'lostpointercapture',
    (e) => {
      if (e.pointerId === drag?.pointer) cancelDrag();
    },
    { signal },
  );
  /** Stores where a burst of key presses ended; the repeats of a held key only move the divider. */
  const commitKeys = (): void => {
    if (!keyDirty || splitState === null) return;
    keyDirty = false;
    proposeSplit(splitState.orientation, splitState.share, true);
  };
  splitHandle.addEventListener(
    'keydown',
    (e) => {
      if (splitState === null || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        splitHandle.blur();
        return;
      }
      const { share, min, max, orientation } = splitState;
      const landscape = orientation === 'landscape';
      let next: number | null = null;
      if (e.key === (landscape ? 'ArrowLeft' : 'ArrowDown')) next = share + SPLIT_STEP;
      else if (e.key === (landscape ? 'ArrowRight' : 'ArrowUp')) next = share - SPLIT_STEP;
      else if (e.key === 'Home') next = min;
      else if (e.key === 'End') next = max;
      // The other axis's arrows stay with the steering and the lever.
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      const clamped = clampShare(next);
      if (clamped === share) return;
      keyDirty = e.repeat;
      proposeSplit(orientation, clamped, !e.repeat);
    },
    { signal },
  );
  splitHandle.addEventListener('keyup', commitKeys, { signal });
  splitHandle.addEventListener('blur', commitKeys, { signal });
  splitReset.addEventListener('click', () => emit({ type: 'splitReset' }), { signal });

  const keyboardLike = matchMedia('(hover: hover) and (pointer: fine)');
  let typed = false;
  const syncLegend = (): void => setHidden(legend, !keyboardLike.matches && !typed);
  syncLegend();
  keyboardLike.addEventListener('change', syncLegend, { signal });
  // Registered after the controls' keyboard listener, so defaultPrevented marks a key it handled.
  window.addEventListener(
    'keydown',
    (e) => {
      const viewAction = actionFor('view', e);
      const mode = viewAction === undefined ? undefined : VIEW_OF[viewAction];
      if (
        isAction('splitReset', e) &&
        !split.hidden &&
        !splitReset.disabled &&
        !e.defaultPrevented &&
        !e.repeat &&
        !isFormField(e.target) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        emit({ type: 'splitReset' });
        e.preventDefault();
      }
      if (
        mode !== undefined &&
        (mode !== 'chase' || opts.chase) &&
        !e.defaultPrevented &&
        !e.repeat &&
        !isFormField(e.target) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        selectView(mode);
        e.preventDefault();
      }
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
  let shownToast: MessageKey | null = null;
  let shownGoal: GoalState = 'away';
  let shownContacts = -1;
  let shownJackknifes = -1;
  let shownDirection = -1;
  let shownTime = '';

  const writeSpeed = (tenths: number): void => {
    shownTenths = tenths;
    speed.textContent = `${formatNumber(tenths / 10, 1)} km/h`;
  };
  writeSpeed(0);

  return {
    update(s, contactAhead = false) {
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

      const warning = toastFor(s, contactAhead);
      const key = warning?.key ?? null;
      if (key !== shownToast) {
        shownToast = key;
        if (warning) {
          toast.textContent = t(warning.key);
          toast.dataset['level'] = warning.level;
        }
        setHidden(toast, warning === null);
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
    },
    setRunTime(runSeconds) {
      const text = formatSeconds(runSeconds);
      if (timeEl && text !== shownTime) {
        shownTime = text;
        timeEl.textContent = text;
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
      const mirrorRects = [views.mirrorLeft, views.mirrorRight, views.front];
      mirrors.forEach((el, i) => {
        const r = mirrorRects[i];
        setHidden(el, !r);
        if (r) place(el, r);
      });
      const base = c ?? views.topDown;
      const column = messageColumn(views);
      toastWrap.style.left = `${column.x}px`;
      toastWrap.style.top = `${column.y}px`;
      toastWrap.style.width = `${column.width}px`;
      place(topDown, views.topDown);
      // The finish/menu button sits at the screen's top-right corner.
      toastWrap.toggleAttribute('data-reserve', base.y < 1 && spansRight(base));
      topDown.toggleAttribute('data-reserve', spansRight(views.topDown));
      hasCockpit = c !== null;
      syncSplitHidden();
      if (c) {
        const td = views.topDown;
        const landscape = root.clientWidth >= root.clientHeight;
        split.style.left = `${td.x}px`;
        split.style.top = `${td.y}px`;
        split.style.height = `${td.height}px`;
        split.style.width = landscape ? '' : `${td.width}px`;
      }
    },
    setSplit(next) {
      if (drag !== null && drag.orientation !== next.orientation) cancelDrag();
      splitState = next;
      syncSplitHidden();
      const vertical = next.orientation === 'landscape';
      splitHandle.setAttribute(
        'aria-keyshortcuts',
        vertical ? 'ArrowLeft ArrowRight Home End' : 'ArrowUp ArrowDown Home End',
      );
      splitHandle.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
      splitHandle.setAttribute('aria-valuemin', String(percent(next.min)));
      splitHandle.setAttribute('aria-valuemax', String(percent(next.max)));
      splitHandle.setAttribute('aria-valuenow', String(percent(next.share)));
      splitHandle.setAttribute('aria-valuetext', `${percent(next.share)} %`);
      const atDefault = Math.abs(next.share - next.fallback) < 1e-4;
      if (splitReset.disabled !== atDefault) splitReset.disabled = atDefault;
    },
    panelsBottom(paneWidth) {
      const previous = topDown.style.width;
      topDown.style.width = `${paneWidth}px`;
      const top = topDown.getBoundingClientRect().top;
      let bottom = top;
      for (const child of topDown.children) {
        if (child instanceof HTMLElement && !child.hidden) {
          bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
        }
      }
      topDown.style.width = previous;
      return bottom - top;
    },
    legendBox() {
      const r = legend.getBoundingClientRect();
      if (r.width === 0) return null;
      const stage = root.getBoundingClientRect();
      return { right: r.right - stage.left, height: stage.bottom - r.top };
    },
    onLegendResize(cb) {
      const observer = new ResizeObserver(cb);
      observer.observe(legend);
      abort.signal.addEventListener('abort', () => observer.disconnect());
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
      if (drag?.frame != null) cancelAnimationFrame(drag.frame);
      abort.abort();
      hud.remove();
    },
  };
}
