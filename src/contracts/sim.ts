export type Vec2 = { readonly x: number; readonly y: number };
export type Pose2 = { readonly x: number; readonly y: number; readonly heading: number };
export type Gear = 'P' | 'R' | 'N' | 'D';
/** steer: target wheel position, −1 full right … 1 full left; lever: 0 … 1 of the speed cap. */
export type ControlVector = {
  readonly steer: number;
  readonly lever: number;
  readonly brake: boolean;
  readonly gear: Gear;
};
export type BodyId = 'truck' | 'drawbar' | 'trailer';
export type BlockReason = 'coupling' | 'turntable' | 'contact';
export type Obb = {
  readonly cx: number;
  readonly cy: number;
  readonly halfLength: number; // along heading
  readonly halfWidth: number;
  readonly heading: number;
};
export type BodyFootprint = { readonly body: BodyId; readonly obb: Obb };
/** `obstacleId` 'self': truck against trailer body. `point` is where the boxes overlap, on the ground. */
export type SimContact = {
  readonly body: BodyId;
  readonly obstacleId: string;
  readonly point: Vec2;
};
export type ContactQuery = (bodies: readonly BodyFootprint[]) => SimContact | null;
export type StartState = {
  readonly truck: Pose2;
  readonly couplingAngle?: number;
  readonly turntableAngle?: number;
};
export type SimSnapshot = {
  readonly step: number;
  readonly time: number;
  readonly truck: Pose2;
  readonly coupling: Vec2;
  readonly dolly: Pose2;
  readonly trailer: Pose2;
  readonly trailerRear: Vec2;
  readonly couplingAngle: number;
  readonly turntableAngle: number;
  readonly steer: number;
  readonly roadWheelAngle: number;
  readonly speed: number;
  readonly control: ControlVector;
  readonly blocked: BlockReason | null;
  /** The touching body and contact point while `blocked` is 'contact'; `self`: truck against trailer. */
  readonly contact: {
    readonly body: BodyId;
    readonly point: Vec2;
    readonly self: boolean;
  } | null;
  readonly contacts: number;
  readonly jackknifes: number;
  readonly directionChanges: number;
};
export type Simulation = {
  step(control: ControlVector): SimSnapshot;
  snapshot(): SimSnapshot;
};
export type InputChange = { readonly step: number; readonly control: ControlVector };

/**
 * Predicted ground paths at constant target steer: the two corners of the leading end, sampled
 * together, so `left[k]` and `right[k]` lie on one cross-section. They stop where the simulation would block.
 */
export type Prediction = {
  /** The trailer's rear when reversing, the truck's front when driving forward; null when nothing is predicted. */
  readonly lead: 'trailer' | 'truck' | null;
  readonly left: readonly Vec2[];
  readonly right: readonly Vec2[];
  readonly blocked: BlockReason | null;
  /** Path length (m) travelled before the block; null when not blocked. */
  readonly blockedAt: number | null;
};
