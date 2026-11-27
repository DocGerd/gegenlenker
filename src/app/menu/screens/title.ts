import type { InputLog, Role } from '../../../contracts/exercise';
import type { MessageKey } from '../../../i18n/en';
import { t } from '../../../i18n/i18n';
import { claimStatusDisplay, offlineStatus, onOfflineStatus } from '../../../pwa/offline-status';
import { buildLabel } from '../../build-info';
import { CHANNEL } from '../../channel';
import { replayContext } from '../../exercise-text';
import { currentSettings } from '../../settings';
import { entryHeading } from '../catalogue';
import { continueEntry } from '../continue';
import {
  holds,
  screenOf,
  shownItems,
  type ActionId,
  type ConditionId,
  type Item,
  type MenuState,
} from '../graph';
import { labelOf, optionValue, roleField, type OptionId } from '../options';
import { titleArt } from '../title-art';
import { element, markUnavailable, noGraphicsNote } from './frame';

export type TitleContext = {
  readonly state: MenuState;
  /** Null when there is no run to replay. */
  readonly replay: InputLog | null;
  /** Settles true when What's new has entries the trainee has not seen; a rejection shows no badge. */
  readonly hasNews: () => Promise<boolean>;
  /** `button` is the control that was activated, for actions that go busy. */
  readonly activate: (item: Item, button: HTMLButtonElement) => void;
  /** No graphics backend: the notice shows and what starts a run is disabled. */
  readonly graphicsMissing: boolean;
};

const BADGE: Readonly<Partial<Record<ConditionId, MessageKey>>> = { hasNews: 'whatsNewBadge' };

/** The replay entry's detail line; a night run says so, as it replays at night whatever the settings say. */
function replayLabel(log: InputLog): string {
  const notes = [
    // an exercise title already says Guide…/…einweisen: only a yard needs the role
    ...(log.role === 'einweiser' && log.exerciseId === null ? [t('roleEinweiser')] : []),
    ...(log.lighting === 'night' ? [t('lightingNight')] : []),
    ...(log.mirrorsOnly
      ? [t(log.role === 'einweiser' ? 'einweiserViewNoTop' : 'driveViewMirrors')]
      : []),
  ];
  return [replayContext(log), ...notes].join(' · ');
}

/** The chosen value's name as the setup screen shows it to `role`, without the field name. */
function valueLabel(id: OptionId, role: Role = 'driver'): string {
  const value = optionValue(currentSettings(), id, role);
  const choice = roleField(id, role).choices.find((c) => c.value === value);
  return choice === undefined ? '' : labelOf(choice);
}

/** What Continue starts and the setup it starts with: all four values, defaults included, and an Einweiser's role. */
function continueLines({ state }: TitleContext): readonly string[] {
  const entry = continueEntry(state.lastEntry, state.done);
  if (entry === null) return [];
  const role = entry.role === 'einweiser' && entry.kind === 'yard' ? [t('roleEinweiser')] : [];
  return [
    entryHeading(entry),
    `${valueLabel('truck')} · ${valueLabel('trailer', entry.role)}`,
    [...role, valueLabel('lighting'), valueLabel('driveView', entry.role)].join(' · '),
  ];
}

/** The detail lines under an action's label. */
const DETAIL: Readonly<Record<ActionId, (ctx: TitleContext) => readonly string[]>> = {
  replayLast: ({ replay }) => (replay === null ? [] : [replayLabel(replay)]),
  continue: continueLines,
};

export function titleScreen(ctx: TitleContext): {
  readonly root: HTMLElement;
  readonly focus: (remembered: string | null) => void;
  readonly close: () => void;
} {
  const screen = screenOf('title');
  const items = shownItems(screen, ctx.state);
  const primary = items.filter((i) => i.tier === 'primary');
  const lead = primary.length > 0 ? null : items.find((i) => i.tier === 'main');
  const badges: { readonly when: ConditionId; readonly el: HTMLElement }[] = [];

  const itemButton = (item: Item): HTMLLIElement => {
    const tier = item === lead ? 'primary' : item.tier;
    const button = element('button', `menu-item menu-item-${tier}`);
    button.type = 'button';
    button.dataset['menu'] = item.id;
    if (ctx.graphicsMissing && 'action' in item.target) markUnavailable(button);
    const label = element('span', 'menu-item-label', t(item.label));
    button.append(label);
    if (item.badgeWhen !== undefined) {
      const text = BADGE[item.badgeWhen];
      if (text !== undefined) {
        const badge = element('span', 'menu-badge', t(text));
        badge.dataset['menu'] = `${item.id}Badge`;
        badge.hidden = true;
        label.append(badge);
        badges.push({ when: item.badgeWhen, el: badge });
      }
    }
    const lines = 'action' in item.target ? DETAIL[item.target.action](ctx) : [];
    for (const line of lines) button.append(element('span', 'menu-item-detail', line));
    if (item.tier === 'main') {
      const chevron = element('span', 'menu-item-chevron', '›');
      chevron.setAttribute('aria-hidden', 'true');
      button.append(chevron);
    }
    button.addEventListener('click', () => {
      ctx.activate(item, button);
    });
    const li = element('li', 'menu-items-entry');
    li.append(button);
    return li;
  };
  const list = (className: string, tier: Item['tier']): HTMLUListElement | null => {
    const tiered = items.filter((i) => i.tier === tier);
    if (tiered.length === 0) return null;
    const ul = element('ul', className);
    ul.append(...tiered.map(itemButton));
    return ul;
  };

  const root = element('main', 'menu-screen menu-title-screen');
  root.dataset['screen'] = 'title';
  const scroll = element('div', 'menu-screen-scroll');
  const layout = element('div', 'menu-title-layout');

  const header = element('header', 'menu-title-header');
  header.append(
    element('h1', 'menu-title', t('appName')),
    element('p', 'menu-tagline', t('tagline')),
  );
  if (ctx.graphicsMissing) header.append(noGraphicsNote());

  const nav = element('nav', 'menu-nav');
  nav.setAttribute('aria-label', t('menu'));
  const lists = [
    list('menu-items menu-session', 'primary'),
    list('menu-items menu-main', 'main'),
    list('menu-secondary', 'secondary'),
  ];
  nav.append(...lists.filter((l) => l !== null));

  const art = element('div', 'menu-art');
  art.append(titleArt());

  const footer = element('footer', 'menu-footer');
  const build = element('span', 'mono', buildLabel());
  build.dataset['menu'] = 'build';
  footer.append(build);
  if (CHANNEL === 'uat') {
    const channel = element('span', 'menu-badge', t('channelUat'));
    channel.dataset['menu'] = 'channel';
    footer.append(channel);
  }
  const offline = element('span', 'menu-offline');
  offline.dataset['menu'] = 'offline';
  offline.setAttribute('role', 'status');
  footer.append(offline);

  layout.append(header, art, nav, footer);
  scroll.append(layout);
  root.append(scroll);

  const paintOffline = (): void => {
    const status = offlineStatus();
    offline.textContent =
      status === 'ready'
        ? t('offlineReady')
        : status === 'incomplete'
          ? t('offlineIncomplete')
          : status === 'failed'
            ? t('offlineSetupFailed')
            : '';
  };
  paintOffline();
  const stopOffline = onOfflineStatus(paintOffline);
  const releaseStatus = claimStatusDisplay();

  let open = true;
  ctx
    .hasNews()
    .then((hasNews) => {
      if (!open) return;
      const state = { ...ctx.state, hasNews };
      for (const { when, el } of badges) el.hidden = !holds(when, state);
    })
    .catch(() => undefined);

  const button = (id: string): HTMLElement | null =>
    root.querySelector<HTMLElement>(`.menu-item[data-menu="${id}"]`);
  return {
    root,
    focus: (remembered) => {
      const ids = [...(remembered === null ? [] : [remembered]), ...(screen.focus ?? [])];
      const target = ids.map(button).find((b) => b !== null) ?? button(items[0]?.id ?? '');
      target?.focus();
    },
    close: () => {
      open = false;
      stopOffline();
      releaseStatus();
    },
  };
}
