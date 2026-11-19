import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { settle } from '../pinned-shoot';

/** A page whose framing box is `boxes[i]` on the i-th read (the last one repeats) and whose attachments are ready. */
function fakePage(boxes: readonly (string | null)[]): { page: Page; reads: () => number } {
  let reads = 0;
  const page = {
    clock: { runFor: () => Promise.resolve() },
    waitForTimeout: () => Promise.resolve(),
    evaluate: (fn: () => unknown, arg?: unknown) => {
      const src = String(fn);
      if (src.includes('fonts')) return Promise.resolve(undefined);
      if (src.includes('querySelector')) return Promise.resolve(1);
      return Promise.resolve((arg as string[]).map(() => 'webgl2'));
    },
    locator: () => ({
      getAttribute: () => {
        const box = boxes[Math.min(reads++, boxes.length - 1)] ?? null;
        return Promise.resolve(box);
      },
    }),
  } as unknown as Page;
  return { page, reads: () => reads };
}
const box = (left: number): string =>
  JSON.stringify({ left, top: 0, right: 10, bottom: 10, step: left });

describe('settle', () => {
  it('waits until the framing box holds, ignoring the sim step', async () => {
    const { page, reads } = fakePage([box(1), box(2), box(2), box(2), box(2), box(2), box(2)]);
    await settle(page, 'low', 1_000);
    expect(reads()).toBe(7);
  });

  it('resets the count when the box moves', async () => {
    const same = JSON.stringify({ left: 1, top: 0, right: 10, bottom: 10, step: 0 });
    const moved = JSON.stringify({ left: 2, top: 0, right: 10, bottom: 10, step: 0 });
    const { page, reads } = fakePage([same, same, same, same, moved, moved]);
    await settle(page, 'low', 1_000);
    expect(reads()).toBe(10);
  });

  it('names the preset and the phase when the box never appears', async () => {
    const { page } = fakePage([null]);
    await expect(settle(page, 'low', 20)).rejects.toThrow(/^low not ready: \["framing unstable"/);
  });
});
