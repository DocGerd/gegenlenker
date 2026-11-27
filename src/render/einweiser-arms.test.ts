import { Layers, Mesh, type Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { SIGN_IDS, type SignId } from '../contracts/einweiser';
import { LOOP_RECOGNITION } from '../einweiser/signs';
import { SIGN_POSES } from '../einweiser/sign-poses';
import {
  armPoints,
  createEinweiserArms,
  firstPersonKeys,
  placeViewModelCamera,
  SIGN_BLEND,
  SIGN_CYCLE,
} from './einweiser-arms';
import {
  CHASE_LAYERS,
  COCKPIT_LAYERS,
  EINWEISER_LAYERS,
  MIRROR_LAYERS,
  SHADOW_CASTER_LAYERS,
  TOP_DOWN_LAYERS,
  VIEWMODEL_LAYER,
} from './seams';
import { bandTopNdc, computeViewports } from './viewports';

const SIGNS: readonly (SignId | null)[] = [null, ...SIGN_IDS];
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

  it('keep the signing forearms and every hand in frame and above the HUD band for every sign, cut-over and pane', () => {
    const arms = createEinweiserArms();
    const band = bandTopNdc();
    const misses: string[] = [];
    const sweep = panes();
    expect(Math.min(...sweep.map((p) => p.width / p.height))).toBeLessThan(0.6);
    expect(Math.max(...sweep.map((p) => p.width / p.height))).toBeGreaterThan(3);
    for (const pane of sweep) {
      placeViewModelCamera(arms.camera, pane);
      const check = (label: string, point: Vector3): void => {
        const p = point.clone().project(arms.camera);
        if (Math.abs(p.x) > 1 - MARGIN || p.y > 1 - MARGIN || p.y < band + MARGIN) {
          misses.push(`${pane.label} ${label} (${p.x.toFixed(2)}, ${p.y.toFixed(2)})`);
        }
      };
      for (const sign of SIGNS) {
        for (const side of ['left', 'right'] as const) {
          // a lowered arm only shows its hand: its forearm rises into the frame from below
          const signing = sign !== null && SIGN_POSES[sign].arms.includes(side);
          for (const phase of PHASES) {
            const { elbow, hand } = armPoints(sign, phase, side);
            const label = `${String(sign)} t=${phase.toFixed(2)} ${side}`;
            check(`${label} hand`, hand);
            if (signing) check(`${label} wrist`, elbow.clone().lerp(hand, 0.75));
          }
          for (const from of SIGNS) {
            for (const fromPhase of [0, SIGN_CYCLE / 4]) {
              const { hand } = armPoints(
                sign,
                SIGN_BLEND / 2,
                side,
                armPoints(from, fromPhase, side),
              );
              check(`${String(from)} to ${String(sign)} ${side} hand mid-blend`, hand);
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
    arms.update(undefined);
    expect(arms.object.visible).toBe(false);
    arms.update({ pose: { x: 0, y: 0, heading: 0 }, pitch: 0, sign: null, phase: 0 });
    expect(arms.object.visible).toBe(true);
  });

  it('blend a press or release from the arms as drawn into the new sign, and start a shown sign unblended', () => {
    const arms = createEinweiserArms();
    const show = (sign: SignId | null, phase: number): void => {
      arms.update({ pose: { x: 0, y: 0, heading: 0 }, pitch: 0, sign, phase });
    };
    // per side: upper arm, forearm, glove
    const glove = (): Vector3 => {
      const mesh = arms.object.children[2];
      if (mesh === undefined) throw new Error('no glove');
      return mesh.position.clone();
    };
    const near = (a: Vector3, b: Vector3): void => {
      expect(a.distanceTo(b)).toBeCloseTo(0, 9);
    };
    show('herkommen', 0.3);
    const drawn = glove();
    show('halt', 0);
    near(glove(), drawn);
    show('halt', SIGN_BLEND / 2);
    expect(glove().distanceTo(drawn)).toBeGreaterThan(0.02);
    expect(glove().distanceTo(armPoints('halt', SIGN_BLEND / 2, 'left').hand)).toBeGreaterThan(
      0.02,
    );
    show('halt', SIGN_BLEND);
    near(glove(), armPoints('halt', SIGN_BLEND, 'left').hand);
    // the same sign pressed again starts over from where it is drawn
    show('herkommen', 0.3);
    show('herkommen', 0.8);
    const again = glove();
    show('herkommen', 0);
    near(glove(), again);
    arms.update(undefined);
    show('herkommen', 0);
    near(glove(), armPoints('herkommen', 0, 'left').hand);
  });

  it('is in no other camera or shadow layer list', () => {
    for (const list of [
      SHADOW_CASTER_LAYERS,
      COCKPIT_LAYERS,
      MIRROR_LAYERS,
      CHASE_LAYERS,
      EINWEISER_LAYERS,
      TOP_DOWN_LAYERS,
    ]) {
      expect(list).not.toContain(VIEWMODEL_LAYER);
    }
  });
});
