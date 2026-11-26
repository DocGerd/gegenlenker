import { describe, expect, it } from 'vitest';
import { TRUCK_IDS } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { trailers, truckById, trucks } from '../vehicles/registry';
import { TARP_TOP, TIPPER_WALL_TOP } from './body-dims';
import { CAB_HEIGHT, cabShellParams, FRAME_TOP, metres } from './cab-dims';
import { TRUCK_LOOKS } from './livery';
import { SWAP_BODY_HEIGHT } from './trailer-dims';

const MARGIN = 0.3;

describe('cockpit eye against the cab glass', () => {
  it.each(TRUCK_IDS)(
    '%s: the eye sits a margin above the sill and below the windscreen top',
    (id) => {
      const spec = truckById(id);
      const { cab } = cabShellParams(spec);
      const sill = FRAME_TOP + cab.glassSill;
      const glassTop = sill + cab.glassHeight;
      const { z } = truckAnchors(spec).eye;
      expect(z).toBeGreaterThanOrEqual(sill + MARGIN);
      expect(z).toBeLessThanOrEqual(glassTop - MARGIN);
    },
  );
});

describe('vehicle height Params against the render model', () => {
  it.each(trucks)('$id: cab, frame and body tops are the drawn ones', (spec) => {
    expect(metres(spec.cab.height)).toBe(CAB_HEIGHT);
    expect(metres(spec.frameTop)).toBe(FRAME_TOP);
    const kind = TRUCK_LOOKS[spec.id].body.kind;
    expect(metres(spec.bodyTop)).toBe(kind === 'tarp' ? TARP_TOP : TIPPER_WALL_TOP);
  });

  it.each(trailers)('$id: a swap body is as tall as drawn', (spec) => {
    const height = spec.swapBodyHeight;
    if (height !== undefined) expect(metres(height)).toBe(SWAP_BODY_HEIGHT);
  });
});
