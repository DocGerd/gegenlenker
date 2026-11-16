import type { BodyFootprint, BodyId, Obb, SimSnapshot, Vec2 } from '../contracts/sim';
import type { VehicleParams } from '../contracts/vehicle';
import { DRAWBAR_WIDTH } from './constants';

/** Box from `front` to `rear` along `heading`. */
function span(front: Vec2, rear: Vec2, heading: number, width: number): Obb {
  return {
    cx: (front.x + rear.x) / 2,
    cy: (front.y + rear.y) / 2,
    halfLength: Math.hypot(front.x - rear.x, front.y - rear.y) / 2,
    halfWidth: width / 2,
    heading,
  };
}

const along = (from: Vec2, length: number, heading: number): Vec2 => ({
  x: from.x + length * Math.cos(heading),
  y: from.y + length * Math.sin(heading),
});

export function bodyFootprints(
  params: VehicleParams,
  s: Pick<SimSnapshot, 'truck' | 'coupling' | 'dolly' | 'trailer'>,
): BodyFootprint[] {
  const { truck, coupling, dolly, trailer } = s;
  const footprint = (body: BodyId, obb: Obb): BodyFootprint => ({ body, obb });
  return [
    footprint(
      'truck',
      span(
        along(truck, params.truckFront, truck.heading),
        along(truck, -params.truckRear, truck.heading),
        truck.heading,
        params.truckWidth,
      ),
    ),
    footprint('drawbar', span(coupling, dolly, dolly.heading, DRAWBAR_WIDTH)),
    footprint(
      'trailer',
      span(
        along(dolly, params.trailerFrontOverhang, trailer.heading),
        along(trailer, -params.trailerRearOverhang, trailer.heading),
        trailer.heading,
        params.trailerWidth,
      ),
    ),
  ];
}
