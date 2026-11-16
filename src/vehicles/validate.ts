import type { Param, TrailerSpec, TruckSpec } from '../contracts/vehicle';

const MIN_PAIR_CLEARANCE_MM = 500;

function collect(node: unknown, path: string, out: [string, Param][]): void {
  if (typeof node !== 'object' || node === null) return;
  if ('value' in node && 'status' in node && 'source' in node) {
    out.push([path, node as Param]);
    return;
  }
  for (const [key, child] of Object.entries(node)) collect(child, `${path}.${key}`, out);
}

function checkParams(spec: object, label: string): string[] {
  const found: [string, Param][] = [];
  collect(spec, label, found);
  const problems: string[] = [];
  for (const [path, p] of found) {
    if (!Number.isFinite(p.value)) problems.push(`${path}: value is not finite`);
    if (p.status === 'sourced' && !/^https:\/\//.test(p.source)) {
      problems.push(`${path}: sourced parameter needs an https URL`);
    } else if (p.status === 'estimate' && p.source.trim() === '') {
      problems.push(`${path}: estimate needs a basis`);
    }
  }
  return problems;
}

export function validateTruck(t: TruckSpec): string[] {
  const problems = checkParams(t, t.id);
  if (
    t.length !== undefined &&
    t.frontOverhang.value + t.wheelbase.value + t.rearOverhang.value !== t.length.value
  ) {
    problems.push(`${t.id}: overhangs and wheelbase do not add up to length`);
  }
  if (!(t.eye.leftOfCentre.value > 0 && t.eye.leftOfCentre.value < t.width.value / 2)) {
    problems.push(`${t.id}: eye must lie left of centre and inside the body width`);
  }
  if (!(t.eye.behindBumper.value < t.frontOverhang.value + t.wheelbase.value)) {
    problems.push(`${t.id}: eye must lie ahead of the rear axle`);
  }
  if (!(t.mirror.lateral.value >= t.width.value / 2)) {
    problems.push(`${t.id}: mirror pivot must lie outside the body`);
  }
  return problems;
}

export function validateTrailer(t: TrailerSpec): string[] {
  const problems = checkParams(t, t.id);
  const count = t.rearAxleCount.value;
  if (count !== 1 && count !== 2) problems.push(`${t.id}: rear axle count must be 1 or 2`);
  if ((t.rearAxleSpacing !== undefined) !== count > 1) {
    problems.push(`${t.id}: rear axle spacing must be set exactly for multi-axle groups`);
  }
  if (
    t.lengthToEye !== undefined &&
    t.drawbar.value + t.wheelbase.value + t.rearOverhang.value !== t.lengthToEye.value
  ) {
    problems.push(`${t.id}: drawbar, wheelbase and rear overhang do not add up to length to eye`);
  }
  for (const [name, limit] of [
    ['coupling', t.couplingLimit],
    ['turntable', t.turntableLimit],
  ] as const) {
    if (!(limit.value > 0 && limit.value < 90)) {
      problems.push(`${t.id}: ${name} limit must be between 0 and 90 degrees`);
    }
  }
  return problems;
}

export function validatePair(t: TruckSpec, r: TrailerSpec): string[] {
  const clearance =
    t.couplingOffset.value + r.drawbar.value - r.frontOverhang.value - t.rearOverhang.value;
  return clearance >= MIN_PAIR_CLEARANCE_MM
    ? []
    : [`${t.id} + ${r.id}: rear clearance ${clearance} mm is below ${MIN_PAIR_CLEARANCE_MM} mm`];
}
