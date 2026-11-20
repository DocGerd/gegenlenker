import { describe, expect, it } from 'vitest';
import { TRUCK_IDS } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import { cabShellParams, FRAME_TOP } from './cab-dims';

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
