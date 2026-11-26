import { describe, expect, it } from 'vitest';
import { EXERCISE_IDS } from '../../contracts/exercise';
import { LAYOUT_IDS } from '../../contracts/layout';
import { loadSettings } from '../settings';
import { entriesOf, SETUP_STEPS } from './catalogue';
import { GRAPH, screenOf, shownItems, type MenuState, type ScreenId } from './graph';
import { OPTION_FIELDS, optionPatch, optionValue, PAUSE_FIELDS, type OptionId } from './options';

const OPTION_IDS = Object.keys(OPTION_FIELDS) as OptionId[];

describe('menu catalogue', () => {
  it('the catalogue lists the exercises in curriculum order, then the yards', () => {
    expect(entriesOf('driver', 'exercise').map((e) => e.ref.id)).toEqual(EXERCISE_IDS);
    expect(entriesOf('driver', 'yard').map((e) => e.ref.id)).toEqual(LAYOUT_IDS);
  });

  it('every setup step names run fields', () => {
    for (const fields of Object.values(SETUP_STEPS)) {
      for (const id of fields) expect(OPTION_FIELDS[id].group).toBe('run');
    }
  });
});

describe('menu options', () => {
  it('every option offers at least two values, and each round-trips', () => {
    const settings = loadSettings(null, 'en');
    for (const id of OPTION_IDS) {
      const { choices } = OPTION_FIELDS[id];
      expect(choices.length).toBeGreaterThanOrEqual(2);
      for (const { value } of choices) {
        const patch = optionPatch(id, value);
        expect(patch).not.toBeNull();
        expect(optionValue({ ...settings, ...patch }, id)).toBe(value);
      }
      expect(optionPatch(id, 'nonsense')).toBeNull();
    }
  });

  it('options apply where the spec says', () => {
    expect(Object.fromEntries(OPTION_IDS.map((id) => [id, OPTION_FIELDS[id].applies]))).toEqual({
      truck: 'run',
      trailer: 'run',
      lighting: 'run',
      driveView: 'run',
      language: 'menuOnly',
      theme: 'live',
      graphics: 'nextStart',
      wideMirrors: 'live',
    });
  });

  it('the pause sheet offers exactly the options a running drive applies', () => {
    expect(PAUSE_FIELDS).toEqual(['theme', 'wideMirrors', 'graphics']);
    const applied = OPTION_IDS.filter((id) =>
      ['live', 'nextStart'].includes(OPTION_FIELDS[id].applies),
    );
    expect(new Set(PAUSE_FIELDS)).toEqual(new Set(applied));
  });
});

describe('menu graph', () => {
  const ids = new Set(GRAPH.map((s) => s.id));

  it('every item target is a screen in the graph', () => {
    for (const screen of GRAPH) {
      for (const { target } of screen.items) {
        if ('screen' in target) expect(ids).toContain(target.screen);
      }
    }
  });

  it('every screen in the graph is reachable from the title', () => {
    const reached = new Set<ScreenId>();
    const visit = (id: ScreenId): void => {
      if (reached.has(id)) return;
      reached.add(id);
      const screen = screenOf(id);
      for (const { target } of screen.items) if ('screen' in target) visit(target.screen);
      if (screen.kind === 'entries') visit('setup');
    };
    visit('title');
    expect([...reached].sort()).toEqual([...ids].sort());
  });

  it('the graph survives a JSON round trip', () => {
    expect(JSON.parse(JSON.stringify(GRAPH))).toEqual(GRAPH);
  });

  it('shownItems hides replay without a replayable run', () => {
    const state: MenuState = { done: [], replayable: false, hasNews: false, lastEntry: null };
    const title = screenOf('title');
    expect(shownItems(title, state).map((i) => i.id)).not.toContain('replay');
    expect(shownItems(title, { ...state, replayable: true }).map((i) => i.id)).toContain('replay');
  });
});
