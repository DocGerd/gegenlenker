import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { COCKPIT_FOV, coneEdge, coneTop } from '../src/render/cockpit-band';
import { QUALITY_FLAGS } from '../src/render/quality';
import { computeViewports, NO_INSETS, type Insets } from '../src/render/viewports';

type Size = { width: number; height: number };

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
 * mirrors under them and the front mirror where `computeViewports` finds room for them, given the key
 * legend as the page measured it.
 */
async function expectedMirrors(page: Page, insets: Insets): Promise<number> {
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
  const { front, wideLeft } = computeViewports(
    size.width,
    size.height,
    'drive',
    legend,
    insets,
    undefined,
    null,
    {
      front: QUALITY_FLAGS.balanced.frontMirror,
      wide: QUALITY_FLAGS.balanced.wideMirrors,
    },
  );
  return 2 + (wideLeft === null ? 0 : 2) + (front === null ? 0 : 1);
}

/**
 * Waits until the HUD, gauges and controls are laid out, so measuring never sees an empty set. With
 * `exact` the mirrors shown are those the default layout gives at this size: a missing front mirror fails.
 */
async function hudReady(
  page: Page,
  { insets = NO_INSETS, exact = true }: { insets?: Insets; exact?: boolean } = {},
): Promise<void> {
  const shown = () => page.locator('.hud-mirror:not([hidden])').count();
  if (exact)
    await expect.poll(async () => (await shown()) - (await expectedMirrors(page, insets))).toBe(0);
  else await expect.poll(shown).toBeGreaterThanOrEqual(2);
  const gauges = page.locator('.hud-gauge');
  await expect(gauges).toHaveCount(2);
  await expect(gauges.first()).toBeVisible();
  await expect(gauges.last()).toBeVisible();
  await expect(page.locator('.hud-counters')).toBeVisible();
  await expect(page.locator('.hud-action')).toBeVisible();
  await expect(page.locator('.ctl-wheel')).toBeVisible();
  await expect(page.locator('.ctl-lever')).toBeVisible();
  await expect(page.locator('.ctl-lamp')).toHaveCount(2);
  await expect(page.locator('.ctl-lamp').first()).toBeVisible();
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

  // Each class IV mirror hangs from the arm of the class II mirror above it: its arm reaches up into that mirror's span.
  const wide = page.locator('[data-hud^="wide"]:not([hidden])');
  const wideBoxes = await boxes(wide);
  if (wideBoxes.length > 0) {
    // `hudReady` pinned the count against the layout, so a missing mirror has failed already
    expect(wideBoxes).toHaveLength(2);
    const stems = await wide.evaluateAll((els) =>
      els.map((el) => Math.max(0, -parseFloat(getComputedStyle(el, '::before').top))),
    );
    wideBoxes.forEach((box, i) => {
      const above = i === 0 ? leftBox : rightBox;
      const top = box.top - (stems[i] ?? 0);
      expect(stems[i], 'class IV arm is drawn').toBeGreaterThan(0);
      expect(top, 'class IV arm reaches the class II arm').toBeGreaterThanOrEqual(above.top);
      expect(top, 'class IV arm reaches the class II arm').toBeLessThan(above.bottom);
    });
  }

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

/** The cockpit pane is drawn from the first row down, once a frame has landed. */
async function expectNoBlankBand(page: Page, size: Size): Promise<void> {
  await settled(page);
  await expect.poll(() => blankRows(page, Math.round(size.width * 0.3))).toBe(0);
}

const insets = { top: 24, left: 48, bottom: 20, right: 48 };

const insetSizes = [
  { width: 1280, height: 720 },
  { width: 1024, height: 600 },
  { width: 900, height: 649 },
  { width: 768, height: 1024 },
];

for (const size of insetSizes) {
  test(`the drive screen stays inside the safe area at ${size.width}x${size.height}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ locale: 'en-US', viewport: size });
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
    await page.getByRole('button', { name: en.exerciseStraightReverse }).click();
    await hudReady(page, { insets });

    const placed = await boxes(
      page.locator(
        [
          '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever',
          '.hud-action, .hud-goal:not([hidden]), .hud-gauge, .hud-counters, .hud-legend',
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
    await context.close();
  });
}

const starts = [
  { name: 'exercise', label: en.exerciseStraightReverse },
  { name: 'yard', label: en.layoutDepot },
];

for (const start of starts) {
  test(`the ${start.name} top view stays compact at 1366x768`, async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('./');
    await page.getByRole('button', { name: start.label }).click();

    const buttons = page.locator('.hud-toolbar button');
    await expect(buttons.first()).toBeVisible();
    const rows = new Set((await boxes(buttons)).map((b) => Math.round(b.top)));
    expect(rows.size).toBeLessThanOrEqual(2);

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

const handle = (page: Page) => page.locator('[data-hud="splitHandle"]');
const splitBar = (page: Page) => page.locator('[data-hud="split"]');

/** A short landscape screen: no panel row fits above the divider. */
const shortLandscape = { width: 844, height: 390 };
const splitSizes = [...sizes, shortLandscape];

/** Two animation frames: the legend's resize observer re-lays out after the first one. */
const settled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

async function startStraightReverse(page: Page, label: string): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: label }).click();
  await hudReady(page);
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
        '.hud-goal:not([hidden]), .hud-gauge, .hud-counters, .hud-action, .hud-toolbar .hud-toggle',
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

/** Screen height below which the toast and the goal cue cannot clear the gear column. */
const CRAMPED_HEIGHT = 420;

/**
 * The longest toast and a goal cue: no word sticks out of its box, and neither touches the controls
 * or the forward sight cone. With the front mirror they also keep clear of the cockpit label and every
 * mirror; without it they span the cockpit, as before it existed.
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
  const overflow = await page
    .locator('[data-hud="toast"], [data-hud="goalCue"]')
    .evaluateAll((els) => els.map((el) => el.scrollWidth - el.clientWidth));
  expect(overflow, 'a word sticks out of a message').toEqual([0, 0]);
  const messages = await boxes(page.locator('[data-hud="toast"], [data-hud="goalCue"]'));
  expect(messages).toHaveLength(2);
  const controls = await boxes(
    page.locator(
      '.ctl-wheel, .ctl-reset, .ctl-label, .ctl-gears, .ctl-lamp, .ctl-stop, .ctl-lever, .hud-legend, .hud-gear, .hud-speed',
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
  const mirrors = frontShown
    ? await boxes(page.locator('.hud-cockpit > .hud-view-label, .hud-mirror:not([hidden])'))
    : [];
  if (frontShown) expect(mirrors.length).toBeGreaterThanOrEqual(4);
  // On a screen this short even one toast line and the cue reach the gear column, as before the front
  // mirror: the rule drops the mirror there, and only the fit is asserted.
  const cramped = !frontShown && (page.viewportSize()?.height ?? Infinity) < CRAMPED_HEIGHT;
  for (const m of messages) {
    for (const o of cramped ? [] : [...controls, cone, ...mirrors]) {
      expect(overlaps(m, o), `${m.name} overlaps ${o.name}`).toBe(false);
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
        // The short landscape size has no mirror or blank-band check, only the messages and the divider.
        if (size !== shortLandscape) {
          await test.step('mirrors clear the controls', () =>
            expectMirrorsClearControls(page, size));
          await test.step('the cockpit view has no blank band', () =>
            expectNoBlankBand(page, size));
        }
        await test.step('the longest toast and the goal cue fit and keep clear of the controls and the mirrors', () =>
          expectMessagesClear(page, messages.blockedTurntable, messages.goalInside));
        // Last: the divider moves the stored split.
        await test.step('the divider at its smallest and largest share clears the cockpit and the panels', () =>
          expectDividerClears(page, size));
      } finally {
        await context.close();
      }
    });
  }
}

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
  // The tallest landscape screen here where the opened legend no longer leaves room for the divider.
  const size = { width: 1280, height: 600 };
  await page.setViewportSize(size);
  await startStraightReverse(page, en.exerciseStraightReverse);
  await expect(handle(page)).toBeVisible();
  const min = await handle(page).getAttribute('aria-valuemin');
  const max = await handle(page).getAttribute('aria-valuemax');
  expect(min).not.toBe(max);

  const toggle = page.locator('[data-hud="aidLegendToggle"]');
  await toggle.click();
  await expect(page.locator('[data-hud="aidLegend"]')).toBeVisible();
  // The opened legend leaves the divider no room here.
  await expect(splitBar(page)).toHaveAttribute('hidden', '');
  await expect(handle(page)).toBeHidden();

  await toggle.click();
  await expect(page.locator('[data-hud="aidLegend"]')).toBeHidden();
  await expect(handle(page)).toBeVisible();
  await expect(handle(page)).toHaveAttribute('aria-valuemin', min ?? '');
  await expect(handle(page)).toHaveAttribute('aria-valuemax', max ?? '');
});

test('folding and unfolding a panel re-measures the divider against the panels', async ({
  page,
}) => {
  // Short enough that the unfolded aids panel leaves no room for the divider, the folded one does.
  const size = { width: 1024, height: 560 };
  await page.setViewportSize(size);
  await startStraightReverse(page, en.exerciseStraightReverse);
  await expect(splitBar(page)).toHaveAttribute('hidden', '');

  const aids = page.locator('[data-panel="aids"]');
  await expect(aids).toHaveAttribute('aria-pressed', 'true');
  await aids.click();
  await expect(aids).toHaveAttribute('aria-pressed', 'false');
  await expect(handle(page)).toBeVisible();
  await expectDividerClearOrHidden(page, size);

  // The folded state is stored: the next run starts with the aids panel folded and the divider in place.
  await startStraightReverse(page, en.exerciseStraightReverse);
  await expect(aids).toHaveAttribute('aria-pressed', 'false');
  await expect(handle(page)).toBeVisible();
  await aids.click();
  await expect(aids).toHaveAttribute('aria-pressed', 'true');
  await expect(splitBar(page)).toHaveAttribute('hidden', '');
  await expectDividerClearOrHidden(page, size);
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
