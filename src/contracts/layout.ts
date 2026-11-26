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
  | 'gatehouse'
  | 'furniture';
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
export type PropAsset = 'hall' | 'parked' | 'lamp' | 'gate' | 'bollard' | 'kit';
/** Light on a lamp prop: `flood` masts carry floodlights, `street` lamps a single arm; both face `aim`. */
export type Fixture = { readonly kind: 'flood' | 'street'; readonly aim: Vec2 };
export type Prop = {
  /** Unique within the layout, without '/'. */
  readonly id: string;
  readonly asset: PropAsset;
  readonly colliders: readonly Collider[];
  /** Present exactly when `asset` is 'lamp'. */
  readonly fixture?: Fixture;
  /** Present exactly when `asset` is 'kit'. */
  readonly kit?: KitPlacement;
};
/** Id of a prop's `index`-th collider once resolved into an `Obstacle`. */
export const colliderId = (propId: string, index: number): string => `${propId}/${index}`;
/** Closed set: a new asset needs a drawing in the renderer. */
export type DecorAsset = 'swap-body' | 'skip' | 'pallets' | 'mesh-boxes' | 'kit';
/** A node of the yard kit (`src/render/assets/yard-kit.glb`); `tools/blender/kit-build.test.ts` pins the list. */
export type KitPiece =
  | 'bench'
  | 'bike-rack'
  | 'bin-1100'
  | 'bin-240'
  | 'fence-gate'
  | 'fence-panel'
  | 'flagpole'
  | 'grass-tuft'
  | 'hall-corner'
  | 'hall-door-bay'
  | 'hall-roof'
  | 'hall-wall-bay'
  | 'hedge'
  | 'hydrant'
  | 'lime-a'
  | 'lime-b'
  | 'maple-a'
  | 'maple-b'
  | 'office-bay'
  | 'office-entrance'
  | 'office-roof'
  | 'salt-bin'
  | 'sign-post'
  | 'wash-canopy';
/** A piece of the yard kit and the world box it is drawn within (`kitFootprint`). */
export type KitPlacement = { readonly piece: KitPiece; readonly footprint: Obb };

type DecorBase = {
  /** Unique within the layout. */
  readonly id: string;
  /** World-coordinate box the drawing stays within; its heading is the drawing's. */
  readonly footprint: Obb;
  /** Palette index, wrapped by the renderer; assets with one look ignore it. */
  readonly variant: number;
  /** Top of the drawing above the ground (metres): the box hides an Einweiser behind it. */
  readonly height: number;
};
/** A piece of the yard kit, drawn from the glb where the footprint says (`kitFootprint`). */
export type KitDecor = DecorBase & KitPlacement & { readonly asset: 'kit' };
/** Perspective-only goods on ground nothing drives: no collision, not part of a run. */
export type Decor = (DecorBase & { readonly asset: Exclude<DecorAsset, 'kit'> }) | KitDecor;
export const isKitDecor = (decor: Decor): decor is KitDecor => decor.asset === 'kit';

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
  /** Perspective-only goods; not part of a run. */
  readonly decor: readonly Decor[];
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
  readonly decor: readonly Decor[];
  readonly markings: readonly Marking[];
  readonly target: TargetZone | null;
  /** Present exactly when `target` is. */
  readonly tolerances: Tolerances | null;
  readonly waypoint: WaypointGate | null;
};
