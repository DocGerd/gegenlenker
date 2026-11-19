import { describe, expect, it } from 'vitest';

// Entries that package.json runs with plain Node import cleanly and do nothing unless run.
describe('Node-run .ts entries', () => {
  it.each(['../e2e/perf/tablet-emulation', './textures/sky-build'])('%s', async (entry) => {
    expect(await import(entry)).toBeDefined();
  });
});
