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

/** How bright each function is, 0 (off) to 1. */
export type LampLevels = Readonly<Record<LampFn, number>>;

/** Lamp levels from the snapshot's controls, with the flash phase from sim time. */
export function lampState(
  snapshot: Pick<SimSnapshot, 'control' | 'time'>,
  { night, hazard }: LampToggles = DAY,
): LampLevels {
  const lit = night ? 1 : 0;
  const flash = hazard && snapshot.time % FLASH_PERIOD < FLASH_PERIOD / 2 ? 1 : 0;
  return {
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
  };
}

/** A lens with several functions shows the brightest. */
export const lensLevel = (levels: LampLevels, fns: readonly LampFn[]): number =>
  Math.max(0, ...fns.map((fn) => levels[fn]));
