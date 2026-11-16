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
export type SimContact = { readonly body: BodyId; readonly obstacleId: string }; // 'self': truck against trailer body
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
  readonly contacts: number;
  readonly jackknifes: number;
  readonly directionChanges: number;
};
export type Simulation = {
  step(control: ControlVector): SimSnapshot;
  snapshot(): SimSnapshot;
};
export type InputChange = { readonly step: number; readonly control: ControlVector };
