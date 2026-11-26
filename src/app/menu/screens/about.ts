import { t } from '../../../i18n/i18n';
import { ABOUT_CREDITS } from '../../about-credits';
import type { AssetCredit, LicenceText, ThirdParty } from '../../about-credits-types';
import { buildLabel } from '../../build-info';
import { element } from './frame';
import './about.css';

const SOURCE = 'https://github.com/DocGerd/gegenlenker';

function externalLink(href: string, text: string): HTMLAnchorElement {
  const link = element('a', 'about-link', text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

/** The licence text is English only, whatever the UI language. */
function licenceDetails(summary: string, { text }: LicenceText): HTMLDetailsElement {
  const details = element('details', 'about-licence');
  details.lang = 'en';
  const pre = element('pre', 'about-text mono', text);
  details.append(element('summary', 'about-summary', summary), pre);
  return details;
}

/** Bundled packages share their covering entry's licence text. */
function packages({ covers, bundled }: ThirdParty): string | null {
  if (covers.length === 0) return null;
  const list = covers.join(', ');
  return bundled.length === 0
    ? list
    : `${list} (${t('aboutIncludes').replace('{packages}', bundled.join(', '))})`;
}

function thirdPartyItem(entry: ThirdParty): HTMLLIElement {
  const item = element('li', 'about-entry');
  item.dataset['about'] = 'thirdParty';
  const covered = packages(entry);
  if (covered !== null) item.append(element('p', 'about-meta mono', covered));
  item.append(licenceDetails(`${entry.name} · ${entry.spdx}`, entry));
  return item;
}

function assetItem({ title, licence, authors, page }: AssetCredit): HTMLLIElement {
  const item = element('li', 'about-entry');
  item.dataset['about'] = 'asset';
  const heading = element('p', 'about-asset-title');
  heading.append(externalLink(page, title.replaceAll('`', '')));
  item.append(heading, element('p', 'about-meta', `${licence} · ${authors}`));
  return item;
}

function section(title: string, ...content: HTMLElement[]): HTMLElement {
  const el = element('section', 'about-section');
  el.append(element('h2', 'about-heading', title), ...content);
  return el;
}

function list(...items: HTMLLIElement[]): HTMLUListElement {
  const ul = element('ul', 'about-list');
  ul.append(...items);
  return ul;
}

/** Appends the build, the copyright and source link, and the bundled licence and credit texts. */
export function render(body: HTMLElement): void {
  const source = externalLink(SOURCE, t('aboutSource'));
  const arrow = element('span', '', ' ↗');
  arrow.setAttribute('aria-hidden', 'true');
  source.append(arrow);
  const copyright = element('p', 'about-meta', '© 2026 Patrick Kuhn · ');
  copyright.append(source);

  const lead = element('header', 'about-lead');
  lead.append(
    element('p', 'about-build', `${t('appName')} · ${buildLabel()}`),
    element('p', 'about-meta', t('tagline')),
    copyright,
  );

  body.append(
    lead,
    section(
      t('aboutLicense'),
      licenceDetails(`${ABOUT_CREDITS.app.name} · ${ABOUT_CREDITS.app.spdx}`, ABOUT_CREDITS.app),
    ),
    section(t('aboutThirdParty'), list(...ABOUT_CREDITS.thirdParty.map(thirdPartyItem))),
    section(t('aboutAssets'), list(...ABOUT_CREDITS.assets.map(assetItem))),
  );
}
