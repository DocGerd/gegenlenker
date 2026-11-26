import { Layers, Mesh, type Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SIGN_IDS, type SignId } from '../contracts/einweiser';
import { LOOP_RECOGNITION } from '../einweiser/signs';
import { SIGN_POSES } from '../einweiser/sign-poses';
import { createEinweiserCamera, placeEinweiserCamera } from './einweiser-camera';
import {
  armPoints,
  createEinweiserArms,
  firstPersonKeys,
  placeViewModelCamera,
  SIGN_CYCLE,
} from './einweiser-arms';
import {
  CHASE_LAYERS,
  COCKPIT_LAYERS,
  DEFAULT_LAYER,
  EINWEISER_LAYERS,
  MIRROR_LAYERS,
  SHADOW_CASTER_LAYERS,
  TOP_DOWN_LAYERS,
  VIEWMODEL_LAYER,
  YARD_CASTER_LAYER,
} from './seams';
import { bandTopNdc, computeViewports } from './viewports';

const SIGNS: readonly (SignId | null)[] = [null, ...SIGN_IDS];
const FOVS = [70, 80, 90, 100, 110];
/** Phases sampled per sign: every key and the blends between them, over one cycle. */
const PHASES = Array.from({ length: 9 }, (_, i) => (i / 8) * SIGN_CYCLE);
/** NDC kept clear of the frame's and the band's edges: the glove's half width at arm's length. */
const MARGIN = 0.05;
const NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

/** Landscape and portrait windows from tablet to desktop, in both Einweiser layouts. */
function panes(): { label: string; width: number; height: number }[] {
  const out: { label: string; width: number; height: number }[] = [];
  for (let w = 600; w <= 2560; w += 160) {
    for (let h = 500; h <= 1440; h += 120) {
      for (const mode of ['drive', 'mirrors'] as const) {
        const { cockpit } = computeViewports(
          w,
          h,
          mode,
          null,
          NO_INSETS,
          undefined,
          null,
          undefined,
          'einweiser',
        );
        if (cockpit !== null) out.push({ label: `${String(w)}x${String(h)} ${mode}`, ...cockpit });
      }
    }
  }
  return out;
}

describe('Einweiser arms', () => {
  it('give one first-person key per source key, the arms that give no sign lowered', () => {
    for (const sign of SIGN_IDS) {
      const { keys, arms } = SIGN_POSES[sign];
      const own = firstPersonKeys(sign);
      expect(own, sign).toHaveLength(keys.length);
      for (const side of ['left', 'right'] as const) {
        if (arms.includes(side)) continue;
        expect(new Set(own.map((k) => k[side])).size, `${sign} ${side}`).toBe(1);
        expect(own[0]?.[side]).toEqual(firstPersonKeys(null)[0]?.[side]);
      }
    }
  });

  it('keep the signing forearms and every hand in frame and above the HUD band for every sign, pane and field of view', () => {
    const arms = createEinweiserArms();
    const own = createEinweiserCamera();
    const band = bandTopNdc();
    const misses: string[] = [];
    const sweep = panes();
    expect(Math.min(...sweep.map((p) => p.width / p.height))).toBeLessThan(0.6);
    expect(Math.max(...sweep.map((p) => p.width / p.height))).toBeGreaterThan(3);
    for (const pane of sweep) {
      for (const fov of FOVS) {
        placeEinweiserCamera(own, { pose: { x: 0, y: 0, heading: 0 }, pitch: 0 }, pane, fov);
        placeViewModelCamera(arms.camera, pane);
        for (const sign of SIGNS) {
          for (const phase of PHASES) {
            for (const side of ['left', 'right'] as const) {
              const { elbow, hand } = armPoints(sign, phase, side);
              // a lowered arm only shows its hand: its forearm rises into the frame from below
              const signing = sign !== null && SIGN_POSES[sign].arms.includes(side);
              const points: [string, Vector3][] = [['hand', hand]];
              if (signing) points.push(['wrist', elbow.clone().lerp(hand, 0.75)]);
              for (const [name, point] of points) {
                const p = point.clone().project(arms.camera);
                if (Math.abs(p.x) > 1 - MARGIN || p.y > 1 - MARGIN || p.y < band + MARGIN) {
                  misses.push(
                    `${pane.label} ${String(fov)}° ${String(sign)} t=${phase.toFixed(2)} ${side} ${name} (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`,
                  );
                }
              }
            }
          }
        }
      }
    }
    expect(misses.slice(0, 20)).toEqual([]);
  });

  it('loop once per cycle and hold the last key of a sign played once', () => {
    const same = (sign: SignId, a: number, b: number): void => {
      for (const side of ['left', 'right'] as const) {
        expect(armPoints(sign, a, side).hand.distanceTo(armPoints(sign, b, side).hand)).toBeCloseTo(
          0,
          9,
        );
      }
    };
    same('herkommen', 0.1, 0.1 + SIGN_CYCLE);
    expect(
      armPoints('herkommen', 0, 'left').hand.distanceTo(
        armPoints('herkommen', SIGN_CYCLE / 2, 'left').hand,
      ),
    ).toBeGreaterThan(0.1);
    same('abstand', LOOP_RECOGNITION, 5);
    expect(
      armPoints('abstand', 0, 'left').hand.distanceTo(
        armPoints('abstand', LOOP_RECOGNITION, 'left').hand,
      ),
    ).toBeGreaterThan(0.1);
  });

  it('draw at most ten meshes on the view-model layer alone, casting no shadow, hidden without a visual', () => {
    const arms = createEinweiserArms();
    const meshes = arms.object.children.filter((o): o is Mesh => o instanceof Mesh);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.length).toBeLessThanOrEqual(10);
    const only = new Layers();
    only.set(VIEWMODEL_LAYER);
    for (const mesh of meshes) {
      expect(mesh.layers.mask).toBe(only.mask);
      expect(mesh.castShadow).toBe(false);
    }
    expect(arms.camera.layers.mask).toBe(only.mask);
    expect(arms.update(undefined)).toBe(false);
    expect(arms.object.visible).toBe(false);
    expect(arms.update({ pose: { x: 0, y: 0, heading: 0 }, pitch: 0, sign: null, phase: 0 })).toBe(
      true,
    );
    expect(arms.object.visible).toBe(true);
  });

  it('is in no other camera or shadow layer list', () => {
    for (const list of [
      SHADOW_CASTER_LAYERS,
      COCKPIT_LAYERS,
      MIRROR_LAYERS,
      CHASE_LAYERS,
      EINWEISER_LAYERS,
      TOP_DOWN_LAYERS,
      [DEFAULT_LAYER, YARD_CASTER_LAYER],
    ]) {
      expect(list).not.toContain(VIEWMODEL_LAYER);
    }
  });
});
