import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { COCKPIT_FOV, coneEdge, coneTop } from '../src/render/cockpit-band';
import { QUALITY_FLAGS } from '../src/render/quality';
import { computeViewports, NO_INSETS, type Insets } from '../src/render/viewports';
import { heavyAt, startPinnedDrive } from './pinned-shoot';

type Size = { width: number; height: number };

const SETTINGS_KEY = 'gegenlenker.settings.v1';

const sizes = [
  { width: 740, height: 649 },
  { width: 768, height: 700 },
  { width: 768, height: 1024 },
  { width: 800, height: 800 },
  { width: 800, height: 820 },
  { width: 900, height: 649 },
  { width: 1000, height: 649 },
  { width: 1024, height: 600 },
  { width: 1024, height: 700 },
  { width: 1200, height: 700 },
  { width: 1210, height: 720 },
  { width: 1280, height: 649 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1300, height: 540 },
  { width: 1300, height: 600 },
  { width: 1350, height: 600 },
  { width: 1366, height: 768 },
  { width: 1172, height: 426 },
  { width: 620, height: 774 },
];

/** Height of the gear column before the lamp row: its label, four gear buttons and their gaps. */
const GEAR_COLUMN_HEIGHT = 274.5;

/** The key legend wraps differently per language, so every size runs in both. */
const locales = [
  { locale: 'en-US', messages: en },
  { locale: 'de-DE', messages: de },
];

const boxes = (loc: Locator) =>
  loc.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        name: el.getAttribute('class') ?? '',
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      };
    }),
  );

/** How far each mirror housing's arm reaches past the mirror's outer side, from the arm's computed style. */
const armReach = (loc: Locator) =>
  loc.evaluateAll((els) =>
    els.map((el) => {
      const arm = getComputedStyle(el, '::before');
      return Math.max(-parseFloat(arm.left), -parseFloat(arm.right));
    }),
  );

const overlaps = (
  a: Awaited<ReturnType<typeof boxes>>[number],
  b: Awaited<ReturnType<typeof boxes>>[number],
) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Rows at the top of a full-viewport screenshot column that show the bare page background. */
async function blankRows(page: Page, x: number): Promise<number> {
  const shot = (await page.screenshot()).toString('base64');
  return page.evaluate(
    async ([data, column]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      const background = getComputedStyle(document.body).backgroundColor;
      let y = 0;
      for (; y < img.height; y++) {
        const [r = 0, g = 0, b = 0] = ctx.getImageData(column, y, 1, 1).data;
        if (`rgb(${r}, ${g}, ${b})` !== background) break;
      }
      return y;
    },
    [shot, x] as const,
  );
}

/**
 * The mirrors the default Balanced drive shows at the page's size: the two side mirrors, the class IV
 * mirrors under them, the class V mirror above the right one and the front mirror where `computeViewports` finds room for them, given the key
 * legend as the page measured it.
 */
async function expectedViews(
  page: Page,
  insets: Insets,
  wide: boolean,
  mode: 'drive' | 'mirrors' = 'drive',
) {
  const size = page.viewportSize();
  if (size === null) throw new Error('no viewport');
  const legend = await page.evaluate(() => {
    const el = document.querySelector('.hud-legend');
    const hud = document.querySelector('.hud');
    if (!(el instanceof HTMLElement) || !(hud instanceof HTMLElement)) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0) return null;
    const stage = hud.getBoundingClientRect();
    return { right: r.right - stage.left, height: stage.bottom - r.top };
  });
  return computeViewports(size.width, size.height, mode, legend, insets, undefined, null, {
    front: QUALITY_FLAGS.balanced.frontMirror,
    wide: QUALITY_FLAGS.balanced.wideMirrors && wide,
    close: QUALITY_FLAGS.balanced.closeMirror,
  });
}

/** The class IV mirrors are shown unless the setting is off. */
const wideSetting = (page: Page): Promise<boolean> =>
  page.evaluate((key) => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      return (
        !(typeof stored === 'object' && stored !== null && 'wideMirrors' in stored) ||
        stored.wideMirrors !== false
      );
    } catch {
      return true;
    }
  }, SETTINGS_KEY);

async function expectedMirrors(
  page: Page,
  insets: Insets,
  mode: 'drive' | 'mirrors',
): Promise<number> {
  const { front, wideLeft, close } = await expectedViews(
    page,
    insets,
    await wideSetting(page),
    mode,
  );
  return 2 + (wideLeft === null ? 0 : 2) + (front === null ? 0 : 1) + (close === null ? 0 : 1);
}

/**
 * Waits until the HUD, gauges and controls are laid out, so measuring never sees an empty set. With
 * `exact` the mirrors shown are those the default layout gives at this size: a missing front mirror fails.
 */
async function hudReady(
  page: Page,
  {
    insets = NO_INSETS,
    exact = true,
    mirrorsOnly = false,
  }: { insets?: Insets; exact?: boolean; mirrorsOnly?: boolean } = {},
): Promise<void> {
  const shown = () => page.locator('.hud-mirror:not([hidden])').count();
  const mode = mirrorsOnly ? 'mirrors' : 'drive';
  if (exact)
    await expect
      .poll(async () => (await shown()) - (await expectedMirrors(page, insets, mode)))
      .toBe(0);
  else await expect.poll(shown).toBeGreaterThanOrEqual(2);
  const gauges = page.locator('.hud-gauge');
  await expect(gauges).toHaveCount(2);
  // The gauges belong to the top-down pane, which a mirror-only drive does not have.
  for (const gauge of [gauges.first(), gauges.last()]) {
    if (mirrorsOnly) await expect(gauge).toBeHidden();
    else await expect(gauge).toBeVisible();
  }
  await expect(page.locator('.hud-counters')).toBeVisible();
  await expect(page.locator('.hud-action')).toBeVisible();
  await expect(page.locator('.ctl-wheel')).toBeVisible();
  await expect(page.locator('.ctl-lever')).toBeVisible();
  await expect(page.locator('.ctl-lamp')).toHaveCount(2);
  await expect(page.locator('.ctl-lamp').first()).toBeVisible();
}

/**
 * Each class IV mirror hangs from the arm of the class II mirror above it: its arm sits on the same side
 * and overlaps that arm both across and down.
 */
async function expectWideArms(page: Page): Promise<void> {
  await expect(page.locator('[data-hud^="wide"]:not([hidden])')).toHaveCount(2);
  const arms = await page
    .locator(
      '[data-hud="mirrorLeft"], [data-hud="wideLeft"], [data-hud="mirrorRight"], [data-hud="wideRight"]',
    )
    .evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect();
        const arm = getComputedStyle(el, '::before');
        const left = box.left + parseFloat(arm.left);
        const top = box.top + parseFloat(arm.top);
        return {
          name: el.getAttribute('data-hud') ?? '',
          left,
          right: left + parseFloat(arm.width),
          top,
          bottom: box.bottom - parseFloat(arm.bottom),
        };
      }),
    );
  for (const side of ['Left', 'Right']) {
    const upper = arms.find((a) => a.name === `mirror${side}`);
    const lower = arms.find((a) => a.name === `wide${side}`);
    if (upper === undefined || lower === undefined) throw new Error(`no ${side} arms`);
    expect(lower.left, `${side} class IV arm is at the class II arm's side`).toBeCloseTo(
      upper.left,
      0,
    );
    expect(lower.right, `${side} class IV arm is at the class II arm's side`).toBeCloseTo(
      upper.right,
      0,
    );
    expect(lower.top, `${side} class IV arm reaches into the class II arm`).toBeLessThan(
      upper.bottom,
    );
    expect(lower.top, `${side} class IV arm reaches into the class II arm`).toBeGreaterThan(
      upper.top,
    );
    expect(lower.bottom, `${side} class IV arm hangs below it`).toBeGreaterThan(upper.bottom);
  }
}

/** The mirrors, controls, panels and gauge labels do not collide or clip. */
async function expectMirrorsClearControls(page: Page, size: Size): Promise<void> {
  const mirrors = page.locator('.hud-mirror:not([hidden])');
  const controls = page.locator(
    '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever, .hud-legend',
  );

  const mirrorBoxes = await boxes(mirrors);
  const controlBoxes = await boxes(controls);
  expect(controlBoxes.length).toBeGreaterThan(0);

  for (const m of mirrorBoxes) {
    for (const c of controlBoxes) {
      expect(overlaps(m, c), `${c.name} overlaps a mirror`).toBe(false);
    }
  }
  // nor does a mirror meet another, the cockpit label or the gear and speed readouts
  const readouts = await boxes(
    page.locator('.hud-cockpit > .hud-view-label, .hud-gear, .hud-speed'),
  );
  mirrorBoxes.forEach((m, i) => {
    for (const r of readouts) expect(overlaps(m, r), `${r.name} overlaps a mirror`).toBe(false);
    for (const other of mirrorBoxes.slice(i + 1)) {
      expect(overlaps(m, other), 'two mirrors overlap').toBe(false);
    }
  });

  // Balanced is the default preset, so the housings are drawn: the arms stay clear too.
  await expect(page.locator('.hud[data-interior]')).toHaveCount(1);
  const [leftBox, rightBox] = mirrorBoxes;
  const [leftArm, rightArm] = await armReach(mirrors);
  if (leftBox === undefined || rightBox === undefined) throw new Error('two mirrors');
  if (leftArm === undefined || rightArm === undefined) throw new Error('two arms');
  expect(Math.min(leftArm, rightArm), 'arms are drawn').toBeGreaterThan(0);
  const armed = [
    { ...leftBox, left: leftBox.left - leftArm },
    { ...rightBox, right: rightBox.right + rightArm },
  ];
  for (const m of armed) {
    expect(m.left, 'arm on screen').toBeGreaterThanOrEqual(0);
    expect(m.right, 'arm on screen').toBeLessThanOrEqual(size.width);
    for (const c of controlBoxes) {
      expect(overlaps(m, c), `${c.name} overlaps a mirror housing`).toBe(false);
    }
  }

  if ((await page.locator('[data-hud^="wide"]:not([hidden])').count()) > 0)
    await expectWideArms(page);

  // The front mirror hangs from a bracket above it, which stays inside the cockpit.
  const front = page.locator('[data-hud="front"]:not([hidden])');
  if ((await front.count()) > 0) {
    // `hudReady` pinned the count against the layout, so a missing mirror has failed already
    const [frontBox] = await boxes(front);
    const [cockpitBox] = await boxes(page.locator('.hud-cockpit'));
    const bracket = await front.evaluate((el) =>
      Math.max(0, -parseFloat(getComputedStyle(el, '::before').top)),
    );
    expect(bracket, 'bracket is drawn').toBeGreaterThan(0);
    expect((frontBox?.top ?? 0) - bracket, 'bracket inside the cockpit').toBeGreaterThanOrEqual(
      cockpitBox?.top ?? 0,
    );
  }

  // The class V mirror's housing arm reaches past its outer, right side, and stays on screen and clear.
  const close = page.locator('[data-hud="close"]:not([hidden])');
  if ((await close.count()) > 0) {
    const [closeBox] = await boxes(close);
    const [closeArm] = await armReach(close);
    if (closeBox === undefined || closeArm === undefined) throw new Error('class V arm');
    expect(closeArm, 'class V arm is drawn').toBeGreaterThan(0);
    const armedClose = { ...closeBox, right: closeBox.right + closeArm };
    expect(armedClose.right, 'class V arm on screen').toBeLessThanOrEqual(size.width);
    for (const c of controlBoxes) {
      expect(overlaps(armedClose, c), `${c.name} overlaps the class V housing`).toBe(false);
    }
  }

  // The lamp row must not make the gear column taller than the gears and their label were alone.
  const [gearColumn] = await boxes(page.locator('.ctl-gears'));
  expect(
    (gearColumn?.bottom ?? 0) - (gearColumn?.top ?? 0),
    'gear column height',
  ).toBeLessThanOrEqual(GEAR_COLUMN_HEIGHT);

  const panels = await boxes(
    page.locator('.hud-goal:not([hidden]), .hud-gauge, .hud-counters, .hud-action'),
  );
  expect(panels.length).toBeGreaterThan(0);
  for (const panel of panels) {
    for (const c of controlBoxes) {
      expect(overlaps(panel, c), `${panel.name} overlaps ${c.name}`).toBe(false);
    }
  }

  const clipped = await page
    .locator('.hud-gauge .hud-label')
    .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length);
  expect(clipped, 'a gauge label is wider than its gauge').toBe(0);
}

const insets = { top: 24, left: 48, bottom: 20, right: 48 };

/**
 * `slot`: where a mirror-only drive too short for both messages between the mirrors puts them;
 * `keysOpen`: the key legend's chevron starts open.
 */
const insetSizes: {
  width: number;
  height: number;
  slot?: 'cue yields' | 'right of the cone';
  keysOpen?: boolean;
}[] = [
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
  { width: 900, height: 649 },
  { width: 768, height: 1024 },
  { width: 860, height: 860, keysOpen: true },
  { width: 950, height: 426, slot: 'cue yields' },
  // over the brief's side of the cockpit
  { width: 1030, height: 426, slot: 'right of the cone' },
];

for (const { slot, keysOpen = false, ...size } of insetSizes) {
  const mirrorsOnly = slot !== undefined;
  const screen = mirrorsOnly ? 'mirror-only drive' : 'drive screen';
  test(`the ${screen} stays inside the safe area at ${size.width}x${size.height}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'en-US', viewport: size });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    if (mirrorsOnly) {
      await page.addInitScript((key) => {
        localStorage.setItem(key, JSON.stringify({ version: 1, mirrorsOnly: true }));
      }, SETTINGS_KEY);
    }
    await page.goto('./');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--safe-left'),
        ),
      )
      .toBe(`${insets.left}px`);
    await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
    await hudReady(page, { insets, mirrorsOnly });
    if (keysOpen) {
      await expect(page.locator('[data-hud="keysToggle"]')).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }

    const placed = await boxes(
      page.locator(
        [
          '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever',
          // the mirror-only drive hides the gauges with the top-down pane
          `.hud-action, .hud-goal:not([hidden]), ${mirrorsOnly ? '' : '.hud-gauge, '}.hud-counters, .hud-legend`,
          '.hud-gear, .hud-speed, .hud-cockpit > .hud-view-label, .hud-mirror:not([hidden])',
        ].join(', '),
      ),
    );
    expect(placed.length).toBeGreaterThan(0);
    for (const b of placed) {
      const at = `${b.name} in the safe area`;
      expect(b.left, at).toBeGreaterThanOrEqual(insets.left);
      expect(b.right, at).toBeLessThanOrEqual(size.width - insets.right);
      expect(b.bottom, at).toBeLessThanOrEqual(size.height - insets.bottom);
    }
    const topEdge = await boxes(
      page.locator('.hud-action, .hud-goal:not([hidden]), .hud-cockpit > .hud-view-label'),
    );
    const landscape = size.width >= size.height;
    for (const b of topEdge) {
      // In portrait the cockpit label sits mid-screen, so only the top view's panels reach the top edge.
      if (landscape || !b.name.includes('view-label')) {
        expect(b.top, `${b.name} below the top inset`).toBeGreaterThanOrEqual(insets.top);
      }
    }

    const mirrors = await boxes(page.locator('.hud-mirror:not([hidden])'));
    const controls = await boxes(
      page.locator(
        '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever, .hud-legend',
      ),
    );
    for (const m of mirrors) {
      for (const c of controls) {
        expect(overlaps(m, c), `${c.name} overlaps a mirror`).toBe(false);
      }
    }

    const wrap = page.locator('[data-hud="toastWrap"]');
    if (slot === 'cue yields') await expect(wrap).toHaveAttribute('data-cue-yields');
    else await expect(wrap).not.toHaveAttribute('data-cue-yields');
    if (slot === 'right of the cone') {
      const [column] = await boxes(wrap);
      expect(column?.left, 'the messages right of the sight cone').toBeGreaterThan(size.width / 2);
    }
    await expectMessagesClear(page, en.blockedTurntable, en.goalInside);
    // the toast stands inside the wrap, which keeps clear of the safe area
    const messages = await boxes(
      page.locator(
        '[data-hud="toastWrap"], [data-hud="toast"]:visible, [data-hud="goalCue"]:visible',
      ),
    );
    for (const b of messages) {
      const at = `${b.name} in the safe area`;
      expect(b.left, at).toBeGreaterThanOrEqual(insets.left);
      expect(b.right, at).toBeLessThanOrEqual(size.width - insets.right);
      if (landscape && !b.name.includes('toast-wrap')) {
        expect(b.top, `${b.name} below the top inset`).toBeGreaterThanOrEqual(insets.top);
      }
    }
    await context.close();
  });
}

test('the longest German toast fits the narrowest pane column, inside the safe area, at 800x426', async ({
  browser,
}) => {
  const size = { width: 800, height: 426 };
  const context = await browser.newContext({ locale: 'de-DE', viewport: size });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await page.goto('./');
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--safe-left'),
        ),
      )
      .toBe(`${insets.left}px`);
    await page.getByRole('button', { name: de.exerciseStraightReverse }).click();
    await hudReady(page, { insets });
    const [column] = await boxes(page.locator('[data-hud="toastWrap"]'));
    const [pane] = await boxes(page.locator('.hud-topdown'));
    expect(column?.left, 'the messages in the top-down pane').toBeGreaterThanOrEqual(
      pane?.left ?? Infinity,
    );
    await expectMessagesClear(page, de.blockedTurntable, de.goalInside);
    const messages = await boxes(
      page.locator('[data-hud="toast"]:visible, [data-hud="goalCue"]:visible'),
    );
    for (const b of messages) {
      expect(b.right, `${b.name} in the safe area`).toBeLessThanOrEqual(size.width - insets.right);
    }
  } finally {
    await context.close();
  }
});

const starts = [
  { name: 'exercise', label: en.exerciseStraightReverse },
  { name: 'yard', label: en.layoutDepot },
];

for (const start of starts) {
  test(`the ${start.name} top view stays compact at 1366x768`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('./');
    await page.getByRole('button', { name: start.label }).click();

    // a hidden button measures at the top: count the shown ones, in the outside view with its free camera too
    const buttons = page.locator('.hud-toolbar button:visible');
    await expect(buttons.first()).toBeVisible();
    const rows = async (): Promise<number> =>
      new Set((await boxes(buttons)).map((b) => Math.round(b.top))).size;
    expect(await rows()).toBeLessThanOrEqual(2);
    await page.keyboard.press('o');
    await expect(page.locator('[data-hud="freeCamera"]')).toBeVisible();
    expect(await rows(), 'outside view').toBeLessThanOrEqual(2);
    await page.keyboard.press('f');

    await expect(page.locator('.hud-info')).toBeVisible();
    const [info] = await boxes(page.locator('.hud-info'));
    expect(info?.bottom).toBeLessThan(768 / 2);
  });
}

test('the two gauges stay equally wide in German', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'de-DE',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  await page.goto('./');
  await page.getByRole('button', { name: de.exerciseStraightReverse }).click();

  await hudReady(page);
  const widths = (await boxes(page.locator('.hud-gauge'))).map((b) => b.right - b.left);
  expect(widths).toHaveLength(2);
  expect(widths[0]).toBeCloseTo(widths[1] ?? 0, 0);
  await context.close();
});

test('the goal cue keeps its distance out of the live region', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  // The distance changes every 0.1 m; only the state span may be announced.
  const parts = page.locator(
    '[data-hud="toastWrap"][aria-live="polite"] [data-hud="goalCue"] > span',
  );
  await expect(parts).toHaveCount(2);
  await expect(parts.nth(0)).toHaveAttribute('aria-hidden', 'true');
  await expect(parts.nth(1)).not.toHaveAttribute('aria-hidden', /.*/);
});

const menuViews = [
  { width: 1280, height: 585 },
  { width: 390, height: 844 },
];

for (const { locale, messages } of locales) {
  for (const size of menuViews) {
    test(`the menu opens on the exercises at ${locale} ${size.width}x${size.height}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ locale, viewport: size });
      try {
        const page = await context.newPage();
        await page.goto('./');
        const cards = page.locator('[data-menu="exercises"] .menu-start');
        await expect(cards).toHaveCount(5);
        await expect(page.locator('ol[data-menu="exercises"] > li')).toHaveCount(5);
        await expect(page.locator('.menu-heading').first()).toHaveText(messages.exercises);
        const setupFollows = await page
          .locator('[data-menu="exercises"]')
          .evaluate((el) =>
            Boolean(
              el.compareDocumentPosition(document.querySelector('[data-menu="truck"]') ?? el) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            ),
          );
        expect(setupFollows).toBe(true);
        const found = await boxes(cards);
        if (size.width > size.height) {
          // The second row starts within view, so more than one row of exercises shows.
          expect(Math.max(...found.map((b) => b.top))).toBeLessThan(size.height - 100);
        } else expect(found[0]?.bottom ?? Infinity).toBeLessThanOrEqual(size.height);
      } finally {
        await context.close();
      }
    });
  }
}

test('the key legend folds away and stays folded in the next run', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  const toggle = page.locator('[data-hud="keysToggle"]');
  await expect(page.locator('.hud-legend dl')).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.hud-legend dl')).toBeHidden();

  await page.reload();
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await expect(page.locator('.hud-legend dl')).toBeHidden();
  await expect(toggle).toBeVisible();
});

test('a short cockpit opens the key legend to the drive keys, and the chevron shows the rest', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startStraightReverse(page, en.exerciseStraightReverse);
  const toggle = page.locator('[data-hud="keysToggle"]');
  const rows = page.locator('.hud-legend dt');
  const view = page.locator('.hud-legend dt.hud-legend-view');
  await expect(view.first()).toBeHidden();
  await expect(rows.filter({ visible: true })).toHaveCount(5);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const box = await toggle.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(24);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(view.first()).toBeVisible();
  await settled(page);
  await expectMirrorsClearControls(page, { width: 1280, height: 720 });
  await toggle.click();
  await expect(view.first()).toBeHidden();
});

test('below 700 px the brief collapses on the first drive input and the key legend is an overlay', async ({
  page,
}) => {
  const size = { width: 1280, height: 585 };
  await page.setViewportSize(size);
  await startStraightReverse(page, en.exerciseStraightReverse);
  const brief = page.locator('.hud-goal-brief');
  const briefToggle = page.locator('[data-hud="briefToggle"]');
  const keysToggle = page.locator('[data-hud="keysToggle"]');
  const list = page.locator('.hud-legend dl');

  await expect(brief).toBeVisible();
  await expect(briefToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(list).toBeHidden();
  await expect(keysToggle).toHaveAttribute('aria-expanded', 'false');
  await settled(page);
  await expectMirrorsClearControls(page, size);
  const closed = await boxes(page.locator('.hud-legend'));

  // Open or closed, the legend is its toggle: the mirrors do not move for the list.
  await keysToggle.click();
  await expect(list).toBeVisible();
  await expect(keysToggle).toHaveAttribute('aria-expanded', 'true');
  await settled(page);
  expect(await boxes(page.locator('.hud-legend'))).toEqual(closed);
  await expectMirrorsClearControls(page, size);
  for (const other of [size, { width: 1024, height: 690 }, { width: 800, height: 600 }, size]) {
    await page.setViewportSize(other);
    await expect
      .poll(async () => (await boxes(page.locator('.hud-topdown')))[0])
      .toMatchObject({ right: other.width, bottom: other.height });
    await settled(page);
    await expect.poll(() => overlayTrouble(page, KEY_LIST)).toEqual([]);
  }
  await keysToggle.click();
  await expect(list).toBeHidden();

  // The first drive input collapses the brief, also after a taller window in between.
  await page.keyboard.press('4');
  await expect(brief).toBeHidden();
  await expect(briefToggle).toHaveAttribute('aria-expanded', 'false');
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(briefToggle).toBeHidden();
  await expect(brief).toBeVisible();
  await page.setViewportSize(size);
  await expect(briefToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(brief).toBeHidden();
  await settled(page);
  await expectMirrorsClearControls(page, size);
  await briefToggle.click();
  await expect(brief).toBeVisible();
  await expect(briefToggle).toHaveAttribute('aria-expanded', 'true');

  // A later control change closes an open list.
  await page.keyboard.down('w');
  await page.waitForTimeout(300);
  await page.keyboard.up('w');
  await keysToggle.click();
  await expect(list).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(list).toBeVisible();
  await expect(brief).toBeVisible();
  await page.keyboard.down('a');
  await expect(list).toBeHidden();
  await page.keyboard.up('a');
  await expect(keysToggle).toHaveAttribute('aria-expanded', 'false');
});

for (const [height, short] of [
  [699, true],
  [700, false],
] as const) {
  test(`the brief and the key legend ${short ? 'collapse' : 'stay as they are'} at 1280x${String(height)}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height });
    await startStraightReverse(page, en.exerciseStraightReverse);
    await expect(page.locator('[data-hud="briefToggle"]')).toBeVisible({ visible: short });
    await expect(page.locator('.hud-legend[data-overlay]')).toHaveCount(short ? 1 : 0);
    await expect(page.locator('.hud-topdown[data-short]')).toHaveCount(short ? 1 : 0);
    await page.keyboard.press('4');
    await expect(page.locator('.hud-goal-brief')).toBeVisible({ visible: !short });
  });
}

for (const [height, openFull] of [
  [739, false],
  [740, true],
] as const) {
  test(`the key legend opens to ${openFull ? 'the full list' : 'the drive keys'} at 1280x${String(height)}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height });
    await startStraightReverse(page, en.exerciseStraightReverse);
    await expect(page.locator('.hud-legend dt.hud-legend-view').first()).toBeVisible({
      visible: openFull,
    });
  });
}

const handle = (page: Page) => page.locator('[data-hud="splitHandle"]');
const splitBar = (page: Page) => page.locator('[data-hud="split"]');

/** A short landscape screen: no panel row fits above the divider. */
const shortLandscape = { width: 844, height: 390 };
const splitSizes = [...sizes, shortLandscape];
/** Laptops whose lever column stands well below the toolbar: the toolbar keeps its full width there. */
const unreservedToolbar = new Set(['1280x800', '1366x768']);

const KEY_LIST = '.hud-legend dl';
const AID_LIST = '[data-hud="aidLegend"]';

/**
 * What an open overlay of a short screen leaves or covers: it stands in the top-down pane, clear of the
 * mirrors, the controls, the divider and the toolbar. Taller than its room, it scrolls: its first item
 * shows whole and every item can be scrolled into view.
 */
async function overlayTrouble(page: Page, sel: string): Promise<string[]> {
  const list = page.locator(sel);
  const [box] = await boxes(list);
  const [pane] = await boxes(page.locator('.hud-topdown'));
  if (box === undefined || pane === undefined) return ['no list or no pane'];
  const inside =
    box.left >= pane.left &&
    box.right <= pane.right &&
    box.top >= pane.top &&
    box.bottom <= pane.bottom;
  const scroll = await list.evaluate((el) => {
    const style = getComputedStyle(el);
    const scrollable = /auto|scroll/.test(style.overflowY) && style.pointerEvents !== 'none';
    const from = el.scrollTop;
    // Whole within the padding box, at the current scroll.
    const whole = (item: Element): boolean => {
      const top = el.getBoundingClientRect().top + el.clientTop;
      const r = item.getBoundingClientRect();
      return r.top >= top - 0.5 && r.bottom <= top + el.clientHeight + 0.5;
    };
    el.scrollTop = 0;
    const items = [...el.children].filter((item) => item.getClientRects().length > 0);
    const first = items[0] !== undefined && whole(items[0]);
    // Scrolled down to its bottom, an item shows whole, or from there up if it is taller than the view.
    const unreachable = items.flatMap((item, i) => {
      const view = el.getBoundingClientRect().top + el.clientTop + el.clientHeight;
      el.scrollTop += Math.max(0, item.getBoundingClientRect().bottom - view);
      const r = item.getBoundingClientRect();
      const reached =
        whole(item) || (r.height > el.clientHeight && Math.abs(r.bottom - view) <= 0.5);
      return reached ? [] : [`item ${String(i + 1)} out of reach`];
    });
    el.scrollTop = from;
    return {
      clipped: el.scrollHeight > el.clientHeight,
      scrollable,
      first,
      unreachable: [
        ...unreachable,
        ...(el.scrollWidth > el.clientWidth ? ['cut at the side'] : []),
      ],
    };
  });
  const others = await boxes(
    page.locator(
      [
        '.hud-mirror:not([hidden]), .ctl-stop, .ctl-lever, .hud-action',
        '.hud-split:not([hidden]) .hud-split-handle, .hud-split:not([hidden]) .hud-split-reset',
        '.hud-toolbar .hud-toggle, [data-hud="freeCamera"]:visible',
      ].join(', '),
    ),
  );
  return [
    ...(inside ? [] : ['outside the top-down pane']),
    ...(scroll.clipped && !scroll.scrollable ? ['clipped and not scrollable'] : []),
    ...(scroll.first ? [] : ['first item cut']),
    ...scroll.unreachable,
    ...others.filter((o) => overlaps(box, o)).map((o) => o.name),
  ];
}

/** Two animation frames: the legend's resize observer re-lays out after the first one. */
const settled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

async function startFreeYard(page: Page, label: string): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: label }).click();
  // No exercise, so no counters or brief: the toolbar and the controls are what stands.
  await expect(page.locator('.hud-gauge')).toHaveCount(2);
  await expect(page.locator('.hud-toolbar .hud-toggle').first()).toBeVisible();
  await expect(page.locator('.ctl-stop')).toBeVisible();
  await expect
    .poll(() => page.locator('.hud-mirror:not([hidden])').count())
    .toBeGreaterThanOrEqual(2);
  await settled(page);
}

async function startStraightReverse(page: Page, label: string): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: label }).click();
  await hudReady(page);
}

const aidToggle = (page: Page) => page.locator('[data-hud="aidLegendToggle"]');
const keysToggle = (page: Page) => page.locator('[data-hud="keysToggle"]');

test('below 700 px the aid legend opens over the top view, one overlay at a time, and closes on the next control input', async ({
  page,
}) => {
  const size = { width: 1280, height: 585 };
  await page.setViewportSize(size);
  await startStraightReverse(page, en.exerciseStraightReverse);
  const list = page.locator(AID_LIST);
  const keys = page.locator(KEY_LIST);
  const frame = async () => ({
    info: await boxes(page.locator('.hud-info')),
    toggles: await boxes(page.locator('.hud-toolbar .hud-toggle')),
    min: await handle(page).getAttribute('aria-valuemin'),
    max: await handle(page).getAttribute('aria-valuemax'),
  });

  await expect(list).toBeHidden();
  await expect(aidToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(handle(page)).toBeVisible();
  await settled(page);
  const closed = await frame();

  // Open or closed, the legend stands out of the flow: the panels and the divider do not move for it.
  await aidToggle(page).click();
  await expect(list).toBeVisible();
  await expect(aidToggle(page)).toHaveAttribute('aria-expanded', 'true');
  await settled(page);
  expect(await frame()).toEqual(closed);
  await expect.poll(() => overlayTrouble(page, AID_LIST)).toEqual([]);
  // It paints over the info row, not under it.
  // The HUD takes no pointer events, so let the list, or `elementFromPoint` skips it.
  const covered = await list.evaluate((el) => {
    if (!(el instanceof HTMLElement)) throw new Error('no legend');
    el.style.pointerEvents = 'auto';
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    el.style.pointerEvents = '';
    return top !== null && el.contains(top);
  });
  expect(covered, 'the legend is painted under another element').toBe(true);
  await page.waitForTimeout(1000);
  await expect(list).toBeVisible();

  // One overlay at a time.
  await keysToggle(page).click();
  await expect(keys).toBeVisible();
  await expect(list).toBeHidden();
  await expect(aidToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await aidToggle(page).click();
  await expect(list).toBeVisible();
  await expect(keys).toBeHidden();
  await expect(keysToggle(page)).toHaveAttribute('aria-expanded', 'false');

  // The next control input closes it.
  await page.keyboard.down('a');
  await expect(list).toBeHidden();
  await page.keyboard.up('a');
  await expect(aidToggle(page)).toHaveAttribute('aria-expanded', 'false');
  await settled(page);
  expect(await frame()).toEqual(closed);
});

/** Wide, narrow, short and tall panes: the sizes where the overlay's limits bind. */
const overlaySizes = [
  { width: 1280, height: 585 },
  { width: 1024, height: 690 },
  { width: 800, height: 600 },
  { width: 1300, height: 540 },
  { width: 1172, height: 426 },
];

for (const { locale, messages } of locales) {
  for (const touch of [false, true]) {
    for (const size of overlaySizes) {
      const at = `${locale} ${size.width}x${size.height} with ${touch ? 'touch' : 'a mouse'}`;

      test(`the open overlays stay whole and clear of the controls at ${at}`, async ({
        browser,
      }) => {
        test.slow();
        const context = await browser.newContext({
          locale,
          viewport: size,
          ...(touch ? { hasTouch: true, isMobile: true } : {}),
        });
        try {
          const page = await context.newPage();
          await startStraightReverse(page, messages.exerciseStraightReverse);
          // The outside view's free camera button stands where the overlays open from: it steps aside for them.
          const tool = page.locator('[data-hud="freeCamera"]');
          await page.locator('[data-view="chase"]').click();
          await settled(page);
          const toolShown = await tool.isVisible();
          // The brief open, then folded by the first drive input.
          for (const folded of [false, true]) {
            if (folded) {
              await page.keyboard.press('4');
              await expect(page.locator('.hud-goal-brief')).toBeHidden();
            }
            // A touch screen has no key legend until a key is typed.
            for (const [toggle, sel] of [
              [aidToggle(page), AID_LIST],
              ...(touch ? [] : [[keysToggle(page), KEY_LIST] as const]),
            ] as const) {
              await toggle.click();
              await expect(page.locator(sel)).toBeVisible();
              await settled(page);
              await expect(tool).toBeHidden();
              await expect
                .poll(() => overlayTrouble(page, sel), {
                  message: `${sel}, brief ${folded ? 'folded' : 'open'}`,
                })
                .toEqual([]);
              await toggle.click();
              await expect(page.locator(sel)).toBeHidden();
              if (toolShown) await expect(tool).toBeVisible();
            }
          }
        } finally {
          await context.close();
        }
      });
    }
  }
}

for (const { locale, messages } of locales) {
  test(`the open aid legend of the free yard stays whole and clear at ${locale} 1024x600`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale, viewport: { width: 1024, height: 600 } });
    try {
      const page = await context.newPage();
      await startFreeYard(page, messages.layoutDepot);
      await aidToggle(page).click();
      await expect(page.locator(AID_LIST)).toBeVisible();
      await settled(page);
      await expect.poll(() => overlayTrouble(page, AID_LIST)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test('a swipe on the open aid legend scrolls it, and neither steers, drives nor moves the top view', async ({
  browser,
}) => {
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 800, height: 600 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await startStraightReverse(page, en.exerciseStraightReverse);
    const list = page.locator(AID_LIST);
    await aidToggle(page).tap();
    await expect(list).toBeVisible();
    await settled(page);
    const scrollTop = () => list.evaluate((el) => el.scrollTop);
    expect(
      await list.evaluate((el) => el.scrollHeight > el.clientHeight),
      'no room to scroll',
    ).toBe(true);
    const controls = () =>
      Promise.all([
        page.locator('[data-ctl="lever"]').evaluate((el) => el.style.getPropertyValue('--lever')),
        page.locator('[data-ctl="wheel-art"]').evaluate((el) => el.style.transform),
      ]);
    const before = await controls();
    const [box] = await boxes(list);
    if (box === undefined) throw new Error('no legend');
    const x = (box.left + box.right) / 2;
    const cdp = await context.newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: y === undefined ? [] : [{ x, y, id: 1 }],
      });
    await touch('touchStart', box.bottom - 8);
    for (let i = 1; i <= 8; i++) await touch('touchMove', box.bottom - 8 - i * 10);
    await touch('touchEnd');
    await expect.poll(scrollTop).toBeGreaterThan(0);
    // A tap during the fling only stops it.
    await expect
      .poll(async () => {
        const from = await scrollTop();
        await settled(page);
        await page.waitForTimeout(100);
        return (await scrollTop()) === from;
      })
      .toBe(true);
    await expect(list).toBeVisible();
    expect(await controls()).toEqual(before);
    await expect(page.locator('[data-hud="resetView"]')).toBeDisabled();
    // Opened again, it starts at the top.
    await aidToggle(page).tap();
    await expect(list).toBeHidden();
    await aidToggle(page).tap();
    await expect(list).toBeVisible();
    expect(await scrollTop()).toBe(0);
  } finally {
    await context.close();
  }
});

test('the key list of a short screen opens at its top again', async ({ page }) => {
  await page.setViewportSize({ width: 1172, height: 426 });
  await startStraightReverse(page, en.exerciseStraightReverse);
  const list = page.locator(KEY_LIST);
  await keysToggle(page).click();
  await expect(list).toBeVisible();
  await settled(page);
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight), 'no room to scroll').toBe(
    true,
  );
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await keysToggle(page).click();
  await expect(list).toBeHidden();
  await keysToggle(page).click();
  await expect(list).toBeVisible();
  expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
});

test('the messages stay clear of the controls with the aid legend open on a short portrait screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 690 });
  await startStraightReverse(page, en.exerciseStraightReverse);
  await aidToggle(page).click();
  await expect(page.locator(AID_LIST)).toBeVisible();
  await settled(page);
  await expectMessagesClear(page, en.blockedTurntable, en.goalInside);
  // The message column stands in the top view here.
  const [wrap] = await boxes(page.locator('[data-hud="toastWrap"]'));
  const [pane] = await boxes(page.locator('.hud-topdown'));
  expect(wrap?.top).toBeGreaterThanOrEqual(pane?.top ?? Infinity);
  expect(wrap?.bottom).toBeLessThanOrEqual(pane?.bottom ?? -Infinity);
});

/** Below 700 px the counters stand beside the angle gauges instead of under them. */
const counterSizes = [
  { width: 1280, height: 585 },
  { width: 1280, height: 649 },
  { width: 1300, height: 540 },
  { width: 1350, height: 600 },
];

for (const { locale, messages } of locales) {
  for (const touch of [false, true]) {
    for (const size of counterSizes) {
      test(`the counters stand beside the angle gauges at ${locale} ${size.width}x${size.height} with ${touch ? 'touch' : 'a mouse'}`, async ({
        browser,
      }) => {
        const context = await browser.newContext({
          locale,
          viewport: size,
          ...(touch ? { hasTouch: true, isMobile: true } : {}),
        });
        try {
          const page = await context.newPage();
          await startStraightReverse(page, messages.exerciseStraightReverse);
          await settled(page);
          const [gauges] = await boxes(page.locator('.hud-gauges'));
          const [counters] = await boxes(page.locator('.hud-counters'));
          expect(counters?.top).toBeCloseTo(gauges?.top ?? NaN, 0);
          const overflow = await page
            .locator('.hud-gauge .hud-label')
            .evaluateAll((els) => els.map((el) => el.scrollWidth - el.clientWidth));
          expect(overflow, 'a gauge label sticks out').toEqual([0, 0]);
        } finally {
          await context.close();
        }
      });
    }
  }
}

/** A gauge label that wraps breaks only at a space or a soft hyphen, never mid-word without a hyphen. */
for (const size of [
  { width: 1280, height: 585 },
  { width: 1366, height: 640 },
]) {
  test(`the German gauge labels break only at a space or a soft hyphen at ${size.width}x${size.height}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'de-DE', viewport: size });
    try {
      const page = await context.newPage();
      await startStraightReverse(page, de.exerciseStraightReverse);
      await settled(page);
      const labels = page.locator('.hud-gauge .hud-label');
      await expect(labels).toHaveCount(2);
      const breaks = await labels.evaluateAll((els) =>
        els.map((el) => {
          const bad: string[] = [];
          let wraps = 0;
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? '';
            let last: { char: number; top: number } | undefined;
            for (let i = 0; i < text.length; i++) {
              const range = document.createRange();
              range.setStart(node, i);
              range.setEnd(node, i + 1);
              // the first character after a soft-hyphen break reports the hyphen glyph first
              const rect = [...range.getClientRects()].filter((r) => r.width > 0).at(-1);
              if (!rect || text[i] === ' ') continue;
              if (last && rect.top - last.top > 2) {
                wraps++;
                const at = text[last.char];
                const next = text[last.char + 1];
                if (at !== '\u00AD' && next !== '\u00AD' && next !== ' ') {
                  bad.push(`${text.slice(0, i)}|${text.slice(i)}`);
                }
              }
              last = { char: i, top: rect.top };
            }
          }
          return { bad, wraps };
        }),
      );
      // A label that fits on one line would pass vacuously: pick a size where it wraps.
      expect(
        breaks.map((b) => b.wraps > 0),
        'a gauge label no longer wraps at this size',
      ).toEqual([true, true]);
      expect(
        breaks.map((b) => b.bad),
        'a gauge label breaks inside a syllable',
      ).toEqual([[], []]);
    } finally {
      await context.close();
    }
  });
}

/** At the smallest and largest share the divider clears the cockpit and the panels, or is hidden. */
async function expectDividerClears(page: Page, size: Size): Promise<void> {
  await expect(handle(page)).toHaveCount(1);
  await expect(handle(page)).toHaveAttribute('aria-valuemin', /^\d+$/);
  await expect(handle(page)).toHaveAttribute('aria-valuemax', /^\d+$/);
  const min = Number(await handle(page).getAttribute('aria-valuemin'));
  const max = Number(await handle(page).getAttribute('aria-valuemax'));
  // Where the panels or the cockpit leave the split no room, there is no divider.
  if (min === max) {
    await expect(splitBar(page)).toHaveAttribute('hidden', '');
    await expect(handle(page)).toBeHidden();
    return;
  }
  expect(min).toBeLessThan(max);
  await expect(splitBar(page)).not.toHaveAttribute('hidden', '');
  await expect(handle(page)).toBeVisible();

  for (const key of ['Home', 'End']) {
    await handle(page).focus();
    await page.keyboard.press(key);
    await expect(handle(page)).toHaveAttribute('aria-valuenow', String(key === 'Home' ? min : max));
    await settled(page);

    const mirrors = await boxes(page.locator('.hud-mirror:not([hidden])'));
    const controls = await boxes(
      page.locator(
        '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever, .hud-legend',
      ),
    );
    const panels = await boxes(
      page.locator(
        '.hud-goal:not([hidden]), .hud-gauge, .hud-counters, .hud-action, .hud-toolbar .hud-toggle, [data-hud="freeCamera"]:visible',
      ),
    );
    const divider = await boxes(page.locator('.hud-split-handle, .hud-split-reset'));
    // the front mirror comes with the two side mirrors where the window has room for it
    expect(mirrors.length).toBeGreaterThanOrEqual(2);
    expect(divider).toHaveLength(2);
    for (const m of mirrors) {
      for (const c of [...controls, ...divider]) {
        expect(overlaps(m, c), `${c.name} overlaps a mirror at ${key}`).toBe(false);
      }
    }
    for (const d of divider) {
      for (const c of [...controls, ...panels]) {
        expect(overlaps(d, c), `${d.name} overlaps ${c.name} at ${key}`).toBe(false);
      }
      expect(d.left, `${d.name} on screen`).toBeGreaterThanOrEqual(0);
      expect(d.top, `${d.name} on screen`).toBeGreaterThanOrEqual(0);
      expect(d.right, `${d.name} on screen`).toBeLessThanOrEqual(size.width);
      expect(d.bottom, `${d.name} on screen`).toBeLessThanOrEqual(size.height);
    }
    for (const p of panels) {
      for (const c of controls) {
        expect(overlaps(p, c), `${p.name} overlaps ${c.name} at ${key}`).toBe(false);
      }
    }
  }
}

/**
 * The longest toast and a goal cue: no word sticks out of its box, and neither touches the controls
 * or the forward sight cone, the cockpit label and every mirror. Where the column holds one message at
 * a time (`data-cue-yields`), the cue hides while the toast shows, and each is checked alone.
 */
async function expectMessagesClear(page: Page, toast: string, goal: string): Promise<void> {
  await page.evaluate(
    ([toastText, goalText]) => {
      for (const [name, text] of [
        ['toast', toastText],
        ['goalCue', goalText],
      ] as const) {
        const el = document.querySelector(`[data-hud="${name}"]`);
        if (!(el instanceof HTMLElement)) throw new Error(`no ${name}`);
        el.textContent = text;
        el.hidden = false;
      }
    },
    [toast, goal] as const,
  );
  const cue = page.locator('[data-hud="goalCue"]');
  if ((await page.locator('[data-hud="toastWrap"][data-cue-yields]').count()) === 0) {
    await expectShownMessagesClear(page, 2);
    return;
  }
  await expect(cue, 'the goal cue yields to the toast').toBeHidden();
  await expectShownMessagesClear(page, 1);
  await page.locator('[data-hud="toast"]').evaluate((el) => {
    if (el instanceof HTMLElement) el.hidden = true;
  });
  await expect(cue).toBeVisible();
  await expectShownMessagesClear(page, 1);
}

async function expectShownMessagesClear(page: Page, count: number): Promise<void> {
  const shown = page.locator('[data-hud="toast"]:visible, [data-hud="goalCue"]:visible');
  await expect(shown).toHaveCount(count);
  const overflow = await shown.evaluateAll((els) =>
    els.map((el) => el.scrollWidth - el.clientWidth),
  );
  expect(overflow, 'a word sticks out of a message').toEqual(Array<number>(count).fill(0));
  // Standing over the top view's panels, they must paint above them: the wrap takes no pointer events, so
  // let it, or `elementFromPoint` skips it.
  const covered = await page.evaluate(() => {
    const wrap = document.querySelector('[data-hud="toastWrap"]');
    if (!(wrap instanceof HTMLElement)) throw new Error('no toastWrap');
    wrap.style.pointerEvents = 'auto';
    const hidden: string[] = [];
    for (const el of document.querySelectorAll('[data-hud="toast"], [data-hud="goalCue"]')) {
      if (!el.checkVisibility()) continue;
      const r = el.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      const points = [
        [(r.left + r.right) / 2, mid],
        [r.left + 12, mid],
        [r.right - 12, mid],
        [(r.left + r.right) / 2, r.top + 4],
      ] as const;
      for (const [x, y] of points) {
        const top = document.elementFromPoint(x, y);
        if (!top || !el.contains(top))
          hidden.push(`${el.className} at ${Math.round(x)},${Math.round(y)}`);
      }
    }
    wrap.style.pointerEvents = '';
    return hidden;
  });
  expect(covered, 'a message is painted under another element').toEqual([]);
  const messages = await boxes(shown);
  expect(messages).toHaveLength(count);
  // Without the top-down pane the brief and the counters stand in the cockpit too.
  const mirrorsOnly = (await page.locator('.hud[data-mirrors]').count()) > 0;
  const controls = await boxes(
    page.locator(
      [
        '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever, .hud-legend, .hud-gear, .hud-speed, .hud-action, [data-hud="freeCamera"]:visible',
        ...(mirrorsOnly ? ['.hud-goal:not([hidden]), .hud-counters'] : []),
      ].join(', '),
    ),
  );
  const [cockpit] = await boxes(page.locator('.hud-cockpit'));
  if (cockpit === undefined) throw new Error('no cockpit');
  const aspect = (cockpit.right - cockpit.left) / (cockpit.bottom - cockpit.top);
  const centre = {
    x: (cockpit.left + cockpit.right) / 2,
    y: (cockpit.top + cockpit.bottom) / 2,
  };
  const halfWidth = (coneEdge(aspect, COCKPIT_FOV) * (cockpit.right - cockpit.left)) / 2;
  const halfHeight = (coneTop(COCKPIT_FOV) * (cockpit.bottom - cockpit.top)) / 2;
  const cone = {
    name: 'sight cone',
    left: centre.x - halfWidth,
    right: centre.x + halfWidth,
    top: centre.y - halfHeight,
    bottom: centre.y + halfHeight,
  };
  const frontShown = (await page.locator('[data-hud="front"]:not([hidden])').count()) > 0;
  const wideShown = (await page.locator('[data-hud^="wide"]:not([hidden])').count()) > 0;
  const closeShown = (await page.locator('[data-hud="close"]:not([hidden])').count()) > 0;
  const mirrors = await boxes(
    page.locator('.hud-cockpit > .hud-view-label, .hud-mirror:not([hidden])'),
  );
  expect(mirrors).toHaveLength(
    3 + (frontShown ? 1 : 0) + (wideShown ? 2 : 0) + (closeShown ? 1 : 0),
  );
  for (const m of messages) {
    for (const o of [...controls, cone, ...mirrors]) {
      expect(overlaps(m, o), `${m.name} overlaps ${o.name}`).toBe(false);
    }
  }
}

/**
 * In the outside view the free camera button stands in the pane, at least a pointer target high, clear of
 * every panel, the controls, the mirrors, the divider and the target arrow: the vehicle is framed clear of
 * it as chrome, so the arrow never lands under it either. It is in the divider's reserve, so wherever the
 * divider is shown the button is too. Only where the panels leave no room for it (`paneToolAbsent`, K still
 * works) may it be missing; any other size losing it fails, tablets and desktops included.
 */
const paneToolAbsent = new Set([
  'en-US 844x390',
  'de-DE 844x390',
  'de-DE 740x649',
  'de-DE 1172x426',
]);

async function expectPaneToolClear(page: Page, at: string): Promise<void> {
  await page.keyboard.press('o');
  const tool = page.locator('[data-hud="freeCamera"]');
  await settled(page);
  if (paneToolAbsent.has(at)) {
    await expect(tool, 'no room for it here').toBeHidden();
    return;
  }
  await expect(tool, 'shown wherever the panels leave room').toBeVisible();
  const [box] = await boxes(tool);
  const [pane] = await boxes(page.locator('.hud-topdown'));
  if (box === undefined || pane === undefined) throw new Error('no button or no pane');
  expect(box.right - box.left, 'the button is a pointer target wide').toBeGreaterThanOrEqual(24);
  expect(box.bottom - box.top, 'the button is a pointer target high').toBeGreaterThanOrEqual(24);
  expect(box.left, 'inside the pane').toBeGreaterThanOrEqual(pane.left);
  expect(box.right, 'inside the pane').toBeLessThanOrEqual(pane.right);
  expect(box.top, 'inside the pane').toBeGreaterThanOrEqual(pane.top);
  expect(box.bottom, 'inside the pane').toBeLessThanOrEqual(pane.bottom);
  const others = await boxes(
    page.locator(
      [
        '.hud-goal:not([hidden]), .hud-gauge, .hud-counters, .hud-action, .hud-toolbar .hud-toggle',
        '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever',
        '.hud-mirror:not([hidden])',
        '.hud-split:not([hidden]) .hud-split-handle, .hud-split:not([hidden]) .hud-split-reset',
        '[data-hud="targetArrow"]:not([hidden]) svg',
      ].join(', '),
    ),
  );
  expect(others.length).toBeGreaterThan(0);
  for (const o of others) {
    expect(overlaps(box, o), `the free camera button overlaps ${o.name}`).toBe(false);
  }
}

/** The toolbar's buttons keep clear of the finish button and the controls (the folded brief's reserve included). */
async function expectToolbarClear(page: Page): Promise<void> {
  const toolbar = await boxes(page.locator('.hud-toolbar .hud-toggle'));
  const others = await boxes(
    page.locator(
      '.hud-action, .ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever',
    ),
  );
  expect(toolbar.length).toBeGreaterThan(0);
  for (const b of toolbar) {
    for (const o of others) {
      const gap = Math.max(b.left - o.right, o.left - b.right, b.top - o.bottom, o.top - b.bottom);
      expect(gap, `${b.name} touches ${o.name}`).toBeGreaterThan(0);
    }
  }
}

for (const { locale, messages } of locales) {
  for (const size of splitSizes) {
    const at = `${locale} ${size.width}x${size.height}`;

    test(`the layout holds at ${at}`, async ({ browser }) => {
      test.slow();
      const context = await browser.newContext({ locale, viewport: size });
      try {
        const page = await context.newPage();
        await startStraightReverse(page, messages.exerciseStraightReverse);
        // The short landscape size has no mirror check, only the messages and the divider.
        if (size !== shortLandscape) {
          await test.step('mirrors clear the controls', () =>
            expectMirrorsClearControls(page, size));
        }
        if (unreservedToolbar.has(`${size.width}x${size.height}`)) {
          await test.step('the toolbar takes no reserve against the lever column', () =>
            expect(page.locator('.hud-topdown')).not.toHaveAttribute('data-toolbar-reserve'));
        }
        await test.step('the toolbar clears the finish button and the controls', () =>
          expectToolbarClear(page));
        await test.step('the longest toast and the goal cue fit and keep clear of the controls and the mirrors', () =>
          expectMessagesClear(page, messages.blockedTurntable, messages.goalInside));
        await test.step("the outside view's free camera button clears the panels, the divider, the mirrors, the target arrow and the messages", async () => {
          await expectPaneToolClear(page, at);
          await expectMessagesClear(page, messages.blockedTurntable, messages.goalInside);
        });
        // Last: the divider moves the stored split.
        await test.step('the divider at its smallest and largest share clears the cockpit and the panels', () =>
          expectDividerClears(page, size));
      } finally {
        await context.close();
      }
    });
  }
}

// Without an exercise there is no brief: the view row takes its place beside the finish button, and wraps.
for (const { locale, messages } of locales) {
  for (const size of splitSizes.filter((s) => s.width <= 1024)) {
    test(`the free yard toolbar stays clear at ${locale} ${size.width}x${size.height}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ locale, viewport: size });
      try {
        const page = await context.newPage();
        await startFreeYard(page, messages.layoutDepot);
        await expectToolbarClear(page);
      } finally {
        await context.close();
      }
    });
  }
}

/** The mirror-only drive: the cockpit takes the window, and the brief and counters stand in it clear of everything. */
async function expectMirrorsOnlyClear(page: Page, size: Size): Promise<void> {
  const [cockpit] = await boxes(page.locator('.hud-cockpit'));
  expect(cockpit, 'the cockpit takes the whole window').toMatchObject({
    left: 0,
    top: 0,
    right: size.width,
    bottom: size.height,
  });
  const mirrors = await boxes(page.locator('.hud-mirror:not([hidden])'));
  const controls = await boxes(
    page.locator(
      '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever, .hud-legend',
    ),
  );
  const [pause] = await boxes(page.locator('.hud-action'));
  const [goal] = await boxes(page.locator('.hud-goal:not([hidden])'));
  const [counters] = await boxes(page.locator('.hud-counters'));
  if (pause === undefined || goal === undefined || counters === undefined) {
    throw new Error('no pause button, brief or counters');
  }
  const { right, left } = cockpit ?? { right: 0, left: 0 };
  const aspect = (right - left) / size.height;
  const halfWidth = (coneEdge(aspect, COCKPIT_FOV) * size.width) / 2;
  const halfHeight = (coneTop(COCKPIT_FOV) * size.height) / 2;
  const cone = {
    name: 'sight cone',
    left: size.width / 2 - halfWidth,
    right: size.width / 2 + halfWidth,
    top: size.height / 2 - halfHeight,
    bottom: size.height / 2 + halfHeight,
  };
  const readouts = await boxes(page.locator('.hud-gear, .hud-speed'));
  const against = (name: string, box: (typeof mirrors)[number], others: typeof mirrors) => {
    for (const o of others) expect(overlaps(box, o), `${name} overlaps ${o.name}`).toBe(false);
  };
  for (const m of mirrors)
    against('a mirror', m, [...controls, pause, goal, counters, ...readouts]);
  against('the brief', goal, [...controls, pause, counters, cone, ...readouts]);
  against('the counters', counters, [...controls, pause, goal, cone]);
  for (const box of [goal, counters, pause]) {
    expect(box.left, `${box.name} on screen`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${box.name} on screen`).toBeLessThanOrEqual(size.width);
    expect(box.bottom, `${box.name} on screen`).toBeLessThanOrEqual(size.height);
  }
}

for (const size of [
  { width: 1366, height: 768 },
  { width: 1280, height: 585 },
  { width: 768, height: 1024 },
]) {
  for (const { locale, messages } of locales) {
    test(`the mirror-only drive clears the controls and holds the brief at ${locale} ${size.width}x${size.height}`, async ({
      browser,
    }) => {
      test.slow();
      const context = await browser.newContext({ locale, viewport: size });
      try {
        const page = await context.newPage();
        await page.addInitScript((key) => {
          if (localStorage.getItem(key) === null) {
            localStorage.setItem(key, JSON.stringify({ version: 1, mirrorsOnly: true }));
          }
        }, SETTINGS_KEY);
        await page.goto('./');
        await page.getByRole('button', { name: messages.exerciseStraightReverse }).click();
        await hudReady(page, { mirrorsOnly: true });
        // both messages fit at once here, so the two-message check holds
        await expect(page.locator('[data-hud="toastWrap"]')).not.toHaveAttribute('data-cue-yields');
        // Portrait has no room for the key legend beside the brief.
        if (size.width < size.height) await expect(page.locator('.hud-legend')).toBeHidden();
        await expectMirrorsClearControls(page, size);
        await expectMirrorsOnlyClear(page, size);
        await expectMessagesClear(page, messages.blockedTurntable, messages.goalInside);
        if (size.height < 700) {
          // A short screen's key list has no top-down pane to open in.
          await page.locator('[data-hud="keysToggle"]').click();
          await expect(page.locator('.hud-legend dl')).toBeVisible();
          const [list] = await boxes(page.locator('.hud-legend dl'));
          if (list === undefined) throw new Error('no key list');
          expect(list.left, 'key list on screen').toBeGreaterThanOrEqual(0);
          expect(list.top, 'key list on screen').toBeGreaterThanOrEqual(0);
          expect(list.right, 'key list on screen').toBeLessThanOrEqual(size.width);
          expect(list.bottom, 'key list on screen').toBeLessThanOrEqual(size.height);
          const others = await boxes(
            page.locator(
              '.hud-mirror:not([hidden]), .ctl-wheel, .ctl-gears, .ctl-stop, .ctl-lever, .hud-action',
            ),
          );
          for (const o of others)
            expect(overlaps(list, o), `key list overlaps ${o.name}`).toBe(false);
        }
      } finally {
        await context.close();
      }
    });
  }
}

for (const size of [
  { width: 1536, height: 729 },
  { width: 1280, height: 585 },
  { width: 768, height: 1024 },
]) {
  for (const { locale, messages } of locales) {
    test(`the replay names the exercise and its corner stays clear at ${locale} ${size.width}x${size.height}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ locale, viewport: size });
      try {
        const page = await context.newPage();
        await page.goto('./');
        await page.getByRole('button', { name: messages.exerciseStraightReverse }).click();
        await expect(page.locator('[data-hud="speed"]')).toBeVisible();
        await page.getByRole('button', { name: messages.pause }).click();
        await page
          .getByRole('dialog', { name: messages.paused })
          .getByRole('button', { name: messages.finish })
          .click();
        await page.getByRole('button', { name: messages.replay }).click();
        const title = page.getByRole('heading', { name: messages.exerciseStraightReverse });
        await expect(title).toBeVisible();
        await expect(page.locator('.replay-readout')).toBeVisible();
        const [head] = await boxes(title);
        const [readout] = await boxes(page.locator('.replay-readout'));
        const [map] = await boxes(page.locator('.replay-map'));
        const [bar] = await boxes(page.locator('.replay-bar'));
        if (!head || !readout || !map || !bar) throw new Error('replay boxes missing');
        expect(overlaps(head, readout), 'the title overlaps the readout').toBe(false);
        expect(overlaps(head, bar), 'the title overlaps the bar').toBe(false);
        for (const box of [head, readout]) {
          expect(box.left, `${box.name} inside the map`).toBeGreaterThanOrEqual(map.left);
          expect(box.right, `${box.name} inside the map`).toBeLessThanOrEqual(map.right);
          expect(box.bottom, `${box.name} inside the map`).toBeLessThanOrEqual(map.bottom);
        }
      } finally {
        await context.close();
      }
    });
  }
}

/**
 * The cockpit pane is drawn from the first row down. On a pinned drive: a free-running software-GL
 * frame takes seconds, which a screenshot poll would spend waiting for.
 */
for (const size of sizes) {
  test(`the cockpit view has no blank band at ${size.width}x${size.height}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'en-US', viewport: size });
    try {
      const page = await context.newPage();
      await startPinnedDrive(
        page,
        { preset: 'balanced', lighting: 'day' },
        en.exerciseStraightReverse,
      );
      expect(await blankRows(page, Math.round(size.width * 0.3))).toBe(0);
    } finally {
      await context.close();
    }
  });
}

test('the class IV mirrors hang from the class II arms at 1920x1080', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1920, height: 1080 },
  });
  try {
    const page = await context.newPage();
    await startStraightReverse(page, en.exerciseStraightReverse);
    await hudReady(page);
    await expectWideArms(page);
  } finally {
    await context.close();
  }
});

/** Sizes where the front mirror is shown and where it is not: the toast column is too narrow or too short there. */
const frontShown = [
  { width: 1280, height: 800, front: 1 },
  { width: 1366, height: 768, front: 1 },
  { width: 768, height: 1024, front: 1 },
  { width: 390, height: 844, front: 0 },
  { width: 360, height: 800, front: 0 },
];

for (const { width, height, front } of frontShown) {
  test(`the longest German toast fits and clears the controls and the mirrors at ${width}x${height}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'de-DE', viewport: { width, height } });
    try {
      const page = await context.newPage();
      await startStraightReverse(page, de.exerciseStraightReverse);
      await expect(page.locator('[data-hud="front"]:not([hidden])')).toHaveCount(front);
      await expectMessagesClear(page, de.blockedTurntable, de.goalInside);
    } finally {
      await context.close();
    }
  });
}

/** The divider is hidden, or clear of every panel (and the open aid legend) and on screen. */
async function expectDividerClearOrHidden(page: Page, size: Size): Promise<void> {
  await settled(page);
  if ((await splitBar(page).getAttribute('hidden')) !== null) {
    await expect(handle(page)).toBeHidden();
    return;
  }
  await expect(handle(page)).toBeVisible();
  const panels = await boxes(
    page.locator(
      '.hud-goal:not([hidden]), .hud-gauge, .hud-counters, .hud-action, .hud-toolbar .hud-toggle, .hud-aid-legend',
    ),
  );
  const divider = await boxes(page.locator('.hud-split-handle, .hud-split-reset'));
  expect(panels.length).toBeGreaterThan(0);
  expect(divider).toHaveLength(2);
  for (const d of divider) {
    for (const c of panels) expect(overlaps(d, c), `${d.name} overlaps ${c.name}`).toBe(false);
    expect(d.bottom, `${d.name} on screen`).toBeLessThanOrEqual(size.height);
    expect(d.right, `${d.name} on screen`).toBeLessThanOrEqual(size.width);
  }
}

test('opening the aid legend re-measures the divider against the panels', async ({ page }) => {
  // The tallest landscape screen here where the in-flow legend leaves the divider no room (below 700 px it is an overlay).
  const size = { width: 1280, height: 700 };
  await page.setViewportSize(size);
  await startStraightReverse(page, en.exerciseStraightReverse);
  await expect(handle(page)).toBeVisible();
  const min = await handle(page).getAttribute('aria-valuemin');
  const max = await handle(page).getAttribute('aria-valuemax');
  expect(min).not.toBe(max);

  const toggle = page.locator('[data-hud="aidLegendToggle"]');
  await toggle.click();
  await expect(page.locator('[data-hud="aidLegend"]')).toBeVisible();
  await expect(splitBar(page)).toHaveAttribute('hidden', '');
  await expect(handle(page)).toBeHidden();

  await toggle.click();
  await expect(page.locator('[data-hud="aidLegend"]')).toBeHidden();
  await expect(handle(page)).toBeVisible();
  await expect(handle(page)).toHaveAttribute('aria-valuemin', min ?? '');
  await expect(handle(page)).toHaveAttribute('aria-valuemax', max ?? '');
});

for (const { locale } of locales) {
  test(`a wrapped view control rounds the ends of each row at ${locale} 740x649`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale, viewport: { width: 740, height: 649 } });
    try {
      const page = await context.newPage();
      await page.goto('./');
      await page.locator('[data-menu="yards"] .menu-start').first().click();
      await expect(page.locator('.ctl-wheel')).toBeVisible();
      await expect(page.locator('.hud-segment').last()).toBeVisible();
      await settled(page);
      const segmentRows = () =>
        page.locator('.hud-segment').evaluateAll((els) => {
          const byRow = new Map<number, { left: string[]; right: string[] }[]>();
          for (const el of els) {
            const style = getComputedStyle(el);
            const top = el.getBoundingClientRect().top;
            const row = byRow.get(top) ?? [];
            row.push({
              left: [style.borderTopLeftRadius, style.borderBottomLeftRadius],
              right: [style.borderTopRightRadius, style.borderBottomRightRadius],
            });
            byRow.set(top, row);
          }
          return [...byRow.values()];
        });
      const expectEndsRounded = (rows: Awaited<ReturnType<typeof segmentRows>>) => {
        for (const row of rows) {
          row.forEach((seg, i) => {
            const round = (corners: string[], rounded: boolean) =>
              expect(corners.every((c) => parseFloat(c) > 0) === rounded).toBe(true);
            round(seg.left, i === 0);
            round(seg.right, i === row.length - 1);
          });
        }
      };
      const wrapped = await segmentRows();
      expect(wrapped.length, 'the view control wraps').toBeGreaterThan(1);
      expectEndsRounded(wrapped);
      // The rows re-sync on a live resize, not only at the first layout.
      await page.setViewportSize({ width: 1280, height: 649 });
      await expect.poll(async () => (await segmentRows()).length).toBe(1);
      expectEndsRounded(await segmentRows());
    } finally {
      await context.close();
    }
  });
}

test('folding and unfolding a panel re-measures the divider against the panels', async ({
  page,
}) => {
  // Short enough that the unfolded aids panel leaves no room for the divider, the folded one does.
  const size = { width: 1024, height: 560 };
  await page.setViewportSize(size);
  await startStraightReverse(page, en.exerciseStraightReverse);
  await expect(splitBar(page)).toHaveAttribute('hidden', '');

  const aids = page.locator('[data-panel="aids"]');
  await expect(aids).toHaveAttribute('aria-expanded', 'true');
  await aids.click();
  await expect(aids).toHaveAttribute('aria-expanded', 'false');
  await expect(handle(page)).toBeVisible();
  await expectDividerClearOrHidden(page, size);

  // The folded state is stored: the next run starts with the aids panel folded and the divider in place.
  await startStraightReverse(page, en.exerciseStraightReverse);
  await expect(aids).toHaveAttribute('aria-expanded', 'false');
  await expect(handle(page)).toBeVisible();
  await aids.click();
  await expect(aids).toHaveAttribute('aria-expanded', 'true');
  await expect(splitBar(page)).toHaveAttribute('hidden', '');
  await expectDividerClearOrHidden(page, size);

  // The angle readouts show only with the angle display aid, so their chip waits for it.
  const gauges = page.locator('[data-panel="gauges"]');
  const pivots = page.locator('[data-aid="pivots"]');
  await expect(gauges).toHaveAttribute('aria-expanded', 'true');
  await pivots.click();
  await expect(gauges).toBeDisabled();
  await expect(gauges).toHaveAttribute('aria-expanded', 'false');
  await pivots.click();
  await expect(gauges).toBeEnabled();
  await expect(gauges).toHaveAttribute('aria-expanded', 'true');
});

test('toggling the pivots aid re-measures the divider against the panels', async ({ page }) => {
  // The pivots aid shows the gauge panel: with it the divider has no room here, without it it does.
  const size = { width: 1024, height: 560 };
  await page.setViewportSize(size);
  await startStraightReverse(page, en.exerciseStraightReverse);
  const pivots = page.locator('[data-aid="pivots"]');
  await expect(pivots).toHaveAttribute('aria-pressed', 'true');
  await expect(splitBar(page)).toHaveAttribute('hidden', '');

  await pivots.click();
  await expect(pivots).toHaveAttribute('aria-pressed', 'false');
  await expect(handle(page)).toBeVisible();
  await expectDividerClearOrHidden(page, size);

  await pivots.click();
  await expect(pivots).toHaveAttribute('aria-pressed', 'true');
  await expect(splitBar(page)).toHaveAttribute('hidden', '');
  await expectDividerClearOrHidden(page, size);
});

test('dragging the divider resizes the top view, persists, and resets', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startStraightReverse(page, en.exerciseStraightReverse);
  const topLeft = async () => (await boxes(page.locator('.hud-topdown')))[0]?.left ?? 0;
  const defaultLeft = await topLeft();
  expect(defaultLeft).toBe(768);
  const reset = page.locator('[data-hud="splitReset"]');
  await expect(reset).toBeDisabled();

  const b = await handle(page).boundingBox();
  if (b === null) throw new Error('divider has no box');
  expect(b.width).toBeGreaterThanOrEqual(44);
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 120, y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(topLeft).toBeCloseTo(defaultLeft - 120, -1);
  // A dragged divider gives focus back, so the arrow keys steer again.
  await expect(handle(page)).not.toBeFocused();
  await expect(reset).toBeEnabled();

  // Stored per orientation, so the next run starts with the same split.
  await page.reload();
  await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
  await hudReady(page, { exact: false });
  await expect.poll(topLeft).toBeCloseTo(defaultLeft - 120, -1);

  await page.locator('[data-hud="splitReset"]').click();
  await expect.poll(topLeft).toBe(defaultLeft);
  await expect(page.locator('[data-hud="splitReset"]')).toBeDisabled();

  await handle(page).focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(topLeft).toBeLessThan(defaultLeft);
  await page.keyboard.press('KeyL');
  await expect.poll(topLeft).toBe(defaultLeft);
  // Nothing to reset: the shortcut does nothing.
  await page.keyboard.press('KeyL');
  await settled(page);
  expect(await topLeft()).toBe(defaultLeft);
});

test('rotating mid-drag cancels it, and the divider works again afterwards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startStraightReverse(page, en.exerciseStraightReverse);
  const topLeft = async () => (await boxes(page.locator('.hud-topdown')))[0]?.left ?? 0;
  const defaultLeft = await topLeft();
  const b = await handle(page).boundingBox();
  if (b === null) throw new Error('divider has no box');
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 120, y, { steps: 6 });
  await expect.poll(topLeft).toBeLessThan(defaultLeft);

  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(handle(page)).toHaveAttribute('aria-orientation', 'horizontal');
  await page.mouse.up();

  // The portrait divider takes a fresh drag, which an orphaned one would have swallowed.
  const bottom = async () => (await boxes(page.locator('.hud-topdown')))[0]?.bottom ?? 0;
  const before = await bottom();
  const p = await handle(page).boundingBox();
  if (p === null) throw new Error('divider has no box');
  const px = p.x + p.width / 2;
  const py = p.y + p.height / 2;
  await page.mouse.move(px, py);
  await page.mouse.down();
  await page.mouse.move(px, py - 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(bottom).toBeLessThan(before);

  // The cancelled landscape drag was not stored.
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(topLeft).toBe(defaultLeft);
});

test('the divider is keyboard-operable and exposes its value', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startStraightReverse(page, en.exerciseStraightReverse);
  const sep = handle(page);
  await expect(sep).toHaveAttribute('role', 'separator');
  await expect(sep).toHaveAttribute('aria-orientation', 'vertical');
  await expect(sep).toHaveAttribute('aria-valuenow', '40');
  const min = Number(await sep.getAttribute('aria-valuemin'));
  const max = Number(await sep.getAttribute('aria-valuemax'));
  expect(min).toBeLessThan(max);
  await sep.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(sep).toHaveAttribute('aria-valuenow', '42');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(sep).toHaveAttribute('aria-valuenow', '38');
  await page.keyboard.press('End');
  await expect(sep).toHaveAttribute('aria-valuenow', String(max));
  await page.keyboard.press('Home');
  await expect(sep).toHaveAttribute('aria-valuenow', String(min));
});

test('the divider runs across the screen in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await startStraightReverse(page, en.exerciseStraightReverse);
  const sep = handle(page);
  await expect(sep).toHaveAttribute('aria-orientation', 'horizontal');
  const bottom = async () => (await boxes(page.locator('.hud-topdown')))[0]?.bottom ?? 0;
  const before = await bottom();
  await sep.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(bottom).toBeLessThan(before);
  await page.keyboard.press('Home');
  await settled(page);
  const mirrors = await boxes(page.locator('.hud-mirror:not([hidden])'));
  const divider = await boxes(page.locator('.hud-split-handle, .hud-split-reset'));
  for (const m of mirrors) {
    for (const d of divider) expect(overlaps(m, d), `${d.name} overlaps a mirror`).toBe(false);
  }
});

/** Where the class V mirror shows: wide and tall screens, the key legend open or folded away. */
const closeScreens = [
  { size: { width: 1920, height: 1080 }, folded: false },
  { size: { width: 1920, height: 1080 }, folded: true },
  { size: { width: 1080, height: 1920 }, folded: false },
];

for (const { size, folded } of closeScreens) {
  test(
    `the class V mirror sits above the right class II mirror at ${size.width}x${size.height} with the legend ${folded ? 'folded' : 'open'}, with the messages clear`,
    heavyAt('balanced'),
    async ({ browser }) => {
      test.slow();
      const context = await browser.newContext({ locale: 'en-US', viewport: size });
      try {
        const page = await context.newPage();
        await startStraightReverse(page, en.exerciseStraightReverse);
        if (folded) {
          const toggle = page.locator('[data-hud="keysToggle"]');
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-expanded', 'false');
          await expect(page.locator('.hud-legend dl')).toBeHidden();
          await hudReady(page);
        }
        const close = page.locator('[data-hud="close"]:not([hidden])');
        await expect(close).toHaveCount(1);
        const [closeBox] = await boxes(close);
        const [rightBox] = await boxes(page.locator('[data-hud="mirrorRight"]'));
        if (closeBox === undefined || rightBox === undefined) throw new Error('mirrors');
        expect(closeBox.right, 'right-aligned with class II').toBeCloseTo(rightBox.right, 0);
        expect(closeBox.bottom, 'above class II').toBeLessThanOrEqual(rightBox.top);
        await expectMirrorsClearControls(page, size);
        await expectMessagesClear(page, en.blockedTurntable, en.goalInside);
      } finally {
        await context.close();
      }
    },
  );
}

test('a short portrait cockpit keeps the messages clear of the open key legend', async ({
  page,
}) => {
  const size = { width: 840, height: 841 };
  await page.setViewportSize(size);
  await startStraightReverse(page, en.exerciseStraightReverse);
  const toggle = page.locator('[data-hud="keysToggle"]');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.hud-legend dt.hud-legend-view').first()).toBeVisible();
  await settled(page);
  await expectMessagesClear(page, en.blockedTurntable, en.goalInside);
});

/** Laptop viewports too small to leave class V room above class II. */
for (const size of [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1536, height: 729 },
]) {
  test(`there is no class V mirror at ${size.width}x${size.height}`, async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US', viewport: size });
    try {
      const page = await context.newPage();
      await startStraightReverse(page, en.exerciseStraightReverse);
      await expect(page.locator('[data-hud="close"]')).toBeHidden();
      await expect(page.locator('[data-hud="close"]:not([hidden])')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
}

/** Laptop viewports where class IV shows beside the key legend as it opens; 1440x739 is the first of the tall ones to lose it if the legend grows. */
const laptops: { size: Size; locale: string; messages: typeof en | typeof de }[] = [
  ...[
    { width: 1536, height: 729 },
    { width: 1440, height: 765 },
    { width: 1470, height: 832 },
    { width: 1512, height: 788 },
    { width: 1280, height: 585 },
    { width: 1280, height: 739 },
    { width: 1280, height: 740 },
  ].flatMap((size) => locales.map((l) => ({ size, ...l }))),
  { size: { width: 1440, height: 739 }, locale: 'de-DE', messages: de },
];

for (const { size, locale, messages } of laptops) {
  test(`the class IV mirrors show beside the key legend at ${locale} ${size.width}x${size.height}`, async ({
    browser,
  }) => {
    test.slow();
    const context = await browser.newContext({ locale, viewport: size });
    try {
      const page = await context.newPage();
      await startStraightReverse(page, messages.exerciseStraightReverse);
      await expect(page.locator('[data-hud^="wide"]:not([hidden])')).toHaveCount(2);
      await expectMirrorsClearControls(page, size);
      await expectMessagesClear(page, messages.blockedTurntable, messages.goalInside);
    } finally {
      await context.close();
    }
  });
}

// Look-around is offered on High only, so its legend row is one line taller there than at the default preset.
for (const { size, locale, messages } of [
  { size: { width: 1440, height: 739 }, locale: 'de-DE', messages: de },
  { size: { width: 1536, height: 729 }, locale: 'en-US', messages: en },
]) {
  test(`the class IV mirrors show beside the legend with its look-around row on High at ${locale} ${size.width}x${size.height}`, async ({
    browser,
  }) => {
    test.slow();
    const context = await browser.newContext({ locale, viewport: size });
    try {
      const page = await context.newPage();
      await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
        SETTINGS_KEY,
        JSON.stringify({ version: 1, graphics: 'high' }),
      ] as const);
      await startStraightReverse(page, messages.exerciseStraightReverse);
      await expect(page.locator('.hud-legend')).toContainText(messages.lookAround);
      await expect(page.locator('[data-hud^="wide"]:not([hidden])')).toHaveCount(2);
      await expectMirrorsClearControls(page, size);
      await expectMessagesClear(page, messages.blockedTurntable, messages.goalInside);
    } finally {
      await context.close();
    }
  });
}

test('the wide-angle mirrors setting hides class IV, gives class II its full size and persists', async ({
  browser,
}) => {
  test.slow();
  const size = { width: 1536, height: 729 };
  const context = await browser.newContext({ locale: 'en-US', viewport: size });
  try {
    const page = await context.newPage();
    const wide = page.locator('[data-hud^="wide"]:not([hidden])');
    const left = async () => {
      const [b] = await boxes(page.locator('[data-hud="mirrorLeft"]'));
      return b === undefined ? undefined : { width: b.right - b.left, height: b.bottom - b.top };
    };
    const setting = page.locator('[data-menu="wideMirrors"]');

    await startStraightReverse(page, en.exerciseStraightReverse);
    await expect(wide).toHaveCount(2);
    const withWide = await left();

    await page.goto('./');
    await setting.selectOption('off');
    await page.reload();
    await expect(setting).toHaveValue('off');
    await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
    await hudReady(page);
    await expect(wide).toHaveCount(0);
    const plain = (await expectedViews(page, NO_INSETS, false)).mirrorLeft;
    const without = await left();
    if (plain === null || withWide === undefined || without === undefined)
      throw new Error('mirror');
    expect(Math.abs(without.width - plain.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(without.height - plain.height)).toBeLessThanOrEqual(1);
    expect(without.height).toBeGreaterThan(withWide.height);

    await page.goto('./');
    await setting.selectOption('on');
    await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
    await hudReady(page);
    await expect(wide).toHaveCount(2);
  } finally {
    await context.close();
  }
});
