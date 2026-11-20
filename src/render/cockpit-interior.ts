import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Rect } from '../contracts/render';
import type { TruckSpec } from '../contracts/vehicle';
import { type CabSight, cabSight } from './cab-sight';
import { COCKPIT_FOV } from './cockpit-camera';
import { REALISM_HUES, type RealismHueKey } from './realism-hues';
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
/** The header's lower edge: highest at `shift`, and as high at the left view edge as unshifted, where the left mirror sits. */
export const headerEdge = (x: number, shift = 0): number =>
  0.78 - 0.06 * ((x - shift) / (1 + shift)) ** 2;
const DASH_LIP = 0.035;

/** The aspect the dash and header are shaped for, as the ratio of a landscape drive layout's cockpit view. */
const REFERENCE_ASPECT = 2.4;
/** NDC; the dash low point and header high point never move further right than this. */
const MAX_SHIFT = 0.45;
/** The instrument binnacle over the dash straight ahead of the driver; `top` stays below the sight cone. */
export const HUMP = { halfWidth: 0.3, drop: 0.12, top: -0.475 };
const hump = (x: number): number => HUMP.top - HUMP.drop * (Math.abs(x) / HUMP.halfWidth) ** 4;

/** NDC x of the cab windscreen's centre, where the dash is lowest and the header highest. */
export function edgeShift(truck: TruckSpec, fov: number): number {
  const { windscreenCentre } = cabSight(truck);
  const ndc =
    Math.tan(windscreenCentre) / (REFERENCE_ASPECT * Math.tan(MathUtils.degToRad(fov / 2)));
  return Math.min(ndc, MAX_SHIFT);
}

/** Half-angle in degrees about the view axis of the forward sight cone that no part may enter. */
export const CLEAR_CONE_DEG = 12;
/** NDC gaps between a pillar and the cone, and between a pillar and a mirror rect. */
export const CONE_GAP = 0.05;
export const MIRROR_GAP = 0.03;
const PILLAR_WIDTH = 0.12;
/** NDC; a narrower pillar is a sliver. */
export const MIN_PILLAR_WIDTH = 0.06;
/** The pillar's top edge leans this far towards the centre of the view, in pillar widths. */
const PILLAR_LEAN = 0.25;

export const VISOR = { left: -0.55, right: 0, bottom: 0.62 };
const VISOR_LIP = 0.025;

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

/** NDC x of the forward sight cone's edge. */
export function coneEdge(aspect: number, fov: number): number {
  return (
    Math.tan(MathUtils.degToRad(CLEAR_CONE_DEG)) / (aspect * Math.tan(MathUtils.degToRad(fov / 2)))
  );
}

export type PillarSpan = { centre: number; width: number };

/** The room for a pillar in NDC beside a mirror whose inner edge is `mirrorInner` from the centre; null where it does not fit. */
function pillarSlot(aspect: number, fov: number, mirrorInner: number): PillarSpan | null {
  const outer = Math.min(mirrorInner - MIRROR_GAP, 1);
  const inner = Math.max(outer - PILLAR_WIDTH, coneEdge(aspect, fov) + CONE_GAP);
  const width = outer - inner;
  return width < MIN_PILLAR_WIDTH ? null : { centre: (inner + outer) / 2, width };
}

export type PillarSpans = { left: PillarSpan | null; right: PillarSpan | null };

/**
 * Both pillars in NDC, each in its own slot between the sight cone and its mirror. The near (left)
 * pillar fills the slot; the far one is narrower by the ratio of the angles the two cover from the
 * eye, and keeps its outer edge at the mirror. A pillar is null where its slot is too narrow.
 */
export function pillarSpans(
  sight: CabSight,
  aspect: number,
  fov: number,
  layout: InteriorLayout,
): PillarSpans {
  const left = pillarSlot(aspect, fov, layout.left);
  const slot = pillarSlot(aspect, fov, layout.right);
  let right: PillarSpan | null = null;
  if (slot !== null) {
    const width = Math.max(
      MIN_PILLAR_WIDTH,
      (slot.width * sight.right.covered) / sight.left.covered,
    );
    right = { centre: slot.centre + (slot.width - width) / 2, width };
  }
  return { left, right };
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

export function createCockpitInterior(truck: TruckSpec): FlatInterior {
  const sight = cabSight(truck);
  const shift = edgeShift(truck, COCKPIT_FOV);
  const dash = (x: number): number => Math.max(dashEdge(x, shift), hump(x));
  const header = (x: number): number => headerEdge(x, shift);
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
        [VISOR.left, VISOR.bottom],
        [VISOR.right, VISOR.bottom],
        [VISOR.right, header(VISOR.right)],
        [VISOR.left, header(VISOR.left)],
      ],
      'anthracite',
    ),
    quad(
      [
        [VISOR.left, VISOR.bottom],
        [VISOR.right, VISOR.bottom],
        [VISOR.right, VISOR.bottom + VISOR_LIP],
        [VISOR.left, VISOR.bottom + VISOR_LIP],
      ],
      'headliner',
    ),
  ];
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  add('frame', 1, merged);
  object.visible = false;

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
      const tanV = Math.tan(MathUtils.degToRad(camera.fov / 2));
      object.position.copy(camera.position);
      object.quaternion.copy(camera.quaternion);
      object.scale.set(camera.aspect * tanV * DEPTH, tanV * DEPTH, DEPTH);
      interiorLayout(cockpit, mirrorLeft, mirrorRight, layout);
      const spans = pillarSpans(sight, camera.aspect, camera.fov, layout);
      placePillar(left, -1, spans.left);
      placePillar(right, 1, spans.right);
      object.updateMatrixWorld(true);
    },
    setQuality(flags) {
      object.visible = flags.cockpitInterior;
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      material.dispose();
    },
  };
}
