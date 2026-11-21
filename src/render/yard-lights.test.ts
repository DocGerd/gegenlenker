import { Color, type Object3D, SpotLight, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { exercises, layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { ScenePalette } from '../contracts/render';
import { GROUND, litGround } from './lamp-light';
import { NIGHT_AMBIENT, NIGHT_TINT, PEAK_HEADROOM } from './light-rig';
import { lookFor } from './look';
import { KEYS } from './palette';
import { QUALITY_FLAGS } from './quality';
import { PERSPECTIVE_LAYER } from './seams';
import {
  createYardLights,
  faceIrradiance,
  FLOOD,
  FLOOD_POOL_NAME,
  floodLitSample,
  groundIrradiance,
  poolGeometry,
  STREET,
  STREET_POOL_NAME,
  yardCandela,
  yardLightSpecs,
} from './yard-lights';

const palette = Object.fromEntries(Object.keys(KEYS).map((k) => [k, 0x808080])) as ScenePalette;
const resolved = Object.values(layouts).map((l) => resolveLayout(l, null));
const withFixtures = resolved.filter((l) => l.props.some((p) => p.fixture !== undefined));
const lampProps = (layout: (typeof resolved)[number]) =>
  layout.props.filter((p) => p.asset === 'lamp');

describe('yard light specs', () => {
  it('has a layout with floodlights and one with street lamps', () => {
    const kinds = new Set(withFixtures.flatMap((l) => yardLightSpecs(l).map((s) => s.kind)));
    expect([...kinds].sort()).toEqual(['flood', 'street']);
  });

  it.each(withFixtures.map((l) => [l.id, l] as const))(
    'puts one light on each lamp fixture of %s, aimed at its aim and at its post',
    (_, layout) => {
      const specs = yardLightSpecs(layout);
      const props = lampProps(layout);
      expect(specs).toHaveLength(props.length);
      props.forEach((prop, i) => {
        const spec = specs[i];
        const post = prop.colliders[0];
        if (spec === undefined || post === undefined || prop.fixture === undefined) {
          throw new Error('no spec');
        }
        expect(spec.kind).toBe(prop.fixture.kind);
        expect(spec.post).toEqual({ x: post.obb.cx, y: post.obb.cy });
        expect(spec.position.z).toBeLessThan(post.height);
        expect(spec.position.z).toBeGreaterThan(post.height - 1);
        const { aim } = prop.fixture;
        const heading = Math.atan2(aim.y - spec.position.y, aim.x - spec.position.x);
        // the horizontal part of the axis points at the aim
        expect(Math.atan2(spec.aim.y, spec.aim.x)).toBeCloseTo(heading, 6);
        expect(spec.aim.z).toBeLessThan(0);
        expect(Math.hypot(spec.aim.x, spec.aim.y, spec.aim.z)).toBeCloseTo(1, 9);
      });
    },
  );

  it('throws a mast light on the ground along the way to the aim, and a street lamp at its own pitch', () => {
    for (const layout of withFixtures) {
      for (const spec of yardLightSpecs(layout)) {
        const run = spec.position.z / -spec.aim.z;
        const away = Math.hypot(spec.aim.x, spec.aim.y) * run;
        if (spec.kind === 'flood') expect(away).toBeCloseTo(FLOOD.throw, 6);
        else expect(Math.asin(-spec.aim.z)).toBeCloseTo(STREET.pitch, 9);
      }
    }
  });

  it('puts a lamp head light beyond its lens only by the stand-off, never inside the post', () => {
    for (const layout of withFixtures) {
      for (const spec of yardLightSpecs(layout)) {
        const off = Math.hypot(spec.position.x - spec.post.x, spec.position.y - spec.post.y);
        expect(off).toBeCloseTo(
          spec.kind === 'flood' ? FLOOD.head.forward : STREET.head.forward,
          6,
        );
      }
    }
  });

  it('is warm on a street lamp and neutral on a mast', () => {
    const [flood, street] = [FLOOD.colour, STREET.colour].map((c) => new Color(c));
    if (flood === undefined || street === undefined) throw new Error('no colour');
    expect(Math.abs(flood.r - flood.b)).toBeLessThan(0.15);
    expect(street.r).toBeGreaterThan(street.b * 3);
  });
});

describe('yard light levels', () => {
  it.each(['flood', 'street'] as const)(
    'brings every %s light to its peak on the ground, and no higher',
    (kind) => {
      for (const layout of withFixtures) {
        for (const spec of yardLightSpecs(layout).filter((s) => s.kind === kind)) {
          const peak = Math.max(
            ...litGround(spec, 200).map((p) => p.irradiance * yardCandela(spec)),
          );
          expect(peak).toBeCloseTo(spec.peak, 3);
        }
      }
    },
  );

  it('gives a ground point the irradiance the ray-sampled cone gives', () => {
    const [spec] = yardLightSpecs(withFixtures[0] ?? (resolved[0] as never));
    if (spec === undefined) throw new Error('no spec');
    for (const p of litGround(spec, 40).filter((_, i) => i % 37 === 0)) {
      expect(groundIrradiance(spec, p.x, p.y)).toBeCloseTo(p.irradiance * yardCandela(spec), 6);
    }
  });

  it('puts no light on the ground beyond the light’s reach', () => {
    for (const spec of yardLightSpecs(withFixtures[0] ?? (resolved[0] as never))) {
      const far = spec.distance + 1;
      expect(
        groundIrradiance(
          spec,
          spec.position.x + spec.aim.x * far * 5,
          spec.position.y + spec.aim.y * far * 5,
        ),
      ).toBe(0);
    }
  });

  // with the dipped beam, the reversing and the stop lamps at their peaks and the night ambient, where nothing is tone mapped
  it.each(withFixtures.map((l) => [l.id, l] as const))(
    'keeps the pools of %s, with the worst vehicle lamps, inside the 8-bit headroom',
    (_, layout) => {
      const specs = yardLightSpecs(layout);
      let peak = 0;
      const { bounds } = layout;
      for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
        for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
          peak = Math.max(
            peak,
            specs.reduce((sum, s) => sum + groundIrradiance(s, x, y), 0),
          );
        }
      }
      expect(peak).toBeGreaterThan(0);
      const vehicle = Math.max(GROUND.dipped, GROUND.reversing + GROUND.stop);
      const ambient = NIGHT_AMBIENT * Math.PI * Math.max(...NIGHT_TINT);
      expect(peak + vehicle + ambient).toBeLessThanOrEqual(PEAK_HEADROOM * Math.PI);
    },
  );
});

describe('yard light faces', () => {
  // the masts' real lights also light vertical faces (hall facades, vehicle sides), with the same vehicle lamps and ambient on top
  it.each(withFixtures.map((l) => [l.id, l] as const))(
    'keeps the light on any vertical face in the cones of %s, with the worst vehicle lamps, inside the 8-bit headroom',
    (_, layout) => {
      const floods = yardLightSpecs(layout).filter((s) => s.kind === 'flood');
      const normals = Array.from({ length: 8 }, (_, i) => ({
        x: Math.cos((i * Math.PI) / 4),
        y: Math.sin((i * Math.PI) / 4),
        z: 0,
      }));
      const { bounds } = layout;
      let worst = 0;
      for (let x = bounds.minX; x <= bounds.maxX; x += 4) {
        for (let y = bounds.minY; y <= bounds.maxY; y += 4) {
          for (const z of [0.5, 2, 4, 6, 8]) {
            for (const n of normals) {
              worst = Math.max(
                worst,
                floods.reduce((sum, s) => sum + faceIrradiance(s, { x, y, z }, n), 0),
              );
            }
          }
        }
      }
      expect(worst).toBeGreaterThan(0);
      const vehicle = Math.max(GROUND.dipped, GROUND.reversing + GROUND.stop);
      const ambient = NIGHT_AMBIENT * Math.PI * Math.max(...NIGHT_TINT);
      expect(worst + vehicle + ambient).toBeLessThanOrEqual(PEAK_HEADROOM * Math.PI);
    },
  );
});

describe('exercise independence', () => {
  const specsOf = (layout: (typeof resolved)[number]) =>
    yardLightSpecs(layout).map((s) => ({
      ...s,
      colour: s.colour.getHex(),
      cd: yardCandela(s),
      pool: poolGeometry([{ spec: s, albedo: 0.4 }]).getAttribute('color').array,
    }));

  it.each(Object.values(layouts).map((l) => [l.id, l] as const))(
    'puts the same lights and pools on %s for every exercise as for none',
    (_, layout) => {
      const none = specsOf(resolveLayout(layout, null));
      for (const exercise of exercises.filter((e) => e.layout === layout.id)) {
        expect(specsOf(resolveLayout(layout, exercise)), exercise.id).toEqual(none);
      }
    },
  );
});

describe('baked pools', () => {
  const layout = withFixtures[0];
  if (layout === undefined) throw new Error('no layout with fixtures');
  const albedo = 0.4;

  it('carry, at each vertex, the light colour times the radiance the High light gives there', () => {
    for (const spec of yardLightSpecs(layout)) {
      const geometry = poolGeometry([{ spec, albedo }], 0);
      const position = geometry.getAttribute('position');
      const colour = geometry.getAttribute('color');
      let lit = 0;
      for (let i = 0; i < position.count; i++) {
        const level =
          (groundIrradiance(spec, position.getX(i), -position.getZ(i)) / Math.PI) * albedo;
        if (level === 0) continue;
        lit++;
        expect(colour.getX(i)).toBeCloseTo(spec.colour.r * level, 6);
        expect(colour.getY(i)).toBeCloseTo(spec.colour.g * level, 6);
        expect(colour.getZ(i)).toBeCloseTo(spec.colour.b * level, 6);
      }
      expect(lit).toBeGreaterThan(position.count / 4);
      geometry.dispose();
    }
  });

  it('reach most of the light’s peak, and are black at the rim of the cone', () => {
    for (const spec of yardLightSpecs(layout)) {
      const geometry = poolGeometry([{ spec, albedo }], 0);
      const colour = geometry.getAttribute('color');
      const peak = Math.max(...Array.from(colour.array.filter((_, i) => i % 3 === 1)));
      const expected = (spec.peak / Math.PI) * albedo * spec.colour.g;
      expect(peak).toBeGreaterThan(expected * 0.7);
      expect(peak).toBeLessThanOrEqual(expected * 1.0001);
      // the four corners of the ray grid are outside the cone
      const last = colour.count - 1;
      for (const i of [0, last]) {
        expect(colour.getX(i) + colour.getY(i) + colour.getZ(i)).toBe(0);
      }
      geometry.dispose();
    }
  });

  it('lie flat at the lift', () => {
    const [spec] = yardLightSpecs(layout);
    if (spec === undefined) throw new Error('no spec');
    const geometry = poolGeometry([{ spec, albedo }], 0.05);
    const y = geometry.getAttribute('position').array.filter((_, i) => i % 3 === 1);
    expect(new Set(y)).toEqual(new Set([Math.fround(0.05)]));
    geometry.dispose();
  });
});

describe('createYardLights', () => {
  const layout = withFixtures.find((l) => yardLightSpecs(l).some((s) => s.kind === 'flood'));
  if (layout === undefined) throw new Error('no layout with floodlights');
  const floods = yardLightSpecs(layout).filter((s) => s.kind === 'flood');
  const mesh = (lights: ReturnType<typeof createYardLights>, name: string): Object3D => {
    const found = lights.object.getObjectByName(name);
    if (found === undefined) throw new Error(`no ${name}`);
    return found;
  };

  it('has one spot light per mast, lit to its candela, on the perspective layer and casting nothing', () => {
    const lights = createYardLights(layout, palette);
    expect(lights.lights).toHaveLength(floods.length);
    lights.lights.forEach((light, i) => {
      const spec = floods[i];
      if (spec === undefined) throw new Error('no spec');
      expect(light).toBeInstanceOf(SpotLight);
      expect(light.intensity).toBeCloseTo(yardCandela(spec), 9);
      expect(light.distance).toBe(spec.distance);
      expect(light.angle).toBe(spec.angle);
      expect(light.castShadow).toBe(false);
      expect(light.map).toBeNull();
      expect(light.layers.mask).toBe(1 << PERSPECTIVE_LAYER);
      // sim (x, y, z up) is three (x, z, -y)
      expect(light.position.toArray()).toEqual([
        spec.position.x,
        spec.position.z,
        -spec.position.y,
      ]);
      const along = light.target.position.clone().sub(light.position).normalize();
      const want = new Vector3(spec.aim.x, spec.aim.z, -spec.aim.y);
      expect(along.distanceTo(want)).toBeLessThan(1e-6);
      expect(light.target.parent).not.toBeNull();
    });
    lights.dispose();
  });

  it('lights nothing by day or on low, pools on balanced and the masts on high, one set per look', () => {
    const lights = createYardLights(layout, palette);
    const state = () => ({
      spots: lights.lights.filter((l) => l.visible).length,
      flood: mesh(lights, FLOOD_POOL_NAME).visible,
      street: mesh(lights, STREET_POOL_NAME).visible,
    });
    const none = { spots: 0, flood: false, street: false };
    const looks = [
      ['low', 'day', none],
      ['balanced', 'day', none],
      ['high', 'day', none],
      ['low', 'night', none],
      ['balanced', 'night', { spots: 0, flood: true, street: true }],
      ['high', 'night', { spots: floods.length, flood: false, street: true }],
      ['high', 'day', none],
    ] as const;
    for (const [preset, mode, want] of looks) {
      lights.setLook(lookFor(QUALITY_FLAGS[preset], mode));
      expect(state(), `${preset} ${mode}`).toEqual(want);
    }
    lights.dispose();
  });

  it('keeps the same lights and meshes across looks, so a look only toggles them', () => {
    const lights = createYardLights(layout, palette);
    const before = [...lights.object.children];
    for (const preset of ['balanced', 'high', 'low'] as const) {
      lights.setLook(lookFor(QUALITY_FLAGS[preset], 'night'));
    }
    expect(lights.object.children).toEqual(before);
    lights.dispose();
  });

  it('draws the pools on the perspective layer only', () => {
    const lights = createYardLights(layout, palette);
    for (const name of [FLOOD_POOL_NAME, STREET_POOL_NAME]) {
      expect(mesh(lights, name).layers.mask).toBe(1 << PERSPECTIVE_LAYER);
    }
    lights.dispose();
  });
});

describe('floodLitSample', () => {
  it('is a graded surface under four mast spots with no map, so it adds no sampler', () => {
    const sample = floodLitSample();
    expect(sample.lights).toHaveLength(4);
    for (const light of sample.lights ?? []) {
      if (!(light instanceof SpotLight)) throw new Error('not a spot light');
      expect(light.map).toBeNull();
    }
    sample.dispose();
  });
});
