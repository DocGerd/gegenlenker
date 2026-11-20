import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { MeshLambertNodeMaterial } from 'three/webgpu';
import { DEFAULT_LIGHTING, type LightingMode, type ScenePalette } from '../contracts/render';
import type { TrailerSpec, TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { type Blob, blobShadow } from './blob-shadow';
import {
  bodyFrontX,
  FLOOR_TOP,
  RAIL_HALF_GAP,
  RAIL_WIDTH,
  TIPPER_WALL_TOP,
  TRUCK_WHEEL_WIDTH,
  TWIN_OFFSET,
  TWIN_WHEEL_WIDTH,
  WALL_THICKNESS,
} from './body-dims';
import { CAB_HEIGHT, CAB_LENGTH, FRAME_TOP, RAIL_BOTTOM, TRUCK_WHEEL_RADIUS } from './cab-dims';
import {
  applyShell,
  type Shell,
  type Shells,
  type TrailerShell,
  type TruckShells,
} from './glb-shells';
import { gradeDisabled, setGraded } from './grade';
import { trailerLamps, truckLamps } from './lamp-layout';
import { createDetailMaterial, createLampEmission, slotShell } from './lamp-lens';
import { lampState } from './lamp-state';
import { TRAILER_LOOKS, TRUCK_LOOKS } from './livery';
import { placePose } from './coords';
import { REALISM_HUES } from './realism-hues';
import { CAB_LAYER, PERSPECTIVE_LAYER, type VehicleVisual } from './seams';
import {
  ARM_HEIGHT,
  ARM_WIDTH,
  AXLE_HALF_THICKNESS,
  DRAWBAR_SPREAD,
  EYE_BLOCK,
  PLATE_RADIUS,
  PLATE_THICKNESS,
  POST_HALF_WIDTH,
  RAMP_GAP,
  RAMP_HEIGHT,
  RAMP_THICKNESS,
  RAMP_WIDTH,
  SWAP_BODY_HEIGHT,
  TRAILER_WHEEL_WIDTH,
  lowLoaderDeck,
  trailerFrame,
} from './trailer-dims';
import {
  dollyDetail,
  frontWheelDetail,
  plateGeometry,
  plateTexture,
  trailerDetail,
  truckDetail,
  type TruckDetailParams,
  type PlateSpot,
} from './vehicle-detail';
import { box, merge, WHEEL_SEGMENTS, wheelGeometry } from './vehicle-geometry';
import {
  createVehicleMaterial,
  replaceMaterial,
  type VehicleEnvironment,
  type VehicleNodeMaterial,
} from './vehicle-pbr';
import { dollySchematic, trailerSchematic, truckSchematic } from './vehicle-schematic';

export const SHADOW_NAME = 'blob-shadow';
/** Share of the contact blobs' opacity kept while the sun casts a shadow. */
const BLOB_OPACITY_UNDER_SUN = 0.5;
export const SHADOW_HEIGHT = 0.02; // above the markings
const BODY_SHADOW = { alpha: 0.5, squareness: 4, margin: 0.7 } as const;
const WHEEL_SHADOW = { alpha: 0.6, squareness: 2, growX: 1.3, growY: 1.4 } as const;
const DRAWBAR_SHADOW_HALF_WIDTH = 0.3;
const DRAWBAR_SHADOW_ALPHA = 0.25;

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

/** Soft footprint over `[x0, x1]` by `[y0, y1]` in the body frame. */
function bodyBlob(x0: number, x1: number, y0: number, y1: number, alpha: number): Blob {
  return {
    x: (x0 + x1) / 2,
    y: (y0 + y1) / 2,
    rx: (x1 - x0) / 2 + BODY_SHADOW.margin,
    ry: (y1 - y0) / 2 + BODY_SHADOW.margin,
    alpha,
    squareness: BODY_SHADOW.squareness,
  };
}

/** Contact patch of one wheel, or of a twin pair when `span` is the lateral extent. */
function wheelBlob(radius: number, span: number, x: number, y: number): Blob {
  return {
    x,
    y,
    rx: radius * WHEEL_SHADOW.growX,
    ry: (span / 2) * WHEEL_SHADOW.growY,
    alpha: WHEEL_SHADOW.alpha,
    squareness: WHEEL_SHADOW.squareness,
  };
}

function wheelAt(radius: number, width: number, x: number, y: number): BufferGeometry {
  return wheelGeometry(radius, width).translate(x, radius, -y);
}

/** Owns what a visual allocates so `dispose` releases it exactly once. */
function resources(palette: ScenePalette, env?: VehicleEnvironment) {
  const geometries = new Set<BufferGeometry>();
  const materials: Material[] = [];
  const textures: Texture[] = [];
  const detailMeshes: Mesh[] = [];
  const lamps = createLampEmission();
  let detailMaterial: MeshLambertNodeMaterial | null = null;
  const plateMaterials: MeshLambertNodeMaterial[] = [];
  let gradeOn = false;
  let pbrMaterial: VehicleNodeMaterial | null = null;
  let pbrRoot: Object3D | null = null;
  const pbrToken = {};
  let pbrWanted = false;
  let pbrMode: LightingMode = DEFAULT_LIGHTING;
  let pbrOn = false;
  let shadowMaterial: MeshBasicMaterial | null = null;
  let sunShadowed = false;
  const track = <M extends Material>(material: M): M => {
    materials.push(material);
    return material;
  };
  // the map is checked asynchronously: wear it once it is ready, and drop it when it goes
  const stopWatching = env?.onChange(() => {
    if (pbrRoot !== null) setPbr(pbrRoot);
  });
  /**
   * Reflective shading (#69) for everything below `root` and for the detail meshes a shell swap
   * has taken out of it; without `on` it repeats the last request, for shells that attach later.
   */
  const setPbr = (root: Object3D, on = pbrWanted, mode = pbrMode): void => {
    pbrRoot = root;
    pbrWanted = on;
    pbrMode = mode;
    const map = on ? (env?.texture(palette, mode) ?? null) : null;
    if (map !== null) {
      if (pbrMaterial === null) {
        pbrMaterial = track(createVehicleMaterial(map, lamps));
        setGraded(pbrMaterial, gradeOn);
      }
      pbrMaterial.envMap = map;
    } else if (pbrMaterial !== null) {
      pbrMaterial.envMap = null;
    }
    pbrOn = map !== null;
    env?.reportApplied(pbrToken, pbrOn);
    if (detailMaterial === null || pbrMaterial === null) return;
    replaceMaterial(
      [root, ...detailMeshes],
      [detailMaterial, pbrMaterial],
      pbrOn ? pbrMaterial : detailMaterial,
    );
  };
  return {
    material(color: number): MeshLambertMaterial {
      return track(new MeshLambertMaterial({ color }));
    },
    /** A mesh that casts and takes the sun's shadow; the flags only matter in the perspective views. */
    mesh(geometry: BufferGeometry, material: Material): Mesh {
      geometries.add(geometry);
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
    },
    /** Perspective-only detail: vertex colours in one shared material, off the top-down camera. */
    detail(geometry: BufferGeometry): Mesh {
      const mesh = this.mesh(geometry, this.detailMaterial());
      mesh.layers.set(PERSPECTIVE_LAYER);
      detailMeshes.push(mesh);
      return mesh;
    },
    /** The material of every `detail` mesh; shells use it too, so a swap adds no state change. */
    detailMaterial(): Material {
      if (detailMaterial === null) {
        detailMaterial = track(createDetailMaterial(lamps));
        setGraded(detailMaterial, gradeOn);
      }
      return pbrOn && pbrMaterial !== null ? pbrMaterial : detailMaterial;
    },
    setPbr,
    /** The perspective grade (`grade.ts`) on the perspective-only detail, plate and reflective materials. */
    setGrade(on: boolean): void {
      gradeOn = on;
      for (const material of plateMaterials) setGraded(material, on);
      if (detailMaterial !== null) setGraded(detailMaterial, on);
      if (pbrMaterial !== null) setGraded(pbrMaterial, on);
    },
    /** The contact blobs pale while the sun's shadow draws the real one. */
    setSunShadow(on: boolean): void {
      sunShadowed = on;
      this.syncBlobs();
    },
    /** Follows a grade failure, which also stops the sun casting; call each frame. */
    syncBlobs(): void {
      if (shadowMaterial !== null) shadowMaterial.opacity = this.blobOpacity();
    },
    blobOpacity(): number {
      return sunShadowed && !gradeDisabled() ? BLOB_OPACITY_UNDER_SUN : 1;
    },
    /** The lamp lenses of the detail and the shells, switched per snapshot. */
    lamps,
    /** Cab front: lit like detail, but off the cockpit camera, whose eye is inside the cab. */
    cabFront(geometry: BufferGeometry): Mesh {
      const mesh = this.detail(geometry);
      mesh.layers.set(CAB_LAYER);
      return mesh;
    },
    /** Perspective-only contact shadow; the geometry's vertex alpha carries the softness. */
    shadow(geometry: BufferGeometry): Mesh {
      shadowMaterial ??= track(
        new MeshBasicMaterial({
          color: 0x000000,
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      );
      shadowMaterial.opacity = this.blobOpacity();
      const mesh = this.mesh(geometry, shadowMaterial);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.name = SHADOW_NAME;
      mesh.layers.set(PERSPECTIVE_LAYER);
      return mesh;
    },
    plate(spot: PlateSpot): Mesh {
      const texture = plateTexture();
      if (texture !== null) textures.push(texture);
      const material = track(
        new MeshLambertNodeMaterial(
          texture === null ? { color: REALISM_HUES.plateWhite } : { map: texture },
        ),
      );
      plateMaterials.push(material);
      setGraded(material, gradeOn);
      const mesh = this.mesh(plateGeometry(spot), material);
      mesh.castShadow = false;
      mesh.layers.set(PERSPECTIVE_LAYER);
      return mesh;
    },
    dispose(): void {
      stopWatching?.();
      env?.reportApplied(pbrToken, false);
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}

export function proceduralTruck(
  spec: TruckSpec,
  palette: ScenePalette,
  shells?: TruckShells,
  env?: VehicleEnvironment,
): VehicleVisual {
  const a = truckAnchors(spec);
  const hw = spec.width.value / 2000;
  const rearTrack = spec.rearTrack.value / 1000;
  const frontTrack = spec.frontTrack.value / 1000;
  const look = TRUCK_LOOKS[spec.id];
  const cabRear = a.frontX - CAB_LENGTH;
  const bodyFront = bodyFrontX(a.frontX);
  const res = resources(palette, env);

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

  const floorTop = FLOOR_TOP;
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

  const detailParams: TruckDetailParams = {
    spec,
    halfWidth: hw,
    frontX: a.frontX,
    rearX: a.rearX,
    bodyFront,
    frameTop: FRAME_TOP,
    floorTop,
    railBottom: RAIL_BOTTOM,
    rearAxleX: a.rearAxle.x,
    rearTrack,
    twinOffset: TWIN_OFFSET,
    twinWidth: TWIN_WHEEL_WIDTH,
    wheelRadius: TRUCK_WHEEL_RADIUS,
  };
  const detail = truckDetail(detailParams);

  const wheelSpan = TWIN_OFFSET * 2 + TWIN_WHEEL_WIDTH;
  const truckBlobs = [
    bodyBlob(a.rearX, a.frontX, -hw, hw, BODY_SHADOW.alpha),
    ...[-1, 1].map((side) =>
      wheelBlob(TRUCK_WHEEL_RADIUS, wheelSpan, a.rearAxle.x, (side * rearTrack) / 2),
    ),
    ...[-1, 1].map((side) =>
      wheelBlob(TRUCK_WHEEL_RADIUS, TRUCK_WHEEL_WIDTH, a.frontAxle.x, (side * frontTrack) / 2),
    ),
  ];

  const cabBox = res.mesh(merge(cab), cabMaterial);
  const cabFront = res.cabFront(detail.cabFront);
  const bodyBox = res.mesh(merge(body), bodyMaterial);
  const detailMesh = res.detail(detail.geometry);
  const group = new Group();
  group.add(
    schematic.rear,
    res.shadow(blobShadow(truckBlobs, SHADOW_HEIGHT)),
    cabBox,
    res.mesh(merge(chassis), chassisMaterial),
    bodyBox,
    res.mesh(merge(rearWheels), wheelMaterial),
    detailMesh,
    cabFront,
    res.plate(detail.plate),
  );

  // each front wheel yaws about its own kingpin, so the two share one geometry
  const frontWheel = wheelGeometry(TRUCK_WHEEL_RADIUS, TRUCK_WHEEL_WIDTH);
  const frontDetail = frontWheelDetail(TRUCK_WHEEL_RADIUS, TRUCK_WHEEL_WIDTH);
  const kingpin = (side: -1 | 1): Group => {
    const pivot = new Group();
    pivot.position.set(a.frontAxle.x, TRUCK_WHEEL_RADIUS + a.frontAxle.z, (-side * frontTrack) / 2);
    pivot.add(res.mesh(frontWheel, wheelMaterial), res.detail(frontDetail), schematic.front());
    group.add(pivot);
    return pivot;
  };
  const pivotLeft = kingpin(1);
  const pivotRight = kingpin(-1);

  /*
   * A longer perspective cab pushes the body, and with it the side marking, back from where the
   * top-down body ends. Cab and body then swap as one, so the cab never overlaps the procedural body.
   */
  const linked = look.cab.length !== CAB_LENGTH;
  type Applied = ReturnType<typeof applyShell>;
  let cabShell: Applied | null = null;
  let bodyShell: Applied | null = null;
  let cabGlb = true;
  let vehicleGlb = true;
  const loadedShells: { cab: Shell | null; body: Shell | null } = { cab: null, body: null };
  const cabKey = `${spec.id}-cab`;
  const bodyKey = `${spec.id}-body`;
  const cabOn = (): boolean => (linked ? cabGlb && vehicleGlb : cabGlb);
  const bodyOn = (): boolean => (linked ? cabGlb && vehicleGlb : vehicleGlb);

  const attachCab = (shell: Shell): void => {
    slotShell(
      shell,
      truckLamps(spec, look.cab.length).lamps.filter((l) => l.part === 'cab'),
    );
    cabShell = applyShell(
      group,
      shell,
      { toAids: [cabBox], remove: [cabFront], layer: CAB_LAYER },
      {
        material: res.detailMaterial(),
        enabled: cabOn(),
        onChange: (on) => shells?.cab.attached(cabKey, on),
      },
    );
    res.setPbr(group);
  };
  const attachBody = (shell: Shell): void => {
    slotShell(shell, []);
    // the marking is part of the detail mesh, so the shortened one replaces the whole mesh
    const shortened = linked
      ? res.detail(
          truckDetail({ ...detailParams, bodyFront: bodyFrontX(a.frontX, look.cab.length) })
            .geometry,
        )
      : null;
    bodyShell = applyShell(
      group,
      shell,
      {
        toAids: [bodyBox],
        remove: shortened === null ? [] : [detailMesh],
        add: shortened === null ? [] : [shortened],
        layer: PERSPECTIVE_LAYER,
      },
      {
        material: res.detailMaterial(),
        enabled: bodyOn(),
        onChange: (on) => shells?.body.attached(bodyKey, on),
      },
    );
    res.setPbr(group);
  };
  const attachBoth = (): void => {
    if (loadedShells.cab === null || loadedShells.body === null) return;
    attachCab(loadedShells.cab);
    try {
      attachBody(loadedShells.body);
    } catch (error) {
      cabShell?.dispose();
      cabShell = null;
      throw error;
    }
  };
  const cancelCab = shells?.cab.onLoaded(cabKey, (loaded) => {
    loadedShells.cab = loaded;
    if (linked) attachBoth();
    else attachCab(loaded);
  });
  const cancelBody = shells?.body.onLoaded(bodyKey, (loaded) => {
    loadedShells.body = loaded;
    if (linked) attachBoth();
    else attachBody(loaded);
  });

  return {
    object: group,
    update(snapshot) {
      placePose(group, snapshot.truck);
      pivotRight.rotation.y = snapshot.roadWheelAngle;
      pivotLeft.rotation.y = snapshot.roadWheelAngle;
      res.lamps.update(lampState(snapshot));
      res.syncBlobs();
    },
    setLook({ flags, grade, mode }) {
      cabGlb = flags.cabGlb;
      vehicleGlb = flags.vehicleGlb;
      cabShell?.setEnabled(cabOn());
      bodyShell?.setEnabled(bodyOn());
      res.setGrade(grade.on);
      res.setSunShadow(flags.sunShadow && grade.on);
      res.setPbr(group, flags.pbr, mode);
    },
    dispose() {
      cancelCab?.();
      cancelBody?.();
      cabShell?.dispose();
      bodyShell?.dispose();
      res.dispose();
      schematic.dispose();
    },
  };
}

export function proceduralTrailer(
  spec: TrailerSpec,
  palette: ScenePalette,
  shells?: Shells<TrailerShell>,
  env?: VehicleEnvironment,
): VehicleVisual {
  const { a, hw, track, deck, isBox, underside, radius, axleZ, plateBottom, plateMid, kink } =
    trailerFrame(spec);
  const res = resources(palette, env);

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
    box(
      [a.eye.x - EYE_BLOCK.back, a.eye.x + EYE_BLOCK.front],
      [-EYE_BLOCK.halfWidth, EYE_BLOCK.halfWidth],
      [a.eye.z - EYE_BLOCK.halfHeight, a.eye.z + EYE_BLOCK.halfHeight],
    ),
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
      const [y0, y1] =
        side < 0 ? [-RAMP_GAP - RAMP_WIDTH, -RAMP_GAP] : [RAMP_GAP, RAMP_GAP + RAMP_WIDTH];
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

  const dollyRims = dollyDetail(
    radius,
    TRAILER_WHEEL_WIDTH,
    a.frontAxle.x,
    track,
    trailerLamps(spec, 'procedural'),
  );
  const trailerRig = trailerDetail({
    spec,
    halfWidth: hw,
    rearX: a.rearX,
    frontX: a.frontX,
    deck,
    underside,
    bodyTop: isBox ? deck + SWAP_BODY_HEIGHT : deck,
    isBox,
    radius,
    track,
    wheelWidth: TRAILER_WHEEL_WIDTH,
    rearAxleXs: a.rearAxles.map((axle) => axle.x),
    shellDeck: TRAILER_LOOKS[spec.id].kind === 'low-loader' ? lowLoaderDeck(spec) : null,
  });

  const dollyBlobs = [
    {
      ...bodyBlob(
        Math.min(0, a.eye.x),
        Math.max(0, a.eye.x),
        -DRAWBAR_SHADOW_HALF_WIDTH,
        DRAWBAR_SHADOW_HALF_WIDTH,
        DRAWBAR_SHADOW_ALPHA,
      ),
      squareness: 2,
    },
    ...[-1, 1].map((side) =>
      wheelBlob(radius, TRAILER_WHEEL_WIDTH, a.frontAxle.x, (side * track) / 2),
    ),
  ];
  const trailerBlobs = [
    bodyBlob(a.rearX, a.frontX, -hw, hw, BODY_SHADOW.alpha),
    ...a.rearAxles.flatMap((axle) =>
      [-1, 1].map((side) => wheelBlob(radius, TRAILER_WHEEL_WIDTH, axle.x, (side * track) / 2)),
    ),
  ];

  const dollyChassisMesh = res.mesh(merge(dollyChassis), chassisMaterial);
  const bodyMesh = res.mesh(merge(bodyParts), bodyMaterial);
  const frameMesh = res.mesh(merge([...rails, ...axleBeams]), chassisMaterial);
  const detailMesh = res.detail(trailerRig.geometry);
  const dolly = new Group();
  dolly.add(
    res.shadow(blobShadow(dollyBlobs, SHADOW_HEIGHT)),
    dollyChassisMesh,
    res.mesh(merge(dollyWheels), wheelMaterial),
    dollyPlan.mesh,
    res.detail(dollyRims),
  );
  const trailer = new Group();
  trailer.add(
    res.shadow(blobShadow(trailerBlobs, SHADOW_HEIGHT)),
    trailerPlan.mesh,
    bodyMesh,
    frameMesh,
    res.mesh(merge(trailerWheels), wheelMaterial),
    detailMesh,
    res.plate(trailerRig.plate),
  );
  const group = new Group();
  group.add(dolly, trailer);

  type Applied = ReturnType<typeof applyShell>;
  let applied: { readonly trailer: Applied; readonly dolly: Applied } | null = null;
  let shown = false;
  let vehicleGlb = true;
  const key = `${spec.id}-trailer`;
  /** Both halves switch together or not at all; the shell counts as attached only while both show. */
  const showShell = (on: boolean): void => {
    if (applied === null || on === shown) return;
    const halves = [applied.trailer, applied.dolly];
    try {
      for (const half of halves) half.setEnabled(on);
    } catch (error) {
      console.warn(`Shell ${key} could not be switched; keeping the previous state`, error);
      try {
        for (const half of halves) half.setEnabled(shown);
      } catch (undoError) {
        console.warn(`Shell ${key} could not be restored`, undoError);
      }
      return;
    }
    shown = on;
    shells?.attached(key, on);
  };
  const attach = (shell: TrailerShell): void => {
    const shellLamps = trailerLamps(spec, 'shell').lamps;
    slotShell(
      shell.trailer,
      shellLamps.filter((l) => l.shell && l.part === 'trailer'),
    );
    slotShell(shell.dolly, []);
    const material = res.detailMaterial();
    // a bare chassis drops the swap body's marking; a low-loader's detail follows its deck
    const bare = trailerRig.shellGeometry === null ? null : res.detail(trailerRig.shellGeometry);
    // both start off, so a failure here leaves the groups as they were
    const onBody = applyShell(
      trailer,
      shell.trailer,
      {
        toAids: [bodyMesh, frameMesh],
        remove: bare === null ? [] : [detailMesh],
        add: bare === null ? [] : [bare],
        layer: PERSPECTIVE_LAYER,
      },
      { material, enabled: false },
    );
    const onDolly = applyShell(
      dolly,
      shell.dolly,
      { toAids: [dollyChassisMesh], remove: [], layer: PERSPECTIVE_LAYER },
      { material, enabled: false },
    );
    applied = { trailer: onBody, dolly: onDolly };
    showShell(vehicleGlb);
    res.setPbr(group);
  };
  const cancel = shells?.onLoaded(key, attach);

  return {
    object: group,
    update(snapshot) {
      placePose(dolly, snapshot.dolly);
      placePose(trailer, snapshot.trailer);
      res.lamps.update(lampState(snapshot));
      res.syncBlobs();
    },
    setLook({ flags, grade, mode }) {
      vehicleGlb = flags.vehicleGlb;
      showShell(vehicleGlb);
      res.setGrade(grade.on);
      res.setSunShadow(flags.sunShadow && grade.on);
      res.setPbr(group, flags.pbr, mode);
    },
    dispose() {
      cancel?.();
      showShell(false);
      res.dispose();
      dollyPlan.dispose();
      trailerPlan.dispose();
    },
  };
}
