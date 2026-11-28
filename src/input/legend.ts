import type { SignallingMode } from '../contracts/einweiser';
import type { Role } from '../contracts/exercise';
import type { MessageKey } from '../i18n/en';
import { legendRows, type LegendRow } from './keymap';

/** Legend rows for the top-down view, which a mirror-only drive does not have. */
const TOP_DOWN_ROWS: readonly MessageKey[] = [
  'viewSwitch',
  'viewSwitchNoOutside',
  'zoom',
  'panView',
  'orbitTilt',
  'resetViewAndSize',
];

/** The key legend of a drive: `chase` is whether the outside view exists, `look` whether the cockpit view looks around; `role` is the driver's when absent. */
export const driveLegendRows = (opts: {
  readonly chase: boolean;
  readonly look: boolean;
  readonly mirrorsOnly: boolean;
  readonly role?: Role;
  /** The exercise couples: lists the uncouple key. */
  readonly coupling?: boolean;
  /** The Einweiser's sign keys; tail direction when absent. */
  readonly signalling?: SignallingMode;
}): LegendRow[] =>
  legendRows(opts.chase, opts.look, opts.role, opts.coupling, opts.signalling).filter(
    (row) => !(opts.mirrorsOnly && TOP_DOWN_ROWS.includes(row.desc)),
  );

/** One `<dt>`/`<dd>` pair; a translated term and the description carry `data-i18n`, a literal term is text. */
export const legendRowMarkup = ({ term, desc, viewOnly }: LegendRow): string => {
  const cls = viewOnly ? 'mono hud-legend-view' : 'mono';
  const dt =
    typeof term === 'string'
      ? `<dt class="${cls}">${term}</dt>`
      : `<dt class="${cls}" data-i18n="${term.key}"></dt>`;
  return `${dt}<dd${viewOnly ? ' class="hud-legend-view"' : ''} data-i18n="${desc}"></dd>`;
};
