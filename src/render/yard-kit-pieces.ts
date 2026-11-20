import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  type Material,
  type Mesh,
  type Object3D,
  Texture,
} from 'three';
import type { KitDecor, KitPiece } from '../contracts/layout';
import { YARD_KIT_NODES } from './yard-kit-dims';

/*
 * The yard kit's glb (tools/blender/yard_kit.py) read into plain arrays, and merged per material
 * into the geometry of the placed pieces. A node's frame is the sim frame in three's axes: +X along
 * the piece, -Z out of its face, +Y up, with the origin on the face line (yard-kit-dims.ts).
 */

type Triple = readonly [number, number, number];

export type KitMaterialKind = 'atlas' | 'leaves';

const MATERIALS: Readonly<Record<string, KitMaterialKind>> = {
  'yard-atlas': 'atlas',
  'yard-leaves': 'leaves',
};

/** One primitive of a piece in its own frame, float and with the node transform applied. */
export type KitPrimitive = {
  readonly kind: KitMaterialKind;
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array;
  readonly index: Uint32Array;
};

export type KitModel = {
  readonly primitives: readonly KitPrimitive[];
  /** The node's `bounds` extras in the sim frame: x along the piece, y out of its face. */
  readonly bounds: { readonly min: Triple; readonly max: Triple };
};

export type KitPieces = ReadonlyMap<KitPiece, KitModel>;

const isPiece = (name: string): name is KitPiece =>
  (YARD_KIT_NODES as readonly string[]).includes(name);

/** The kit node a mesh belongs to: itself, or the group that holds a piece's several primitives. */
function nodeOf(mesh: Mesh): Object3D {
  const parent = mesh.parent;
  return parent !== null && isPiece(parent.name) && !isPiece(mesh.name) ? parent : mesh;
}

function bounds(node: Object3D): KitModel['bounds'] {
  const extras = node.userData as { bounds?: { min?: unknown; max?: unknown } };
  const { min, max } = extras.bounds ?? {};
  const triple = (v: unknown): Triple | null => {
    if (!Array.isArray(v)) return null;
    const [a, b, c, ...rest] = v as unknown[];
    return typeof a === 'number' &&
      typeof b === 'number' &&
      typeof c === 'number' &&
      rest.length === 0
      ? [a, b, c]
      : null;
  };
  const lo = triple(min);
  const hi = triple(max);
  if (lo === null || hi === null) throw new Error(`yard kit node "${node.name}" has no bounds`);
  return { min: lo, max: hi };
}

/** Every kit node of the decoded meshes, each primitive applied to its node matrix; anything else is refused. */
export function kitPiecesFrom(meshes: readonly Mesh[]): KitPieces {
  const models = new Map<KitPiece, { primitives: KitPrimitive[]; bounds: KitModel['bounds'] }>();
  for (const mesh of meshes) {
    const node = nodeOf(mesh);
    if (!isPiece(node.name)) throw new Error(`yard kit has an unknown node "${node.name}"`);
    const material = (mesh.material as Material).name;
    const kind = MATERIALS[material];
    if (kind === undefined) throw new Error(`yard kit node "${node.name}" wears "${material}"`);
    const model = models.get(node.name) ?? { primitives: [], bounds: bounds(node) };
    models.set(node.name, model);
    model.primitives.push(primitive(mesh, kind));
  }
  const missing = YARD_KIT_NODES.filter((name) => !models.has(name));
  if (missing.length > 0) throw new Error(`yard kit lacks ${missing.join(', ')}`);
  return models;
}

function primitive(mesh: Mesh, kind: KitMaterialKind): KitPrimitive {
  const { geometry } = mesh;
  for (const name of ['position', 'normal', 'uv']) {
    if (!geometry.hasAttribute(name))
      throw new Error(`yard kit mesh "${mesh.name}" has no ${name}`);
  }
  const [position, normal, uv] = [
    geometry.getAttribute('position'),
    geometry.getAttribute('normal'),
    geometry.getAttribute('uv'),
  ];
  const index = geometry.getIndex();
  if (index === null) throw new Error(`yard kit mesh "${mesh.name}" is not indexed`);
  const count = position.count;
  const e = mesh.matrixWorld.elements;
  const p = new Float32Array(count * 3);
  const n = new Float32Array(count * 3);
  const t = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
    p[i * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
    p[i * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    p[i * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    // the node scale is uniform, so a rotation-only normal matrix is the matrix up to scale
    const [nx, ny, nz] = [normal.getX(i), normal.getY(i), normal.getZ(i)];
    const rx = e[0] * nx + e[4] * ny + e[8] * nz;
    const ry = e[1] * nx + e[5] * ny + e[9] * nz;
    const rz = e[2] * nx + e[6] * ny + e[10] * nz;
    const length = Math.hypot(rx, ry, rz) || 1;
    n[i * 3] = rx / length;
    n[i * 3 + 1] = ry / length;
    n[i * 3 + 2] = rz / length;
    t[i * 2] = uv.getX(i);
    t[i * 2 + 1] = uv.getY(i);
  }
  return { kind, position: p, normal: n, uv: t, index: Uint32Array.from(index.array) };
}

/** A GLTFLoader plugin that skips the glb's placeholder images: the atlases are bound at runtime. */
export const skipTextures = (): { name: string; loadTexture: () => Promise<Texture> } => ({
  name: 'YardKitNoTextures',
  loadTexture: () => Promise.resolve(new Texture()),
});

/** Decodes the kit glb: no GPU, no texture. */
export async function parseKitGlb(data: ArrayBuffer): Promise<KitPieces> {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(skipTextures);
  const gltf = await loader.parseAsync(data, '');
  gltf.scene.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  gltf.scene.traverse((o) => {
    if ('isMesh' in o) meshes.push(o as Mesh);
  });
  return kitPiecesFrom(meshes);
}

const at = (array: Float32Array, i: number): number => array[i] ?? 0;

/**
 * The geometry of every `kind` primitive of the placed pieces. Each piece is put where its footprint
 * says: the glb's bounds map onto the footprint, scaled along the piece's Y (the stretched roofs).
 * Null when none of them wears `kind`.
 */
export function mergeKit(
  pieces: KitPieces,
  placements: readonly KitDecor[],
  kind: KitMaterialKind,
): BufferGeometry | null {
  const parts: { primitive: KitPrimitive; model: KitModel; decor: KitDecor }[] = [];
  for (const decor of placements) {
    const model = pieces.get(decor.piece);
    if (model === undefined) throw new Error(`yard kit lacks ${decor.piece}`);
    for (const primitive of model.primitives)
      if (primitive.kind === kind) parts.push({ primitive, model, decor });
  }
  if (parts.length === 0) return null;
  const vertices = parts.reduce((sum, { primitive }) => sum + primitive.position.length / 3, 0);
  const indices = parts.reduce((sum, { primitive }) => sum + primitive.index.length, 0);
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const index = new Uint32Array(indices);
  let v = 0;
  let i = 0;
  for (const { primitive, model, decor } of parts) {
    const { footprint: f } = decor;
    const { min, max } = model.bounds;
    // sim frame of the piece: x along, y out of the face = three -z
    const scale = (2 * f.halfWidth) / (max[1] - min[1]);
    const [bx, by] = [(min[0] + max[0]) / 2, ((min[1] + max[1]) / 2) * scale];
    const [c, s] = [Math.cos(f.heading), Math.sin(f.heading)];
    const [ox, oy] = [f.cx - (c * bx - s * by), f.cy - (s * bx + c * by)];
    const count = primitive.position.length / 3;
    for (let k = 0; k < count; k++) {
      const [px, py, pz] = [
        at(primitive.position, k * 3),
        at(primitive.position, k * 3 + 1),
        -at(primitive.position, k * 3 + 2) * scale,
      ];
      position[(v + k) * 3] = ox + c * px - s * pz;
      position[(v + k) * 3 + 1] = py;
      position[(v + k) * 3 + 2] = -(oy + s * px + c * pz);
      const [nx, ny, nz] = [
        at(primitive.normal, k * 3),
        at(primitive.normal, k * 3 + 1),
        -at(primitive.normal, k * 3 + 2),
      ];
      normal[(v + k) * 3] = c * nx - s * nz;
      normal[(v + k) * 3 + 1] = ny;
      normal[(v + k) * 3 + 2] = -(s * nx + c * nz);
      uv[(v + k) * 2] = at(primitive.uv, k * 2);
      uv[(v + k) * 2 + 1] = at(primitive.uv, k * 2 + 1);
    }
    for (const at of primitive.index) index[i++] = at + v;
    v += count;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}
