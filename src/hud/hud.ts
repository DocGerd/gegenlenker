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
import { SIGN_IDS, type Sight, type SignId } from '../contracts/einweiser';
import type { Role } from '../contracts/exercise';
import type { BlockReason, BodyId, Gear, SimSnapshot } from '../contracts/sim';
import { isDrivingInput, type GoalCue } from '../scoring/score';
import { applyMessages, formatNumber, formatSeconds, t } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import { SIGN_NAME } from '../i18n/sign-names';
import { isFormField } from '../input/keyboard';
import { CHROME_SELECTOR } from './chrome-selector';
import { goalCueTexts } from './goal-cue';
import { hasTopDown, messageColumn, readSafeInsets, sightCueBox } from '../render/viewports';
import { actionFor, isAction, type Action } from '../input/keymap';
import { driveLegendRows, legendRowMarkup } from '../input/legend';
import { aidSwatch } from './aid-swatches';
import type { Ahead } from '../sim/predict';
import { createGauge, type Gauge } from './gauges';
import { SIGHT_CUE_KEY, sightCue, type SightCue } from './sight-cue';
import { signPictogram } from './sign-pictogram';
import './hud.css';

export type HudAction =
  | { type: 'topDown'; mode: TopDownMode }
  | { type: 'resetView' }
  /** The free camera button or its key: toggles it, entering the outside view first when another is shown. */
  | { type: 'freeCamera' }
  /** A proposed top-down share for an orientation; `commit` ends a drag or is a key press, so it is worth storing. */
  | { type: 'split'; orientation: Orientation; share: number; commit: boolean }
  | { type: 'splitReset' }
  | { type: 'aid'; aid: keyof AidFlags; on: boolean }
  | { type: 'collapse'; panel: keyof CollapsedPanels; collapsed: boolean }
  /** The aid legend opened or closed, which changes the height of the panels. */
  | { type: 'aidLegend' }
  /** The exercise brief opened or collapsed, which changes the height of the panels. */
  | { type: 'brief' }
  /** The button opening the pause sheet. */
  | { type: 'pause' };

export type Hud = {
  /** `ahead` is the first warning stage: the held steer leads into a contact or limit stop soon. */
  update(s: SimSnapshot, ahead?: Ahead): void;
  /** Elapsed run time in seconds; the clock starts with the first driving input, not when the drive opens. */
  setRunTime(seconds: number): void;
  layout(views: ViewRects): void;
  /** The key legend as laid out by the last `layout`; null while hidden. */
  legendBox(): LegendBox | null;
  /** Fires when the legend changes size: folding, showing, hiding, other wrapping. */
  onLegendResize(cb: () => void): void;
  /** The reset-view button is enabled while the top-down view differs from its default framing. */
  setViewChanged(changed: boolean): void;
  /** Shows the free camera button as pressed while it flies. */
  setFree(on: boolean): void;
  /** What a new graphics preset offers; losing the outside view while shown selects the last other view. */
  setOffers(offers: HudOffers): void;
  /** The divider between the views: its value, range and orientation. */
  setSplit(split: TopDownSplit): void;
  /**
   * The bottom edge of the top view's panels, px below its top, were it `paneWidth` wide; the layout is left as it was.
   * `Infinity` where a row sticks out sideways at that width: no pane height holds it, so `topDownSplit` takes it as not fitting.
   */
  panelsBottom(paneWidth: number): number;
  /** Points the arrow at a target beyond the top-down view; null hides it. Positions are stage CSS px. */
  setTargetArrow(arrow: { x: number; y: number; angle: number } | null): void;
  /** The live tolerance cue; a no-op in the free yard. */
  setGoal(cue: GoalCue): void;
  /** The sign he shows and how the driver sees him; a no-op in the driver's role. Null before the first sim step. */
  setEinweiser(state: EinweiserHud | null): void;
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
  /** Offers looking around in the cockpit; the preset's `interiorGlb` flag with the interior. */
  look?: boolean;
  collapsed: CollapsedPanels;
  /** No top-down pane: its brief and counters move into the cockpit, and its views, aids and gauges are gone. */
  mirrorsOnly?: boolean;
  /** The stop button and lever column, which the toolbar stays clear of; absent where there are no controls. */
  pedalsBox?: () => DOMRect;
  /**
   * Whose key legend it lists, the driver's when absent. The Einweiser's band holds the sign bar, and
   * the sight cue takes the cockpit label's place; he has no gear or speed readout, no gauges and no
   * target arrow.
   */
  role?: Role;
};

export type EinweiserHud = {
  readonly sign: SignId | null;
  readonly sight: Sight;
  /** The driver just met a sign it could not read. */
  readonly unclear: boolean;
};

export type HudOffers = {
  readonly chase: boolean;
  readonly interior: boolean;
  readonly look: boolean;
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

/** Two stages: a predicted contact or limit stop warns, a blocked vehicle states what stopped it. */
function toastFor(
  s: SimSnapshot,
  ahead: Ahead,
  started: boolean,
  driver: boolean,
): { key: MessageKey; level: ToastLevel } | null {
  if (s.blocked === 'contact') {
    return {
      key: contactKey(s.contact),
      level: 'danger',
    };
  }
  if (s.blocked !== null) return { key: BLOCKED_KEY[s.blocked], level: 'danger' };
  if (ahead === 'contact') return { key: 'contactAhead', level: 'warn' };
  if (ahead === 'limit') return { key: 'limitAhead', level: 'warn' };
  // From the start until the first gear; later, a raised lever in P would move the truck off on shifting.
  return driver && s.control.gear === 'P' && (!started || s.control.lever > 0)
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
/** How long a counter stays highlighted before it fades. */
const BUMP_MS = 250;
/**
 * Cockpit widths below which the legend drops to one column: it must fit right of the wheel and
 * gears, and where the cockpit reaches the screen's right edge, left of the lever as well.
 */
const COMPACT_WIDTH = 720;
const COMPACT_WIDTH_WITH_LEVER = 840;
/**
 * Cockpit heights below which the legend opens to the drive keys only: the full list takes the
 * mirrors' room. At 1280 wide the full list keeps class IV from this height; `layout.spec` pins it.
 */
const SHORT_HEIGHT = 740;
/**
 * Screen heights (CSS px) below which the brief collapses on the first drive input, the key and
 * aid legends are overlays (one at a time) that close on the next one, and the counters stand
 * beside the angle gauges.
 */
const SHORT_SCREEN = 700;

const CHEVRON_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>';

const INFO_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>';

const RESET_VIEW_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /></svg>';

const FREE_CAMERA_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>';

const SPLIT_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM14 5v14" /></svg>';
/** Key steps move the divider by this share of the screen. */
const SPLIT_STEP = 0.02;
const percent = (share: number): number => Math.round(share * 100);

const FOLD_ICON =
  '<svg class="hud-fold" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>';

const CHECK_ICON =
  '<svg class="hud-check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></svg>';

/** One segment of the joined view control. */
const segmentButton = (view: string, key: MessageKey): string =>
  `<button type="button" class="hud-toggle hud-segment" data-view="${view}" data-i18n="${key}"></button>`;

const viewSegments = (): string => VIEWS.map(([v, k]) => segmentButton(v, k)).join('');

/** A folding panel's chip is a disclosure: the chevron points down while the panel shows. */
const panelButton = (panel: string, key: MessageKey): string =>
  `<button type="button" class="hud-toggle hud-chip" data-panel="${panel}" aria-controls="hud-panel-${panel}"><span data-i18n="${key}"></span>${FOLD_ICON}</button>`;

/** The meaning in the legend list is the toggle's description; the ring fills with a tick while the aid is on. */
const aidButton = (aid: keyof AidFlags, key: MessageKey): string =>
  `<button type="button" class="hud-toggle hud-chip" data-aid="${aid}" aria-describedby="aid-meaning-${aid}">${CHECK_ICON}<span data-i18n="${key}"></span></button>`;

const keyRows = (chase: boolean, look: boolean, mirrorsOnly: boolean, role: Role): string =>
  driveLegendRows({ chase, look, mirrorsOnly, role }).map(legendRowMarkup).join('');

/** The Einweiser has no gauges to fold. */
const panelButtons = (driver: boolean): string =>
  PANELS.filter(([p]) => driver || p !== 'gauges')
    .map(([p, k]) => panelButton(p, k))
    .join('');

/** An eye, struck through while out of sight (hud.css). */
const EYE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /><path class="hud-sight-strike" d="M4 4l16 16" /></svg>';

/** One slot per sign in the keys' order, 1 to 9. */
const signBar = (): string =>
  `<div class="hud-sign-name" data-hud="signName"></div><ol class="hud-sign-bar" data-hud="signBar" aria-label="${t('signBar')}">${SIGN_IDS.map(
    (sign, i) =>
      `<li class="hud-sign" data-sign="${sign}"><span class="hud-sign-key mono">${i + 1}</span>${signPictogram(sign)}<span class="hud-sign-label" data-i18n="${SIGN_NAME[sign]}"></span></li>`,
  ).join('')}</ol>`;

const MARKUP = (
  mode: HudOptions['mode'],
  chase: boolean,
  look: boolean | undefined,
  mirrorsOnly: boolean,
  role: Role,
  driver = role === 'driver',
): string => `
<div class="hud" data-hud="root">
  <div class="hud-cockpit" data-hud="cockpit" hidden>
    ${driver ? '<span class="hud-label hud-view-label" data-i18n="labelCockpit"></span>' : `<div class="hud-sight" data-hud="sight" hidden>${EYE_ICON}<span data-hud="sightText"></span></div>`}
    <div class="hud-legend" data-hud="legend" hidden>
      <button type="button" class="hud-legend-toggle" data-hud="keysToggle"><span class="hud-label" data-i18n="keys"></span>${CHEVRON_ICON}</button>
      <dl data-hud="keys">
        ${keyRows(chase, look === true, mirrorsOnly, role)}
      </dl>
    </div>
    <div class="hud-band" data-hud="band">
      ${driver ? '<span class="hud-gear mono" data-hud="gear"></span><span class="hud-speed mono" data-hud="speed"></span>' : signBar()}
    </div>
  </div>
  <div class="hud-mirror" data-hud="mirrorLeft" hidden></div>
  <div class="hud-mirror" data-hud="mirrorRight" hidden></div>
  <div class="hud-mirror" data-hud="wideLeft" hidden></div>
  <div class="hud-mirror" data-hud="wideRight" hidden></div>
  <div class="hud-mirror" data-hud="front" hidden></div>
  <div class="hud-mirror" data-hud="close" hidden></div>
  <div class="hud-topdown" data-hud="topDown">
    <div class="hud-goal" data-hud="goal" data-chrome hidden><div class="hud-goal-head"><div class="hud-goal-title" data-hud="goalTitle"></div><button type="button" class="hud-goal-toggle" data-hud="briefToggle" aria-expanded="true" aria-controls="goal-brief" hidden>${CHEVRON_ICON}</button></div><div class="hud-goal-brief" id="goal-brief" data-hud="goalBrief"></div></div>
    <div class="hud-toolbar" data-hud="toolbar">
      <div class="hud-group" data-hud="views" data-chrome>
        <div class="hud-segmented" role="group" aria-label="${t('labelView')}">${viewSegments()}</div><button type="button" class="hud-toggle hud-icon" data-hud="resetView" disabled>${RESET_VIEW_ICON}</button>${panelButtons(driver)}</div>
      <div class="hud-aids" id="hud-panel-aids" data-hud="aids" data-chrome>
        <div class="hud-group">${AIDS.map(([a, k]) => aidButton(a, k)).join('')}<button type="button" class="hud-toggle hud-icon" data-hud="aidLegendToggle" aria-expanded="false" aria-controls="aid-legend">${INFO_ICON}</button></div>
        <ul class="hud-aid-legend" id="aid-legend" data-hud="aidLegend" hidden>${AIDS.map(([a, , k]) => `<li data-aid-legend="${a}">${aidSwatch(a)}<span id="aid-meaning-${a}" data-i18n="${k}"></span></li>`).join('')}</ul>
      </div>
    </div>
    <div class="hud-info" data-hud="info">
      ${driver ? '<div class="hud-gauges" id="hud-panel-gauges" data-hud="gauges" data-chrome></div>' : ''}
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
  <div class="hud-toast-wrap" data-hud="toastWrap" role="status" aria-live="polite" aria-atomic="false"><div class="hud-toast" data-hud="toast" hidden></div><div class="hud-goal-cue" data-hud="goalCue" hidden></div></div>
  <div class="hud-split" data-hud="split" hidden>
    <div class="hud-split-handle" data-hud="splitHandle" role="separator" tabindex="0" ></div>
    <button type="button" class="hud-toggle hud-icon hud-split-reset" data-hud="splitReset" aria-keyshortcuts="L" disabled>${SPLIT_ICON}</button>
  </div>
  ${!mirrorsOnly ? `<div class="hud-pane-tools" data-hud="paneTools"><button type="button" class="hud-toggle hud-icon" data-hud="freeCamera" data-chrome aria-pressed="false" hidden>${FREE_CAMERA_ICON}</button></div>` : ''}
  ${driver ? `<div class="hud-arrow" data-hud="targetArrow" role="img" aria-label="${t('targetDirection')}" hidden><svg viewBox="-12 -12 24 24" aria-hidden="true"><path d="M-9 -8L10 0L-9 8L-4 0Z" /></svg></div>` : ''}
  <button type="button" class="hud-action" data-chrome data-hud="action" data-i18n="pause"></button>
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

/** The mirror views, in the order the HUD draws them. */
const MIRROR_KEYS = [
  'mirrorLeft',
  'mirrorRight',
  'wideLeft',
  'wideRight',
  'front',
  'close',
] as const;

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

  const role = opts.role ?? 'driver';
  const driver = role === 'driver';
  root.insertAdjacentHTML(
    'beforeend',
    MARKUP(opts.mode, opts.chase, opts.look, opts.mirrorsOnly === true, role),
  );
  const hud = query(root, 'root', HTMLElement);
  hud.dataset['role'] = role;
  hud.toggleAttribute('data-interior', opts.interior);
  applyMessages(hud);

  const cockpit = query(hud, 'cockpit', HTMLElement);
  const legend = query(hud, 'legend', HTMLElement);
  const keysList = query(hud, 'keys', HTMLElement);
  const mirrors = MIRROR_KEYS.map((key) => query(hud, key, HTMLElement));
  const toastWrap = query(hud, 'toastWrap', HTMLElement);
  const toast = query(hud, 'toast', HTMLElement);
  const topDown = query(hud, 'topDown', HTMLElement);
  const infoRow = query(hud, 'info', HTMLElement);
  const toolbar = query(hud, 'toolbar', HTMLElement);
  // the driver's alone
  const gaugeBox = hud.querySelector<HTMLElement>('[data-hud="gauges"]');
  const speed = hud.querySelector<HTMLElement>('[data-hud="speed"]');
  const gearEl = hud.querySelector<HTMLElement>('[data-hud="gear"]');
  const arrow = hud.querySelector<HTMLElement>('[data-hud="targetArrow"]');
  // the Einweiser's alone
  const sightBox = hud.querySelector<HTMLElement>('[data-hud="sight"]');
  const sightText = hud.querySelector<HTMLElement>('[data-hud="sightText"]');
  const signName = hud.querySelector<HTMLElement>('[data-hud="signName"]');
  const signSlots = [...hud.querySelectorAll<HTMLElement>('[data-sign]')];
  const action = query(hud, 'action', HTMLElement);
  const goalCue = query(hud, 'goalCue', HTMLElement);
  const goalDistance = document.createElement('span');
  goalDistance.setAttribute('aria-hidden', 'true');
  const goalState = document.createElement('span');
  goalCue.append(goalDistance, goalState);
  const goal = query(hud, 'goal', HTMLElement);
  if (opts.exercise !== null) {
    query(hud, 'goalTitle', HTMLElement).textContent = opts.exercise.title;
    query(hud, 'goalBrief', HTMLElement).textContent = opts.exercise.brief;
    setHidden(goal, false);
  }
  const mirrorsOnly = opts.mirrorsOnly === true;
  hud.toggleAttribute('data-mirrors', mirrorsOnly);
  if (mirrorsOnly) {
    // The pane is gone: the brief floats over the cockpit and the counters join the readouts in its band.
    setHidden(topDown, true);
    cockpit.append(goal);
    const counters = hud.querySelector('[data-hud="counters"]');
    if (counters !== null) query(hud, 'band', HTMLElement).append(counters);
  }
  const briefToggle = query(hud, 'briefToggle', HTMLButtonElement);
  briefToggle.title = t('briefToggle');
  briefToggle.setAttribute('aria-label', t('briefToggle'));

  let gauges: { readonly coupling: Gauge; readonly turntable: Gauge } | null = null;
  if (gaugeBox !== null) {
    gauges = {
      coupling: createGauge(t('couplingAngle'), opts.couplingLimit),
      turntable: createGauge(t('turntableAngle'), opts.turntableLimit),
    };
    gauges.coupling.set(0);
    gauges.turntable.set(0);
    gaugeBox.append(gauges.coupling.el, gauges.turntable.el);
  }

  const counter = (name: string): HTMLElement | null =>
    hud.querySelector<HTMLElement>(`[data-hud="${name}"]`);
  const contactsEl = counter('contacts');
  const jackknifesEl = counter('jackknifes');
  const directionEl = counter('directionChanges');
  const timeEl = counter('time');

  let view = opts.topDown;
  /** The view a preset without the outside view falls back to. */
  let lastOther: TopDownMode = view === 'chase' ? 'follow' : view;
  const aids = { ...opts.aids };
  const allViewButtons = [...hud.querySelectorAll<HTMLElement>('[data-view]')];
  const chaseSegment = query(hud, 'views', HTMLElement).querySelector<HTMLElement>(
    '[data-view="chase"]',
  );
  const segmentGroup = chaseSegment?.parentElement ?? null;
  /** A button over the pane's bottom edge, only in the outside view: the toolbar keeps its two rows. */
  const freeCameraButton = hud.querySelector<HTMLButtonElement>('[data-hud="freeCamera"]');
  const paneToolsBox = hud.querySelector<HTMLElement>('[data-hud="paneTools"]');
  // Without the outside view its segment and the pane tools leave the DOM: the segments' CSS keys on `:last-child`.
  let chaseOffered = opts.chase;
  let viewButtons = allViewButtons;
  let freeCamera = freeCameraButton;
  let paneTools = paneToolsBox;
  const syncChaseOffer = (): void => {
    viewButtons = chaseOffered ? allViewButtons : allViewButtons.filter((b) => b !== chaseSegment);
    freeCamera = chaseOffered ? freeCameraButton : null;
    paneTools = chaseOffered ? paneToolsBox : null;
    if (!chaseOffered) {
      chaseSegment?.remove();
      paneToolsBox?.remove();
      return;
    }
    if (chaseSegment !== null && !chaseSegment.isConnected) segmentGroup?.append(chaseSegment);
    if (paneToolsBox !== null && !paneToolsBox.isConnected) (arrow ?? action).before(paneToolsBox);
  };
  syncChaseOffer();
  const aidButtons = [...hud.querySelectorAll<HTMLButtonElement>('[data-aid]')];
  const panelButtons = [...hud.querySelectorAll<HTMLButtonElement>('[data-panel]')];
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
  // On a short cockpit the chevron flips between the drive keys and the full list; not persisted.
  let shortCockpit = false;
  let allKeys = false;
  // On a short screen the brief and the key legend each have a state of their own; not persisted.
  let shortScreen = false;
  /** The brief folds away on the first drive input: on a short screen, and where it floats over the cockpit. */
  const foldsBrief = (): boolean => shortScreen || mirrorsOnly;
  let briefOpen = true;
  let briefDone = false;
  let keysOpen = false;
  let aidOpen = false;
  /** A wrapped view control rounds each visual row's ends: its segments carry `data-row-start` / `data-row-end`. */
  const syncSegmentRows = (): void => {
    viewButtons.forEach((b, i) => {
      const prev = viewButtons[i - 1];
      const next = viewButtons[i + 1];
      b.toggleAttribute('data-row-start', prev === undefined || prev.offsetTop !== b.offsetTop);
      b.toggleAttribute('data-row-end', next === undefined || next.offsetTop !== b.offsetTop);
    });
  };
  /** Whether the pane has a corner for the free camera button: set by `fitFreeCamera`. */
  let freeCameraFits = true;
  const syncFreeCamera = (): void => {
    if (freeCamera === null) return;
    setHidden(freeCamera, view !== 'chase' || !freeCameraFits);
    // An open key list or aid legend of a short screen opens over the corner: the button steps aside but keeps its box, so the framing stays.
    freeCamera.toggleAttribute('data-covered', shortScreen && (keysOpen || aidOpen));
  };
  /**
   * The button stands over the pane's bottom edge, in the divider's reserve. Where the panels reach that
   * edge (a window too small for the divider) it has no corner, so it stays away; K still toggles.
   */
  const fitFreeCamera = (): void => {
    if (freeCamera === null) return;
    setHidden(freeCamera, view !== 'chase');
    if (freeCamera.hidden) return;
    const box = freeCamera.getBoundingClientRect();
    freeCameraFits = ![...root.querySelectorAll(CHROME_SELECTOR)].some((el) => {
      if (el === freeCamera) return false;
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.left < box.right &&
        box.left < r.right &&
        r.top < box.bottom &&
        box.top < r.bottom
      );
    });
    syncFreeCamera();
  };
  const syncToggles = (): void => {
    for (const b of viewButtons) b.setAttribute('aria-pressed', String(b.dataset['view'] === view));
    syncFreeCamera();
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
    for (const b of panelButtons) {
      const panel = b.dataset['panel'] as keyof CollapsedPanels;
      // The angle readouts show only with the angle display aid.
      b.disabled = panel === 'gauges' && !aids.pivots;
      b.setAttribute('aria-expanded', String(!b.disabled && !collapsed[panel]));
      if (b.disabled) b.title = t('panelGaugesNeedsAid');
      else b.removeAttribute('title');
    }
    const keysExpanded = shortScreen ? keysOpen : shortCockpit ? allKeys : !collapsed.keys;
    keysToggle.setAttribute('aria-expanded', String(keysExpanded));
    legend.toggleAttribute('data-overlay', shortScreen);
    legend.toggleAttribute(
      'data-collapsed',
      shortScreen ? !keysOpen : !shortCockpit && collapsed.keys,
    );
    legend.toggleAttribute('data-drive-only', !shortScreen && shortCockpit && !allKeys);
    topDown.toggleAttribute('data-short', shortScreen);
    setHidden(aidLegend, !aidOpen);
    legendToggle.setAttribute('aria-expanded', String(aidOpen));
    setHidden(briefToggle, !foldsBrief());
    briefToggle.setAttribute('aria-expanded', String(briefOpen));
    goal.toggleAttribute('data-collapsed', foldsBrief() && !briefOpen);
    setHidden(aidsBox, collapsed.aids);
    if (gaugeBox !== null) setHidden(gaugeBox, !aids.pivots || collapsed.gauges);
  };
  syncToggles();
  /** Runs before anything measures the panels: the brief's state is part of their height. */
  const syncShortScreen = (): void => {
    const now = root.clientHeight < SHORT_SCREEN;
    if (now === shortScreen) return;
    shortScreen = now;
    keysOpen = false;
    aidOpen = false;
    briefOpen = !briefDone;
    syncToggles();
  };
  /**
   * Landscape, the lever column stands at the screen's right edge, which the pane's right edge meets
   * under `data-reserve`: the toolbar stops short of it only where, unreserved, it would come within
   * `--space-3` of it.
   */
  const syncToolbarReserve = (): void => {
    topDown.removeAttribute('data-toolbar-reserve');
    if (!topDown.hasAttribute('data-reserve') || root.clientWidth < root.clientHeight) return;
    const lever = opts.pedalsBox?.();
    if (lever === undefined || lever.width === 0) return;
    const gap = parseFloat(getComputedStyle(root).getPropertyValue('--space-3')) || 12;
    const pane = topDown.getBoundingClientRect();
    const leverLeft = pane.right - (root.getBoundingClientRect().right - lever.left) - gap;
    // A short screen's open aid legend is an overlay: it must not move the reserve or the panels.
    const reaches = [
      ...toolbar.querySelectorAll(shortScreen ? '.hud-toggle' : '.hud-toggle, .hud-aid-legend'),
    ].some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.right > leverLeft && r.bottom > lever.top - gap;
    });
    topDown.toggleAttribute('data-toolbar-reserve', reaches);
  };
  /**
   * The open key list of a short screen stands in the top-down pane, which no mirror reaches; hud.css
   * keeps it clear of the lever and the finish button there. Offsets are from the legend's padding box.
   */
  const placeKeysList = (pane: Rect): void => {
    if (!shortScreen) return;
    const box = legend.getBoundingClientRect();
    if (box.width === 0) return;
    const stage = root.getBoundingClientRect();
    const left = box.left - stage.left + legend.clientLeft;
    const bottom = box.bottom - stage.top - legend.clientTop;
    keysList.style.setProperty('--pane-left', `${pane.x - left}px`);
    keysList.style.setProperty('--pane-bottom', `${bottom - pane.y - pane.height}px`);
    keysList.style.setProperty('--pane-width', `${pane.width}px`);
    keysList.style.setProperty('--pane-height', `${pane.height}px`);
    // The list grows up from the pane's bottom: it stops under the toolbar's lowest row.
    const rows = [...toolbar.querySelectorAll('.hud-group')].map((g) => g.getBoundingClientRect());
    const low = Math.max(...rows.filter((r) => r.width > 0).map((r) => r.bottom), 0);
    const gap = parseFloat(getComputedStyle(root).getPropertyValue('--space-2')) || 8;
    keysList.style.setProperty('--keys-top', `${low - stage.top - pane.y + gap}px`);
  };

  /** The aid legend of a short screen opens over the top view, below the aids chips (hud.css); the offset is from the pane's top. */
  const placeAidOverlay = (pane: Rect): void => {
    if (!shortScreen) return;
    const group = aidsBox.querySelector('.hud-group');
    if (group === null) return;
    const gap = parseFloat(getComputedStyle(root).getPropertyValue('--space-2')) || 8;
    const top = group.getBoundingClientRect().bottom - root.getBoundingClientRect().top - pane.y;
    aidLegend.style.setProperty('--aid-top', `${top + gap}px`);
  };

  const selectView = (mode: TopDownMode): void => {
    view = mode;
    if (mode !== 'chase') lastOther = mode;
    syncToggles();
    emit({ type: 'topDown', mode });
  };
  for (const b of allViewButtons) {
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
  legendToggle.addEventListener(
    'click',
    () => {
      aidOpen = !aidOpen;
      if (aidOpen && shortScreen) keysOpen = false;
      syncToggles();
      // A hidden list keeps its scroll; it opens at the top.
      if (aidOpen) aidLegend.scrollTop = 0;
      emit({ type: 'aidLegend' });
    },
    { signal },
  );
  keysToggle.addEventListener(
    'click',
    () => {
      if (shortScreen) {
        keysOpen = !keysOpen;
        if (keysOpen) aidOpen = false;
        syncToggles();
        // A hidden list keeps its scroll; it opens at the top.
        if (keysOpen) keysList.scrollTop = 0;
      } else if (shortCockpit) {
        allKeys = !allKeys;
        syncToggles();
      } else togglePanel('keys');
    },
    { signal },
  );
  briefToggle.addEventListener(
    'click',
    () => {
      briefOpen = !briefOpen;
      syncToggles();
      emit({ type: 'brief' });
    },
    { signal },
  );
  const resetView = query(hud, 'resetView', HTMLButtonElement);
  resetView.title = t('resetView');
  resetView.setAttribute('aria-label', t('resetView'));
  resetView.addEventListener('click', () => emit({ type: 'resetView' }), { signal });
  /** Another view switches to the outside view first, so the segments follow. */
  const toggleFree = (): void => {
    if (view !== 'chase') selectView('chase');
    emit({ type: 'freeCamera' });
  };
  if (freeCameraButton !== null) {
    const label = `${t('freeCamera')} (K)`;
    freeCameraButton.title = label;
    freeCameraButton.setAttribute('aria-label', label);
    freeCameraButton.addEventListener('click', toggleFree, { signal });
  }
  query(hud, 'action', HTMLElement).addEventListener('click', () => emit({ type: 'pause' }), {
    signal,
  });

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
        freeCamera !== null &&
        viewAction === 'freeCamera' &&
        !e.defaultPrevented &&
        !e.repeat &&
        !isFormField(e.target) &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        toggleFree();
        e.preventDefault();
      }
      if (
        mode !== undefined &&
        !mirrorsOnly &&
        (mode !== 'chase' || chaseOffered) &&
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
  if (gearEl) {
    gearEl.textContent = 'P';
    gearEl.dataset['gear'] = 'P';
  }
  let shownToast: MessageKey | null = null;
  /** A gear other than P has been selected: the start hint is done. */
  let started = false;
  const bumps = new Map<HTMLElement, number>();
  /** Flashes a counter that just grew; its CSS transition fades it back. */
  const bump = (el: HTMLElement): void => {
    clearTimeout(bumps.get(el));
    el.classList.add('bumped');
    bumps.set(
      el,
      window.setTimeout(() => {
        el.classList.remove('bumped');
        bumps.delete(el);
      }, BUMP_MS),
    );
  };
  let shownGoal = '';
  let shownGoalState = '';
  let shownDistance = '';
  let shownContacts = -1;
  let shownJackknifes = -1;
  let shownDirection = -1;
  let shownTime = '';

  let shownSign: SignId | null = null;
  let shownCue: SightCue | null = null;
  /** Marks `sign`'s slot and names it beside the bar. */
  const showSign = (sign: SignId | null): void => {
    shownSign = sign;
    if (signName !== null) signName.textContent = t(sign === null ? 'signNone' : SIGN_NAME[sign]);
    for (const slot of signSlots) {
      if (slot.dataset['sign'] === sign) slot.setAttribute('aria-current', 'true');
      else slot.removeAttribute('aria-current');
    }
  };
  showSign(null);

  const writeSpeed = (tenths: number): void => {
    shownTenths = tenths;
    if (speed) speed.textContent = `${formatNumber(tenths / 10, 1)} km/h`;
  };
  writeSpeed(0);

  let lastControl: SimSnapshot['control'] | null = null;
  /** On a short screen the first drive input collapses the brief, and any later change closes the open legend. */
  const onControl = (c: SimSnapshot['control']): void => {
    const changed =
      lastControl !== null &&
      (c.steer !== lastControl.steer ||
        c.lever !== lastControl.lever ||
        c.brake !== lastControl.brake ||
        c.gear !== lastControl.gear);
    lastControl = c;
    if (shortScreen && (keysOpen || aidOpen) && changed) {
      keysOpen = false;
      aidOpen = false;
      syncToggles();
    }
    if (briefDone || !isDrivingInput(c)) return;
    briefDone = true;
    if (foldsBrief() && briefOpen) {
      briefOpen = false;
      syncToggles();
      emit({ type: 'brief' });
    }
  };

  const legendBox = (): LegendBox | null => {
    const r = legend.getBoundingClientRect();
    if (r.width === 0) return null;
    const stage = root.getBoundingClientRect();
    return { right: r.right - stage.left, height: stage.bottom - r.top };
  };

  return {
    update(s, ahead = null) {
      onControl(s.control);
      const tenths = Math.round(Math.abs(s.speed) * MS_TO_KMH * 10);
      if (tenths !== shownTenths) writeSpeed(tenths);

      const gear = s.control.gear;
      if (gear !== 'P') started = true;
      if (gearEl && gear !== shownGear) {
        shownGear = gear;
        gearEl.textContent = gear;
        gearEl.dataset['gear'] = gear;
      }

      gauges?.coupling.set(s.couplingAngle);
      gauges?.turntable.set(s.turntableAngle);

      const warning = toastFor(s, ahead, started, driver);
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
        if (shownContacts >= 0 && s.contacts > shownContacts) bump(contactsEl);
        shownContacts = s.contacts;
        contactsEl.textContent = formatNumber(s.contacts, 0);
      }
      if (jackknifesEl && s.jackknifes !== shownJackknifes) {
        if (shownJackknifes >= 0 && s.jackknifes > shownJackknifes) bump(jackknifesEl);
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
      syncShortScreen();
      const spansRight = (r: Rect): boolean => r.x + r.width >= root.clientWidth - 1;
      setHidden(cockpit, c === null);
      if (c) {
        place(cockpit, c);
        const compact = c.width < (spansRight(c) ? COMPACT_WIDTH_WITH_LEVER : COMPACT_WIDTH);
        cockpit.toggleAttribute('data-compact', compact);
        // The compact legend already drops the view rows.
        const short = !compact && c.height < SHORT_HEIGHT;
        if (short !== shortCockpit) {
          shortCockpit = short;
          syncToggles();
        }
      }
      // a class IV mirror hangs from the arm of the class II mirror above it
      const hung = { wideLeft: views.mirrorLeft, wideRight: views.mirrorRight } as const;
      MIRROR_KEYS.forEach((key, i) => {
        const el = mirrors[i];
        const r = views[key];
        if (el === undefined) return;
        setHidden(el, !r);
        if (r) place(el, r);
        const above = key === 'wideLeft' || key === 'wideRight' ? hung[key] : null;
        if (r && above) {
          el.style.setProperty('--hud-above-gap', `${r.y - above.y - above.height}px`);
          el.style.setProperty('--hud-above-height', `${above.height}px`);
        }
      });
      const insets = readSafeInsets();
      if (c && sightBox !== null) {
        // in the cockpit element's frame
        const box = sightCueBox(c, insets);
        sightBox.style.left = `${box.x - c.x}px`;
        sightBox.style.top = `${box.y - c.y}px`;
      }
      const column = messageColumn(views, legendBox(), insets);
      toastWrap.style.left = `${column.x}px`;
      toastWrap.style.top = `${column.y}px`;
      toastWrap.style.width = `${column.width}px`;
      toastWrap.toggleAttribute('data-cue-yields', column.cueYields);
      if (hasTopDown(views)) {
        place(topDown, views.topDown);
        placeKeysList(views.topDown);
      }
      // The finish/menu button sits at the screen's top-right corner, below the display cut-out.
      toastWrap.toggleAttribute(
        'data-reserve',
        column.y < insets.top + 1 && column.x + column.width >= root.clientWidth - insets.right - 1,
      );
      topDown.toggleAttribute('data-reserve', spansRight(views.topDown));
      if (hasTopDown(views)) syncToolbarReserve();
      hasCockpit = c !== null;
      syncSplitHidden();
      // After the reserves, which narrow the toolbar.
      if (hasTopDown(views)) {
        syncSegmentRows();
        placeAidOverlay(views.topDown);
      }
      if (paneTools !== null && hasTopDown(views)) {
        const td = views.topDown;
        paneTools.style.left = `${td.x}px`;
        paneTools.style.top = `${td.y}px`;
        paneTools.style.width = `${td.width}px`;
        paneTools.style.height = `${td.height}px`;
        fitFreeCamera();
      }
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
      syncShortScreen();
      const previous = topDown.style.width;
      const reserved = topDown.hasAttribute('data-toolbar-reserve');
      topDown.style.width = `${paneWidth}px`;
      syncToolbarReserve();
      const top = topDown.getBoundingClientRect().top;
      let bottom = top;
      for (const child of topDown.children) {
        if (child instanceof HTMLElement && !child.hidden) {
          bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
        }
      }
      // A counter row that cannot wrap narrower overflows into the lever column instead of growing taller.
      const infoStyle = getComputedStyle(infoRow);
      const infoRight =
        infoRow.getBoundingClientRect().right - (parseFloat(infoStyle.paddingRight) || 0);
      const overflows = [...infoRow.children].some(
        (el) => el.getBoundingClientRect().right > infoRight + 0.5,
      );
      topDown.style.width = previous;
      topDown.toggleAttribute('data-toolbar-reserve', reserved);
      return overflows ? Infinity : bottom - top;
    },
    legendBox,
    onLegendResize(cb) {
      const observer = new ResizeObserver(cb);
      observer.observe(legend);
      abort.signal.addEventListener('abort', () => observer.disconnect());
    },
    setViewChanged(changed) {
      if (resetView.disabled === changed) resetView.disabled = !changed;
    },
    setFree(on) {
      freeCameraButton?.setAttribute('aria-pressed', String(on));
    },
    setOffers(next) {
      chaseOffered = next.chase;
      syncChaseOffer();
      hud.toggleAttribute('data-interior', next.interior);
      keysList.innerHTML = keyRows(next.chase, next.look, mirrorsOnly, role);
      applyMessages(keysList);
      if (!chaseOffered && view === 'chase') selectView(lastOther);
      else syncToggles();
    },
    setTargetArrow(next) {
      if (arrow === null) return;
      setHidden(arrow, next === null);
      if (next === null) return;
      const x = Math.round(next.x);
      const y = Math.round(next.y);
      const deg = Math.round((next.angle * 180) / Math.PI);
      arrow.style.transform = `translate(${x}px, ${y}px) rotate(${deg}deg)`;
    },
    setGoal(cue) {
      if (cue.state === 'away') {
        if (shownGoalState === 'away') return;
        shownGoalState = 'away';
        setHidden(goalCue, true);
        return;
      }
      const { state, distance } = goalCueTexts(cue);
      // Only the state span is announced; rewriting it per frame would read the cue out continuously.
      if (state !== shownGoal) {
        shownGoal = state;
        goalState.textContent = state;
      }
      if (distance !== shownDistance) {
        shownDistance = distance;
        goalDistance.textContent = distance;
      }
      if (cue.state !== shownGoalState) {
        shownGoalState = cue.state;
        goalCue.dataset['goal'] = cue.state;
      }
      setHidden(goalCue, false);
    },
    setEinweiser(state) {
      if (signName === null) return;
      const sign = state?.sign ?? null;
      if (sign !== shownSign) showSign(sign);
      const cue = state === null ? null : sightCue(state.sight, state.unclear);
      if (cue === shownCue || sightBox === null || sightText === null) return;
      shownCue = cue;
      setHidden(sightBox, cue === null);
      if (cue === null) return;
      sightText.textContent = t(SIGHT_CUE_KEY[cue]);
      sightBox.dataset['sight'] = cue === 'none' || cue === 'unclear' ? cue : 'seen';
    },
    onAction(cb) {
      listeners.push(cb);
    },
    dispose() {
      if (drag?.frame != null) cancelAnimationFrame(drag.frame);
      for (const timer of bumps.values()) clearTimeout(timer);
      abort.abort();
      hud.remove();
    },
  };
}
