import type { Texture } from 'three';
import {
  abs,
  attribute,
  clamp,
  dFdx,
  dFdy,
  dot,
  float,
  floor,
  fract,
  fwidth,
  max,
  min,
  mix,
  normalize,
  positionWorld,
  select,
  sin,
  smoothstep,
  sqrt,
  texture,
  transformNormalToView,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu';
import { GLOSS_FROM, GLOSS_ROUGHNESS, WEAR_DARKEN } from './ground-mask';
import { GROUND_TEXTURE_MEAN } from './ground-texture-pixels';
import { PBR_ALBEDO_MEAN, PBR_PACKED, PBR_SURFACE_IDS, type PbrSurface } from './ground-pbr-pixels';
import {
  JOINT_DARKEN,
  JOINT_HALF_WIDTH,
  JOINT_OCCLUDE,
  MACRO_BIAS,
  PBR_TILE,
  type PbrKey,
  SLAB_PITCH,
  SLAB_UV_TRANSFORMS,
  slabNormalMatrix,
  VERGE_ROUGHNESS,
} from './ground-pbr-spec';

/** The ground mask (`groundMask`) and the metres its texture spans from the layout origin. */
export type MaskBinding = {
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
};

/** Names the PBR ground in its shader, so a compile error can be traced to it. */
export const GROUND_PBR_MARKER = 'groundPbr';

type Vec2Node = Node<'vec2'>;
type FloatNode = Node<'float'>;

const hash = (cell: Vec2Node, seed: number): FloatNode =>
  fract(sin(dot(cell, vec2(127.1 + seed, 311.7 - seed))).mul(43758.5453));

const channel = (node: Node<'vec4'>, index: number): FloatNode =>
  [node.x, node.y, node.z, node.w][index] ?? node.x;

/** Picks the entry of an eight-row table of 2x2 matrices by `index` (0..7). */
function pick(table: readonly (readonly number[])[], index: FloatNode): Node<'vec4'> {
  const row = (i: number): Node<'vec4'> => {
    const [a = 0, b = 0, c = 0, d = 0] = table[i] ?? [];
    return vec4(a, b, c, d);
  };
  let chosen = row(0);
  for (let i = 1; i < table.length; i++) chosen = select(index.equal(i), row(i), chosen);
  return chosen;
}

/**
 * Perspective-only PBR ground: the photoscanned albedo, normal, roughness and occlusion of the yard
 * concrete, street asphalt and pavement pavers, picked per vertex like the detail ground, with
 * saw-cut slab joints on the yard. The albedo is detail around 1, so it multiplies the token vertex
 * colour and a surface keeps its token colour on average.
 *
 * The mask's R channel only dims the ambient (aoNode), so it never doubles a sun shadow; its G
 * channel darkens the albedo and, where strong, polishes the roughness.
 *
 * Samplers: `macro` (ground.ktx2, read blurred for slab tone and mottling), one albedo and one
 * packed map per surface, and the mask.
 *
 * @param origin the layout bounds minimum: the detail ground's texture coordinates start there, and
 *   the slab joints sit at multiples of the pitch from it.
 */
export function createGroundPbrMaterial(
  maps: Readonly<Record<PbrKey, Texture>>,
  macro: Texture,
  origin: { readonly x: number; readonly y: number },
  mask: MaskBinding,
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ vertexColors: true, metalness: 0 });
  const select3 = attribute('groundSelect', 'vec3');
  const weights: Readonly<Record<PbrSurface, FloatNode>> = {
    concrete: select3.x,
    asphalt: select3.y,
    pavers: select3.z,
  };
  const covered = select3.x.add(select3.y).add(select3.z);
  const bare = float(1).sub(covered);

  // sim-plane metres from the layout origin: x forward, y left (three z = -y)
  const sim = vec2(positionWorld.x.sub(origin.x), positionWorld.z.negate().sub(origin.y));
  const world = vec2(positionWorld.x, positionWorld.z);

  const albedo = (surface: PbrSurface, uvNode: Vec2Node, grads?: readonly [Vec2Node, Vec2Node]) => {
    const sample = texture(maps[`${surface}Albedo`], uvNode);
    return (grads === undefined ? sample : sample.grad(grads[0], grads[1])).rgb;
  };
  const packed = (surface: PbrSurface, uvNode: Vec2Node, grads?: readonly [Vec2Node, Vec2Node]) => {
    const sample = texture(maps[`${surface}Packed`], uvNode);
    return grads === undefined ? sample : sample.grad(grads[0], grads[1]);
  };

  // The yard's slabs each wear one of eight rotations or mirrorings and an offset; the seam is the
  // joint. Gradients come from the unrotated coordinates, so the mip level is right at the seam.
  const slab = floor(sim.div(SLAB_PITCH));
  const index = floor(hash(slab, 0).mul(SLAB_UV_TRANSFORMS.length));
  const uvMatrix = pick(SLAB_UV_TRANSFORMS, index);
  const normalMatrix = pick(SLAB_UV_TRANSFORMS.map(slabNormalMatrix), index);
  const turn = (m: Node<'vec4'>, p: Vec2Node): Vec2Node =>
    vec2(m.x.mul(p.x).add(m.y.mul(p.y)), m.z.mul(p.x).add(m.w.mul(p.y)));
  const concreteLocal = world.div(PBR_TILE.concrete);
  const concreteUv = turn(uvMatrix, concreteLocal).add(vec2(hash(slab, 1), hash(slab, 2)));
  const concreteGrads = [
    turn(uvMatrix, dFdx(concreteLocal)),
    turn(uvMatrix, dFdy(concreteLocal)),
  ] as const;

  const surfaceUv = (surface: PbrSurface): Vec2Node => world.div(PBR_TILE[surface]);
  const colour: Record<PbrSurface, Node<'vec3'>> = {
    concrete: albedo('concrete', concreteUv, concreteGrads),
    asphalt: albedo('asphalt', surfaceUv('asphalt')),
    pavers: albedo('pavers', surfaceUv('pavers')),
  };
  const data: Record<PbrSurface, Node<'vec4'>> = {
    concrete: packed('concrete', concreteUv, concreteGrads),
    asphalt: packed('asphalt', surfaceUv('asphalt')),
    pavers: packed('pavers', surfaceUv('pavers')),
  };
  const blend = <T extends Node<'float'> | Node<'vec2'> | Node<'vec3'>>(
    pickOne: (surface: PbrSurface) => T,
    fallback: T,
  ): T => {
    let sum = pickOne(PBR_SURFACE_IDS[0]).mul(weights[PBR_SURFACE_IDS[0]]);
    for (const surface of PBR_SURFACE_IDS.slice(1)) {
      sum = sum.add(pickOne(surface).mul(weights[surface]));
    }
    return sum.add(fallback.mul(bare)) as T;
  };

  // joints: distance (m) to the nearest multiple of the pitch on each axis, filtered to the pixel
  const toJoint = abs(fract(sim.div(SLAB_PITCH).add(0.5)).sub(0.5)).mul(SLAB_PITCH);
  const footprint = max(fwidth(sim), 1e-4);
  const edge = float(1)
    .sub(
      smoothstep(
        footprint.negate().add(JOINT_HALF_WIDTH),
        footprint.add(JOINT_HALF_WIDTH),
        toJoint,
      ),
    )
    .mul(min(float(1), footprint.reciprocal().mul(JOINT_HALF_WIDTH)));
  const joint = max(edge.x, edge.y).mul(weights.concrete);

  const marks = texture(mask.texture, vec2(sim.x.div(mask.width), sim.y.div(mask.height)));
  const wear = channel(marks, 1);

  const macroGain = dot(texture(macro, uv()).bias(float(MACRO_BIAS)).rgb, select3).mul(
    1 / GROUND_TEXTURE_MEAN,
  );
  const gain = blend((s) => colour[s], vec3(PBR_ALBEDO_MEAN)).mul(1 / PBR_ALBEDO_MEAN);
  material.colorNode = gain
    .mul(mix(float(1), macroGain, covered))
    .mul(float(1).sub(joint.mul(JOINT_DARKEN)))
    .mul(float(1).sub(wear.mul(WEAR_DARKEN)))
    .toVar(GROUND_PBR_MARKER);

  const roughness = blend((s) => channel(data[s], PBR_PACKED.roughness), float(VERGE_ROUGHNESS));
  material.roughnessNode = mix(
    roughness,
    float(GLOSS_ROUGHNESS),
    smoothstep(GLOSS_FROM, GLOSS_FROM + 0.3, wear),
  );
  material.aoNode = blend((s) => channel(data[s], PBR_PACKED.occlusion), float(1))
    .mul(float(1).sub(joint.mul(JOINT_OCCLUDE)))
    .mul(float(1).sub(channel(marks, 0)));

  // Tangent-space XY (the concrete's turned with its slab), Z rebuilt, then into the frame the
  // texture axes lie in (GROUND_FRAME) and on to view space.
  const xy = (surface: PbrSurface): Vec2Node =>
    vec2(channel(data[surface], PBR_PACKED.normalX), channel(data[surface], PBR_PACKED.normalY))
      .mul(2)
      .sub(1);
  const concreteXy = turn(normalMatrix, xy('concrete'));
  const flat = blend((s) => (s === 'concrete' ? concreteXy : xy(s)), vec2(0));
  const z = sqrt(max(float(0), float(1).sub(dot(flat, flat))));
  const local = clamp(vec3(flat.x, z, flat.y.negate()), -1, 1);
  material.normalNode = transformNormalToView(normalize(local));
  return material;
}
