import type { BrowserContext, Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { exerciseById } from '../src/content/registry';
import type { ExerciseId, RunResult } from '../src/contracts/exercise';
import { TRAILER_IDS, TRUCK_IDS } from '../src/contracts/vehicle';
import { resultKey, serializeBestResults } from '../src/scoring/best';
import { createInputRecorder, serializeInputLog, type RunIds } from '../src/sim/replay';

const SETTINGS_KEY = 'gegenlenker.settings.v1';
const BEST_KEY = 'gegenlenker.best.v2';
const LAST_RUN_KEY = 'gegenlenker.lastRun.v1';
const LAST_RUN_STEPS = 60;

const idsKey = (ids: RunIds): string =>
  JSON.stringify([ids.layoutId, ids.exerciseId, ids.truckId, ids.trailerId]);

/** A reached, unaided day result with the default vehicles: marks the exercise done. */
export const reachedResult = (exerciseId: ExerciseId): RunResult => ({
  exerciseId,
  truckId: TRUCK_IDS[0],
  trailerId: TRAILER_IDS[0],
  reached: true,
  assisted: false,
  lighting: 'day',
  mirrorsOnly: false,
  waypointMissed: false,
  positionError: 0.1,
  angleError: 0.01,
  contacts: 0,
  jackknifes: 0,
  directionChanges: 1,
  time: 42.5,
});

let bundle: Promise<string> | null = null;
const fingerprintBundle = (): Promise<string> =>
  (bundle ??= build({
    configFile: false,
    logLevel: 'silent',
    build: {
      write: false,
      lib: {
        entry: fileURLToPath(new URL('./fingerprint-entry.ts', import.meta.url)),
        formats: ['iife'],
        name: 'fp',
      },
    },
  }).then((out) => {
    const first = Array.isArray(out) ? out[0] : out;
    if (!(first && 'output' in first)) throw new Error('fingerprint bundle is empty');
    const chunk = first.output.find((o) => o.type === 'chunk');
    if (chunk?.type !== 'chunk') throw new Error('fingerprint bundle is empty');
    return chunk.code;
  }));

/**
 * The fingerprints the app computes for `ids`: taken in the browser, because Node and Chromium round `Math.atan2`
 * differently and a Node fingerprint of some layouts would be dropped by the app.
 */
async function browserFingerprints(
  target: Page | BrowserContext,
  ids: readonly RunIds[],
): Promise<(ids: RunIds) => string> {
  if (ids.length === 0) {
    return () => {
      throw new Error('no fingerprints were taken');
    };
  }
  const page = await ('newPage' in target ? target : target.context()).newPage();
  try {
    await page.addScriptTag({ content: await fingerprintBundle() });
    const found = await page.evaluate(
      (list) => list.map((i) => globalThis.gegenlenkerFingerprint(i)),
      ids,
    );
    const byKey = new Map(ids.map((i, n) => [idsKey(i), found[n] ?? '']));
    return (i) => {
      const fp = byKey.get(idsKey(i));
      if (fp === undefined || fp === '') throw new Error(`no fingerprint taken for ${idsKey(i)}`);
      return fp;
    };
  } finally {
    await page.close();
  }
}

/** A standing day run with the top-down view: enough to be offered for replay. */
function lastRunJson(ids: RunIds, fingerprint: (ids: RunIds) => string): string {
  const recorder = createInputRecorder();
  recorder.record(0, { steer: 0, lever: 0, brake: false, gear: 'P' });
  const log = recorder.finish({ ...ids, lighting: 'day', mirrorsOnly: false }, LAST_RUN_STEPS);
  return serializeInputLog(log, fingerprint);
}

/**
 * Seeds storage on the first load only: the settings key is always written, so a reload keeps what the app stored
 * since.
 */
export async function seedStorage(
  target: Page | BrowserContext,
  seed: { settings?: object; best?: readonly RunResult[]; lastRun?: RunIds },
): Promise<void> {
  const bestIds = (seed.best ?? []).map((r): RunIds => ({
    layoutId: exerciseById(r.exerciseId).layout,
    exerciseId: r.exerciseId,
    truckId: r.truckId,
    trailerId: r.trailerId,
  }));
  const fingerprint = await browserFingerprints(target, [
    ...bestIds,
    ...(seed.lastRun === undefined ? [] : [seed.lastRun]),
  ]);
  const items: [string, string][] = [
    [SETTINGS_KEY, JSON.stringify({ version: 1, ...seed.settings })],
  ];
  if (seed.best !== undefined) {
    const best = Object.fromEntries(seed.best.map((r) => [resultKey(r), r]));
    items.push([
      BEST_KEY,
      serializeBestResults(best, (ids) =>
        fingerprint({ ...ids, layoutId: exerciseById(ids.exerciseId).layout }),
      ),
    ]);
  }
  if (seed.lastRun !== undefined)
    items.push([LAST_RUN_KEY, lastRunJson(seed.lastRun, fingerprint)]);
  await target.addInitScript(
    ([settingsKey, pairs]) => {
      try {
        if (localStorage.getItem(settingsKey) !== null) return;
        for (const [key, value] of pairs) localStorage.setItem(key, value);
      } catch {
        // Opaque frames have no storage.
      }
    },
    [SETTINGS_KEY, items] as const,
  );
}
