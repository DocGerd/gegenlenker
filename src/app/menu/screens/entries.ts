import type { ExerciseId } from '../../../contracts/exercise';
import { t } from '../../../i18n/i18n';
import { entriesOf, entryKey, type EntryRef } from '../catalogue';
import type { Screen } from '../graph';
import { element, screenFrame } from './frame';

export type EntriesContext = {
  readonly screen: Screen;
  readonly heading: string;
  readonly done: readonly ExerciseId[];
  readonly back: () => void;
  readonly pick: (entry: EntryRef) => void;
};

/** One row per catalogue entry of the screen's list: exercises numbered with their done marker, yards plain. */
export function entriesScreen(ctx: EntriesContext): {
  readonly root: HTMLElement;
  readonly focus: (remembered: string | null) => void;
} {
  const { list } = ctx.screen;
  if (list === undefined) throw new Error(`Screen ${ctx.screen.id} has no list`);
  const frame = screenFrame(ctx.screen.id, ctx.heading, ctx.back);
  const entries = entriesOf(list.role, list.kind);
  const isDone = (ref: EntryRef): boolean => ref.kind === 'exercise' && ctx.done.includes(ref.id);

  const rows = element(list.kind === 'exercise' ? 'ol' : 'ul', 'menu-rows');
  rows.append(
    ...entries.map(({ ref, title, brief }, index) => {
      const button = element('button', 'menu-item menu-row');
      button.type = 'button';
      button.dataset['entry'] = entryKey(ref);
      if (ref.kind === 'exercise') {
        const number = element('span', 'menu-row-num', `${index + 1}`);
        number.setAttribute('aria-hidden', 'true');
        button.append(number);
      }
      button.append(element('span', 'menu-row-title', t(title)));
      if (isDone(ref)) button.append(element('span', 'menu-done', `✓ ${t('exerciseDone')}`));
      button.append(element('span', 'menu-row-brief', t(brief)));
      button.addEventListener('click', () => ctx.pick(ref));
      const item = document.createElement('li');
      item.append(button);
      return item;
    }),
  );
  frame.body.append(rows);

  const row = (key: string): HTMLElement | null =>
    rows.querySelector<HTMLElement>(`[data-entry="${key}"]`);
  const fresh = entries.find((e) => !isDone(e.ref)) ?? entries[0];
  return {
    root: frame.root,
    focus: (remembered) => {
      const target =
        (remembered === null ? null : row(remembered)) ??
        (fresh === undefined ? null : row(entryKey(fresh.ref)));
      target?.focus();
    },
  };
}
