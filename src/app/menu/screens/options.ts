import { t } from '../../../i18n/i18n';
import { choiceRow } from '../choice-row';
import type { Item, Screen } from '../graph';
import { applyOption, OPTION_FIELDS, optionValue, type OptionId } from '../options';
import { currentSettings } from '../../settings';
import { element, rowItem, screenFrame } from './frame';

export type OptionsContext = {
  readonly screen: Screen;
  readonly heading: string;
  readonly back: () => void;
  readonly activate: (item: Item) => void;
  /** The change needs this screen drawn again, in place; focus returns to the row `id`. */
  readonly redraw: (id: OptionId) => void;
};

/** Each group's heading and choice rows, then the screen's own items; a change applies and is stored at once. */
export function optionsScreen(ctx: OptionsContext): {
  readonly root: HTMLElement;
  readonly focus: (remembered: string | null) => void;
} {
  const frame = screenFrame(ctx.screen.id, ctx.heading, ctx.back);
  const settings = currentSettings();
  const body = element('div', 'menu-settings');

  ctx.screen.groups?.forEach((group, index) => {
    const section = element('section', 'menu-settings-group');
    const heading = element('h2', 'menu-settings-heading', t(group.label));
    heading.id = `settings-group-${index}`;
    section.setAttribute('aria-labelledby', heading.id);
    section.append(
      heading,
      ...group.fields.map((id) =>
        choiceRow(OPTION_FIELDS[id], optionValue(settings, id), (value) => {
          if (applyOption(id, value) && id === 'language') ctx.redraw(id);
        }),
      ),
    );
    body.append(section);
  });

  if (ctx.screen.items.length > 0) {
    const rows = element('ul', 'menu-rows');
    rows.append(
      ...ctx.screen.items.map((item) => {
        const { item: li, button } = rowItem(() => {
          ctx.activate(item);
        });
        button.dataset['menu'] = item.id;
        button.append(element('span', 'menu-row-title', t(item.label)));
        return li;
      }),
    );
    body.append(rows);
  }
  frame.body.append(body);

  const checked = (row: Element | null): HTMLElement | null =>
    row?.querySelector<HTMLElement>('input:checked') ?? null;
  return {
    root: frame.root,
    focus: (remembered) => {
      const named =
        remembered === null
          ? null
          : body.querySelector<HTMLElement>(`[data-menu="${CSS.escape(remembered)}"]`);
      const target =
        named instanceof HTMLFieldSetElement
          ? checked(named)
          : (named ?? checked(body.querySelector('fieldset')));
      target?.focus();
    },
  };
}
