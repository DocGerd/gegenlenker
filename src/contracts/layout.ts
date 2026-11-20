import type { TargetZone, Tolerances } from './exercise';
import type { Obb, Pose2, Vec2 } from './sim';
export type Rect2 = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
export type ObstacleKind =
  | 'kerb'
  | 'wall'
  | 'fence'
  | 'hall'
  | 'ramp'
  | 'lamp'
  | 'parked'
  | 'cone'
  | 'bollard'
  | 'barrier'
  | 'gatehouse';
export type Obstacle = {
  readonly id: string;
  readonly kind: ObstacleKind;
  readonly obb: Obb;
  readonly height: number;
};
/** A prop's collision box, in world coordinates. */
export type Collider = {
  readonly kind: ObstacleKind;
  readonly obb: Obb;
  readonly height: number;
};
/** Closed set: a new asset needs a drawing in the renderer. */
export type PropAsset = 'hall' | 'parked' | 'lamp' | 'gate' | 'bollard';
/** Light on a lamp prop: `flood` masts carry floodlights, `street` lamps a single arm; both face `aim`. */
export type Fixture = { readonly kind: 'flood' | 'street'; readonly aim: Vec2 };
export type Prop = {
  /** Unique within the layout, without '/'. */
  readonly id: string;
  readonly asset: PropAsset;
  readonly colliders: readonly Collider[];
  /** Present exactly when `asset` is 'lamp'. */
  readonly fixture?: Fixture;
};
/** Id of a prop's `index`-th collider once resolved into an `Obstacle`. */
export const colliderId = (propId: string, index: number): string => `${propId}/${index}`;
export type MarkingKind = 'lane-centre' | 'bay' | 'stop' | 'arrow' | 'dock-number';
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
  /** Loose obstacles; collidable props live in `props`. */
  readonly obstacles: readonly Obstacle[];
  readonly props: readonly Prop[];
  readonly markings: readonly Marking[];
};
/** Turn point the truck must come within `radius` of before the target counts. */
export type WaypointGate = Vec2 & { readonly radius: number };
export type ResolvedLayout = {
  readonly id: LayoutId;
  readonly bounds: Rect2;
  readonly yard: Rect2;
  readonly surfaces: readonly Surface[];
  /** Street, loose, prop-collider and exercise obstacles, in that order. */
  readonly obstacles: readonly Obstacle[];
  readonly props: readonly Prop[];
  readonly markings: readonly Marking[];
  readonly target: TargetZone | null;
  /** Present exactly when `target` is. */
  readonly tolerances: Tolerances | null;
  readonly waypoint: WaypointGate | null;
};
