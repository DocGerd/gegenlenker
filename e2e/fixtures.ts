import { expect, test as base, type BrowserContext } from '@playwright/test';
import { DRIVER_PERFORMANCE_HINT, isThreeProblem } from './three-problems';

/** Console messages only: headless Chromium denies the wake lock, and the software GL driver hints at performance. Neither is a fault of the app. */
const IGNORED_CONSOLE: readonly RegExp[] = [/Wake Lock/, DRIVER_PERFORMANCE_HINT];

type Guard = { allow: (pattern: RegExp) => void };

/**
 * Every test fails on a console error, a failed `console.assert`, a page error or a `THREE.`
 * warning in any page of its contexts (the `page` one and those from `browser.newContext()`);
 * `allow()` exempts messages a test provokes on purpose. Service-worker exceptions are not seen.
 */
export const test = base.extend<{ guard: Guard; allow: Guard['allow'] }>({
  guard: [
    async ({ browser, context, serviceWorkers }, use) => {
      const problems: string[] = [];
      const allowed: RegExp[] = [];
      // workbox-window reads `.waiting` off the registration a blocked worker never returns.
      if (serviceWorkers === 'block') allowed.push(/SW registration failed/);
      const record = (kind: string, text: string, ignored: readonly RegExp[] = []) => {
        if (![...allowed, ...ignored].some((p) => p.test(text))) problems.push(`${kind}: ${text}`);
      };
      const own: BrowserContext[] = [];
      const watch = (ctx: BrowserContext) => {
        ctx.on('console', (m) => {
          const type = m.type();
          if (type === 'error' || type === 'assert' || isThreeProblem(type, m.text()))
            record(`console.${type}`, m.text(), IGNORED_CONSOLE);
        });
        ctx.on('weberror', (e) => {
          const error = e.error();
          record('pageerror', error.stack ?? error.message);
        });
      };
      watch(context);

      const previous = Object.getOwnPropertyDescriptor(browser, 'newContext');
      const newContext = browser.newContext.bind(browser);
      browser.newContext = async (...args) => {
        const ctx = await newContext(...args);
        watch(ctx);
        own.push(ctx);
        return ctx;
      };
      try {
        await use({
          // A global or sticky regex would alternate between match and miss.
          allow: (pattern) =>
            allowed.push(new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))),
        });
      } finally {
        if (previous) Object.defineProperty(browser, 'newContext', previous);
        else Reflect.deleteProperty(browser, 'newContext');
        // A round trip delivers events still in flight; closing covers a test that threw before it did.
        await Promise.all(
          [context, ...own]
            .flatMap((ctx) => ctx.pages())
            .map((p) => p.evaluate(() => 0).catch(() => 0)),
        );
        await Promise.all(own.map((ctx) => ctx.close()));
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
