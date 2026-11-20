import { OrthographicCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { KIT_FOOTPRINTS } from '../content/kit';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import { perspectiveSunDirection } from './light-rig';
import type { ShadowFocus } from './seams';
import { CASTER_HEIGHT, fitSunShadow, SHADOW_MAP_SIZE, type SunShadowFit } from './sun-shadow';

const SUN = perspectiveSunDirection();
const HALF_LENGTH = 8;
const HALF_WIDTH = 1.3;
const HEIGHT = 4;
const RADIUS = Math.hypot(HALF_LENGTH, HALF_WIDTH) + 1;
const fit = (focus: ShadowFocus): SunShadowFit => fitSunShadow(focus, SUN, SHADOW_MAP_SIZE);

function shadowCamera(f: SunShadowFit): OrthographicCamera {
  const camera = new OrthographicCamera(-f.half, f.half, f.half, -f.half, f.near, f.far);
  camera.position.copy(f.position);
  camera.lookAt(f.target);
  camera.updateMatrixWorld();
  return camera;
}

const inside = (camera: OrthographicCamera, p: Vector3): boolean => {
  const ndc = p.clone().project(camera);
  return [ndc.x, ndc.y, ndc.z].every((v) => Math.abs(v) <= 1);
};

const foci = [
  { x: 0, y: 0 },
  { x: 37.123, y: -12.77 },
  { x: -250.5, y: 410.01 },
  { x: 1e-3, y: 1e3 },
];
const headings = [0, 0.4, Math.PI / 2, 2.5, -2, Math.PI];

describe('fitSunShadow', () => {
  it('holds the vehicle box and the ground around it at every pose', () => {
    for (const { x, y } of foci) {
      for (const heading of headings) {
        const camera = shadowCamera(fit({ x, y, radius: RADIUS }));
        const c = Math.cos(heading);
        const s = Math.sin(heading);
        for (const [u, v] of [
          [HALF_LENGTH, HALF_WIDTH],
          [HALF_LENGTH, -HALF_WIDTH],
          [-HALF_LENGTH, HALF_WIDTH],
          [-HALF_LENGTH, -HALF_WIDTH],
        ] as const) {
          for (const z of [0, HEIGHT]) {
            const p = new Vector3(x + c * u - s * v, z, -(y + s * u + c * v));
            expect(inside(camera, p), `corner ${u},${v},${z} at ${x},${y} heading ${heading}`).toBe(
              true,
            );
            const tip = p.clone().addScaledVector(SUN, -z / SUN.y);
            expect(inside(camera, tip), `shadow tip of ${u},${v},${z} at ${x},${y}`).toBe(true);
          }
        }
        for (let a = 0; a < 360; a += 10) {
          const t = (a * Math.PI) / 180;
          const p = new Vector3(x + RADIUS * Math.cos(t), 0, -(y + RADIUS * Math.sin(t)));
          expect(inside(camera, p), `ground ${a} deg at ${x},${y}`).toBe(true);
        }
      }
    }
  });

  it('reaches tall casters towards the sun', () => {
    const { x, y } = foci[1] as { x: number; y: number };
    const camera = shadowCamera(fit({ x, y, radius: RADIUS }));
    const ground = new Vector3(x, 0, -y);
    const sunSide = ground.clone().addScaledVector(SUN, 10 / SUN.y);
    expect(inside(camera, sunSide)).toBe(true);
  });

  it('reaches the tallest caster of the kit and of every layout', () => {
    const tops = Object.values(KIT_FOOTPRINTS).map((piece) => piece.height);
    for (const source of Object.values(layouts)) {
      tops.push(...resolveLayout(source, null).obstacles.map((o) => o.height));
    }
    expect(CASTER_HEIGHT).toBeGreaterThanOrEqual(Math.max(...tops));
    expect(CASTER_HEIGHT).toBeGreaterThan(12);
    const { x, y } = foci[1] as { x: number; y: number };
    const camera = shadowCamera(fit({ x, y, radius: RADIUS }));
    // the top of the tallest caster standing at the edge of the ground the box covers, towards the sun
    const edge = new Vector3(x, 0, -y).addScaledVector(
      new Vector3(SUN.x, 0, SUN.z).normalize(),
      RADIUS,
    );
    edge.y = CASTER_HEIGHT;
    expect(inside(camera, edge)).toBe(true);
  });

  it('keeps the extent per radius, whatever the focus', () => {
    const halves = foci.map(({ x, y }) => fit({ x, y, radius: RADIUS }).half);
    expect(new Set(halves).size).toBe(1);
    expect(fit({ x: 0, y: 0, radius: 2 * RADIUS }).half).toBeCloseTo(2 * (halves[0] ?? NaN), 9);
  });

  it('keeps the box centre on the texel grid of light space', () => {
    const right = new Vector3(SUN.z, 0, -SUN.x).normalize();
    const up = new Vector3().crossVectors(SUN, right);
    for (const { x, y } of foci) {
      const f = fit({ x, y, radius: RADIUS });
      const texel = (2 * f.half) / SHADOW_MAP_SIZE;
      for (const axis of [right, up]) {
        const cells = f.target.dot(axis) / texel;
        expect(Math.abs(cells - Math.round(cells))).toBeLessThan(1e-4);
      }
    }
  });

  it('does not move the box for a focus move inside a texel', () => {
    const right = new Vector3(SUN.z, 0, -SUN.x).normalize();
    const base = fit({ x: 12, y: 7, radius: RADIUS });
    const texel = (2 * base.half) / SHADOW_MAP_SIZE;
    // start from the snapped centre, then slide a third of a texel along the light's x axis
    const onGrid = { x: base.target.x, y: -base.target.z, radius: RADIUS };
    const moved = {
      ...onGrid,
      x: onGrid.x + right.x * texel * 0.3,
      y: onGrid.y - right.z * texel * 0.3,
    };
    const a = fit(onGrid);
    const b = fit(moved);
    expect(b.target.distanceTo(a.target)).toBeLessThan(1e-6);
    expect(b.position.distanceTo(a.position)).toBeLessThan(1e-6);
  });

  it('places the sun along its direction from the box centre', () => {
    const f = fit({ x: 5, y: -3, radius: RADIUS });
    const direction = f.position.clone().sub(f.target).normalize();
    expect(direction.distanceTo(SUN)).toBeLessThan(1e-9);
    expect(f.near).toBeGreaterThan(0);
    expect(f.far).toBeGreaterThan(f.near);
  });
});
