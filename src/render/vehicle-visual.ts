import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ScenePalette } from '../contracts/render';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { placePose } from './coords';
import type { VehicleVisual } from './seams';
import { dollySchematic, trailerSchematic, truckSchematic } from './vehicle-schematic';

const TRUCK_WHEEL_RADIUS = 0.5;
const WHEEL_SEGMENTS = 20;
const TRUCK_WHEEL_WIDTH = 0.3;
const TWIN_WHEEL_WIDTH = 0.26;
const TWIN_OFFSET = 0.15;
const TRAILER_WHEEL_WIDTH = 0.3;

const CAB_LENGTH = 2.2;
const CAB_HEIGHT = 2.9;
const CAB_GAP = 0.1;
const FRAME_TOP = 1.1; // chassis top and floor of cab and body
const FLOOR_THICKNESS = 0.2;
const WALL_THICKNESS = 0.1;
const TIPPER_WALL_TOP = 2.5;
const RAIL_BOTTOM = 0.65;
const RAIL_HALF_GAP = 0.45; // lateral centre of each chassis rail
const RAIL_WIDTH = 0.2;

const SWAP_BODY_HEIGHT = 2.7;
const RAMP_HEIGHT = 1.2;
const RAMP_WIDTH = 0.9;
const RAMP_THICKNESS = 0.1;
const DECK_PLATE = 0.1; // low-loader deck slab
const BOX_FRAME_DEPTH = 0.25; // rails under a swap body
const WHEEL_CLEARANCE = 0.02;
const DRAWBAR_SPREAD = 0.45; // arm spacing at the turntable end
const ARM_WIDTH = 0.12;
const ARM_HEIGHT = 0.1;
const PLATE_RADIUS = 0.5;
const PLATE_THICKNESS = 0.1;
const POST_HALF_WIDTH = 0.15;
const AXLE_HALF_THICKNESS = 0.07;
const SWING_MARGIN = 0.1;

/** Body-frame extents (x forward, y left, z up) as a Three-space box. */
function box(
  [x0, x1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  [z0, z1]: readonly [number, number],
): BufferGeometry {
  return new BoxGeometry(x1 - x0, z1 - z0, y1 - y0).translate(
    (x0 + x1) / 2,
    (z0 + z1) / 2,
    -(y0 + y1) / 2,
  );
}

type Point3 = readonly [x: number, y: number, z: number];

/** A square-ended bar between two body-frame points, `width` across and `height` tall. */
function strut(
  [x0, y0, z0]: Point3,
  [x1, y1, z1]: Point3,
  width: number,
  height: number,
): BufferGeometry {
  const run = Math.hypot(x1 - x0, y1 - y0);
  return new BoxGeometry(Math.hypot(run, z1 - z0), height, width)
    .rotateZ(Math.atan2(z1 - z0, run))
    .rotateY(Math.atan2(y1 - y0, x1 - x0))
    .translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2);
}

/** Axis along body y, built at the origin. */
function wheelGeometry(radius: number, width: number): BufferGeometry {
  return new CylinderGeometry(radius, radius, width, WHEEL_SEGMENTS).rotateX(Math.PI / 2);
}

function wheelAt(radius: number, width: number, x: number, y: number): BufferGeometry {
  return wheelGeometry(radius, width).translate(x, radius, -y);
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (merged === null) throw new Error('Vehicle parts have mismatched attributes');
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Owns what a visual allocates so `dispose` releases it exactly once. */
function resources() {
  const geometries = new Set<BufferGeometry>();
  const materials: MeshLambertMaterial[] = [];
  return {
    material(color: number): MeshLambertMaterial {
      const material = new MeshLambertMaterial({ color });
      materials.push(material);
      return material;
    },
    mesh(geometry: BufferGeometry, material: MeshLambertMaterial): Mesh {
      geometries.add(geometry);
      return new Mesh(geometry, material);
    },
    dispose(): void {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

export function proceduralTruck(spec: TruckSpec, palette: ScenePalette): VehicleVisual {
  const a = truckAnchors(spec);
  const hw = spec.width.value / 2000;
  const rearTrack = spec.rearTrack.value / 1000;
  const frontTrack = spec.frontTrack.value / 1000;
  const cabRear = a.frontX - CAB_LENGTH;
  const bodyFront = cabRear - CAB_GAP;
  const res = resources();

  const cab = [box([cabRear, a.frontX], [-hw, hw], [FRAME_TOP, CAB_HEIGHT])];

  const chassis = [
    box(
      [a.rearX, a.frontX],
      [RAIL_HALF_GAP - RAIL_WIDTH / 2, RAIL_HALF_GAP + RAIL_WIDTH / 2],
      [RAIL_BOTTOM, FRAME_TOP],
    ),
    box(
      [a.rearX, a.frontX],
      [-RAIL_HALF_GAP - RAIL_WIDTH / 2, -RAIL_HALF_GAP + RAIL_WIDTH / 2],
      [RAIL_BOTTOM, FRAME_TOP],
    ),
    box([a.frontX - 0.12, a.frontX], [-(hw - 0.1), hw - 0.1], [RAIL_BOTTOM, FRAME_TOP]),
    box(
      [a.coupling.x - 0.05, Math.max(a.rearX, a.coupling.x) + 0.3],
      [-0.12, 0.12],
      [a.coupling.z - 0.08, a.coupling.z + 0.08],
    ),
  ];

  const floorTop = FRAME_TOP + FLOOR_THICKNESS;
  const body = [box([a.rearX, bodyFront], [-hw, hw], [FRAME_TOP, floorTop])];
  if (spec.body === 'tipper') {
    body.push(
      box([a.rearX, bodyFront], [-hw, -hw + WALL_THICKNESS], [floorTop, TIPPER_WALL_TOP]),
      box([a.rearX, bodyFront], [hw - WALL_THICKNESS, hw], [floorTop, TIPPER_WALL_TOP]),
      box([bodyFront - WALL_THICKNESS, bodyFront], [-hw, hw], [floorTop, TIPPER_WALL_TOP]),
      box([a.rearX, a.rearX + WALL_THICKNESS], [-hw, hw], [floorTop, TIPPER_WALL_TOP]),
    );
  }

  const rearWheels: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    for (const twin of [-1, 1]) {
      rearWheels.push(
        wheelAt(
          TRUCK_WHEEL_RADIUS,
          TWIN_WHEEL_WIDTH,
          a.rearAxle.x,
          (side * rearTrack) / 2 + twin * TWIN_OFFSET,
        ),
      );
    }
  }

  const cabMaterial = res.material(palette.cab);
  const chassisMaterial = res.material(palette.chassis);
  const bodyMaterial = res.material(palette.body);
  const wheelMaterial = res.material(palette.wheel);

  const schematic = truckSchematic(palette, {
    rearAxleX: a.rearAxle.x,
    rearTrack,
    twinOffset: TWIN_OFFSET,
    twinWidth: TWIN_WHEEL_WIDTH,
    frontWheelWidth: TRUCK_WHEEL_WIDTH,
    wheelRadius: TRUCK_WHEEL_RADIUS,
    couplingX: a.coupling.x,
    frontOverhang: a.frontX - a.frontAxle.x,
  });

  const group = new Group();
  group.add(
    schematic.rear,
    res.mesh(merge(cab), cabMaterial),
    res.mesh(merge(chassis), chassisMaterial),
    res.mesh(merge(body), bodyMaterial),
    res.mesh(merge(rearWheels), wheelMaterial),
  );

  // each front wheel yaws about its own kingpin, so the two share one geometry
  const frontWheel = wheelGeometry(TRUCK_WHEEL_RADIUS, TRUCK_WHEEL_WIDTH);
  const kingpin = (side: -1 | 1): Group => {
    const pivot = new Group();
    pivot.position.set(a.frontAxle.x, TRUCK_WHEEL_RADIUS + a.frontAxle.z, (-side * frontTrack) / 2);
    pivot.add(res.mesh(frontWheel, wheelMaterial), schematic.front());
    group.add(pivot);
    return pivot;
  };
  const pivotLeft = kingpin(1);
  const pivotRight = kingpin(-1);

  return {
    object: group,
    update(snapshot) {
      placePose(group, snapshot.truck);
      pivotRight.rotation.y = snapshot.roadWheelAngle;
      pivotLeft.rotation.y = snapshot.roadWheelAngle;
    },
    dispose() {
      res.dispose();
      schematic.dispose();
    },
  };
}

export function proceduralTrailer(spec: TrailerSpec, palette: ScenePalette): VehicleVisual {
  const a = trailerAnchors(spec);
  const hw = spec.width.value / 2000;
  const track = spec.track.value / 1000;
  const deck = spec.deckHeight.value / 1000;
  const isBox = spec.body === 'box';
  const res = resources();

  // Wheels, axles, plate and drawbar all stay below the deck's underside.
  const underside = deck - (isBox ? BOX_FRAME_DEPTH : DECK_PLATE);
  const radius = Math.min(TRUCK_WHEEL_RADIUS, (underside - WHEEL_CLEARANCE) / 2);
  const axleZ: readonly [number, number] = [
    radius - AXLE_HALF_THICKNESS,
    radius + AXLE_HALF_THICKNESS,
  ];
  const plateTop = underside - WHEEL_CLEARANCE;
  const plateBottom = plateTop - PLATE_THICKNESS;
  const plateMid = (plateTop + plateBottom) / 2;
  // clear of the deck front as the body swings over the arms
  const kink = Math.min(
    Math.hypot(a.frontX - a.turntable.x, hw) + SWING_MARGIN,
    a.eye.x - SWING_MARGIN,
  );

  // Dolly frame: the turntable centre is the origin; eye and front axle are read as given.
  const armPath = (side: number): [Point3, Point3, Point3] => [
    [0, side * DRAWBAR_SPREAD, plateMid],
    [kink, side * DRAWBAR_SPREAD * (1 - kink / a.eye.x), plateMid],
    [a.eye.x, 0, a.eye.z],
  ];
  const arm = (side: number): BufferGeometry[] => {
    const [start, bend, end] = armPath(side);
    return [strut(start, bend, ARM_WIDTH, ARM_HEIGHT), strut(bend, end, ARM_WIDTH, ARM_HEIGHT)];
  };
  const dollyChassis = [
    ...arm(-1),
    ...arm(1),
    box([a.eye.x - 0.15, a.eye.x + 0.05], [-0.1, 0.1], [a.eye.z - 0.07, a.eye.z + 0.07]),
    new CylinderGeometry(PLATE_RADIUS, PLATE_RADIUS, PLATE_THICKNESS, WHEEL_SEGMENTS).translate(
      0,
      plateMid,
      0,
    ),
    box(
      [a.frontAxle.x - POST_HALF_WIDTH, a.frontAxle.x + POST_HALF_WIDTH],
      [-POST_HALF_WIDTH, POST_HALF_WIDTH],
      [axleZ[1], plateBottom],
    ),
    box(
      [a.frontAxle.x - AXLE_HALF_THICKNESS, a.frontAxle.x + AXLE_HALF_THICKNESS],
      [-track / 2, track / 2],
      axleZ,
    ),
  ];
  const dollyWheels = [-1, 1].map((side) =>
    wheelAt(radius, TRAILER_WHEEL_WIDTH, a.frontAxle.x, (side * track) / 2),
  );

  // Body frame: the effective rear axle is the origin.
  const rails = isBox
    ? [-1, 1].map((side) =>
        box(
          [a.rearX, a.frontX],
          [side * RAIL_HALF_GAP - RAIL_WIDTH / 2, side * RAIL_HALF_GAP + RAIL_WIDTH / 2],
          [underside, deck],
        ),
      )
    : [];
  const axleBeams = a.rearAxles.map((axle) =>
    box(
      [axle.x - AXLE_HALF_THICKNESS, axle.x + AXLE_HALF_THICKNESS],
      [-track / 2, track / 2],
      axleZ,
    ),
  );
  const bodyParts: BufferGeometry[] = [];
  if (isBox) {
    bodyParts.push(box([a.rearX, a.frontX], [-hw, hw], [deck, deck + SWAP_BODY_HEIGHT]));
  } else {
    bodyParts.push(box([a.rearX, a.frontX], [-hw, hw], [underside, deck]));
    for (const side of [-1, 1]) {
      const [y0, y1] = side < 0 ? [-0.15 - RAMP_WIDTH, -0.15] : [0.15, 0.15 + RAMP_WIDTH];
      bodyParts.push(
        box([a.rearX, a.rearX + RAMP_THICKNESS], [y0, y1], [deck, deck + RAMP_HEIGHT]),
      );
    }
  }
  const trailerWheels = a.rearAxles.flatMap((axle) =>
    [-1, 1].map((side) => wheelAt(radius, TRAILER_WHEEL_WIDTH, axle.x, (side * track) / 2)),
  );

  const chassisMaterial = res.material(palette.chassis);
  const bodyMaterial = res.material(palette.body);
  const wheelMaterial = res.material(palette.wheel);

  const dollyPlan = dollySchematic(palette, {
    frontAxleX: a.frontAxle.x,
    track,
    wheelRadius: radius,
    wheelWidth: TRAILER_WHEEL_WIDTH,
    ringRadius: PLATE_RADIUS,
    arms: [-1, 1].map((side) => armPath(side).map(([x, y]) => [x, y] as const)),
  });
  const trailerPlan = trailerSchematic(palette, {
    rearAxleXs: a.rearAxles.map((axle) => axle.x),
    track,
    wheelRadius: radius,
    wheelWidth: TRAILER_WHEEL_WIDTH,
    turntableX: a.turntable.x,
    ringRadius: PLATE_RADIUS,
    frontX: a.frontX,
  });

  const dolly = new Group();
  dolly.add(
    res.mesh(merge(dollyChassis), chassisMaterial),
    res.mesh(merge(dollyWheels), wheelMaterial),
    dollyPlan.mesh,
  );
  const trailer = new Group();
  trailer.add(
    trailerPlan.mesh,
    res.mesh(merge(bodyParts), bodyMaterial),
    res.mesh(merge([...rails, ...axleBeams]), chassisMaterial),
    res.mesh(merge(trailerWheels), wheelMaterial),
  );
  const group = new Group();
  group.add(dolly, trailer);

  return {
    object: group,
    update(snapshot) {
      placePose(dolly, snapshot.dolly);
      placePose(trailer, snapshot.trailer);
    },
    dispose() {
      res.dispose();
      dollyPlan.dispose();
      trailerPlan.dispose();
    },
  };
}
