import { OVERLAP_EPSILON } from './collision';

export const DT = 1 / 60;
export const V_MAX = 5 / 3.6;
export const ACCEL = 0.5;
export const DECEL = 0.8;
export const BRAKE_DECEL = 2.5;
export const DRAWBAR_WIDTH = 0.6;
export const MAX_STEPS_PER_FRAME = 8;
export const PREDICT_STEP = 0.5;
export const PREDICT_DISTANCE = 30;
/** A predicted contact nearer than this (m) raises the first warning stage. */
export const CONTACT_WARN_DISTANCE = 3;
export const EVENT_CLEAR_DISTANCE = 0.5;

/** Hashed whole into the data fingerprint; order is part of the fingerprint. */
export const SIM_CONSTANTS = {
  DT,
  V_MAX,
  ACCEL,
  DECEL,
  BRAKE_DECEL,
  DRAWBAR_WIDTH,
  EVENT_CLEAR_DISTANCE,
  OVERLAP_EPSILON,
} as const;
