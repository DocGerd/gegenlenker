import { Mesh, type Object3D, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import type { ScenePalette } from '../contracts/render';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import { createSimulation } from '../sim/simulation';
import { trailerById, truckById } from '../vehicles/registry';
import { resolveCombination } from '../vehicles/resolve';
import { trailerLamps, truckLamps } from './lamp-layout';
import { lookFor } from './look';
import { GLOW, glowCentre, markerGlowGeometry } from './marker-glow';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { PERSPECTIVE_LAYER } from './seams';
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
  const visuals = [
    ['truck', () => proceduralTruck(truckById(TRUCK_IDS[0]), palette, undefined, env)],
    ['trailer', () => proceduralTrailer(trailerById(TRAILER_IDS[0]), palette, undefined, env)],
  ] as const;

  const glowOf = (root: Object3D): Mesh[] => {
    const found: Mesh[] = [];
    root.traverse((o) => {
      if (o instanceof Mesh && o.name === GLOW_NAME) found.push(o as Mesh);
    });
    return found;
  };

  it.each(visuals)(
    'draws one perspective-only decal per %s, at night with lamp light only',
    (_n, make) => {
      const visual = make();
      const found = glowOf(visual.object);
      expect(found).toHaveLength(1);
      const [glow] = found;
      if (glow === undefined) throw new Error('no glow');
      expect(glow.layers.mask).toBe(1 << PERSPECTIVE_LAYER);
      expect(glow.castShadow).toBe(false);
      for (const [preset, lighting, shown] of [
        ['balanced', 'night', true],
        ['high', 'night', true],
        ['low', 'night', false],
        ['balanced', 'day', false],
        ['high', 'day', false],
      ] as const) {
        visual.setLook(lookFor(QUALITY_FLAGS[preset], lighting));
        visual.update(snapshot());
        expect(glow.visible, `${preset} ${lighting}`).toBe(shown);
      }
      visual.dispose();
    },
  );

  it('counts the lamps of the part it sits on', () => {
    const spec = trailerById(TRAILER_IDS[0]);
    const own = trailerLamps(spec, 'procedural').lamps.filter(
      (l) => l.part === 'trailer' && l.fns.includes('side-marker'),
    );
    const visual = proceduralTrailer(spec, palette, undefined, env);
    const [glow] = glowOf(visual.object);
    expect(glow?.geometry.getAttribute('position').count).toBe(
      own.length * (1 + 2 * GLOW.segments),
    );
    visual.dispose();
  });
});
