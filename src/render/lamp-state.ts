import type { LampSwitches } from '../contracts/render';
import type { SimSnapshot } from '../contracts/sim';
import type { LampFn } from './lamp-layout';

// No `three` import: pure, so replays and pinned-clock shots light the same lamps.

/** Render-side switches; the sim has no indicator or light input. */
export type LampToggles = LampSwitches;

/** Lights off, which is the default by day. */
export const DAY: LampToggles = { lights: false, hazard: false };

/** 90 flashes a minute, inside UN R48 6.5.9's 90 ± 30, half the period on. */
export const FLASH_PERIOD = 60 / 90;
/** A rear position lamp beside the stop lamp it shares a lens with. */
export const TAIL_LEVEL = 0.25;

export type LampState = {
  /** How bright each function is, 0 (off) to 1. */
  readonly levels: Readonly<Record<LampFn, number>>;
};

/** Lamp levels from the snapshot's controls, with the flash phase from sim time. */
export function lampState(
  snapshot: Pick<SimSnapshot, 'control' | 'time'>,
  { lights, hazard }: LampToggles = DAY,
): LampState {
  const lit = lights ? 1 : 0;
  const flash = hazard && snapshot.time % FLASH_PERIOD < FLASH_PERIOD / 2 ? 1 : 0;
  return {
    levels: {
      'dipped-beam': lit,
      'front-position': lit,
      'front-indicator': flash,
      'side-indicator': flash,
      'side-marker': lit,
      'end-outline-front': lit,
      'end-outline-rear': lit,
      'rear-position': lights ? TAIL_LEVEL : 0,
      stop: snapshot.control.brake ? 1 : 0,
      'rear-indicator': flash,
      reversing: snapshot.control.gear === 'R' ? 1 : 0,
      'rear-fog': 0,
      'rear-plate': lit,
    },
  };
}

/** A lens with several functions shows the brightest. */
export function lensLevel({ levels }: LampState, fns: readonly LampFn[]): number {
  return Math.max(0, ...fns.map((fn) => levels[fn]));
}
