import { entryKey, entryOf, type EntryKind, type EntryRef, type Role } from './catalogue';
import { screenOf, type ScreenId } from './graph';

export type Level = {
  readonly screen: ScreenId;
  /** The entry being set up, and its step. */
  readonly entry?: EntryRef;
  readonly step?: number;
  /** The item or row to focus when this level is shown again. */
  readonly focus: string | null;
};

/** `stack[0]` is the title. */
export type NavState = { readonly stack: readonly Level[] };

export type NavEvent =
  | { readonly type: 'open'; readonly item: string }
  | { readonly type: 'pick'; readonly entry: EntryRef }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'home' };

export const TITLE: NavState = { stack: [{ screen: 'title', focus: null }] };

export const topOf = (state: NavState): Level => {
  const top = state.stack.at(-1);
  if (top === undefined) throw new Error('The navigation stack is empty');
  return top;
};

export const holdsEntry = (state: NavState): boolean => topOf(state).screen !== 'title';

const withTop = (state: NavState, top: Level): NavState => ({
  stack: [...state.stack.slice(0, -1), top],
});

const push = (state: NavState, from: Level, next: Level): NavState => ({
  stack: [...state.stack.slice(0, -1), from, next],
});

const listKey = (of: { role: Role; kind: EntryKind }): string => `${of.role}:${of.kind}`;

const listsEntry = (screen: ScreenId, entry: EntryRef): boolean => {
  const { list } = screenOf(screen);
  return list !== undefined && listKey(list) === listKey(entry);
};

const defaultSteps = (entry: EntryRef): number => entryOf(entry).steps.length;

export function navigate(
  state: NavState,
  event: NavEvent,
  steps: (entry: EntryRef) => number = defaultSteps,
): NavState {
  const top = topOf(state);
  switch (event.type) {
    case 'open': {
      const item = screenOf(top.screen).items.find((i) => i.id === event.item);
      if (item === undefined || !('screen' in item.target)) return state;
      return push(state, { ...top, focus: item.id }, { screen: item.target.screen, focus: null });
    }
    case 'pick':
      if (!listsEntry(top.screen, event.entry)) return state;
      return push(
        state,
        { ...top, focus: entryKey(event.entry) },
        { screen: 'setup', entry: event.entry, step: 0, focus: null },
      );
    case 'next': {
      if (top.screen !== 'setup' || top.entry === undefined) return state;
      const step = top.step ?? 0;
      return step + 1 < steps(top.entry) ? withTop(state, { ...top, step: step + 1 }) : state;
    }
    case 'back':
      if ((top.step ?? 0) > 0) return withTop(state, { ...top, step: (top.step ?? 0) - 1 });
      return state.stack.length > 1 ? { stack: state.stack.slice(0, -1) } : state;
    case 'home':
      return state.stack.length > 1 ? { stack: state.stack.slice(0, 1) } : state;
  }
}
