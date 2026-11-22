import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Rect } from '../contracts/render';
import type { TruckSpec } from '../contracts/vehicle';
import { type CabSight, cabSight } from './cab-sight';
import {
  CLEAR_CONE_DEG,
  CONE_GAP,
  coneEdge,
  headerEdge,
  MAX_SHIFT,
  MIN_PILLAR_WIDTH,
  MIRROR_GAP,
  PILLAR_LEAN,
  type PillarSpan,
  pillarSlot,
  VISOR,
} from './cockpit-band';
import { REALISM_HUES, type RealismHueKey } from './realism-hues';
import type { Look } from './look';
import { INTERIOR_LAYER, type CockpitInterior } from './seams';
import { tint } from './tint';

/**
 * The cab interior as the cockpit camera sees it: dashboard edge, A-pillars, roof header and a
 * stowed visor, from the left-hand seat: the cab's windscreen centre lies to the right of the view axis. The parts are authored in normalised device coordinates on a plane `DEPTH` ahead of
 * the eye and `place` scales them to the camera's field of view, so the framing holds at every aspect.
 */

/** Metres ahead of the eye: only above the near plane, since the parts draw without depth. */
const DEPTH = 0.5;
/** Past the view edge, so no hairline shows at the border. */
const BLEED = 1.05;
const STRIP_STEPS = 48;

/** The dashboard's top edge as NDC y at NDC x: lowest at `shift`, rising towards the sides. */
export const dashEdge = (x: number, shift = 0): number => -0.52 + 0.06 * (x - shift) ** 2;
const DASH_LIP = 0.035;

/** The instrument binnacle over the dash straight ahead of the driver; `top` stays below the sight cone. */
export const HUMP = { halfWidth: 0.3, drop: 0.12, top: -0.475 };
const hump = (x: number): number => HUMP.top - HUMP.drop * (Math.abs(x) / HUMP.halfWidth) ** 4;

/**
 * NDC x where the dash is lowest and the header highest: the cab windscreen's centre in a pane of
 * `aspect`, held to `MAX_SHIFT` (the centre lies past the view edge in narrow panes).
 */
export function edgeShift(truck: TruckSpec, aspect: number, fov: number): number {
  const { windscreenCentre } = cabSight(truck);
  const ndc = Math.tan(windscreenCentre) / (aspect * Math.tan(MathUtils.degToRad(fov / 2)));
  return Math.min(ndc, MAX_SHIFT);
}

export {
  CLEAR_CONE_DEG,
  CONE_GAP,
  coneEdge,
  headerEdge,
  MIN_PILLAR_WIDTH,
  MIRROR_GAP,
  VISOR,
  type PillarSpan,
};

const VISOR_LIP = 0.025;

/** The visor's left edge: `VISOR.left`, kept `MIRROR_GAP` clear of the left mirror's inner edge (`mirrorInner` from the centre). */
export const visorLeft = (mirrorInner: number): number =>
  Math.min(Math.max(VISOR.left, MIRROR_GAP - mirrorInner), VISOR.right);

/** The mirror rects' inner edges as distances from the view centre in NDC; 1 where there is no mirror. */
export type InteriorLayout = { left: number; right: number };

/** `cockpit` and the mirror rects are in CSS px; the result is written to `into` when given. */
export function interiorLayout(
  cockpit: Rect,
  mirrorLeft: Rect | null,
  mirrorRight: Rect | null,
  into: InteriorLayout = { left: 1, right: 1 },
): InteriorLayout {
  const ndc = (x: number): number => (2 * (x - cockpit.x)) / cockpit.width - 1;
  into.left = mirrorLeft === null ? 1 : -ndc(mirrorLeft.x + mirrorLeft.width);
  into.right = mirrorRight === null ? 1 : ndc(mirrorRight.x);
  return into;
}

export type PillarSpans = { left: PillarSpan | null; right: PillarSpan | null };

/**
 * Both pillars in NDC, each in its own slot between the sight cone and its mirror. The near (left)
 * pillar fills its slot. The far one is stylised: from the left seat it lies past the view's edge
 * (`CabSight`), so only its width follows the sight, narrower than the near pillar by the ratio of
 * the angles they cover, and it keeps its outer edge at its mirror. It is never wider than the near
 * pillar nor than its own slot, and it is dropped with it: null where a slot is too narrow.
 */
export function pillarSpans(
  sight: CabSight,
  aspect: number,
  fov: number,
  layout: InteriorLayout,
): PillarSpans {
  const left = pillarSlot(aspect, fov, layout.left);
  const slot = pillarSlot(aspect, fov, layout.right);
  if (left === null || slot === null) return { left, right: null };
  const width = Math.min(
    slot.width,
    Math.max(MIN_PILLAR_WIDTH, (left.width * sight.right.covered) / sight.left.covered),
  );
  return { left, right: { centre: slot.centre + (slot.width - width) / 2, width } };
}

function paint(positions: number[], index: number[], hue: RealismHueKey): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return tint(geometry, new Color().set(REALISM_HUES[hue]));
}

/** A band between two curves over x in [-BLEED, BLEED], on the plane z = -1. */
function strip(
  top: (x: number) => number,
  bottom: (x: number) => number,
  hue: RealismHueKey,
): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= STRIP_STEPS; i++) {
    const x = -BLEED + (2 * BLEED * i) / STRIP_STEPS;
    positions.push(x, top(x), -1, x, bottom(x), -1);
    if (i > 0) {
      const k = 2 * i;
      index.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  return paint(positions, index, hue);
}

function quad(corners: readonly (readonly [number, number])[], hue: RealismHueKey): BufferGeometry {
  return paint(
    corners.flatMap(([x, y]) => [x, y, -1]),
    [0, 1, 2, 0, 2, 3],
    hue,
  );
}

/** The flat overlay: the `CockpitInterior` the Balanced preset draws, with its parts exposed. */
export type FlatInterior = CockpitInterior & {
  readonly object: Group;
  readonly meshes: readonly Mesh[];
  readonly pillars: { readonly left: Mesh; readonly right: Mesh };
};

/** The binnacle's lit lip: a thin strip along the hump's top edge, inside the dash, narrow enough to stay on the hump at every `shift`. */
export const LIP = { halfWidth: 0.15, thickness: 0.012, gap: 0.004 };
/** Linear colour of the lip's glow. */
const LIP_COLOUR = new Color(0xff9a3c).multiplyScalar(0.55);

/** The lip's top edge as NDC y at NDC x. */
export const lipTop = (x: number): number => hump(x) - LIP.gap;

const LIP_STEPS = 12;

function lipGeometry(): BufferGeometry {
  const positions: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= LIP_STEPS; i++) {
    const x = -LIP.halfWidth + (2 * LIP.halfWidth * i) / LIP_STEPS;
    positions.push(x, lipTop(x), -1, x, lipTop(x) - LIP.thickness, -1);
    if (i > 0) {
      const k = 2 * i;
      index.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return tint(geometry, LIP_COLOUR);
}
/** Fixes `object` to the camera's eye, scaled so its NDC parts fill the field of view at `DEPTH`. */
export function placeInEye(object: Object3D, camera: PerspectiveCamera): void {
  const tanV = Math.tan(MathUtils.degToRad(camera.fov / 2));
  object.position.copy(camera.position);
  object.quaternion.copy(camera.quaternion);
  object.scale.set(camera.aspect * tanV * DEPTH, tanV * DEPTH, DEPTH);
}

/** The instrument backlight's visible part: shown at night only, over everything else in the cockpit view. */
export type BinnacleLip = {
  readonly mesh: Mesh;
  setLook(look: Look): void;
  dispose(): void;
};

export function createBinnacleLip(): BinnacleLip {
  const geometry = lipGeometry();
  const material = new MeshBasicMaterial({
    vertexColors: true,
    side: DoubleSide,
    fog: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    forceSinglePass: true,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'binnacle-lip';
  mesh.layers.set(INTERIOR_LAYER);
  mesh.renderOrder = 102;
  mesh.visible = false;
  return {
    mesh,
    setLook(look) {
      mesh.visible = look.mode === 'night';
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createCockpitInterior(truck: TruckSpec): FlatInterior {
  const sight = cabSight(truck);
  const object = new Group();
  object.name = 'cockpit-interior';
  const material = new MeshBasicMaterial({
    vertexColors: true,
    side: DoubleSide,
    fog: false,
    // Over everything else in the cockpit view, blended shadows included.
    depthTest: false,
    depthWrite: false,
    transparent: true,
    // Every part is a single flat layer: without this a double-sided transparent mesh draws twice.
    forceSinglePass: true,
  });
  const geometries: BufferGeometry[] = [];
  const meshes: Mesh[] = [];
  const add = (name: string, order: number, geometry: BufferGeometry): Mesh => {
    geometries.push(geometry);
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.layers.set(INTERIOR_LAYER);
    mesh.renderOrder = 100 + order;
    object.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  // Authored for the right side; the left pillar is its mirror image.
  const pillar = (): BufferGeometry =>
    quad(
      [
        [-0.5, -BLEED],
        [0.5, -BLEED],
        [0.5 - PILLAR_LEAN, BLEED],
        [-0.5 - PILLAR_LEAN, BLEED],
      ],
      'anthracite',
    );
  const right = add('pillar-right', 0, pillar());
  const left = add('pillar-left', 0, pillar());
  // One draw for the static parts; later triangles cover earlier ones, since nothing is depth tested.
  const buildFrame = (shift: number, visor: number): BufferGeometry => {
    const dash = (x: number): number => Math.max(dashEdge(x, shift), hump(x));
    const header = (x: number): number => headerEdge(x, shift);
    const parts = [
      strip(
        (x) => dash(x) - DASH_LIP,
        () => -BLEED,
        'chevronBlack',
      ),
      strip(dash, (x) => dash(x) - DASH_LIP, 'anthracite'),
      strip(() => BLEED, header, 'headliner'),
      quad(
        [
          [visor, VISOR.bottom],
          [VISOR.right, VISOR.bottom],
          [VISOR.right, header(VISOR.right)],
          [visor, header(visor)],
        ],
        'anthracite',
      ),
      quad(
        [
          [visor, VISOR.bottom],
          [VISOR.right, VISOR.bottom],
          [VISOR.right, VISOR.bottom + VISOR_LIP],
          [visor, VISOR.bottom + VISOR_LIP],
        ],
        'headliner',
      ),
    ];
    const merged = mergeGeometries(parts);
    parts.forEach((g) => g.dispose());
    return merged;
  };
  let shift = MAX_SHIFT;
  let visor = VISOR.left;
  const frame = add('frame', 1, buildFrame(shift, visor));
  const lip = createBinnacleLip();
  object.add(lip.mesh);
  object.visible = false;
  /** The windscreen centre and the mirror move with the pane: the frame is rebuilt only when one of them does. */
  const shape = (nextShift: number, nextVisor: number): void => {
    if (nextShift === shift && nextVisor === visor) return;
    shift = nextShift;
    visor = nextVisor;
    const previous = frame.geometry;
    frame.geometry = buildFrame(shift, visor);
    geometries[geometries.indexOf(previous)] = frame.geometry;
    previous.dispose();
  };

  const layout: InteriorLayout = { left: 1, right: 1 };
  const placePillar = (mesh: Mesh, side: -1 | 1, span: PillarSpan | null): void => {
    mesh.visible = span !== null;
    if (span === null) return;
    mesh.position.x = side * span.centre;
    mesh.scale.x = side * span.width;
  };

  return {
    object,
    frame: 'eye',
    meshes,
    pillars: { left, right },
    place({ camera, cockpit, mirrorLeft, mirrorRight }) {
      placeInEye(object, camera);
      interiorLayout(cockpit, mirrorLeft, mirrorRight, layout);
      shape(edgeShift(truck, camera.aspect, camera.fov), visorLeft(layout.left));
      const spans = pillarSpans(sight, camera.aspect, camera.fov, layout);
      placePillar(left, -1, spans.left);
      placePillar(right, 1, spans.right);
      object.updateMatrixWorld(true);
    },
    setLook(look) {
      object.visible = look.flags.cockpitInterior;
      material.color.setRGB(...look.interior.unlit);
      lip.setLook(look);
    },
    dispose() {
      lip.dispose();
      geometries.forEach((g) => g.dispose());
      material.dispose();
    },
  };
}
