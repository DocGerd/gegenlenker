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
import { REALISM_HUES, type RealismHueKey } from './realism-hues';
import { INTERIOR_LAYER, type CockpitInterior } from './seams';
import { tint } from './tint';

/**
 * The cab interior as the cockpit camera sees it: dashboard edge, A-pillars, roof header and a
 * stowed visor. The parts are authored in normalised device coordinates on a plane `DEPTH` ahead of
 * the eye and `place` scales them to the camera's field of view, so the framing holds at every aspect.
 */

/** Metres ahead of the eye: only above the near plane, since the parts draw without depth. */
const DEPTH = 0.5;
/** Past the view edge, so no hairline shows at the border. */
const BLEED = 1.05;
const STRIP_STEPS = 24;

/** The dashboard's top edge as NDC y at NDC x: lowest at the centre, rising towards the sides. */
export const dashEdge = (x: number): number => -0.52 + 0.06 * x * x;
/** The header's lower edge: highest at the centre. */
export const headerEdge = (x: number): number => 0.78 - 0.06 * x * x;
const DASH_LIP = 0.035;

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

const VISOR = { left: -0.5, right: -0.08, bottom: 0.62 };
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

/** A pillar's centre and width in NDC beside a mirror whose inner edge is `mirrorInner` from the centre; null where it does not fit. */
export function pillarSpan(
  aspect: number,
  fov: number,
  mirrorInner: number,
  into: PillarSpan = { centre: 0, width: 0 },
): PillarSpan | null {
  const outer = Math.min(mirrorInner - MIRROR_GAP, 1);
  const inner = Math.max(outer - PILLAR_WIDTH, coneEdge(aspect, fov) + CONE_GAP);
  into.width = outer - inner;
  into.centre = (inner + outer) / 2;
  return into.width < MIN_PILLAR_WIDTH ? null : into;
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

export function createCockpitInterior(): FlatInterior {
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
      (x) => dashEdge(x) - DASH_LIP,
      () => -BLEED,
      'chevronBlack',
    ),
    strip(dashEdge, (x) => dashEdge(x) - DASH_LIP, 'anthracite'),
    strip(() => BLEED, headerEdge, 'headliner'),
    quad(
      [
        [VISOR.left, VISOR.bottom],
        [VISOR.right, VISOR.bottom],
        [VISOR.right, headerEdge(VISOR.right)],
        [VISOR.left, headerEdge(VISOR.left)],
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
  const span: PillarSpan = { centre: 0, width: 0 };
  const placePillar = (
    mesh: Mesh,
    side: -1 | 1,
    aspect: number,
    fov: number,
    inner: number,
  ): void => {
    mesh.visible = pillarSpan(aspect, fov, inner, span) !== null;
    if (!mesh.visible) return;
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
      placePillar(left, -1, camera.aspect, camera.fov, layout.left);
      placePillar(right, 1, camera.aspect, camera.fov, layout.right);
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
