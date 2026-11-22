import type {
  TrailerAnchors,
  TrailerSpec,
  TruckAnchors,
  TruckSpec,
  Vec3,
} from '../contracts/vehicle';

export const COUPLING_HEIGHT = 0.9;

const m = (mm: number): number => mm / 1000;

export function truckAnchors(spec: TruckSpec): TruckAnchors {
  const L = m(spec.wheelbase.value);
  const F = L + m(spec.frontOverhang.value);
  const mirrorX = F - m(spec.mirror.behindBumper.value);
  const mirrorY = m(spec.mirror.lateral.value + spec.mirror.glassOutboard.value);
  const mirrorZ = m(spec.mirror.height.value);
  const wideZ = mirrorZ - m(spec.mirror.wideBelow.value);
  return {
    rearAxle: { x: 0, y: 0, z: 0 },
    frontAxle: { x: L, y: 0, z: 0 },
    coupling: { x: -m(spec.couplingOffset.value), y: 0, z: COUPLING_HEIGHT },
    frontX: F,
    rearX: -m(spec.rearOverhang.value),
    eye: {
      x: F - m(spec.eye.behindBumper.value),
      y: m(spec.eye.leftOfCentre.value),
      z: m(spec.eye.height.value),
    },
    mirrorLeft: { x: mirrorX, y: mirrorY, z: mirrorZ },
    mirrorRight: { x: mirrorX, y: -mirrorY, z: mirrorZ },
    wideLeft: { x: mirrorX, y: mirrorY, z: wideZ },
    wideRight: { x: mirrorX, y: -mirrorY, z: wideZ },
  };
}

export function trailerAnchors(spec: TrailerSpec): TrailerAnchors {
  const wheelbase = m(spec.wheelbase.value);
  let rearAxles: Vec3[];
  if (spec.rearAxleCount.value === 1) {
    rearAxles = [{ x: 0, y: 0, z: 0 }];
  } else if (spec.rearAxleCount.value === 2 && spec.rearAxleSpacing !== undefined) {
    const half = m(spec.rearAxleSpacing.value) / 2;
    rearAxles = [
      { x: half, y: 0, z: 0 },
      { x: -half, y: 0, z: 0 },
    ];
  } else {
    throw new Error(`Unsupported rear axle configuration for trailer ${spec.id}`);
  }
  return {
    eye: { x: m(spec.drawbar.value), y: 0, z: COUPLING_HEIGHT },
    frontAxle: { x: 0, y: 0, z: 0 },
    turntable: { x: wheelbase, y: 0, z: 0 },
    rearAxles,
    frontX: wheelbase + m(spec.frontOverhang.value),
    rearX: -m(spec.rearOverhang.value),
  };
}
