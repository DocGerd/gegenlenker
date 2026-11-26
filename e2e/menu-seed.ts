import type { BrowserContext, Page } from '@playwright/test';
import { exerciseById } from '../src/content/registry';
import { resolveRun } from '../src/content/run';
import type { RunResult } from '../src/contracts/exercise';
import { resultKey, serializeBestResults } from '../src/scoring/best';
import { createInputRecorder, serializeInputLog, type RunIds } from '../src/sim/replay';

const SETTINGS_KEY = 'gegenlenker.settings.v1';
const BEST_KEY = 'gegenlenker.best.v2';
const LAST_RUN_KEY = 'gegenlenker.lastRun.v1';
const LAST_RUN_STEPS = 60;

const fingerprint = (ids: RunIds): string => resolveRun(ids).fingerprint;

/** A standing day run with the top-down view: enough to be offered for replay. */
function lastRunJson(ids: RunIds): string {
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
  if (seed.lastRun !== undefined) items.push([LAST_RUN_KEY, lastRunJson(seed.lastRun)]);
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
