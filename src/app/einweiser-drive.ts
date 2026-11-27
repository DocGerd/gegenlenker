import type { ControlSource } from '../contracts/control';
import { DEG_PER_COUNT, type EinweiserResult, type EinweiserStatus } from '../contracts/einweiser';
import type { EinweiserTrack } from '../contracts/exercise';
import type { ResolvedLayout } from '../contracts/layout';
import type { EinweiserVisual, LampSwitches, LightingMode } from '../contracts/render';
import type { ContactQuery, ControlVector, SimSnapshot } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { layoutOccluders, sightGeometry } from '../einweiser/sight';
import { createEinweiserRun, type EinweiserStep } from '../einweiser/track';
import type { EinweiserHud } from '../hud/hud';
import { createWalkInput, type WalkInput } from '../input/walk-input';
import { createEinweiserTracker } from '../scoring/einweiser';
import { currentSettings } from './settings';

/** How long the sight cue says a sign was unclear, sim seconds (estimate). */
const UNCLEAR_CUE_SECONDS = 2;

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
  /** What his HUD shows; null before the first sim step. */
  hud(): EinweiserHud | null;
  /** After each `sim.step`, with its snapshot: scores the step the source just ticked. */
  settle(after: SimSnapshot): void;
  /** The vehicle hit him: the run ends at once. */
  runOver(): boolean;
  /** A stop in the target ends the run only after a recognised Halt. */
  halted(): boolean;
  result(): EinweiserResult;
};

export type EinweiserDriveSetup = {
  readonly truck: TruckSpec;
  readonly trailer: TrailerSpec;
  readonly layout: ResolvedLayout;
  readonly contacts: ContactQuery;
  /** The run's first snapshot. */
  readonly start: SimSnapshot;
  readonly lighting: LightingMode;
};

/** Marks `stage` with `data-role="einweiser"`, which e2e waits for. */
export function startEinweiserDrive(
  stage: HTMLElement,
  { truck, trailer, layout, contacts, start, lighting }: EinweiserDriveSetup,
): EinweiserDrive {
  const g = sightGeometry(truck, trailer);
  const run = createEinweiserRun({
    g,
    occluders: layoutOccluders(layout),
    yard: layout.yard,
    start,
  });
  const tracker = createEinweiserTracker(g, contacts);
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
  let ticked: { readonly before: SimSnapshot; readonly step: EinweiserStep } | null = null;
  // sim time, so the cue holds while the pause sheet stops the run
  let time = start.time;
  let unclearAt = -Infinity;
  stage.dataset['role'] = 'einweiser';
  return {
    attach: (surface, onLockLost) => input.attach(surface, onLockLost),
    pause: () => {
      input.pause();
    },
    source: {
      tick(_, snapshot) {
        const step = run.step(snapshot, input.sample());
        ticked = { before: snapshot, step };
        control = step.control;
        status = step.status;
        time = snapshot.time;
        // a later reading, or sight lost, ends the cue
        if (step.reading.kind === 'unclear') unclearAt = time;
        else if (step.reading.kind !== 'none') unclearAt = -Infinity;
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
    hud: () =>
      status === null
        ? null
        : {
            sign: status.sign,
            sight: status.sight,
            unclear: time - unclearAt < UNCLEAR_CUE_SECONDS,
          },
    settle(after) {
      if (ticked === null) return;
      const { before, step } = ticked;
      ticked = null;
      tracker.update({
        before,
        after,
        held: step.status.held,
        moved: step.moved,
        sign: step.status.sign,
        inSight: step.perception.inSight,
        reading: step.reading,
      });
    },
    runOver: () => tracker.runOver(),
    halted: () => tracker.halted(),
    result: () => tracker.result(),
  };
}
