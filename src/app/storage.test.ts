import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InputLog, RunResult } from '../contracts/exercise';

const ids = {
  exerciseId: 'reverse-bay',
  truckId: 'man-le-18-280',
  trailerId: 'hueffermann-hpa-24-81-l',
} as const;

const result: RunResult = {
  ...ids,
  reached: true,
  assisted: false,
  lighting: 'day',
  waypointMissed: false,
  positionError: 0.1,
  angleError: 0.01,
  contacts: 0,
  jackknifes: 0,
  directionChanges: 2,
  time: 30,
};

const log: InputLog = {
  version: 2,
  layoutId: 'logistics',
  ...ids,
  lighting: 'day',
  steps: 10,
  changes: [],
};

/** A `Storage` whose `setItem` throws once the stored characters would exceed `limit`. */
function fakeStorage(limit: number): Storage {
  const data = new Map<string, string>();
  const size = (): number => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => data.get(k) ?? null,
    removeItem: (k) => void data.delete(k),
    clear: () => {
      data.clear();
    },
    setItem(k, v) {
      const before = data.get(k);
      data.set(k, v);
      if (size() > limit) {
        if (before === undefined) data.delete(k);
        else data.set(k, before);
        throw new DOMException('full', 'QuotaExceededError');
      }
    },
  };
}

/** A fresh module per call: storage.ts holds the probe, best and last run in module state. */
async function load(storage: () => Storage) {
  vi.resetModules();
  vi.stubGlobal('window', {
    get localStorage() {
      return storage();
    },
  });
  return import('./storage');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeStorage probe', () => {
  it('returns the storage and leaves no probe key behind', async () => {
    const storage = fakeStorage(1000);
    const { safeStorage } = await load(() => storage);
    expect(safeStorage()).toBe(storage);
    expect(storage.length).toBe(0);
  });

  it('is null when access throws', async () => {
    const { safeStorage, writeText, readText } = await load(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(safeStorage()).toBeNull();
    expect(writeText('k', 'v')).toBe(false);
    expect(readText('k')).toBeNull();
  });

  it('is null when storage is already full', async () => {
    const { safeStorage } = await load(() => fakeStorage(0));
    expect(safeStorage()).toBeNull();
  });

  it('probes once', async () => {
    const storage = fakeStorage(1000);
    const setItem = vi.spyOn(storage, 'setItem');
    const { safeStorage, writeText } = await load(() => storage);
    safeStorage();
    writeText('k', 'v');
    expect(setItem).toHaveBeenCalledTimes(2);
  });
});

describe('storeResult', () => {
  it('keeps the best result when a large old run log fills the quota', async () => {
    const storage = fakeStorage(2000);
    const { storeResult, LAST_RUN_KEY, BEST_KEY } = await load(() => storage);
    storage.setItem(LAST_RUN_KEY, 'x'.repeat(1900));

    expect(storeResult(result).isNewBest).toBe(true);

    expect(storage.getItem(LAST_RUN_KEY)).toBeNull();
    expect(storage.getItem(BEST_KEY)).toContain('reverse-bay');
  });

  it('keeps the best in memory when even the retry fails', async () => {
    const { storeResult, bestResults } = await load(() => fakeStorage(40));
    storeResult(result);
    expect(Object.values(bestResults())).toEqual([result]);
  });

  it('leaves the last run alone when the best fits', async () => {
    const storage = fakeStorage(100_000);
    const { storeResult, LAST_RUN_KEY, BEST_KEY } = await load(() => storage);
    storage.setItem(LAST_RUN_KEY, 'old');
    storeResult(result);
    expect(storage.getItem(LAST_RUN_KEY)).toBe('old');
    expect(storage.getItem(BEST_KEY)).not.toBeNull();
  });
});

describe('storeLastRun', () => {
  it('removes the stale run when the write fails, keeping the new one in memory', async () => {
    const storage = fakeStorage(200);
    const { storeLastRun, lastRun, LAST_RUN_KEY } = await load(() => storage);
    storage.setItem(LAST_RUN_KEY, 'stale');

    storeLastRun(log);

    expect(storage.getItem(LAST_RUN_KEY)).toBeNull();
    expect(lastRun()).toEqual(log);
  });

  it('removes the stale run when the new log is not replayable', async () => {
    const storage = fakeStorage(100_000);
    const { storeLastRun, lastRun, LAST_RUN_KEY } = await load(() => storage);
    storage.setItem(LAST_RUN_KEY, 'stale');

    storeLastRun({ ...log, steps: Number.MAX_SAFE_INTEGER });

    expect(storage.getItem(LAST_RUN_KEY)).toBeNull();
    expect(lastRun()).toBeNull();
  });

  it('writes the run when there is room', async () => {
    const storage = fakeStorage(100_000);
    const { storeLastRun, LAST_RUN_KEY } = await load(() => storage);
    storeLastRun(log);
    expect(storage.getItem(LAST_RUN_KEY)).toContain('"steps":10');
  });
});
