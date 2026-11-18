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
import type { Rect } from '../contracts/render';
import { truckAnchors } from '../vehicles/anchors';
import { truckById } from '../vehicles/registry';
import { createChaseCamera } from './chase-camera';
import { COCKPIT_FOV, createCockpitCamera, placeCockpitCamera } from './cockpit-camera';
import {
  CLEAR_CONE_DEG,
  createCockpitInterior,
  interiorLayout,
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
function shoot(width: number, height: number, heading = 0.7): Shot {
  const { cockpit, mirrorLeft, mirrorRight } = computeViewports(width, height, 'drive');
  if (cockpit === null || mirrorLeft === null || mirrorRight === null) throw new Error('no views');
  const camera = createCockpitCamera();
  const interior = createCockpitInterior();
  placeCockpitCamera(camera, { x: 12, y: -7, heading }, eye, cockpit);
  interior.place(camera, interiorLayout(cockpit, mirrorLeft, mirrorRight));
  return { camera, interior, cockpit, left: mirrorLeft, right: mirrorRight };
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
  const views = [
    [1350, 600],
    [1280, 800],
  ] as const;

  it.each(views)('is in the frustum, part by part, at %i x %i', (w, h) => {
    const { camera, interior } = shoot(w, h);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    expect(interior.meshes.length).toBe(7);
    for (const m of interior.meshes) {
      expect(m.visible, m.name).toBe(true);
      expect(frustum.intersectsObject(m), m.name).toBe(true);
    }
  });

  it.each(views)(
    'is hit by rays through the dashboard, header, visor and pillars at %i x %i',
    (w, h) => {
      const { camera, interior, cockpit, left, right } = shoot(w, h);
      const m = interior.meshes;
      expect(hits(camera, m, 0, -0.9)).toContain('dash');
      expect(hits(camera, m, 0, -0.535)).toContain('dash-lip');
      expect(hits(camera, m, 0, 0.9)).toContain('header');
      expect(hits(camera, m, -0.3, 0.7)).toContain('visor');
      const layout = interiorLayout(cockpit, left, right);
      const span = pillarSpan(camera.aspect, COCKPIT_FOV, layout.right);
      if (span === null) throw new Error('no right pillar');
      expect(hits(camera, m, span.centre, 0)).toContain('pillar-right');
      const leftSpan = pillarSpan(camera.aspect, COCKPIT_FOV, layout.left);
      if (leftSpan === null) throw new Error('no left pillar');
      expect(hits(camera, m, -leftSpan.centre, 0)).toContain('pillar-left');
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

describe('cockpit interior keeps the training view clear', () => {
  // Landscape and portrait windows from phone to desktop, the layouts of `computeViewports`.
  const windows: [number, number][] = [];
  for (let w = 360; w <= 1920; w += 60) for (let h = 360; h <= 1280; h += 80) windows.push([w, h]);
  windows.push([1350, 600], [1280, 800], [1024, 768], [390, 844], [844, 390]);

  const cone = MathUtils.degToRad(CLEAR_CONE_DEG);

  it('leaves a central forward sight cone free of every part', () => {
    for (const [w, h] of windows) {
      const { camera, interior } = shoot(w, h);
      for (let az = -cone; az <= cone + 1e-9; az += cone / 6) {
        for (let el = -cone; el <= cone + 1e-9; el += cone / 6) {
          if (Math.hypot(az, el) > cone) continue;
          expect(hitsAlong(camera, interior.meshes, az, el), `${w}x${h} ${az} ${el}`).toEqual([]);
        }
      }
    }
  });

  it('keeps the A-pillars out of the lines of sight from the eye to each mirror rect', () => {
    for (const [w, h] of windows) {
      const { camera, interior, cockpit, left, right } = shoot(w, h);
      const pillars = [interior.pillars.left, interior.pillars.right];
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
    for (const [w, h] of windows) {
      const { camera, interior, cockpit, left, right } = shoot(w, h);
      for (const rect of [left, right]) {
        const [x, y] = rectToNdc(cockpit, rect, 0.5, 0.5);
        expect(hits(camera, interior.meshes, x, y), `${w}x${h}`).toEqual([]);
      }
    }
  });

  it('shows both pillars in tablet and desktop windows whose cockpit is wide enough to leave room beside the cone', () => {
    for (const [w, h] of windows) {
      const { interior, cockpit } = shoot(w, h);
      if (w >= 800 && cockpit.width / cockpit.height >= 0.9) {
        expect(interior.pillars.left.visible, `${w}x${h}`).toBe(true);
        expect(interior.pillars.right.visible, `${w}x${h}`).toBe(true);
      }
    }
  });

  it('drops a pillar that would have to enter the cone or cover a mirror', () => {
    const { interior } = shoot(1024, 768);
    expect(interior.pillars.left.visible).toBe(false);
    expect(interior.pillars.right.visible).toBe(false);
    expect(interior.meshes.filter((m) => m.visible).length).toBe(5);
  });
});
