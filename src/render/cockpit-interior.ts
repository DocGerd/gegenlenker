import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
} from 'three';
import type { Rect } from '../contracts/render';
import type { QualityFlags } from './quality';
import { REALISM_HUES, type RealismHueKey } from './realism-hues';
import { INTERIOR_LAYER } from './seams';
import { tint } from './tint';

/**
 * The cab interior as the cockpit camera sees it: dashboard top edge, A-pillars, roof header and a
 * stowed sun visor. A real cab frames the view far outside a 55 degree window (the pillars stand
 * 30 to 55 degrees off axis, the header 40 degrees up), so the parts are authored in the camera's own
 * frame, in normalised device coordinates on a plane `DEPTH` ahead of the eye, and `place` scales
 * them to the camera's field of view. The framing therefore holds at every aspect. The pillars sit
 * between the forward sight cone and the mirror rects, so neither is hidden.
 */

/** Metres ahead of the eye: only above the near plane, since the parts draw without depth. */
const DEPTH = 0.5;
/** Past the view edge, so no hairline shows at the border. */
const BLEED = 1.05;
const STRIP_STEPS = 24;

/** The dashboard's top edge as NDC y at NDC x: lowest at the centre, rising towards the sides. It stands above the opaque HUD band (the lower 18% of the cockpit), so it shows. */
export const dashEdge = (x: number): number => -0.52 + 0.06 * x * x;
/** The header's lower edge: highest at the centre, and above the mirror rects' top row everywhere. */
export const headerEdge = (x: number): number => 0.78 - 0.06 * x * x;
const DASH_LIP = 0.035;

/** Half-angle in degrees about the view axis of the forward sight cone that no part may enter. */
export const CLEAR_CONE_DEG = 12;
/** NDC gaps between a pillar and the cone, and between a pillar and a mirror rect. */
const CONE_GAP = 0.05;
const MIRROR_GAP = 0.03;
const PILLAR_WIDTH = 0.12;
const MIN_PILLAR_WIDTH = 0.03;
/** The pillar's top edge leans this far towards the centre of the view, in pillar widths. */
const PILLAR_LEAN = 0.25;

const VISOR = { left: -0.5, right: -0.08, bottom: 0.62 };
const VISOR_LIP = 0.025;

/** The mirror rects' inner edges as distances from the view centre in NDC; 1 where there is no mirror. */
export type InteriorLayout = { readonly left: number; readonly right: number };

/** `cockpit` and the mirror rects are in CSS px. */
export function interiorLayout(
  cockpit: Rect,
  mirrorLeft: Rect | null,
  mirrorRight: Rect | null,
): InteriorLayout {
  const ndc = (x: number): number => (2 * (x - cockpit.x)) / cockpit.width - 1;
  return {
    left: mirrorLeft === null ? 1 : -ndc(mirrorLeft.x + mirrorLeft.width),
    right: mirrorRight === null ? 1 : ndc(mirrorRight.x),
  };
}

/** NDC x of the forward sight cone's edge. */
export function coneEdge(aspect: number, fov: number): number {
  return (
    Math.tan(MathUtils.degToRad(CLEAR_CONE_DEG)) / (aspect * Math.tan(MathUtils.degToRad(fov / 2)))
  );
}

/** A pillar's centre and width in NDC beside a mirror whose inner edge is `mirrorInner` from the centre; null where it does not fit. */
export function pillarSpan(
  aspect: number,
  fov: number,
  mirrorInner: number,
): { centre: number; width: number } | null {
  const outer = Math.min(mirrorInner - MIRROR_GAP, 1);
  const inner = Math.max(outer - PILLAR_WIDTH, coneEdge(aspect, fov) + CONE_GAP);
  const width = outer - inner;
  return width < MIN_PILLAR_WIDTH ? null : { centre: (inner + outer) / 2, width };
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

export type CockpitInterior = {
  readonly object: Group;
  readonly meshes: readonly Mesh[];
  readonly pillars: { readonly left: Mesh; readonly right: Mesh };
  /** Fixes the parts to `camera`'s current pose and field of view. */
  place(camera: PerspectiveCamera, layout: InteriorLayout): void;
  setQuality(flags: QualityFlags): void;
  dispose(): void;
};

export function createCockpitInterior(): CockpitInterior {
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
  add(
    'dash',
    1,
    strip(
      (x) => dashEdge(x) - DASH_LIP,
      () => -BLEED,
      'chevronBlack',
    ),
  );
  add(
    'dash-lip',
    1,
    strip(dashEdge, (x) => dashEdge(x) - DASH_LIP, 'anthracite'),
  );
  add(
    'header',
    1,
    strip(() => BLEED, headerEdge, 'headliner'),
  );
  add(
    'visor',
    2,
    quad(
      [
        [VISOR.left, VISOR.bottom],
        [VISOR.right, VISOR.bottom],
        [VISOR.right, headerEdge(VISOR.right)],
        [VISOR.left, headerEdge(VISOR.left)],
      ],
      'anthracite',
    ),
  );
  add(
    'visor-lip',
    2,
    quad(
      [
        [VISOR.left, VISOR.bottom],
        [VISOR.right, VISOR.bottom],
        [VISOR.right, VISOR.bottom + VISOR_LIP],
        [VISOR.left, VISOR.bottom + VISOR_LIP],
      ],
      'headliner',
    ),
  );
  object.visible = false;

  return {
    object,
    meshes,
    pillars: { left, right },
    place(camera, layout) {
      const tanV = Math.tan(MathUtils.degToRad(camera.fov / 2));
      object.position.copy(camera.position);
      object.quaternion.copy(camera.quaternion);
      object.scale.set(camera.aspect * tanV * DEPTH, tanV * DEPTH, DEPTH);
      for (const [mesh, side, inner] of [
        [left, -1, layout.left],
        [right, 1, layout.right],
      ] as const) {
        const span = pillarSpan(camera.aspect, camera.fov, inner);
        mesh.visible = span !== null;
        if (span === null) continue;
        mesh.position.x = side * span.centre;
        mesh.scale.x = side * span.width;
      }
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
