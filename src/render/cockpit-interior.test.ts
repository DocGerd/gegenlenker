import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Box3,
  type BufferGeometry,
  BackSide,
  DoubleSide,
  Frustum,
  Group,
  Layers,
  Light,
  Matrix4,
  MathUtils,
  type Object3D,
  Ray,
  Raycaster,
  Vector2,
  Vector3,
  Mesh,
  type PerspectiveCamera,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  HEAD_REST,
  type HeadPose,
  type LegendBox,
  type LightingMode,
  type Rect,
  type ScenePalette,
} from '../contracts/render';
import type { TruckSpec } from '../contracts/vehicle';
import { truckAnchors } from '../vehicles/anchors';
import { truckById, trucks } from '../vehicles/registry';
import { cabSight } from './cab-sight';
import { cabShellParams, FRAME_TOP } from './cab-dims';
import { placePose } from './coords';
import { createChaseCamera } from './chase-camera';
import {
  COCKPIT_FOV,
  COCKPIT_PITCH,
  createCockpitCamera,
  placeCockpitCamera,
} from './cockpit-camera';
import {
  CLEAR_CONE_DEG,
  CONE_GAP,
  coneEdge,
  createCockpitInterior,
  edgeShift,
  headerEdge,
  type FlatInterior,
  interiorLayout,
  LIP,
  lipTop,
  MIN_PILLAR_WIDTH,
  MIRROR_GAP,
  pillarSpans,
  placeInEye,
  VISOR,
  visorLeft,
} from './cockpit-interior';
import { parseMeshes } from './glb-shells';
import { HEAD_LIMITS } from './head-look';
import {
  createGlbInterior,
  type GlbInterior,
  interiorParts,
  interiorShellFrom,
  type InteriorShell,
} from './interior-glb';
import { createMirror } from './mirror';
import { KEYS } from './palette';
import { lookFor } from './look';
import { QUALITY_FLAGS, type QualityFlags } from './quality';
import {
  enableLayers,
  INTERIOR_LAYER,
  PERSPECTIVE_LAYER,
  SHADOW_CASTER_LAYERS,
  TOP_DOWN_LAYERS,
  type CockpitInterior,
  type RendererParts,
} from './seams';
import { bandTopNdc, computeViewports, type Insets } from './viewports';

const truck = truckById('man-le-18-280');
const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;

type Shot<I extends CockpitInterior = FlatInterior> = {
  readonly camera: PerspectiveCamera;
  readonly interior: I;
  readonly cockpit: Rect;
  readonly left: Rect;
  readonly right: Rect;
  readonly front: Rect | null;
  /** The class IV mirrors under the class II ones; null where the window has no room for them. */
  readonly wide: readonly [Rect, Rect] | null;
  /** The class V mirror above the right class II one; null where the window has no room for it. */
  readonly close: Rect | null;
};

/** Every mirror rect of `shot`: the class IV, front and class V mirrors' among them where the window has room for them. */
const rectsOf = ({
  left,
  right,
  front,
  wide,
  close,
}: Pick<Shot, 'left' | 'right' | 'front' | 'wide' | 'close'>): Rect[] => [
  left,
  right,
  ...(wide ?? []),
  ...(front === null ? [] : [front]),
  ...(close === null ? [] : [close]),
];

/**
 * The real cockpit camera and `interior` placed for a window of `width` x `height` CSS px, as the
 * renderer does: the interior hangs under the posed truck or the scene root by its `frame`, and the
 * world matrices are updated once before `place`, which owns the interior's own afterwards.
 */
function shootWith<I extends CockpitInterior>(
  interior: I,
  width: number,
  height: number,
  heading: number,
  legend: LegendBox | null,
  flags: QualityFlags,
  spec: TruckSpec = truck,
  insets?: Insets,
  mode: LightingMode = 'day',
  head: HeadPose = HEAD_REST,
): Shot<I> {
  const { cockpit, mirrorLeft, mirrorRight, front, wideLeft, wideRight, close } = computeViewports(
    width,
    height,
    'drive',
    legend,
    insets,
    undefined,
    null,
    { front: true, wide: true, close: true },
  );
  if (cockpit === null || mirrorLeft === null || mirrorRight === null) throw new Error('no views');
  const pose = { x: 12, y: -7, heading };
  const scene = new Group();
  scene.matrixWorldAutoUpdate = false;
  const truckObject = new Group();
  placePose(truckObject, pose);
  scene.add(truckObject);
  (interior.frame === 'truck' ? truckObject : scene).add(interior.object);
  const camera = createCockpitCamera();
  interior.setLook(lookFor(flags, mode));
  // as the renderer does: an interior fixed to the eye keeps the head forward
  const turn = interior.looksAround === true ? head : HEAD_REST;
  placeCockpitCamera(camera, pose, truckAnchors(spec).eye, cockpit, turn);
  scene.updateMatrixWorld();
  interior.place({ camera, heading, cockpit, mirrorLeft, mirrorRight });
  const wide = wideLeft === null || wideRight === null ? null : ([wideLeft, wideRight] as const);
  return { camera, interior, cockpit, left: mirrorLeft, right: mirrorRight, front, wide, close };
}

function shoot(
  width: number,
  height: number,
  heading = 0.7,
  legend: LegendBox | null = null,
  spec: TruckSpec = truck,
  insets?: Insets,
): Shot {
  return shootWith(
    createCockpitInterior(spec),
    width,
    height,
    heading,
    legend,
    QUALITY_FLAGS.balanced,
    spec,
    insets,
  );
}

/** Windows whose pillars must show: landscape desktop and tablet sizes. */
const REQUIRED: readonly (readonly [number, number])[] = [
  [1350, 600],
  [1280, 800],
  [1280, 720],
];

/** The pillars as drawn; a hidden one is forced on as a `MIN_PILLAR_WIDTH` pillar flush against its mirror's margin. */
function forcedPillars({ interior, cockpit, left, right }: Shot): Mesh[] {
  const layout = interiorLayout(cockpit, left, right);
  const pillars: Mesh[] = [];
  for (const [mesh, side, inner] of [
    [interior.pillars.left, -1, layout.left],
    [interior.pillars.right, 1, layout.right],
  ] as const) {
    if (!mesh.visible) {
      const outer = Math.min(inner - MIRROR_GAP, 1);
      mesh.visible = true;
      mesh.position.x = side * (outer - MIN_PILLAR_WIDTH / 2);
      mesh.scale.x = side * MIN_PILLAR_WIDTH;
    }
    pillars.push(mesh);
  }
  interior.object.updateMatrixWorld(true);
  return pillars;
}

const raycaster = new Raycaster();

/** Meshes among `meshes` that the ray through NDC (x, y) of the camera crosses. */
function hits(camera: PerspectiveCamera, meshes: readonly Mesh[], x: number, y: number): string[] {
  raycaster.layers.mask = camera.layers.mask;
  raycaster.setFromCamera(new Vector2(x, y), camera);
  return raycaster
    .intersectObjects(
      meshes.filter((m) => m.visible),
      false,
    )
    .map((h) => h.object.name);
}

/** The ray along the view axis tilted by `azimuth` and `elevation` (radians), as hits. */
function hitsAlong(
  camera: PerspectiveCamera,
  meshes: readonly Mesh[],
  azimuth: number,
  elevation: number,
): string[] {
  const direction = new Vector3(Math.tan(azimuth), Math.tan(elevation), -1)
    .normalize()
    .transformDirection(camera.matrixWorld);
  raycaster.layers.mask = camera.layers.mask;
  raycaster.set(camera.position, direction);
  return raycaster
    .intersectObjects(
      meshes.filter((m) => m.visible),
      false,
    )
    .map((h) => h.object.name);
}

/**
 * A ray test for the sweeps below, which cast thousands of rays at the same few parts and mostly
 * expect none to hit: each part's triangles are cached per geometry in groups of `CHUNK` triangles
 * (a solid is contiguous, so a group is compact) with a box each, and a ray works in each part's own
 * frame, so it skips whole groups. Same culling as `Mesh.raycast`; unlike `hits` it names each part
 * once, nearest not first.
 */
const CHUNK = 8;
type Soup = {
  readonly vertices: readonly Vector3[];
  readonly box: Box3;
  readonly chunks: readonly { readonly box: Box3; readonly from: number; readonly to: number }[];
};
const soups = new WeakMap<BufferGeometry, Soup>();

const soupOf = (geometry: BufferGeometry): Soup => {
  const cached = soups.get(geometry);
  if (cached !== undefined) return cached;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index?.count ?? position.count;
  const vertices: Vector3[] = [];
  for (let i = 0; i < count; i++) {
    vertices.push(new Vector3().fromBufferAttribute(position, index ? index.getX(i) : i));
  }
  const chunks = [];
  for (let from = 0; from < count; from += 3 * CHUNK) {
    const to = Math.min(from + 3 * CHUNK, count);
    chunks.push({ box: new Box3().setFromPoints(vertices.slice(from, to)), from, to });
  }
  const soup = { vertices, box: new Box3().setFromPoints(vertices), chunks };
  soups.set(geometry, soup);
  return soup;
};

type Sight = {
  readonly name: string;
  readonly soup: Soup;
  readonly inverse: Matrix4;
  readonly side: number;
};

/** The names of the parts the world-space ray crosses, among those `camera` sees; visibility is the caller's, as with `Raycaster`. */
function crossing(camera: PerspectiveCamera, meshes: readonly Mesh[]) {
  const sights: Sight[] = [];
  for (const mesh of meshes) {
    if ((mesh.layers.mask & camera.layers.mask) === 0) continue;
    if (Array.isArray(mesh.material)) throw new Error(`${mesh.name}: material array`);
    sights.push({
      name: mesh.name,
      soup: soupOf(mesh.geometry),
      inverse: mesh.matrixWorld.clone().invert(),
      side: mesh.material.side,
    });
  }
  const local = new Ray();
  const point = new Vector3();
  return (origin: Vector3, direction: Vector3): string[] => {
    const names: string[] = [];
    for (const { name, soup, inverse, side } of sights) {
      local.set(origin, direction).applyMatrix4(inverse);
      if (!local.intersectsBox(soup.box)) continue;
      const { vertices } = soup;
      const found = soup.chunks.some(({ box, from, to }) => {
        if (!local.intersectsBox(box)) return false;
        for (let i = from; i < to; i += 3) {
          const [a, b, c] = [vertices[i], vertices[i + 1], vertices[i + 2]] as [
            Vector3,
            Vector3,
            Vector3,
          ];
          const hit =
            side === BackSide
              ? local.intersectTriangle(c, b, a, true, point)
              : local.intersectTriangle(a, b, c, side !== DoubleSide, point);
          if (hit !== null) return true;
        }
        return false;
      });
      if (found) names.push(name);
    }
    return names;
  };
}

const ndcRay = new Raycaster();
const ndc = new Vector2();

/** `crossing` along the ray through NDC (x, y), like `hits`. */
function crossingAt(camera: PerspectiveCamera, meshes: readonly Mesh[]) {
  const cross = crossing(camera, meshes);
  return (x: number, y: number): string[] => {
    ndcRay.setFromCamera(ndc.set(x, y), camera);
    return cross(ndcRay.ray.origin, ndcRay.ray.direction);
  };
}

/** `crossing` along the view axis tilted by `azimuth` and `elevation` (radians), like `hitsAlong`. */
function crossingAlong(camera: PerspectiveCamera, meshes: readonly Mesh[]) {
  const cross = crossing(camera, meshes);
  const direction = new Vector3();
  return (azimuth: number, elevation: number): string[] =>
    cross(
      camera.position,
      direction
        .set(Math.tan(azimuth), Math.tan(elevation), -1)
        .normalize()
        .transformDirection(camera.matrixWorld),
    );
}

const rectToNdc = (cockpit: Rect, rect: Rect, u: number, v: number): [number, number] => [
  (2 * (rect.x + u * rect.width - cockpit.x)) / cockpit.width - 1,
  1 - (2 * (rect.y + v * rect.height - cockpit.y)) / cockpit.height,
];

const layersOf = (ids: readonly number[]): Layers => {
  const layers = new Layers();
  layers.disableAll();
  enableLayers(layers, ids);
  return layers;
};

type Route = {
  readonly name: string;
  readonly make: RendererParts['interior'];
  /** The presets the route draws at; the viewport checks run at the first. */
  readonly presets: readonly (keyof typeof QUALITY_FLAGS)[];
  /** Names of the meshes that carry the dashboard; the pillars and the roof parts never count. */
  readonly dash: readonly string[];
  /** Where a part may cover a mirror rect by design (NDC); everywhere else the rect's view is clear. */
  readonly mayCoverMirror: (x: number, y: number, shift: number) => boolean;
  /** Parts that may lie under a mirror rect anywhere: the mirror insets are composited over them. */
  readonly underMirror: readonly string[];
};

const interiorGlb = async (id: string): Promise<InteriorShell> => {
  const bytes = readFileSync(join(import.meta.dirname, `assets/${id}-interior.glb`));
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return interiorShellFrom(await parseMeshes(data));
};
const GLB_SHELLS = Object.fromEntries(
  await Promise.all(trucks.map(async (spec) => [spec.id, await interiorGlb(spec.id)] as const)),
);

/** Every route that implements the seam; a new interior joins here and inherits the checks below. */
const ROUTES: readonly Route[] = [
  {
    name: 'flat overlay',
    presets: ['balanced', 'high'],
    make: createCockpitInterior,
    dash: ['frame'],
    // Only the headliner reaches down over the top of a mirror rect on small windows; its edge is a
    // chord polyline just below the curve. The visor is not exempt: it keeps clear of the mirror.
    mayCoverMirror: (x, y, shift) => y >= headerEdge(x, shift) - 0.005,
    underMirror: [],
  },
  {
    name: 'glb interior',
    presets: ['high'],
    make: (spec) => {
      const interior = createGlbInterior(spec);
      interior.attach(GLB_SHELLS[spec.id] as InteriorShell);
      return interior;
    },
    dash: ['interior'],
    // The header with its visor and the A-pillars, which stand at the windscreen's corners and
    // cannot move for a mirror, lie under the mirror insets.
    mayCoverMirror: () => false,
    underMirror: ['header', 'pillars'],
  },
];

const MODES: readonly LightingMode[] = ['day', 'night'];

const isPart = (o: Object3D): boolean => o.type !== 'Group' && o.type !== 'Object3D';

/** Everything under `interior` that draws or lights; bare containers do not. */
function renderables(interior: CockpitInterior): Object3D[] {
  const found: Object3D[] = [];
  interior.object.traverse((o) => {
    if (isPart(o)) found.push(o);
  });
  return found;
}

/** What the cockpit camera would draw or light: visible renderables of a visible chain. */
function shown(interior: CockpitInterior): Object3D[] {
  const found: Object3D[] = [];
  interior.object.traverseVisible((o) => {
    if (isPart(o)) found.push(o);
  });
  return found;
}

/** The meshes drawn, with the merged glb interior split back into its named parts. */
function drawn(interior: CockpitInterior): Mesh[] {
  return shown(interior)
    .filter((o): o is Mesh => o instanceof Mesh)
    .flatMap(interiorParts);
}

/** Every route on every truck. */
const CASES = ROUTES.flatMap((route) =>
  trucks.map((spec) => ({ ...route, spec, label: `${route.name}, ${spec.id}` })),
);

describe.each(CASES)(
  'cockpit interior seam: $label',
  ({ make, dash, mayCoverMirror, underMirror, presets, spec }) => {
    const build = (flags: QualityFlags) => {
      const interior = make(spec, palette);
      interior.setLook(lookFor(flags, 'day'));
      return interior;
    };
    const shootRoute = (width: number, height: number, heading = 0.7, mode: LightingMode = 'day') =>
      shootWith(
        make(spec, palette),
        width,
        height,
        heading,
        null,
        QUALITY_FLAGS[presets[0] ?? 'high'],
        spec,
        undefined,
        mode,
      );

    describe.each(presets)('at %s', (preset) => {
      const flags = QUALITY_FLAGS[preset];

      it('puts every part on INTERIOR_LAYER alone, which only the cockpit camera enables', () => {
        const found = renderables(build(flags)).filter((o) => !(o instanceof Light));
        expect(found.length).toBeGreaterThan(0);
        const cockpit = createCockpitCamera().layers;
        const mirror = createMirror().camera.layers;
        const chase = createChaseCamera().layers;
        const topDown = layersOf(TOP_DOWN_LAYERS);
        for (const o of found) {
          const name = `${o.type} ${o.name}`;
          expect(o.layers.mask, name).toBe(1 << INTERIOR_LAYER);
          expect(o.layers.test(cockpit), name).toBe(true);
          expect(o.layers.test(mirror), name).toBe(false);
          expect(o.layers.test(chase), name).toBe(false);
          expect(o.layers.test(topDown), name).toBe(false);
        }
      });

      it('puts every light on PERSPECTIVE_LAYER alone: seen by every perspective camera, never top-down', () => {
        const lights = renderables(build(flags)).filter((o) => o instanceof Light);
        const perspective = [
          createCockpitCamera().layers,
          createMirror().camera.layers,
          createChaseCamera().layers,
        ];
        for (const light of lights) {
          expect(light.layers.mask, light.name).toBe(1 << PERSPECTIVE_LAYER);
          for (const layers of perspective)
            expect(light.layers.test(layers), light.name).toBe(true);
          expect(light.layers.test(layersOf(TOP_DOWN_LAYERS)), light.name).toBe(false);
        }
      });

      it('is not drawn into the sun shadow', () => {
        const shadow = layersOf(SHADOW_CASTER_LAYERS);
        for (const o of renderables(build(flags)).filter((r) => !(r instanceof Light))) {
          expect(o.layers.test(shadow), o.name).toBe(false);
        }
      });
    });

    it('keeps the cockpit camera on the perspective layer too, and no other camera on the interior', () => {
      const cockpit = createCockpitCamera().layers;
      expect(cockpit.isEnabled(PERSPECTIVE_LAYER)).toBe(true);
      for (const layers of [createMirror().camera.layers, createChaseCamera().layers]) {
        expect(layers.isEnabled(INTERIOR_LAYER)).toBe(false);
      }
    });

    it('draws and lights nothing on the Low preset, and something on the others', () => {
      expect(shown(build(QUALITY_FLAGS.low))).toEqual([]);
      for (const preset of presets) {
        expect(drawn(build(QUALITY_FLAGS[preset])).length, preset).toBeGreaterThan(0);
      }
    });

    it('draws the binnacle lip at night only, and nothing at all on Low', () => {
      for (const preset of presets) {
        const names = (mode: LightingMode): string[] => {
          const interior = make(spec, palette);
          interior.setLook(lookFor(QUALITY_FLAGS[preset], mode));
          return drawn(interior).map((o) => o.name);
        };
        expect(names('day'), preset).not.toContain('binnacle-lip');
        expect(names('night'), preset).toContain('binnacle-lip');
      }
      const low = make(spec, palette);
      low.setLook(lookFor(QUALITY_FLAGS.low, 'night'));
      expect(shown(low)).toEqual([]);
    });

    it('puts the lip on the hump straight ahead, below the sight cone', () => {
      const { camera, interior } = shootRoute(1280, 720, 0.7, 'night');
      const parts = drawn(interior);
      for (const x of [-LIP.halfWidth, -0.05, 0, 0.05, LIP.halfWidth]) {
        expect(hits(camera, parts, x, lipTop(x) - LIP.thickness / 2), `x=${x}`).toContain(
          'binnacle-lip',
        );
        expect(hits(camera, parts, x, lipTop(x) + 0.01), `x=${x} above`).not.toContain(
          'binnacle-lip',
        );
      }
    });

    describe('keeps the training view clear', () => {
      // Landscape and portrait windows from phone to desktop, the layouts of `computeViewports`.
      const windows: (readonly [number, number])[] = [];
      for (let w = 360; w <= 1920; w += 60) {
        for (let h = 360; h <= 1280; h += 80) windows.push([w, h]);
      }
      windows.push(...REQUIRED, [1024, 768], [390, 844], [844, 390]);
      const cone = MathUtils.degToRad(CLEAR_CONE_DEG);

      it.each(MODES)('leaves a central forward sight cone free of every part, by %s', (mode) => {
        // one assertion for the whole sweep: an expect per ray costs more than the ray
        const blocked: string[] = [];
        for (const [w, h] of windows) {
          const { camera, interior } = shootRoute(w, h, 0.7, mode);
          const along = crossingAlong(camera, drawn(interior));
          for (let az = -cone; az <= cone + 1e-9; az += cone / 6) {
            for (let el = -cone; el <= cone + 1e-9; el += cone / 6) {
              if (Math.hypot(az, el) > cone) continue;
              const names = along(az, el);
              if (names.length > 0) blocked.push(`${w}x${h} ${az} ${el}: ${names.join(', ')}`);
            }
          }
        }
        expect(blocked).toEqual([]);
      });

      it.each(MODES)(
        'keeps every part out of the lines of sight to each mirror rect, bar what the route covers by design, by %s',
        (mode) => {
          const blocked: string[] = [];
          for (const [w, h] of windows) {
            const shot = shootRoute(w, h, 0.7, mode);
            const { camera, interior, cockpit } = shot;
            const at = crossingAt(camera, drawn(interior));
            for (const rect of rectsOf(shot)) {
              for (let u = 0; u <= 1; u += 0.125) {
                for (let v = 0; v <= 1; v += 0.125) {
                  const [x, y] = rectToNdc(cockpit, rect, u, v);
                  if (mayCoverMirror(x, y, edgeShift(spec, camera.aspect, COCKPIT_FOV))) continue;
                  const names = at(x, y).filter((name) => !underMirror.includes(name));
                  if (names.length > 0) blocked.push(`${w}x${h} (${u}, ${v}): ${names.join(', ')}`);
                }
              }
            }
          }
          expect(blocked).toEqual([]);
        },
      );

      it('has a dash above the HUD band at every x, so the opaque band never meets open cab', () => {
        const y = bandTopNdc() + 0.02;
        for (const [w, h] of windows) {
          const { camera, interior } = shootRoute(w, h);
          const parts = drawn(interior);
          for (let x = -1; x <= 1; x += 0.125) {
            const names = hits(camera, parts, x, y);
            expect(
              names.some((name) => dash.includes(name)),
              `${w}x${h} x=${x}: ${names.join(', ') || 'no hit'}`,
            ).toBe(true);
          }
        }
      });

      it('keeps every part off the centre of each mirror rect, the front, class IV and class V mirrors included', () => {
        let fronts = 0;
        let wides = 0;
        let closes = 0;
        for (const [w, h] of windows) {
          const shot = shootRoute(w, h);
          if (shot.front !== null) fronts++;
          if (shot.wide !== null) wides++;
          if (shot.close !== null) closes++;
          const { camera, interior, cockpit } = shot;
          const parts = drawn(interior);
          for (const rect of rectsOf(shot)) {
            const [x, y] = rectToNdc(cockpit, rect, 0.5, 0.5);
            // class V is drawn over the headliner: it lies under the route's own cover, nowhere else
            if (
              rect === shot.close &&
              mayCoverMirror(x, y, edgeShift(spec, camera.aspect, COCKPIT_FOV))
            )
              continue;
            expect(
              hits(camera, parts, x, y).filter((name) => !underMirror.includes(name)),
              `${w}x${h}`,
            ).toEqual([]);
          }
        }
        expect(fronts).toBeGreaterThan(windows.length / 2);
        expect(wides).toBeGreaterThan(windows.length / 4);
        expect(closes).toBeGreaterThan(0);
      });
    });
  },
);

describe('cockpit interior in the real cockpit camera', () => {
  it.each(REQUIRED)('is in the frustum, part by part, at %i x %i', (w, h) => {
    const { camera, interior } = shoot(w, h);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    expect(interior.meshes.length).toBeGreaterThan(0);
    for (const m of interior.meshes) {
      expect(m.visible, m.name).toBe(true);
      expect(frustum.intersectsObject(m), m.name).toBe(true);
    }
  });

  it.each(REQUIRED)(
    'is hit by rays through the dashboard, header, visor and pillars at %i x %i',
    (w, h) => {
      const { camera, interior, cockpit, left, right } = shoot(w, h);
      const m = interior.meshes;
      expect(hits(camera, m, 0, -0.9)).toEqual(['frame']);
      expect(hits(camera, m, 0, -0.535)).toEqual(['frame']);
      expect(hits(camera, m, 0, 0.9)).toEqual(['frame']);
      expect(hits(camera, m, -0.3, 0.7)).toContain('frame');
      const layout = interiorLayout(cockpit, left, right);
      const { left: leftSpan, right: span } = pillarSpans(
        cabSight(truck),
        camera.aspect,
        COCKPIT_FOV,
        layout,
      );
      if (span === null || leftSpan === null) throw new Error('no pillar');
      expect(hits(camera, m, span.centre, 0)).toEqual(['pillar-right']);
      expect(hits(camera, m, -leftSpan.centre, 0)).toEqual(['pillar-left']);
    },
  );

  it('follows the truck: the same view at another heading gives the same hits', () => {
    const a = shoot(1350, 600, 0.2);
    const b = shoot(1350, 600, 2.9);
    for (const [x, y] of [
      [0, -0.9],
      [0, 0.9],
      [0.6, 0],
      [0, 0],
    ] as const) {
      expect(hits(b.camera, b.interior.meshes, x, y)).toEqual(
        hits(a.camera, a.interior.meshes, x, y),
      );
    }
  });
});

describe('cockpit interior pillars', () => {
  it.each(REQUIRED)('show at the required landscape size %i x %i', (w, h) => {
    const { interior } = shoot(w, h);
    expect(interior.pillars.left.visible).toBe(true);
    expect(interior.pillars.right.visible).toBe(true);
  });

  it('are dropped on a 4:3 tablet by design: the cone leaves no room, and the rest stays', () => {
    const { interior } = shoot(1024, 768);
    const hidden = interior.meshes.filter((m) => !m.visible);
    expect(hidden.map((m) => m.name).sort()).toEqual(['pillar-left', 'pillar-right']);
  });

  it('keep clear of mirror rects that a measured legend shifts', () => {
    const legend = { right: 780, height: 400 };
    const plain = shoot(1350, 600);
    const shot = shoot(1350, 600, 0.7, legend);
    expect(shot.right.width).toBeLessThan(plain.right.width);
    const { camera, interior, cockpit } = shot;
    expect(interior.pillars.left.visible).toBe(true);
    expect(interior.pillars.right.visible).toBe(true);
    for (const rect of rectsOf(shot)) {
      for (let u = 0; u <= 1; u += 0.125) {
        for (let v = 0; v <= 1; v += 0.125) {
          const [x, y] = rectToNdc(cockpit, rect, u, v);
          expect(
            hits(camera, [interior.pillars.left, interior.pillars.right], x, y),
            `(${u}, ${v})`,
          ).toEqual([]);
        }
      }
      const [x, y] = rectToNdc(cockpit, rect, 0.5, 0.5);
      expect(hits(camera, interior.meshes, x, y)).toEqual([]);
    }
  });
});

describe.each(trucks)('cockpit interior from the left seat of $id', (spec) => {
  const sight = cabSight(spec);

  it.each(REQUIRED)('has a wider left pillar than right at %i x %i', (w, h) => {
    const { camera, interior, cockpit, left, right } = shoot(w, h, 0.7, null, spec);
    const { left: l, right: r } = pillarSpans(
      sight,
      camera.aspect,
      COCKPIT_FOV,
      interiorLayout(cockpit, left, right),
    );
    if (l === null || r === null) throw new Error('no pillar');
    expect(l.width).toBeGreaterThan(r.width);
    expect(r.width).toBeGreaterThanOrEqual(MIN_PILLAR_WIDTH);
    const { pillars, meshes } = interior;
    expect(hits(camera, meshes, -l.centre, 0)).toEqual(['pillar-left']);
    expect(hits(camera, meshes, r.centre, 0)).toEqual(['pillar-right']);
    expect(pillars.left.scale.x).toBeLessThan(0);
  });

  describe('draws the pillars in their slots', () => {
    const windows: (readonly [number, number])[] = [
      ...REQUIRED,
      [1024, 768],
      [390, 844],
      [844, 390],
    ];
    const insets = [0, 24, 48, 96, 160].map((left) => ({ top: 0, right: 0, bottom: 0, left }));
    const extent = (mesh: Mesh) => {
      const centre = Math.abs(mesh.position.x);
      const width = Math.abs(mesh.scale.x);
      return { inner: centre - width / 2, outer: centre + width / 2, width };
    };

    it.each(windows)('at %i x %i, with and without a left safe-area inset', (w, h) => {
      for (const inset of insets) {
        const { camera, interior, cockpit, left, right } = shoot(w, h, 0.7, null, spec, inset);
        const layout = interiorLayout(cockpit, left, right);
        const margin = coneEdge(camera.aspect, COCKPIT_FOV) + CONE_GAP;
        const { left: l, right: r } = interior.pillars;
        const label = `${w}x${h} inset ${inset.left}`;
        if (!l.visible) {
          expect(r.visible, label).toBe(false);
          continue;
        }
        expect(l.position.x, label).toBeLessThan(0);
        expect(r.visible, label).toBe(true);
        expect(r.position.x, label).toBeGreaterThan(0);
        const near = extent(l);
        const far = extent(r);
        expect(near.width, label).toBeGreaterThanOrEqual(far.width);
        expect(far.width, label).toBeGreaterThanOrEqual(MIN_PILLAR_WIDTH - 1e-9);
        expect(near.outer, label).toBeLessThanOrEqual(layout.left - MIRROR_GAP + 1e-9);
        expect(far.outer, label).toBeLessThanOrEqual(layout.right - MIRROR_GAP + 1e-9);
        expect(near.inner, label).toBeGreaterThanOrEqual(margin - 1e-9);
        expect(far.inner, label).toBeGreaterThanOrEqual(margin - 1e-9);
      }
    });

    it('narrows the far pillar by the covered-angle ratio where the slot is full', () => {
      const { interior } = shoot(1350, 600, 0.7, null, spec);
      const ratio = sight.right.covered / sight.left.covered;
      const near = extent(interior.pillars.left);
      const far = extent(interior.pillars.right);
      expect(far.width).toBeCloseTo(Math.max(MIN_PILLAR_WIDTH, near.width * ratio), 9);
      expect(far.width).toBeLessThan(near.width);
    });
  });

  it('drops both pillars together where the slot is too narrow', () => {
    const { interior } = shoot(1024, 768, 0.7, null, spec);
    expect(interior.pillars.left.visible).toBe(false);
    expect(interior.pillars.right.visible).toBe(false);
  });

  it('puts the dash low point towards the windscreen centre: higher on the left than the right', () => {
    const { camera, interior } = shoot(1280, 720, 0.7, null, spec);
    const edgeAt = (x: number): number => {
      for (let y = -0.9; y < 0; y += 0.002) {
        if (
          hits(camera, interior.meshes, x, y).includes('frame') &&
          hits(camera, interior.meshes, x, y + 0.002).length === 0
        ) {
          return y;
        }
      }
      throw new Error(`no dash edge at ${x}`);
    };
    expect(edgeAt(-0.9)).toBeGreaterThan(edgeAt(0.9));
    const low = edgeShift(spec, camera.aspect, COCKPIT_FOV);
    expect(edgeAt(low)).toBeLessThan(edgeAt(low - 0.6));
    expect(edgeAt(low)).toBeLessThan(edgeAt(low + 0.4));
  });

  it('keeps the instrument hump straight ahead below the sight cone', () => {
    const { camera, interior } = shoot(1280, 720, 0.7, null, spec);
    expect(hits(camera, interior.meshes, 0, -0.48)).toEqual(['frame']);
    expect(hits(camera, interior.meshes, 0, -0.46)).toEqual([]);
  });
});

describe('the flat overlay binnacle lip', () => {
  const windows = [...REQUIRED, [360, 844], [1920, 360], [390, 844], [844, 390]] as const;

  it.each(trucks)('stays on the hump, whatever the dash shift of the window: $id', (spec) => {
    for (const [w, h] of windows) {
      const { camera, interior } = shoot(w, h, 0.7, null, spec);
      for (const x of [-LIP.halfWidth, 0, LIP.halfWidth]) {
        const edge = lipTop(x) + LIP.gap;
        expect(hits(camera, interior.meshes, x, edge - 0.002), `${w}x${h} x=${x}`).toContain(
          'frame',
        );
        expect(hits(camera, interior.meshes, x, edge + 0.002), `${w}x${h} x=${x}`).toEqual([]);
      }
    }
  });
});

describe('edgeShift', () => {
  const fov = COCKPIT_FOV;

  it.each(trucks)(
    'is the windscreen centre in a wide pane and held to the cap in a narrow one: $id',
    (spec) => {
      const wide = edgeShift(spec, 4, fov);
      expect(wide).toBeCloseTo(
        Math.tan(cabSight(spec).windscreenCentre) / (4 * Math.tan(MathUtils.degToRad(fov / 2))),
        12,
      );
      expect(edgeShift(spec, 1.07, fov)).toBeGreaterThan(wide);
      expect(edgeShift(spec, 0.5, fov)).toBe(edgeShift(spec, 1.07, fov));
    },
  );
});

describe('visorLeft', () => {
  it('keeps the visor clear of the left mirror, and at its own edge where there is room', () => {
    expect(visorLeft(0.467)).toBeCloseTo(MIRROR_GAP - 0.467, 12);
    expect(visorLeft(1)).toBe(VISOR.left);
    expect(visorLeft(0.05)).toBeLessThanOrEqual(VISOR.right);
  });
});

describe('flat overlay pillars keep the training view clear', () => {
  // Landscape and portrait windows from phone to desktop, the layouts of `computeViewports`.
  const windows: (readonly [number, number])[] = [];
  for (let w = 360; w <= 1920; w += 60) for (let h = 360; h <= 1280; h += 80) windows.push([w, h]);
  windows.push(...REQUIRED, [1024, 768], [390, 844], [844, 390]);

  /** Fresh each time: `forcedPillars` moves the pillars. */
  const sweep = () => windows.map(([w, h]) => ({ w, h, shot: shoot(w, h) }));
  const shown = (s: Shot): Mesh[] =>
    [s.interior.pillars.left, s.interior.pillars.right].filter((m) => m.visible);

  it('sweeps windows with and without pillars', () => {
    const shots = sweep();
    const withPillars = shots.filter(({ shot }) => shown(shot).length === 2).length;
    expect(withPillars).toBeGreaterThan(0);
    expect(withPillars).toBeLessThan(shots.length);
  });

  it('keeps the A-pillars out of the lines of sight from the eye to each mirror rect', () => {
    for (const { w, h, shot } of sweep()) {
      const { camera, cockpit, left, right } = shot;
      const pillars = forcedPillars(shot);
      for (const rect of [left, right]) {
        for (let u = 0; u <= 1; u += 0.125) {
          for (let v = 0; v <= 1; v += 0.125) {
            const [x, y] = rectToNdc(cockpit, rect, u, v);
            expect(hits(camera, pillars, x, y), `${w}x${h} (${u}, ${v})`).toEqual([]);
          }
        }
      }
    }
  });

  it('drops a pillar only when the narrowest allowed one would reach into the cone margin', () => {
    let hidden = 0;
    for (const { w, h, shot } of sweep()) {
      const { camera, interior, cockpit, left, right } = shot;
      const layout = interiorLayout(cockpit, left, right);
      const margin = coneEdge(camera.aspect, COCKPIT_FOV) + CONE_GAP;
      for (const [mesh, side] of [
        [interior.pillars.left, -1],
        [interior.pillars.right, 1],
      ] as const) {
        if (mesh.visible) continue;
        hidden++;
        forcedPillars(shot);
        let innermost = Infinity;
        for (let x = 0; x <= 1; x += 0.0025) {
          if (hits(camera, [mesh], side * x, 0).length > 0) {
            innermost = x;
            break;
          }
        }
        expect(
          innermost,
          `${w}x${h} ${mesh.name} (mirror at ${side < 0 ? layout.left : layout.right})`,
        ).toBeLessThan(margin);
      }
    }
    expect(hidden).toBeGreaterThan(0);
  });
});

describe.each(trucks)('glb interior steering wheel of $id', (spec) => {
  const windows: (readonly [number, number])[] = [...REQUIRED, [1024, 768], [390, 844], [844, 390]];
  for (let w = 360; w <= 1920; w += 120) {
    for (let h = 360; h <= 1280; h += 160) windows.push([w, h]);
  }
  const shootGlb = (w: number, h: number) => {
    const interior = createGlbInterior(spec);
    interior.attach(GLB_SHELLS[spec.id] as InteriorShell);
    return shootWith(interior, w, h, 0.7, null, QUALITY_FLAGS.high, spec);
  };
  const rim = (shot: Shot<GlbInterior>): Mesh[] =>
    drawn(shot.interior).filter((m) => m.name === 'wheel');
  const cone = MathUtils.degToRad(CLEAR_CONE_DEG);

  it('stays out of the sight cone and the lines of sight to each mirror rect', () => {
    for (const [w, h] of windows) {
      const shot = shootGlb(w, h);
      const wheel = rim(shot);
      expect(wheel).toHaveLength(1);
      for (let az = -cone; az <= cone + 1e-9; az += cone / 6) {
        for (let el = -cone; el <= cone + 1e-9; el += cone / 6) {
          expect(hitsAlong(shot.camera, wheel, az, el), `${w}x${h} cone`).toEqual([]);
        }
      }
      for (const rect of rectsOf(shot)) {
        for (let u = 0; u <= 1; u += 0.125) {
          for (let v = 0; v <= 1; v += 0.125) {
            const [x, y] = rectToNdc(shot.cockpit, rect, u, v);
            expect(hits(shot.camera, wheel, x, y), `${w}x${h} mirror (${u}, ${v})`).toEqual([]);
          }
        }
      }
    }
  });

  it('shows its rim above the HUD band straight ahead of the driver', () => {
    for (const [w, h] of REQUIRED) {
      const shot = shootGlb(w, h);
      const y = bandTopNdc() + 0.03;
      expect(hits(shot.camera, rim(shot), 0, y), `${w}x${h}`).toEqual(['wheel']);
    }
  });
});

describe.each(trucks)('glb interior closes the cab above the windscreen of $id', (spec) => {
  const anchors = truckAnchors(spec);
  const cab = cabShellParams(spec);
  const glassTop = FRAME_TOP + cab.cab.glassSill + cab.cab.glassHeight;
  const screen = cab.width / 2 - cab.cab.windscreenInset;
  const probe = new Raycaster();
  const PITCH = -COCKPIT_PITCH;

  it('hits an interior part on every ray that would leave through the front wall above the glass', () => {
    let total = 0;
    for (const [w, h] of [...REQUIRED, [1024, 768], [844, 390], [1920, 800]] as const) {
      const interior = createGlbInterior(spec);
      interior.attach(GLB_SHELLS[spec.id] as InteriorShell);
      // heading 0 at (12, -7): three space is body x, body z, -body y from there
      const { camera } = shootWith(interior, w, h, 0, null, QUALITY_FLAGS.high, spec);
      const parts = drawn(interior);
      probe.layers.mask = camera.layers.mask;
      let rays = 0;
      for (let x = -1; x <= 1; x += 0.05) {
        for (let y = -1; y <= 1; y += 0.05) {
          probe.setFromCamera(new Vector2(x, y), camera);
          const { origin, direction } = probe.ray;
          if (direction.x <= 0) continue;
          const t = (12 + anchors.frontX - origin.x) / direction.x;
          const z = origin.y + t * direction.y;
          const across = 7 - (origin.z + t * direction.z);
          if (z <= glassTop + 0.002 || Math.abs(across) >= screen) continue;
          rays++;
          expect(
            hits(camera, parts, x, y),
            `${w}x${h} (${x.toFixed(2)}, ${y.toFixed(2)})`,
          ).not.toEqual([]);
        }
      }
      total += rays;
    }
    // The glass top projects inside the pane for the truck with the higher eye only.
    const topNdc =
      Math.tan(Math.atan2(glassTop - anchors.eye.z, anchors.frontX - anchors.eye.x) + PITCH) /
      Math.tan(MathUtils.degToRad(COCKPIT_FOV / 2));
    if (topNdc < 1) expect(total).toBeGreaterThan(0);
  });
});

describe.each(trucks)('glb interior of $id with the head turned', (spec) => {
  const shootGlb = (w: number, h: number, head: HeadPose, mode: LightingMode = 'night') => {
    const interior = createGlbInterior(spec);
    interior.attach(GLB_SHELLS[spec.id] as InteriorShell);
    return shootWith(interior, w, h, 0.7, null, QUALITY_FLAGS.high, spec, undefined, mode, head);
  };
  const deg = MathUtils.degToRad;
  const LOOKS: readonly HeadPose[] = [
    { yaw: deg(100), pitch: 0 },
    { yaw: deg(-100), pitch: 0 },
    { yaw: deg(40), pitch: HEAD_LIMITS.pitchUp },
    { yaw: deg(-70), pitch: -HEAD_LIMITS.pitchDown },
  ];
  /** The world matrix of everything the interior draws, by name. */
  const matrices = (interior: CockpitInterior): Map<string, number[]> =>
    new Map(shown(interior).map((o) => [o.name, o.matrixWorld.toArray()]));

  it('looks around only once the asset is drawn, not on the flat overlay', () => {
    expect(createCockpitInterior(spec).looksAround).not.toBe(true);
    const interior = createGlbInterior(spec);
    interior.setLook(lookFor(QUALITY_FLAGS.high, 'day'));
    expect(interior.looksAround).toBe(false);
    interior.attach(GLB_SHELLS[spec.id] as InteriorShell);
    expect(interior.looksAround).toBe(true);
  });

  it('puts the lip where the eye-locked overlay does with the head forward', () => {
    for (const [w, h] of REQUIRED) {
      const { camera, interior } = shootGlb(w, h, HEAD_REST);
      const lip = drawn(interior).find((m) => m.name === 'binnacle-lip');
      if (lip === undefined) throw new Error('no lip');
      const locked = new Group();
      placeInEye(locked, camera);
      locked.updateMatrixWorld();
      lip.matrixWorld.toArray().forEach((v, i) => {
        expect(v, `${w}x${h} [${i}]`).toBeCloseTo(locked.matrixWorld.toArray()[i] as number, 9);
      });
    }
  });

  it.each(LOOKS)('stays put in the cab, lip included, while the head turns %o', (head) => {
    const forward = shootGlb(1280, 720, HEAD_REST);
    const turned = shootGlb(1280, 720, head);
    expect(turned.camera.matrixWorld.toArray()).not.toEqual(forward.camera.matrixWorld.toArray());
    const rest = matrices(forward.interior);
    expect(rest.has('binnacle-lip')).toBe(true);
    const now = matrices(turned.interior);
    expect([...now.keys()]).toEqual([...rest.keys()]);
    for (const [name, matrix] of rest) expect(now.get(name), name).toEqual(matrix);
  });

  it('keeps a dash above the HUD band at every x over the whole pitch range', () => {
    const y = bandTopNdc() + 0.02;
    const { pitchUp, pitchDown } = HEAD_LIMITS;
    for (const pitch of [-pitchDown, -pitchDown / 2, 0, pitchUp / 2, pitchUp]) {
      for (const [w, h] of REQUIRED) {
        const { camera, interior } = shootGlb(w, h, { yaw: 0, pitch });
        const parts = drawn(interior);
        for (let x = -1; x <= 1; x += 0.125) {
          const names = hits(camera, parts, x, y);
          expect(names, `pitch ${pitch} ${w}x${h} x=${x}`).toContain('interior');
        }
      }
    }
  });

  it('stops the pitch up just short of where the dash sinks under the HUD band', () => {
    const y = bandTopNdc() + 0.02;
    const covered = (w: number, h: number, pitch: number): boolean => {
      const { camera, interior } = shootGlb(w, h, { yaw: 0, pitch });
      const parts = drawn(interior);
      for (let x = -1; x <= 1; x += 0.125) {
        if (!hits(camera, parts, x, y).includes('interior')) return false;
      }
      return true;
    };
    for (const [w, h] of REQUIRED) {
      let [low, high] = [0, deg(20)];
      expect(covered(w, h, low), `${w}x${h} forward`).toBe(true);
      while (high - low > 1e-3) {
        const mid = (low + high) / 2;
        if (covered(w, h, mid)) low = mid;
        else high = mid;
      }
      expect(low, `${w}x${h} the dash's own limit`).toBeGreaterThanOrEqual(HEAD_LIMITS.pitchUp);
      expect(low - HEAD_LIMITS.pitchUp, `${w}x${h} slack`).toBeLessThan(deg(2));
    }
  });
});
