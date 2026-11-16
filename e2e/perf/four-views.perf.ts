import { expect, test, type Page } from '@playwright/test';

type Sampled = {
  medianFps: number;
  frameP95Ms: number;
  resolutionScale: number;
  glRenderer: string;
};

const readStats = (page: Page) =>
  page.evaluate(() => {
    const probe = window.__probe;
    if (probe === undefined) throw new Error('probe not started');
    return probe.stats();
  });

/** Waits until the resolution scale has been unchanged for 3 s, at most 40 s. */
async function settle(page: Page): Promise<void> {
  const deadline = Date.now() + 40_000;
  let scale = (await readStats(page)).resolutionScale;
  let since = Date.now();
  while (Date.now() < deadline && Date.now() - since < 3_000) {
    await page.waitForTimeout(250);
    const next = (await readStats(page)).resolutionScale;
    if (next !== scale) {
      scale = next;
      since = Date.now();
    }
  }
}

async function sample(page: Page, durationMs: number): Promise<Sampled> {
  const fps: number[] = [];
  let worstP95 = 0;
  let last = await readStats(page);
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    await page.waitForTimeout(500);
    last = await readStats(page);
    fps.push(last.fps);
    worstP95 = Math.max(worstP95, last.frameP95Ms);
  }
  fps.sort((a, b) => a - b);
  return {
    medianFps: fps[Math.floor(fps.length / 2)] ?? 0,
    frameP95Ms: worstP95,
    resolutionScale: last.resolutionScale,
    glRenderer: last.glRenderer,
  };
}

for (const orientation of ['landscape', 'portrait'] as const) {
  test(`four views hold 60 fps on a throttled tablet (${orientation})`, async ({
    page,
    context,
  }) => {
    if (orientation === 'portrait') await page.setViewportSize({ width: 640, height: 1024 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto('./?probe');
    await page.waitForFunction(() => window.__probe !== undefined);
    await settle(page);
    const stats = await sample(page, 20_000);
    test.skip(
      /SwiftShader|llvmpipe|Software/i.test(stats.glRenderer),
      `no hardware GL (${stats.glRenderer}): result invalid`,
    );
    expect(stats.medianFps).toBeGreaterThanOrEqual(58);
    expect(stats.frameP95Ms).toBeLessThanOrEqual(20);
    expect(stats.resolutionScale).toBeGreaterThanOrEqual(0.5);
    console.log(orientation, JSON.stringify(stats));
  });
}
