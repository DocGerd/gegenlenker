import type { SimSnapshot } from '../contracts/sim';
import type { LampFn } from './lamp-layout';

// No `three` import: pure, so replays and pinned-clock shots light the same lamps.

/** Render-side switches; the sim has no indicator or light input. */
export type LampToggles = { readonly night: boolean; readonly hazard: boolean };

export const DAY: LampToggles = { night: false, hazard: false };

/** 90 flashes a minute, inside UN R48 6.5.9's 90 ± 30, half the period on. */
export const FLASH_PERIOD = 60 / 90;
/** A rear position lamp beside the stop lamp it shares a lens with. */
export const TAIL_LEVEL = 0.25;

const FLASHING: readonly LampFn[] = ['front-indicator', 'side-indicator', 'rear-indicator'];

export type LampState = {
  /** How bright each function is, 0 (off) to 1. */
  readonly levels: Readonly<Record<LampFn, number>>;
  /** The direction indicators are flashing, in either phase. */
  readonly flashing: boolean;
};

/** Lamp levels from the snapshot's controls, with the flash phase from sim time. */
export function lampState(
  snapshot: Pick<SimSnapshot, 'control' | 'time'>,
  { night, hazard }: LampToggles = DAY,
): LampState {
  const lit = night ? 1 : 0;
  const flash = hazard && snapshot.time % FLASH_PERIOD < FLASH_PERIOD / 2 ? 1 : 0;
  return {
    flashing: hazard,
    levels: {
      'dipped-beam': lit,
      'front-position': lit,
      'front-indicator': flash,
      'side-indicator': flash,
      'side-marker': lit,
      'end-outline-front': lit,
      'end-outline-rear': lit,
      'rear-position': night ? TAIL_LEVEL : 0,
      stop: snapshot.control.brake ? 1 : 0,
      'rear-indicator': flash,
      reversing: snapshot.control.gear === 'R' ? 1 : 0,
      'rear-fog': 0,
      'rear-plate': lit,
    },
  };
}

/**
 * A lens with several functions shows the brightest. While the indicators flash, a lens that
 * carries one follows the flash alone: a side marker flashes with them (R48 6.18.7), never steady.
 */
export function lensLevel({ levels, flashing }: LampState, fns: readonly LampFn[]): number {
  const shown =
    flashing && fns.some((fn) => FLASHING.includes(fn))
      ? fns.filter((fn) => FLASHING.includes(fn))
      : fns;
  return Math.max(0, ...shown.map((fn) => levels[fn]));
}
