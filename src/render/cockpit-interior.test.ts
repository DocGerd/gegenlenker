import {
  Frustum,
  Layers,
  Matrix4,
  MathUtils,
  Raycaster,
  Vector2,
  Vector3,
  type Mesh,
  type PerspectiveCamera,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { LegendBox, Rect } from '../contracts/render';
import { truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import { createChaseCamera } from './chase-camera';
import { COCKPIT_FOV, createCockpitCamera, placeCockpitCamera } from './cockpit-camera';
import {
  CLEAR_CONE_DEG,
  CONE_GAP,
  coneEdge,
  createCockpitInterior,
  interiorLayout,
  MIN_PILLAR_WIDTH,
  MIRROR_GAP,
  pillarSpan,
} from './cockpit-interior';
import { createMirror } from './mirror';
import { QUALITY_FLAGS } from './quality';
import { enableLayers, INTERIOR_LAYER, SKY_LAYER, TOP_DOWN_LAYERS } from './seams';
import { computeViewports } from './viewports';

const eye = truckAnchors(truckById('man-le-18-280')).eye;

type Shot = {
  readonly camera: PerspectiveCamera;
  readonly interior: ReturnType<typeof createCockpitInterior>;
  readonly cockpit: Rect;
  readonly left: Rect;
  readonly right: Rect;
};

/** The real cockpit camera and the interior placed for a window of `width` x `height` CSS px. */
function shoot(
  width: number,
  height: number,
  heading = 0.7,
  legend: LegendBox | null = null,
): Shot {
  const { cockpit, mirrorLeft, mirrorRight } = computeViewports(width, height, 'drive', legend);
  if (cockpit === null || mirrorLeft === null || mirrorRight === null) throw new Error('no views');
  const camera = createCockpitCamera();
  const interior = createCockpitInterior();
  placeCockpitCamera(camera, { x: 12, y: -7, heading }, eye, cockpit);
  interior.place(camera, cockpit, mirrorLeft, mirrorRight);
  return { camera, interior, cockpit, left: mirrorLeft, right: mirrorRight };
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

describe('cockpit interior layers', () => {
  const { meshes } = createCockpitInterior();

  it('is on INTERIOR_LAYER alone, which only the cockpit camera enables', () => {
    expect(meshes.length).toBeGreaterThan(0);
    const cockpit = createCockpitCamera().layers;
    const mirror = createMirror().camera.layers;
    const chase = createChaseCamera().layers;
    const topDown = layersOf(TOP_DOWN_LAYERS);
    for (const m of meshes) {
      expect(m.layers.mask, m.name).toBe(1 << INTERIOR_LAYER);
      expect(m.layers.test(cockpit), m.name).toBe(true);
      expect(m.layers.test(mirror), m.name).toBe(false);
      expect(m.layers.test(chase), m.name).toBe(false);
      expect(m.layers.test(topDown), m.name).toBe(false);
    }
  });

  it('keeps the cockpit camera on the sky layer too, and no other camera on the interior', () => {
    const cockpit = createCockpitCamera().layers;
    expect(cockpit.isEnabled(SKY_LAYER)).toBe(true);
    for (const layers of [createMirror().camera.layers, createChaseCamera().layers]) {
      expect(layers.isEnabled(INTERIOR_LAYER)).toBe(false);
    }
  });
});

describe('cockpit interior quality', () => {
  it.each(['low', 'balanced', 'high'] as const)('is drawn only when the %s preset says so', (p) => {
    const interior = createCockpitInterior();
    interior.setQuality(QUALITY_FLAGS[p]);
    expect(interior.object.visible).toBe(p !== 'low');
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

describe('cockpit interior keeps the training view clear', () => {
  // Landscape and portrait windows from phone to desktop, the layouts of `computeViewports`.
  const windows: (readonly [number, number])[] = [];
  for (let w = 360; w <= 1920; w += 60) for (let h = 360; h <= 1280; h += 80) windows.push([w, h]);
  windows.push(...REQUIRED, [1024, 768], [390, 844], [844, 390]);

  const cone = MathUtils.degToRad(CLEAR_CONE_DEG);
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

  it('leaves a central forward sight cone free of every part', () => {
    for (const { w, h, shot } of sweep()) {
      for (let az = -cone; az <= cone + 1e-9; az += cone / 6) {
        for (let el = -cone; el <= cone + 1e-9; el += cone / 6) {
          if (Math.hypot(az, el) > cone) continue;
          expect(
            hitsAlong(shot.camera, shot.interior.meshes, az, el),
            `${w}x${h} ${az} ${el}`,
          ).toEqual([]);
        }
      }
    }
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

  it('keeps every part off the centre of each mirror rect', () => {
    for (const { w, h, shot } of sweep()) {
      const { camera, interior, cockpit, left, right } = shot;
      forcedPillars(shot);
      for (const rect of [left, right]) {
        const [x, y] = rectToNdc(cockpit, rect, 0.5, 0.5);
        expect(hits(camera, interior.meshes, x, y), `${w}x${h}`).toEqual([]);
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
