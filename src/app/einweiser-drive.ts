import type { ControlSource } from '../contracts/control';
import type { EinweiserResult, EinweiserStatus } from '../contracts/einweiser';
import type { EinweiserTrack } from '../contracts/exercise';
import type { ResolvedLayout } from '../contracts/layout';
import type { EinweiserVisual, LampSwitches, LightingMode } from '../contracts/render';
import type { ContactQuery, ControlVector, SimSnapshot } from '../contracts/sim';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { layoutOccluders, sightGeometry } from '../einweiser/sight';
import { createEinweiserRun, type EinweiserInput, type EinweiserStep } from '../einweiser/track';
import { STILL } from '../einweiser/walk';
import { createEinweiserTracker } from '../scoring/einweiser';

/** What a drive in the Einweiser role adds to the driver's: the AI driver as its control source, and the Einweiser. */
export type EinweiserDrive = {
  readonly source: ControlSource;
  /** Null before the first sim step. */
  status(): EinweiserStatus | null;
  visual(): EinweiserVisual | null;
  /** For the run's log. */
  track(): EinweiserTrack;
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
  // Until the walk and sign input lands (#495), he stands at his start with his arms down.
  const input = (): EinweiserInput => ({
    keys: STILL,
    heading: run.walker().heading,
    pitch: 0,
    sign: null,
  });
  const lamps: LampSwitches = { lights: lighting === 'night', hazard: false };
  let control: ControlVector = start.control;
  let status: EinweiserStatus | null = null;
  let ticked: { readonly before: SimSnapshot; readonly step: EinweiserStep } | null = null;
  stage.dataset['role'] = 'einweiser';
  return {
    source: {
      tick(_, snapshot) {
        const step = run.step(snapshot, input());
        ticked = { before: snapshot, step };
        control = step.control;
        status = step.status;
      },
      control: () => control,
      lamps: () => lamps,
    },
    status: () => status,
    visual: () => {
      if (status === null) return null;
      const { x, y, heading, pitch } = status.live;
      return { pose: { x, y, heading }, pitch, sign: status.sign, phase: status.phase };
    },
    track: () => run.track(),
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
