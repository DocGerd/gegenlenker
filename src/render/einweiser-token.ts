import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Shape,
  ShapeGeometry,
  type BufferGeometry,
} from 'three';
import type { EinweiserVisual, ScenePalette } from '../contracts/render';
import { placePose } from './coords';
import { AID_STROKE, AIDS_LAYER } from './seams';

/** The core's disc radius and how far ahead of his centre its facing wedge ends (m). */
export const TOKEN_RADIUS = 0.4;
export const TOKEN_TIP = 0.95;
const ARC_SEGMENTS = 24;
const TOKEN_Y = 0.07;
/** Over every aid, the contact marker included: he stays visible on top of what he stands in. */
const TOKEN_ORDER = 13;

/** A disc of `radius` that runs out into a wedge with its tip `tip` ahead on +x, in the sim plane. */
function teardrop(radius: number, tip: number): Shape {
  const from = Math.acos(radius / tip);
  const shape = new Shape();
  shape.moveTo(tip, 0);
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const a = from + (i / ARC_SEGMENTS) * (2 * Math.PI - 2 * from);
    shape.lineTo(radius * Math.cos(a), radius * Math.sin(a));
  }
  return shape;
}

/** Lies in the ground plane: shape x forward, y left, as the sim's body frame. */
const flat = (shape: Shape): BufferGeometry => new ShapeGeometry(shape).rotateX(-Math.PI / 2);

export type EinweiserToken = {
  readonly object: Group;
  /** Hidden without `visual`: a driver run or a replay. */
  update(visual: EinweiserVisual | undefined): void;
  dispose(): void;
};

/**
 * The Einweiser in the top-down view: an unlit `einweiser` core on a `wheel` casing, the casing
 * offset by `AID_STROKE.casing` all round (at the wedge tip along its bisector), so it reads on every
 * ground (`docs/brand/BRAND.md`).
 */
export function createEinweiserToken(palette: ScenePalette): EinweiserToken {
  const casing = AID_STROKE.casing;
  const group = new Group();
  group.visible = false;
  group.position.y = TOKEN_Y;
  const meshes = [
    {
      geometry: flat(teardrop(TOKEN_RADIUS + casing, TOKEN_TIP * (1 + casing / TOKEN_RADIUS))),
      color: palette.wheel,
    },
    { geometry: flat(teardrop(TOKEN_RADIUS, TOKEN_TIP)), color: palette.einweiser },
  ].map(({ geometry, color }, i) => {
    const material = new MeshBasicMaterial({
      color,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.renderOrder = TOKEN_ORDER + i;
    return mesh;
  });
  group.add(...meshes);
  group.traverse((o) => o.layers.set(AIDS_LAYER));
  return {
    object: group,
    update(visual) {
      group.visible = visual !== undefined;
      if (visual !== undefined) placePose(group, visual.pose);
    },
    dispose() {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    },
  };
}
