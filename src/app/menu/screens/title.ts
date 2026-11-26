import type { InputLog } from '../../../contracts/exercise';
import type { MessageKey } from '../../../i18n/en';
import { t } from '../../../i18n/i18n';
import { offlineStatus, onOfflineStatus } from '../../../pwa/offline-status';
import { buildLabel } from '../../build-info';
import { CHANNEL } from '../../channel';
import { replayContext } from '../../exercise-text';
import {
  holds,
  screenOf,
  shownItems,
  type ActionId,
  type ConditionId,
  type Item,
  type MenuState,
} from '../graph';
import { titleArt } from '../title-art';
import { element } from './frame';

export type TitleContext = {
  readonly state: MenuState;
  /** Null when there is no run to replay. */
  readonly replay: InputLog | null;
  /** Settles true when What's new has entries the trainee has not seen; a rejection shows no badge. */
  readonly hasNews: () => Promise<boolean>;
  readonly activate: (item: Item) => void;
};

const BADGE: Readonly<Partial<Record<ConditionId, MessageKey>>> = { hasNews: 'whatsNewBadge' };

/** The replay entry's detail line; a night run says so, as it replays at night whatever the settings say. */
function replayLabel(log: InputLog): string {
  const notes = [
    ...(log.lighting === 'night' ? [t('lightingNight')] : []),
    ...(log.mirrorsOnly ? [t('driveViewMirrors')] : []),
  ];
  return [replayContext(log), ...notes].join(' · ');
}

/** The detail line under an action's label. */
const DETAIL: Readonly<Record<ActionId, (ctx: TitleContext) => string | null>> = {
  replayLast: ({ replay }) => (replay === null ? null : replayLabel(replay)),
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
    const line = 'action' in item.target ? DETAIL[item.target.action](ctx) : null;
    if (line !== null) button.append(element('span', 'menu-item-detail', line));
    if (item.tier === 'main') {
      const chevron = element('span', 'menu-item-chevron', '›');
      chevron.setAttribute('aria-hidden', 'true');
      button.append(chevron);
    }
    button.addEventListener('click', () => ctx.activate(item));
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
      status === 'ready' ? t('offlineReady') : status === 'failed' ? t('offlineSetupFailed') : '';
  };
  paintOffline();
  const stopOffline = onOfflineStatus(paintOffline);

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
    },
  };
}
