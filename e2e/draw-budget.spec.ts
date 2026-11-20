import { expect, test } from './fixtures';
import { en } from '../src/i18n/en';
import { DRAW_CALL_BUDGET, QUALITY_FLAGS } from '../src/render/quality';
import { drawnBackend, parseOverlay } from './perf/tablet-logic';
import { type Preset, settle, startPinnedDrive } from './pinned-shoot';
import { collectThreeProblems } from './three-problems';

const PRESETS: readonly Preset[] = ['low', 'balanced', 'high'];
const VIEWS = [
  { view: 'follow', key: 'f' },
  { view: 'yard', key: 'y' },
  { view: 'chase', key: 'o' },
] as const;
/** Longer than the overlay's refresh interval, with frames in between. */
const PAST_REFRESH_MS = 500;

test('every view stays within the draw-call budget at every preset', async ({ context }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  const threeProblems: string[] = [];
  const over: string[] = [];
  for (const preset of PRESETS) {
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    const three = collectThreeProblems(page);
    await startPinnedDrive(page, preset, en.exerciseStraightReverse, '?perf=1');
    for (const { view, key } of VIEWS) {
      if (view === 'chase' && !QUALITY_FLAGS[preset].chaseView) continue;
      await page.keyboard.press(key);
      await expect(page.locator(`[data-view="${view}"]`)).toHaveAttribute('aria-pressed', 'true');
      await settle(page, preset);
      await page.clock.runFor(PAST_REFRESH_MS);
      const text = await page.locator('div.mono', { hasText: /calls \d+/ }).textContent();
      const reading = parseOverlay(text ?? '');
      if (reading === null) throw new Error(`${preset} ${view}: no overlay reading`);
      expect(drawnBackend(reading.gl), `${preset} ${view} backend`).toBe('webgl2');
      const { calls } = reading;
      expect(calls, `${preset} ${view} drew nothing`).toBeGreaterThan(0);
      expect(reading.shadow, `${preset} ${view} shadow passes`).toBe(preset === 'high' ? 1 : 0);
      if (calls > DRAW_CALL_BUDGET) over.push(`${preset} ${view}: ${calls}`);
    }
    threeProblems.push(...three);
    await page.close();
  }
  expect(over, `draw calls over ${DRAW_CALL_BUDGET}`).toEqual([]);
  expect(errors).toEqual([]);
  expect(threeProblems).toEqual([]);
});
