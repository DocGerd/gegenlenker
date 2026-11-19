import { expect, test as base, type BrowserContext } from '@playwright/test';
import { isThreeProblem } from './three-problems';

/**
 * Headless Chromium denies the wake lock, and ANGLE's software GL hints that it split a render pass
 * while High starts up: neither is a fault of the app.
 */
const IGNORED: readonly RegExp[] = [
  /Wake Lock/,
  /GL Driver Message \(OpenGL, Performance, [^)]*\): Running out of reserved outsideRenderPass queueSerial/,
];

type Guard = { allow: (pattern: RegExp) => void };

/**
 * Every test fails on a console error, a page error or a `THREE.` warning in any page of its
 * contexts (the `page` one and those from `browser.newContext()`); `allow()` exempts messages a
 * test provokes on purpose.
 */
export const test = base.extend<{ guard: Guard; allow: Guard['allow'] }>({
  guard: [
    async ({ browser, context, serviceWorkers }, use) => {
      const problems: string[] = [];
      const allowed: RegExp[] = [...IGNORED];
      // workbox-window reads `.waiting` off the registration a blocked worker never returns.
      if (serviceWorkers === 'block') allowed.push(/SW registration failed/);
      const record = (text: string) => {
        if (!allowed.some((p) => p.test(text))) problems.push(text);
      };
      const watch = (ctx: BrowserContext) => {
        ctx.on('console', (m) => {
          if (m.type() === 'error' || isThreeProblem(m.type(), m.text())) record(m.text());
        });
        ctx.on('weberror', (e) => {
          record(e.error().message);
        });
      };
      watch(context);

      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args) => {
        const ctx = await newContext(...args);
        watch(ctx);
        return ctx;
      };
      try {
        await use({ allow: (pattern) => allowed.push(pattern) });
      } finally {
        // Own property shadowing the prototype method.
        Reflect.deleteProperty(browser, 'newContext');
      }
      expect(problems, 'console errors, page errors and THREE warnings').toEqual([]);
    },
    { auto: true },
  ],
  allow: async ({ guard }, use) => {
    await use(guard.allow);
  },
});

export { expect };
