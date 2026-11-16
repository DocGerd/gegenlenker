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
import { COUPLING_HEIGHT, trailerAnchors, truckAnchors } from '../vehicles/anchors';
import { placePose } from './coords';
import type { VehicleVisual } from './seams';

const WHEEL_RADIUS = 0.5;
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
const DRAWBAR_SPREAD = 0.45; // arm spacing at the turntable end
const ARM_WIDTH = 0.12;
const PLATE_RADIUS = 0.5;

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

/** A level bar of the given width and height range between two ground-plane points. */
function bar(
  [x0, y0]: readonly [number, number],
  [x1, y1]: readonly [number, number],
  width: number,
  [z0, z1]: readonly [number, number],
): BufferGeometry {
  return new BoxGeometry(Math.hypot(x1 - x0, y1 - y0), z1 - z0, width)
    .rotateY(Math.atan2(y1 - y0, x1 - x0))
    .translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2);
}

/** Axis along body y, built at the origin. */
function wheelGeometry(width: number): BufferGeometry {
  return new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, width, WHEEL_SEGMENTS).rotateX(
    Math.PI / 2,
  );
}

function wheelAt(width: number, x: number, y: number): BufferGeometry {
  return wheelGeometry(width).translate(x, WHEEL_RADIUS, -y);
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
        wheelAt(TWIN_WHEEL_WIDTH, a.rearAxle.x, (side * rearTrack) / 2 + twin * TWIN_OFFSET),
      );
    }
  }

  const cabMaterial = res.material(palette.cab);
  const chassisMaterial = res.material(palette.chassis);
  const bodyMaterial = res.material(palette.body);
  const wheelMaterial = res.material(palette.wheel);

  const group = new Group();
  group.add(
    res.mesh(merge(cab), cabMaterial),
    res.mesh(merge(chassis), chassisMaterial),
    res.mesh(merge(body), bodyMaterial),
    res.mesh(merge(rearWheels), wheelMaterial),
  );

  // each front wheel yaws about its own kingpin, so the two share one geometry
  const frontWheel = wheelGeometry(TRUCK_WHEEL_WIDTH);
  const pivots = [-1, 1].map((side) => {
    const pivot = new Group();
    pivot.position.set(a.frontAxle.x, WHEEL_RADIUS + a.frontAxle.z, (-side * frontTrack) / 2);
    pivot.add(res.mesh(frontWheel, wheelMaterial));
    group.add(pivot);
    return pivot;
  });
  const [pivotRight, pivotLeft] = pivots;
  if (pivotRight === undefined || pivotLeft === undefined) throw new Error('unreachable');

  return {
    object: group,
    update(snapshot) {
      placePose(group, snapshot.truck);
      pivotRight.rotation.y = snapshot.roadWheelAngle;
      pivotLeft.rotation.y = snapshot.roadWheelAngle;
    },
    dispose: res.dispose,
  };
}

export function proceduralTrailer(spec: TrailerSpec, palette: ScenePalette): VehicleVisual {
  const a = trailerAnchors(spec);
  const hw = spec.width.value / 2000;
  const track = spec.track.value / 1000;
  const deck = spec.deckHeight.value / 1000;
  const res = resources();
  const arm = (side: number): BufferGeometry =>
    bar([0, side * DRAWBAR_SPREAD], [a.eye.x, 0], ARM_WIDTH, [
      COUPLING_HEIGHT - 0.07,
      COUPLING_HEIGHT + 0.07,
    ]);

  // Dolly frame: the turntable centre is the origin; eye and front axle are read as given.
  const dollyChassis = [
    arm(-1),
    arm(1),
    box(
      [a.eye.x - 0.15, a.eye.x + 0.05],
      [-0.1, 0.1],
      [COUPLING_HEIGHT - 0.07, COUPLING_HEIGHT + 0.07],
    ),
    new CylinderGeometry(PLATE_RADIUS, PLATE_RADIUS, 0.1, WHEEL_SEGMENTS).translate(
      0,
      COUPLING_HEIGHT - 0.05,
      0,
    ),
    box(
      [a.frontAxle.x - 0.15, a.frontAxle.x + 0.15],
      [-0.15, 0.15],
      [WHEEL_RADIUS, COUPLING_HEIGHT - 0.1],
    ),
    box(
      [a.frontAxle.x - 0.07, a.frontAxle.x + 0.07],
      [-track / 2, track / 2],
      [WHEEL_RADIUS - 0.07, WHEEL_RADIUS + 0.07],
    ),
  ];
  const dollyWheels = [-1, 1].map((side) =>
    wheelAt(TRAILER_WHEEL_WIDTH, a.frontAxle.x, (side * track) / 2),
  );

  // Body frame: the effective rear axle is the origin.
  const rails = [-1, 1].map((side) =>
    box(
      [a.rearX, a.frontX],
      [side * RAIL_HALF_GAP - RAIL_WIDTH / 2, side * RAIL_HALF_GAP + RAIL_WIDTH / 2],
      [deck - (spec.body === 'box' ? 0.25 : 0.3), deck - (spec.body === 'box' ? 0 : 0.1)],
    ),
  );
  const axleBeams = a.rearAxles.map((axle) =>
    box(
      [axle.x - 0.07, axle.x + 0.07],
      [-track / 2, track / 2],
      [WHEEL_RADIUS - 0.07, WHEEL_RADIUS + 0.07],
    ),
  );
  const bodyParts: BufferGeometry[] = [];
  if (spec.body === 'box') {
    bodyParts.push(box([a.rearX, a.frontX], [-hw, hw], [deck, deck + SWAP_BODY_HEIGHT]));
  } else {
    bodyParts.push(box([a.rearX, a.frontX], [-hw, hw], [deck - 0.1, deck]));
    for (const side of [-1, 1]) {
      const [y0, y1] = side < 0 ? [-0.15 - RAMP_WIDTH, -0.15] : [0.15, 0.15 + RAMP_WIDTH];
      bodyParts.push(
        box([a.rearX, a.rearX + RAMP_THICKNESS], [y0, y1], [deck, deck + RAMP_HEIGHT]),
      );
    }
  }
  const trailerWheels = a.rearAxles.flatMap((axle) =>
    [-1, 1].map((side) => wheelAt(TRAILER_WHEEL_WIDTH, axle.x, (side * track) / 2)),
  );

  const chassisMaterial = res.material(palette.chassis);
  const bodyMaterial = res.material(palette.body);
  const wheelMaterial = res.material(palette.wheel);

  const dolly = new Group();
  dolly.add(
    res.mesh(merge(dollyChassis), chassisMaterial),
    res.mesh(merge(dollyWheels), wheelMaterial),
  );
  const trailer = new Group();
  trailer.add(
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
    dispose: res.dispose,
  };
}
