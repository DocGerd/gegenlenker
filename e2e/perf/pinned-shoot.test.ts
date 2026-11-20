import type { Page } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { readyMarkers, settle } from '../pinned-shoot';

/** A page whose framing box is `boxes[i]` on the i-th read (the last one repeats) and whose attachments are ready. */
function fakePage(
  boxes: readonly (string | null)[],
  chase = 0,
): { page: Page; reads: () => number } {
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
    locator: (selector: string) => ({
      count: () => Promise.resolve(selector.includes('chase') ? chase : 0),
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

  it('does not wait for a box in the chase view, which projects none', async () => {
    const { page, reads } = fakePage([null], 1);
    await settle(page, 'low', 1_000);
    expect(reads()).toBe(0);
  });

  it('names the preset and the phase when the box never appears', async () => {
    const { page } = fakePage([null]);
    await expect(settle(page, 'low', 20)).rejects.toThrow(/^low not ready: \["framing unstable"/);
  });
});

describe('readyMarkers', () => {
  const ready = (preset: 'low' | 'balanced' | 'high', values: Record<string, string>): boolean =>
    Object.entries(readyMarkers(preset)).every(([marker, ok]) => ok(values[marker] ?? ''));
  const shells = 'a b c';
  const all = {
    'data-render-backend': 'webgl2',
    'data-vehicle-shells': shells,
    'data-ground-texture': 'ktx2:bc7',
    'data-ground-pbr': 'ktx2:bc7',
    'data-yard-kit': 'on',
    'data-vehicle-pbr': 'on',
    'data-sky-hdri': 'on',
    'data-perspective-grade': 'on',
  };

  it('waits for the backend alone on Low, plus the shells on Balanced, plus the High layers on High', () => {
    expect(Object.keys(readyMarkers('low'))).toEqual(['data-render-backend']);
    expect(Object.keys(readyMarkers('balanced'))).toEqual([
      'data-render-backend',
      'data-vehicle-shells',
    ]);
    expect(Object.keys(readyMarkers('high')).sort()).toEqual(Object.keys(all).sort());
  });

  it('accepts a loaded preset and rejects one that lacks a marker or has a partial one', () => {
    for (const preset of ['low', 'balanced', 'high'] as const)
      expect(ready(preset, all)).toBe(true);
    expect(ready('low', {})).toBe(false);
    expect(ready('balanced', { ...all, 'data-vehicle-shells': 'a b' })).toBe(false);
    expect(ready('high', { ...all, 'data-ground-texture': 'failed' })).toBe(false);
    expect(ready('high', { ...all, 'data-ground-pbr': 'failed' })).toBe(false);
    expect(ready('high', { ...all, 'data-sky-hdri': '' })).toBe(false);
    expect(ready('high', { ...all, 'data-yard-kit': 'failed' })).toBe(false);
  });
});
