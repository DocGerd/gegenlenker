// Data in mm, degrees, turns per second.
export type ParamStatus = 'sourced' | 'estimate';
export type Param = {
  readonly value: number;
  readonly status: ParamStatus;
  readonly source: string; // URL if sourced, basis if estimated
};
export const TRUCK_IDS = ['man-le-18-280', 'arocs-1835-ak'] as const;
export const TRAILER_IDS = ['krone-azw-18', 'hueffermann-hpa-24-81-l'] as const;
export type TruckId = (typeof TRUCK_IDS)[number];
export type TrailerId = (typeof TRAILER_IDS)[number];
/** Perspective-only detail, millimetres. */
export type MudflapSpec = {
  readonly gap: Param; // behind the tyre
  readonly clearance: Param; // lower edge above the road
  readonly height: Param;
};
export type TailLampSpec = {
  readonly inset: Param; // outer edge to body side
  readonly width: Param;
  readonly sill: Param; // lower edge from the reference face, negative below it
  readonly height: Param;
};
export type TruckBody = 'platform' | 'tipper';
export type TrailerBody = 'box' | 'low-loader';
export type TruckSpec = {
  readonly id: TruckId;
  readonly name: string;
  readonly body: TruckBody;
  readonly wheelbase: Param;
  readonly frontOverhang: Param; // front axle → bumper
  readonly rearOverhang: Param; // rear axle → rear end
  readonly length?: Param;
  readonly width: Param;
  readonly frontTrack: Param;
  readonly rearTrack: Param;
  readonly couplingOffset: Param; // rear axle → coupling pin, rearward
  readonly turningRadius: Param; // outer front wheel, full lock
  readonly eye: {
    readonly height: Param;
    readonly behindBumper: Param;
    readonly leftOfCentre: Param;
  };
  readonly mirror: {
    readonly lateral: Param; // pivot from centreline
    readonly glassOutboard: Param;
    readonly behindBumper: Param;
    readonly height: Param;
  };
  readonly steering: { readonly lockToLockTurns: Param; readonly maxRate: Param };
  readonly cab: {
    readonly windscreenInset: Param; // glass edge to cab side
    readonly glassSill: Param; // above the frame top
    readonly glassHeight: Param;
    readonly sideGlassSetback: Param; // from the cab front
    readonly sideGlassLength: Param;
    readonly grilleWidth: Param;
    readonly grilleSill: Param;
    readonly grilleHeight: Param;
    readonly headlampInset: Param; // outer edge to cab side
    readonly headlampWidth: Param;
    readonly lampSill: Param; // from the frame top, negative below it
    readonly lampHeight: Param;
  };
  readonly bumperInset: Param; // bumper end to cab side
  readonly tailLamp: TailLampSpec; // sill from the frame top
  readonly mudflap: MudflapSpec;
};
export type TrailerSpec = {
  readonly id: TrailerId;
  readonly name: string;
  readonly body: TrailerBody;
  readonly drawbar: Param; // eye → turntable centre
  readonly wheelbase: Param; // turntable → effective rear axle
  readonly rearAxleCount: Param;
  readonly rearAxleSpacing?: Param;
  readonly frontOverhang: Param; // turntable → body front
  readonly rearOverhang: Param; // effective rear axle → body rear
  readonly lengthToEye?: Param;
  readonly width: Param;
  readonly track: Param;
  readonly deckHeight: Param;
  readonly couplingLimit: Param;
  readonly turntableLimit: Param;
  readonly underrunGuard: {
    readonly depth: Param;
    readonly inset: Param; // bar end to body side
    readonly lowerEdge: Param; // above the road
    readonly height: Param;
    readonly strutOffset: Param; // centreline to inner strut edge
    readonly strutWidth: Param;
  };
  readonly tailLamp: TailLampSpec; // sill from the deck
  readonly mudflap: MudflapSpec;
};
/** Metres and radians; distances positive; steerRate in steer units (−1…1) per second. */
export type VehicleParams = {
  readonly wheelbase: number;
  readonly couplingOffset: number;
  readonly maxRoadWheelAngle: number;
  readonly steerRate: number;
  readonly frontTrack: number;
  readonly truckFront: number; // rear axle → bumper
  readonly truckRear: number; // rear axle → rear end
  readonly truckWidth: number;
  readonly drawbar: number;
  readonly trailerWheelbase: number;
  readonly trailerFrontOverhang: number;
  readonly trailerRearOverhang: number;
  readonly trailerWidth: number;
  readonly couplingLimit: number;
  readonly turntableLimit: number;
};
export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };
/** Truck body frame, metres. */
export type TruckAnchors = {
  readonly frontAxle: Vec3;
  readonly rearAxle: Vec3;
  readonly coupling: Vec3;
  readonly eye: Vec3;
  readonly mirrorLeft: Vec3;
  readonly mirrorRight: Vec3;
  readonly frontX: number;
  readonly rearX: number;
};
/** eye and frontAxle in the dolly frame; the rest in the trailer body frame. */
export type TrailerAnchors = {
  readonly eye: Vec3;
  readonly frontAxle: Vec3;
  readonly turntable: Vec3;
  readonly rearAxles: readonly Vec3[];
  readonly frontX: number;
  readonly rearX: number;
};
