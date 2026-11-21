import { Mesh, type MeshBasicMaterial, type Object3D, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import type { LampSwitches, ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { trailerLamps, truckLamps } from './lamp-layout';
import { FLASH_PERIOD } from './lamp-state';
import { lookFor } from './look';
import { GLOW, glowCentre, markerGlowGeometry } from './marker-glow';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { PERSPECTIVE_LAYER, type VehicleVisual } from './seams';
import { GLOW_NAME, proceduralTrailer, proceduralTruck } from './vehicle-visual';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const env = {
  attach: () => undefined,
  texture: () => new Texture(),
  onChange: () => () => undefined,
  reportApplied: () => undefined,
  setSky: () => undefined,
  dispose: () => undefined,
};

const snapshot = () =>
  createSimulation(
    resolveCombination(truckById(TRUCK_IDS[0]), trailerById(TRAILER_IDS[0])),
    { truck: { x: 0, y: 0, heading: 0 } },
    () => null,
  ).snapshot();

describe('markerGlowGeometry', () => {
  it('is one pool per side marker, on the ground and outboard of its lens', () => {
    for (const id of TRUCK_IDS) {
      const { lamps } = truckLamps(truckById(id));
      const markers = lamps.filter((l) => l.fns.includes('side-marker'));
      expect(markers.length, id).toBeGreaterThan(0);
      const geometry = markerGlowGeometry(lamps, 0.02);
      const position = geometry?.getAttribute('position');
      if (geometry === null || position === undefined) throw new Error('no glow');
      const perPool = 1 + 2 * GLOW.segments;
      expect(position.count, id).toBe(markers.length * perPool);
      markers.forEach((lamp, k) => {
        const at = glowCentre(lamp);
        expect(Math.abs(at.y)).toBeGreaterThan(Math.max(...lamp.box[1].map(Math.abs)));
        expect(position.getY(k * perPool)).toBeCloseTo(0.02, 6);
        expect(position.getX(k * perPool)).toBeCloseTo(at.x, 5);
        expect(position.getZ(k * perPool)).toBeCloseTo(-at.y, 5);
      });
    }
  });

  it('fades to black at the rim', () => {
    const { lamps } = truckLamps(truckById(TRUCK_IDS[0]));
    const colour = markerGlowGeometry(lamps, 0)?.getAttribute('color');
    if (colour === undefined) throw new Error('no glow');
    const perPool = 1 + 2 * GLOW.segments;
    expect(colour.getX(0)).toBeGreaterThan(colour.getX(1));
    for (let i = perPool - GLOW.segments; i < perPool; i++) expect(colour.getX(i)).toBe(0);
  });

  it('is nothing for a part without side markers', () => {
    expect(markerGlowGeometry([], 0)).toBeNull();
  });
});

describe('the marker glow in the vehicle visuals', () => {
  /** A decal for each part that carries side markers: the truck's, the trailer's and the dolly's. */
  const visuals = [
    ['truck', () => proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env), 1],
    ['trailer', () => proceduralTrailer(trailerById(TRAILER_IDS[0]), palette, undefined, env), 2],
  ] as const;

  const glowOf = (root: Object3D): Mesh[] => {
    const found: Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof Mesh && o.name === GLOW_NAME) found.push(o as Mesh);
    });
    return found;
  };

  it.each(visuals)(
    'draws a perspective-only single-pass decal per part of the %s, at night with lamp light only',
    (_n, make, count) => {
      const visual = make();
      const found = glowOf(visual.object);
      expect(found).toHaveLength(count);
      for (const glow of found) {
        expect(glow.layers.mask).toBe(1 << PERSPECTIVE_LAYER);
        expect(glow.castShadow).toBe(false);
        expect((glow.material as MeshBasicMaterial).forceSinglePass).toBe(true);
      }
      for (const [preset, lighting, shown] of [
        ['balanced', 'night', true],
        ['high', 'night', true],
        ['low', 'night', false],
        ['balanced', 'day', false],
        ['high', 'day', false],
      ] as const) {
        visual.setLook(lookFor(QUALITY_FLAGS[preset], lighting));
        visual.update(snapshot());
        for (const glow of found) expect(glow.visible, `${preset} ${lighting}`).toBe(shown);
      }
      visual.dispose();
    },
  );

  describe('follows the lamps it sits under', () => {
    const on = { ...snapshot(), time: FLASH_PERIOD * 0.25 };
    const off = { ...snapshot(), time: FLASH_PERIOD * 0.75 };

    /** What each decal of `make()` shows under `switches` in each flash phase, at night. */
    const shown = (make: () => VehicleVisual, switches: LampSwitches): boolean[][] => {
      const visual = make();
      visual.setLook(lookFor(QUALITY_FLAGS.balanced, 'night'));
      const found = glowOf(visual.object);
      const out = [on, off].map((frame) => {
        visual.update(frame, switches);
        return found.map((g) => g.visible);
      });
      visual.dispose();
      return out;
    };
    const [[, truck], [, trailer]] = visuals;
    const everything = (on: boolean, count: number): boolean[] => Array<boolean>(count).fill(on);

    it('flashes every decal with the hazard lights, whose indicators share the markers', () => {
      for (const [make, count] of [
        [truck, 1],
        [trailer, 2],
      ] as const) {
        const flash = [everything(true, count), everything(false, count)];
        expect(shown(make, { lights: true, hazard: true })).toEqual(flash);
        expect(shown(make, { lights: false, hazard: true })).toEqual(flash);
      }
    });

    it('keeps every decal steady with the lights alone', () => {
      for (const [make, count] of [
        [truck, 1],
        [trailer, 2],
      ] as const) {
        const steady = [everything(true, count), everything(true, count)];
        expect(shown(make, { lights: true, hazard: false })).toEqual(steady);
      }
    });

    it.each(visuals)('stays dark with the lights and hazard lights off: %s', (_n, make, count) => {
      const dark = [everything(false, count), everything(false, count)];
      expect(shown(make, { lights: false, hazard: false })).toEqual(dark);
    });
  });

  it('counts the lamps of the part it sits on', () => {
    const spec = trailerById(TRAILER_IDS[0]);
    const own = (part: 'trailer' | 'dolly') =>
      trailerLamps(spec, 'procedural').lamps.filter(
        (l) => l.part === part && l.fns.includes('side-marker'),
      );
    const visual = proceduralTrailer(spec, palette, undefined, env);
    const sizes = glowOf(visual.object).map((g) => g.geometry.getAttribute('position').count);
    expect(sizes.sort()).toEqual(
      [own('trailer').length, own('dolly').length].map((n) => n * (1 + 2 * GLOW.segments)).sort(),
    );
    visual.dispose();
  });
});
