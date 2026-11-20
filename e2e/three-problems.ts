import type { Page } from '@playwright/test';

/** A warning or error three logs about itself (`THREE.TSL: ...` for a shader graph that failed to build). */
export function isThreeProblem(type: string, text: string): boolean {
  return (type === 'warning' || type === 'error') && text.startsWith('THREE.');
}

/**
 * ANGLE's software GL hints that it split a render pass while High starts up, and Chromium that a
 * readback stalled the GPU (the multisample resolve pin in `pinned-shoot.ts` reads one pixel back on
 * purpose). Performance hints of the driver CI runs on, not faults of the app.
 */
export const DRIVER_PERFORMANCE_HINT =
  /GL Driver Message \(OpenGL, Performance, [^)]*\): (Running out of reserved outsideRenderPass queueSerial|GPU stall due to ReadPixels)/;

export function collectThreeProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (isThreeProblem(m.type(), m.text())) problems.push(m.text());
  });
  return problems;
}
