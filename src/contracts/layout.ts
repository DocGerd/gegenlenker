import type { TargetZone } from './exercise';
import type { Obb, Pose2, Vec2 } from './sim';
export type Rect2 = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
export type ObstacleKind = 'kerb' | 'wall' | 'fence' | 'hall' | 'ramp' | 'lamp' | 'parked' | 'cone';
export type Obstacle = {
  readonly id: string;
  readonly kind: ObstacleKind;
  readonly obb: Obb;
  readonly height: number;
};
export type MarkingKind = 'lane-centre' | 'lane-edge' | 'bay' | 'stop';
export type Marking = {
  readonly kind: MarkingKind;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly width: number;
  readonly dashed: boolean;
};
export type SurfaceKind = 'yard' | 'pavement' | 'street';
export type Surface = { readonly kind: SurfaceKind; readonly rect: Rect2 };
/** Street along x, south of the yard; kerbY is the yard-side kerb line. */
export type StreetSpec = {
  readonly kerbY: number;
  readonly width: number;
  readonly pavement: number;
  readonly fromX: number;
  readonly toX: number;
  readonly entrance: { readonly fromX: number; readonly toX: number };
};
export const LAYOUT_IDS = ['depot', 'logistics'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];
export type Layout = {
  readonly id: LayoutId;
  readonly bounds: Rect2;
  readonly yard: Rect2;
  readonly street: StreetSpec;
  readonly start: Pose2;
  readonly obstacles: readonly Obstacle[];
  readonly markings: readonly Marking[];
};
/** Turn point the truck must come within `radius` of before the target counts. */
export type WaypointGate = Vec2 & { readonly radius: number };
export type ResolvedLayout = {
  readonly id: LayoutId;
  readonly bounds: Rect2;
  readonly yard: Rect2;
  readonly surfaces: readonly Surface[];
  readonly obstacles: readonly Obstacle[];
  readonly markings: readonly Marking[];
  readonly target: TargetZone | null;
  readonly waypoint: WaypointGate | null;
};
