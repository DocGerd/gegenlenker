import type { TrailerId, TrailerSpec, TruckId, TruckSpec } from '../contracts/vehicle';
import { arocs1835Ak } from './arocs-1835-ak';
import { hueffermannHpa2481L } from './hueffermann-hpa-24-81-l';
import { kroneAzw18 } from './krone-azw-18';
import { manLe18280 } from './man-le-18-280';

export const trucks: readonly TruckSpec[] = [manLe18280, arocs1835Ak];
export const trailers: readonly TrailerSpec[] = [kroneAzw18, hueffermannHpa2481L];

export function truckById(id: TruckId): TruckSpec {
  const spec = trucks.find((t) => t.id === id);
  if (spec === undefined) throw new Error(`Unknown truck ${id}`);
  return spec;
}

export function trailerById(id: TrailerId): TrailerSpec {
  const spec = trailers.find((t) => t.id === id);
  if (spec === undefined) throw new Error(`Unknown trailer ${id}`);
  return spec;
}
