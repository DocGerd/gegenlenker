import { resolveRun } from '../src/content/run';
import type { RunIds } from '../src/sim/replay';

// Bundled into a blank page by `menu-seed.ts`, so fingerprints come from the browser's maths, not Node's.
declare global {
  var gegenlenkerFingerprint: (ids: RunIds) => string;
}
globalThis.gegenlenkerFingerprint = (ids) => resolveRun(ids).fingerprint;
