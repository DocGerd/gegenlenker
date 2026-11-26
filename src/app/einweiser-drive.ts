import type { ControlSource } from '../contracts/control';
import { DEG_PER_COUNT, type EinweiserStatus } from '../contracts/einweiser';
import type { EinweiserTrack } from '../contracts/exercise';
import type { ResolvedLayout } from '../contracts/layout';
import type { EinweiserVisual, LampSwitches, LightingMode } from '../contracts/render';
import type { ControlVector, SimSnapshot } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { layoutOccluders, sightGeometry } from '../einweiser/sight';
import { createEinweiserRun } from '../einweiser/track';
import { createWalkInput, type WalkInput } from '../input/walk-input';
import { currentSettings } from './settings';

/** What a drive in the Einweiser role adds to the driver's: the AI driver as its control source, and the Einweiser. */
export type EinweiserDrive = {
  readonly source: ControlSource;
  /** Binds walk, look and signs to the render surface; see `WalkInput.attach`. Returns the teardown. */
  readonly attach: WalkInput['attach'];
  /** As the pause sheet opens: lets go of every key and button, and of the pointer lock. */
  readonly pause: WalkInput['pause'];
  /** Null before the first sim step. */
  status(): EinweiserStatus | null;
  /** At his start pose before the first sim step, so the first frame already shows his view. */
  visual(): EinweiserVisual;
  /** For the run's log. */
  track(): EinweiserTrack;
};

export type EinweiserDriveSetup = {
  readonly truck: TruckSpec;
  readonly trailer: TrailerSpec;
  readonly layout: ResolvedLayout;
  /** The run's first snapshot. */
  readonly start: SimSnapshot;
  readonly lighting: LightingMode;
};

/** Marks `stage` with `data-role="einweiser"`, which e2e waits for. */
export function startEinweiserDrive(
  stage: HTMLElement,
  { truck, trailer, layout, start, lighting }: EinweiserDriveSetup,
): EinweiserDrive {
  const run = createEinweiserRun({
    g: sightGeometry(truck, trailer),
    occluders: layoutOccluders(layout),
    yard: layout.yard,
    start,
  });
  const input = createWalkInput({
    heading: run.walker().heading,
    look: () => {
      const { mouseSensitivity, invertMouse } = currentSettings();
      return { degPerCount: DEG_PER_COUNT[mouseSensitivity], invert: invertMouse };
    },
  });
  const lamps: LampSwitches = { lights: lighting === 'night', hazard: false };
  let control: ControlVector = start.control;
  let status: EinweiserStatus | null = null;
  stage.dataset['role'] = 'einweiser';
  return {
    attach: (surface, onLockLost) => input.attach(surface, onLockLost),
    pause: () => {
      input.pause();
    },
    source: {
      tick(_, snapshot) {
        const step = run.step(snapshot, input.sample());
        control = step.control;
        status = step.status;
      },
      control: () => control,
      lamps: () => lamps,
    },
    status: () => status,
    visual: () => {
      if (status === null) {
        const { x, y, heading } = run.walker();
        return { pose: { x, y, heading }, pitch: 0, sign: null, phase: 0 };
      }
      const { x, y, heading, pitch } = status.live;
      return { pose: { x, y, heading }, pitch, sign: status.sign, phase: status.phase };
    },
    track: () => run.track(),
  };
}
