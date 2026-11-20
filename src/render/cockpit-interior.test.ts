import {
  Frustum,
  Group,
  Layers,
  Light,
  Matrix4,
  MathUtils,
  type Object3D,
  Raycaster,
  Vector2,
  Vector3,
  Mesh,
  type PerspectiveCamera,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { LegendBox, Rect, ScenePalette } from '../contracts/render';
import { truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import { placePose } from './coords';
import { createChaseCamera } from './chase-camera';
import { COCKPIT_FOV, createCockpitCamera, placeCockpitCamera } from './cockpit-camera';
import {
  CLEAR_CONE_DEG,
  CONE_GAP,
  coneEdge,
  createCockpitInterior,
  headerEdge,
  type FlatInterior,
  interiorLayout,
  MIN_PILLAR_WIDTH,
  MIRROR_GAP,
  pillarSpan,
  VISOR,
} from './cockpit-interior';
import { createMirror } from './mirror';
import { KEYS } from './palette';
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
import { bandTopNdc, computeViewports } from './viewports';

const truck = truckById('man-le-18-280');
const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const eye = truckAnchors(truck).eye;

type Shot<I extends CockpitInterior = FlatInterior> = {
  readonly camera: PerspectiveCamera;
  readonly interior: I;
  readonly cockpit: Rect;
  readonly left: Rect;
  readonly right: Rect;
};

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
): Shot<I> {
  const { cockpit, mirrorLeft, mirrorRight } = computeViewports(width, height, 'drive', legend);
  if (cockpit === null || mirrorLeft === null || mirrorRight === null) throw new Error('no views');
  const pose = { x: 12, y: -7, heading };
  const scene = new Group();
  scene.matrixWorldAutoUpdate = false;
  const truckObject = new Group();
  placePose(truckObject, pose);
  scene.add(truckObject);
  (interior.frame === 'truck' ? truckObject : scene).add(interior.object);
  const camera = createCockpitCamera();
  placeCockpitCamera(camera, pose, eye, cockpit);
  interior.setQuality(flags);
  scene.updateMatrixWorld();
  interior.place({ camera, cockpit, mirrorLeft, mirrorRight });
  return { camera, interior, cockpit, left: mirrorLeft, right: mirrorRight };
}

function shoot(
  width: number,
  height: number,
  heading = 0.7,
  legend: LegendBox | null = null,
): Shot {
  return shootWith(createCockpitInterior(), width, height, heading, legend, QUALITY_FLAGS.balanced);
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
  /** Names of the meshes that carry the dashboard; the pillars and the roof parts never count. */
  readonly dash: readonly string[];
  /** Where a part may cover a mirror rect by design (NDC); everywhere else the rect's view is clear. */
  readonly mayCoverMirror: (x: number, y: number) => boolean;
};

/** Every route that implements the seam; a new interior joins here and inherits the checks below. */
const ROUTES: readonly Route[] = [
  {
    name: 'flat overlay',
    make: createCockpitInterior,
    dash: ['frame'],
    // The headliner and the stowed visor reach down over the top of a mirror rect on small
    // windows; the header edge is a chord polyline just below the curve.
    mayCoverMirror: (x, y) =>
      y >= headerEdge(x) - 0.005 || (x >= VISOR.left && x <= VISOR.right && y >= VISOR.bottom),
  },
];

/** The presets that draw an interior: the checks run at each, as a route may differ per preset. */
const DRAWING = ['balanced', 'high'] as const;

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

function drawn(interior: CockpitInterior): Mesh[] {
  return shown(interior).filter((o): o is Mesh => o instanceof Mesh);
}

describe.each(ROUTES)('cockpit interior seam: $name', ({ make, dash, mayCoverMirror }) => {
  const build = (flags: QualityFlags) => {
    const interior = make(truck, palette);
    interior.setQuality(flags);
    return interior;
  };
  const shootRoute = (width: number, height: number, heading = 0.7) =>
    shootWith(make(truck, palette), width, height, heading, null, QUALITY_FLAGS.balanced);

  describe.each(DRAWING)('at %s', (preset) => {
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
        for (const layers of perspective) expect(light.layers.test(layers), light.name).toBe(true);
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
    for (const preset of DRAWING) {
      expect(drawn(build(QUALITY_FLAGS[preset])).length, preset).toBeGreaterThan(0);
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

    it('leaves a central forward sight cone free of every part', () => {
      for (const [w, h] of windows) {
        const { camera, interior } = shootRoute(w, h);
        const parts = drawn(interior);
        for (let az = -cone; az <= cone + 1e-9; az += cone / 6) {
          for (let el = -cone; el <= cone + 1e-9; el += cone / 6) {
            if (Math.hypot(az, el) > cone) continue;
            expect(hitsAlong(camera, parts, az, el), `${w}x${h} ${az} ${el}`).toEqual([]);
          }
        }
      }
    });

    it('keeps every part out of the lines of sight to each mirror rect, bar what the route covers by design', () => {
      for (const [w, h] of windows) {
        const { camera, interior, cockpit, left, right } = shootRoute(w, h);
        const parts = drawn(interior);
        for (const rect of [left, right]) {
          for (let u = 0; u <= 1; u += 0.125) {
            for (let v = 0; v <= 1; v += 0.125) {
              const [x, y] = rectToNdc(cockpit, rect, u, v);
              if (mayCoverMirror(x, y)) continue;
              expect(hits(camera, parts, x, y), `${w}x${h} (${u}, ${v})`).toEqual([]);
            }
          }
        }
      }
    });

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

    it('keeps every part off the centre of each mirror rect', () => {
      for (const [w, h] of windows) {
        const { camera, interior, cockpit, left, right } = shootRoute(w, h);
        const parts = drawn(interior);
        for (const rect of [left, right]) {
          const [x, y] = rectToNdc(cockpit, rect, 0.5, 0.5);
          expect(hits(camera, parts, x, y), `${w}x${h}`).toEqual([]);
        }
      }
    });
  });
});

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
      const span = pillarSpan(camera.aspect, COCKPIT_FOV, layout.right);
      const leftSpan = pillarSpan(camera.aspect, COCKPIT_FOV, layout.left);
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
    const legend = { right: 780, height: 330 };
    const plain = shoot(1350, 600);
    const shot = shoot(1350, 600, 0.7, legend);
    expect(shot.right.width).toBeLessThan(plain.right.width);
    const { camera, interior, cockpit, left, right } = shot;
    expect(interior.pillars.left.visible).toBe(true);
    expect(interior.pillars.right.visible).toBe(true);
    for (const rect of [left, right]) {
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
