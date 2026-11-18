import { Group } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { layouts } from '../content/registry';
import { resolveLayout } from '../content/resolve-layout';
import type { ScenePalette } from '../contracts/render';
import { trailerById, truckById } from '../vehicles/registry';
import type { QualityFlags } from './quality';
import { QUALITY_FLAGS } from './quality';
import { createThreeSceneRenderer } from './three-renderer';

vi.mock('./palette', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./palette')>();
  return {
    ...actual,
    readScenePalette: (): ScenePalette =>
      Object.fromEntries(Object.keys(actual.KEYS).map((k) => [k, 0x808080])) as ScenePalette,
  };
});

const layout = resolveLayout(layouts.depot, null);

function stubParts(): { applied: QualityFlags[][]; renderer: ReturnType<typeof create> } {
  const applied: QualityFlags[][] = [];
  const part = <T extends object>(extra: T) => {
    const log: QualityFlags[] = [];
    applied.push(log);
    return {
      object: new Group(),
      update: () => undefined,
      setQuality: (flags: QualityFlags) => void log.push(flags),
      dispose: () => undefined,
      ...extra,
    };
  };
  const create = () =>
    createThreeSceneRenderer({
      truck: () => part({}),
      trailer: () => part({}),
      environment: () => part({}),
      aids: () => ({ object: new Group(), update: () => undefined, dispose: () => undefined }),
    });
  return { applied, renderer: create() };
}

describe('renderer quality', () => {
  it('reaches the scene parts whether set before the scene or after, and ignores a repeat', () => {
    const { applied, renderer } = stubParts();
    renderer.setQuality('low');
    renderer.setScene(layout, truckById('man-le-18-280'), trailerById('krone-azw-18'));
    expect(applied).toHaveLength(3);
    for (const log of applied) expect(log).toEqual([QUALITY_FLAGS.low]);

    renderer.setQuality('high');
    renderer.setQuality('high');
    for (const log of applied) expect(log).toEqual([QUALITY_FLAGS.low, QUALITY_FLAGS.high]);
  });
});
