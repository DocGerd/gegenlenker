import {
  BoxGeometry,
  BufferGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ResolvedLayout } from '../src/contracts/layout';
import type { ScenePalette, ScenePaletteKey } from '../src/contracts/render';
import type { Param, TrailerSpec, TruckSpec } from '../src/contracts/vehicle';
import { placePose } from '../src/render/coords';
import type { AidsLayer, Environment, RendererParts, VehicleVisual } from '../src/render/seams';
import { truckAnchors, trailerAnchors } from '../src/vehicles/anchors';

// Stand-in content for the dev harnesses; the shipped parts sit behind the same seams.
export const placeholderLayout: ResolvedLayout = {
  id: 'depot',
  bounds: { minX: -60, minY: -60, maxX: 60, maxY: 60 },
  yard: { minX: -30, minY: -30, maxX: 30, maxY: 30 },
  surfaces: [
    { kind: 'yard', rect: { minX: -30, minY: -30, maxX: 30, maxY: 30 } },
    { kind: 'pavement', rect: { minX: -30, minY: -34, maxX: 30, maxY: -30 } },
    { kind: 'street', rect: { minX: -60, minY: -46, maxX: 60, maxY: -34 } },
  ],
  obstacles: [],
  markings: [],
  target: null,
};

const mm = (p: Param): number => p.value / 1000;

/** World (x east, y north, up) to Three (x, up, −y). */
const toThree = (x: number, y: number, up = 0): Vector3 => new Vector3(x, up, -y);

/** A box given by body-frame extents (x forward, y left, z up). */
function bodyBox(
  material: Material,
  [x0, x1]: readonly [number, number],
  [y0, y1]: readonly [number, number],
  [z0, z1]: readonly [number, number],
): Mesh {
  const mesh = new Mesh(new BoxGeometry(x1 - x0, z1 - z0, y1 - y0), material);
  mesh.position.copy(toThree((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  return mesh;
}

function disposeTree(root: Group): void {
  const materials = new Set<Material>();
  root.traverse((o) => {
    if (o instanceof Mesh) {
      (o.geometry as BufferGeometry).dispose();
      materials.add(o.material as Material);
    }
  });
  materials.forEach((m) => m.dispose());
}

const lambert = (color: number): MeshLambertMaterial => new MeshLambertMaterial({ color });

function truckVisual(spec: TruckSpec, palette: ScenePalette): VehicleVisual {
  const a = truckAnchors(spec);
  const hw = mm(spec.width) / 2;
  const cab = lambert(palette.cab);
  const chassis = lambert(palette.chassis);
  const marker = lambert(palette.accent);
  const group = new Group();
  group.add(
    bodyBox(chassis, [a.rearX, a.frontX], [-hw + 0.2, hw - 0.2], [0.5, 1.1]),
    bodyBox(cab, [a.frontX - 2.2, a.frontX], [-hw, hw], [1.1, 3.2]),
    bodyBox(marker, [a.rearX, a.rearX + 0.5], [hw - 0.1, hw + 0.4], [0.9, 2.4]),
  );
  return {
    object: group,
    update: (s) => placePose(group, s.truck),
    dispose: () => disposeTree(group),
  };
}

function trailerVisual(spec: TrailerSpec, palette: ScenePalette): VehicleVisual {
  const a = trailerAnchors(spec);
  const hw = mm(spec.width) / 2;
  const deck = mm(spec.deckHeight);
  const body = lambert(palette.body);
  const chassis = lambert(palette.chassis);
  const dolly = new Group();
  dolly.add(bodyBox(chassis, [0, a.eye.x], [-0.15, 0.15], [0.4, 0.8]));
  const trailer = new Group();
  trailer.add(bodyBox(body, [a.rearX, a.frontX], [-hw, hw], [deck, deck + 2.6]));
  const group = new Group();
  group.add(dolly, trailer);
  return {
    object: group,
    update: (s) => {
      placePose(dolly, s.dolly);
      placePose(trailer, s.trailer);
    },
    dispose: () => disposeTree(group),
  };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOCK_KEYS: readonly ScenePaletteKey[] = [
  'wall',
  'fence',
  'hall',
  'parked',
  'cone',
  'ramp',
  'lamp',
  'kerb',
];
const BLOCKS = 300;

function environment(layout: ResolvedLayout, palette: ScenePalette): Environment {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  const ground = (
    color: number,
    width: number,
    depth: number,
    cx: number,
    cy: number,
    up: number,
  ) => {
    const material = lambert(color);
    const geometry = new PlaneGeometry(width, depth).rotateX(-Math.PI / 2);
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(toThree(cx, cy, up));
    group.add(mesh);
    geometries.push(geometry);
    materials.push(material);
  };
  const b = layout.bounds;
  ground(
    palette.verge,
    b.maxX - b.minX,
    b.maxY - b.minY,
    (b.minX + b.maxX) / 2,
    (b.minY + b.maxY) / 2,
    0,
  );
  layout.surfaces.forEach((s, i) => {
    const r = s.rect;
    ground(
      palette[s.kind],
      r.maxX - r.minX,
      r.maxY - r.minY,
      (r.minX + r.maxX) / 2,
      (r.minY + r.maxY) / 2,
      0.01 * (i + 1),
    );
  });

  const buckets: BufferGeometry[][] = BLOCK_KEYS.map(() => []);
  const rand = mulberry32(7);
  const box = (bucket: BufferGeometry[], cx: number, cy: number, w: number, d: number, h: number) =>
    bucket.push(new BoxGeometry(w, h, d).translate(cx, h / 2, -cy));
  let count = 0;
  while (count < BLOCKS) {
    const cx = b.minX + 5 + rand() * (b.maxX - b.minX - 10);
    const cy = b.minY + 5 + rand() * (b.maxY - b.minY - 10);
    const r = Math.hypot(cx, cy);
    if (r > 8 && r < 22) continue;
    const bucket = buckets[Math.floor(rand() * buckets.length)];
    if (bucket === undefined) continue;
    const w = 1 + rand() * 3;
    const d = 1 + rand() * 3;
    const h = 1 + rand() * 5;
    box(bucket, cx, cy, w, d, h);
    count++;
    if (rand() < 0.3) {
      box(bucket, cx + w / 2 + 1, cy + d / 2 - 0.5, 2, 1, h);
      count++;
    }
  }
  buckets.forEach((bucket, i) => {
    const merged = mergeGeometries(bucket) as BufferGeometry | null;
    const key = BLOCK_KEYS[i];
    if (merged === null || key === undefined) return;
    bucket.forEach((g) => g.dispose());
    const material = lambert(palette[key]);
    group.add(new Mesh(merged, material));
    geometries.push(merged);
    materials.push(material);
  });

  const sun = new DirectionalLight(0xffffff, 2.4);
  const elevation = (50 * Math.PI) / 180;
  const horizontal = Math.cos(elevation) * 100;
  // south-west of the scene: world (−, −) is Three (−x, +z)
  sun.position.set(-horizontal / Math.SQRT2, Math.sin(elevation) * 100, horizontal / Math.SQRT2);
  group.add(sun, new HemisphereLight(palette.sky, palette.verge, 1.4));

  return {
    object: group,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
    },
  };
}

function aids(): AidsLayer {
  const group = new Group();
  return { object: group, update: () => undefined, dispose: () => undefined };
}

export const placeholderParts: RendererParts = {
  truck: truckVisual,
  trailer: trailerVisual,
  environment,
  aids,
};
