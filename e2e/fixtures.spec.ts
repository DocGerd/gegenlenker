import { expect, test } from './fixtures';

test.describe('the console guard fails a test on', () => {
  test.fail();

  test('a console error', async ({ page }) => {
    await page.evaluate(() => {
      console.error('boom');
    });
  });

  test('a THREE warning in a context the test created', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.evaluate(() => {
      console.warn('THREE.TSL: x');
    });
    await context.close();
  });
});

test('the guard leaves allowed and non-THREE messages alone', async ({ page, allow }) => {
  allow(/^expected/);
  await page.evaluate(() => {
    console.error('expected failure');
    console.warn('plain warning');
  });
  expect(page.url()).toBe('about:blank');
});
