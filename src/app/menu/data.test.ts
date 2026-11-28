import { describe, expect, it } from 'vitest';
import { EXERCISE_IDS, ROLES } from '../../contracts/exercise';
import { LAYOUT_IDS } from '../../contracts/layout';
import { TRAILER_IDS } from '../../contracts/vehicle';
import { loadSettings } from '../settings';
import { entriesOf, nextExercise, offeredRoles, runConfigOf, SETUP_STEPS } from './catalogue';
import { CONTENT } from './content';
import { GRAPH, screenOf, shownItems, type MenuState, type ScreenId } from './graph';
import {
  OPTION_FIELDS,
  optionPatch,
  optionValue,
  pauseFields,
  roleField,
  type OptionId,
} from './options';

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

  it('either role takes the truck solo, and a trailer again once one is picked', () => {
    const solo = { ...loadSettings(null, 'en'), ...optionPatch('trailer', 'none') };
    const yard = { kind: 'yard', id: 'depot' } as const;
    const last = TRAILER_IDS[1];
    const paired = { ...solo, ...optionPatch('trailer', last) };
    for (const role of ROLES) {
      expect(roleField('trailer', role).choices.map((c) => c.value)).toContain('none');
      expect(runConfigOf({ ...yard, role }, solo).trailerId).toBeNull();
      expect(runConfigOf({ ...yard, role }, paired).trailerId).toBe(last);
    }
  });

  it('drives the coupling exercise with the kept trailer, solo or not, and never as the Einweiser', () => {
    const solo = { ...loadSettings(null, 'en'), ...optionPatch('trailer', 'none') };
    const coupling = { role: 'driver', kind: 'exercise', id: 'coupling' } as const;
    expect(runConfigOf(coupling, solo).trailerId).toBe(solo.trailerId);
    expect(offeredRoles(coupling)).toEqual(['driver']);
    expect(entriesOf('einweiser', 'exercise').map((e) => e.ref.id)).not.toContain('coupling');
    expect(nextExercise({ ...coupling, id: 'reverse-corner' })).toEqual(coupling);
    expect(nextExercise({ role: 'einweiser', kind: 'exercise', id: 'reverse-corner' })).toEqual({
      role: 'einweiser',
      kind: 'exercise',
      id: 'dock-ramp',
    });
    expect(nextExercise({ ...coupling, id: 'slalom' })).toBeNull();
  });

  it('options apply where the spec says', () => {
    expect(Object.fromEntries(OPTION_IDS.map((id) => [id, OPTION_FIELDS[id].applies]))).toEqual({
      truck: 'run',
      trailer: 'run',
      lighting: 'run',
      driveView: 'run',
      language: 'menuOnly',
      theme: 'live',
      graphics: 'live',
      wideMirrors: 'live',
      fov: 'live',
      mouseSensitivity: 'live',
      invertMouse: 'live',
    });
  });

  it('the Settings screen lists the Einweiser options only in a group behind the preview', () => {
    const groups = screenOf('settings').groups ?? [];
    for (const id of OPTION_IDS) {
      const behind = groups.some((g) => g.einweiser === true && g.fields.includes(id));
      expect(behind, id).toBe(OPTION_FIELDS[id].group === 'einweiser');
    }
  });

  it('the pause sheet offers exactly the options a running drive applies', () => {
    const live = (group: 'einweiser' | 'other'): OptionId[] =>
      OPTION_IDS.filter(
        (id) =>
          OPTION_FIELDS[id].applies === 'live' &&
          (OPTION_FIELDS[id].group === 'einweiser') === (group === 'einweiser'),
      );
    // the driver's list is what it was before the Einweiser's options
    expect(pauseFields('driver')).toEqual(['theme', 'wideMirrors', 'graphics']);
    expect(new Set(pauseFields('driver'))).toEqual(new Set(live('other')));
    // no mirrors to widen, but the look settings
    expect(new Set(pauseFields('einweiser'))).toEqual(
      new Set([...live('einweiser'), ...live('other').filter((id) => id !== 'wideMirrors')]),
    );
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

  it('the lazy screens are exactly the ones with a content loader', () => {
    const lazy = GRAPH.filter((s) => s.lazy).map((s) => s.id);
    expect(lazy.sort()).toEqual(Object.keys(CONTENT).sort());
    expect(
      GRAPH.filter((s) => s.kind === 'content')
        .map((s) => s.id)
        .sort(),
    ).toEqual(lazy);
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
