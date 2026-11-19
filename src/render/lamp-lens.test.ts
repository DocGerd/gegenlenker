import { BoxGeometry } from 'three';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRAILER_IDS, TRUCK_IDS } from '../contracts/vehicle';
import { trailerById, truckById } from '../vehicles/registry';
import { parseShell, parseTrailerShell } from './glb-shells';
import { trailerLamps, truckLamps } from './lamp-layout';
import {
  createDetailMaterial,
  createLampEmission,
  DARK_SLOT,
  LENS_SLOTS,
  SLOT_ATTRIBUTE,
  slotOf,
  tagShellLenses,
  withSlot,
} from './lamp-lens';
import { lampState } from './lamp-state';
import { TRUCK_LOOKS } from './livery';

const glb = (key: string): ArrayBuffer => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${key}.glb`));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const cabLenses = (id: (typeof TRUCK_IDS)[number]) =>
  truckLamps(truckById(id), TRUCK_LOOKS[id].cab.length).lamps.filter((l) => l.part === 'cab');

describe('lamp lenses', () => {
  it('give every lens of every layout a slot', () => {
    const lamps = [
      ...TRUCK_IDS.flatMap((id) => [...truckLamps(truckById(id)).lamps, ...cabLenses(id)]),
      ...TRAILER_IDS.flatMap((id) =>
        (['procedural', 'shell'] as const).flatMap((v) => trailerLamps(trailerById(id), v).lamps),
      ),
    ];
    for (const lamp of lamps) expect(() => slotOf(lamp.fns), lamp.id).not.toThrow();
  });

  it('put everything that is no lens in the dark slot', () => {
    const slots = withSlot(new BoxGeometry()).getAttribute(SLOT_ATTRIBUTE);
    expect(new Set(Array.from({ length: slots.count }, (_, i) => slots.getX(i)))).toEqual(
      new Set([DARK_SLOT]),
    );
  });

  it.each(TRUCK_IDS)(
    'find every vertex of the %s cab shell lens on a lamp of the layout',
    async (id) => {
      const { lens } = await parseShell(glb(`${id}-cab`), 'cab');
      if (lens === null) throw new Error('the cab shell has no lens mesh');
      const slots = tagShellLenses(lens.geometry, lens.matrixWorld, cabLenses(id)).getAttribute(
        SLOT_ATTRIBUTE,
      );
      expect(slots.count).toBe(lens.geometry.getAttribute('position').count);
    },
  );

  it('find every vertex of the lafette shell lens on a lamp of the layout, and refuse one that is not', async () => {
    const { lens } = (await parseTrailerShell(glb('krone-azw-18-trailer'))).trailer;
    if (lens === null) throw new Error('the lafette shell has no lens mesh');
    const lamps = trailerLamps(trailerById('krone-azw-18'), 'shell').lamps.filter((l) => l.shell);
    const tag = (from: typeof lamps) =>
      tagShellLenses(lens.geometry.clone(), lens.matrixWorld, from);
    expect(() => tag(lamps)).not.toThrow();
    expect(() => tag(lamps.slice(1))).toThrow('lies on no lamp');
  });

  it('switch slots by their uniform only, and never light the dark slot', () => {
    const lamps = createLampEmission();
    const material = createDetailMaterial(lamps);
    const node = material.emissiveNode;
    const drive = (brake: boolean, gear: 'D' | 'R') => ({
      time: 0,
      control: { steer: 0, lever: 0, brake, gear },
    });
    lamps.update(lampState(drive(false, 'D')));
    expect(lamps.emission.every((c) => c.r + c.g + c.b === 0)).toBe(true);
    lamps.update(lampState(drive(true, 'R')));
    expect(lamps.emission[slotOf(['reversing'])]?.g).toBeGreaterThan(0.5);
    expect(lamps.emission[slotOf(['rear-position', 'stop'])]?.r).toBeGreaterThan(0.5);
    expect(lamps.emission.filter((c) => c.r > 0)).toHaveLength(2);
    lamps.update(lampState(drive(true, 'R'), { night: true, hazard: true }));
    expect(lamps.emission[DARK_SLOT]?.getHex()).toBe(0);
    expect(lamps.emission).toHaveLength(LENS_SLOTS.length + 1);
    expect(material.emissiveNode).toBe(node);
  });
});
