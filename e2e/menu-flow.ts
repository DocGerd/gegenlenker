import type { Locator, Page } from '@playwright/test';
import type { ExerciseId } from '../src/contracts/exercise.ts';
import type { LayoutId } from '../src/contracts/layout.ts';
import type { GraphicsPreset, LightingMode } from '../src/contracts/render.ts';
import type { TrailerId, TruckId } from '../src/contracts/vehicle.ts';
import { EXERCISE_TITLE, LAYOUT_NAME } from '../src/app/entry-keys.ts';
import { de } from '../src/i18n/de.ts';
import { en, type MessageKey } from '../src/i18n/en.ts';
import type { Lang } from '../src/i18n/i18n.ts';

// Node loads this by type stripping (`scripts/shoot-views.mjs`): runtime imports carry `.ts`, reach
// modules without runtime imports, and use no `expect` or enum.

export type Messages = Readonly<Record<MessageKey, string>>;
export type MenuEntry =
  | { readonly kind: 'exercise'; readonly id: ExerciseId }
  | { readonly kind: 'yard'; readonly id: LayoutId };
export type RunOptions = {
  readonly truck: TruckId;
  readonly trailer: TrailerId;
  readonly lighting: LightingMode;
  readonly driveView: 'standard' | 'mirrors';
};
export type SettingOptions = {
  readonly language: Lang;
  readonly theme: 'system' | 'light' | 'dark';
  readonly graphics: GraphicsPreset;
  readonly wideMirrors: 'on' | 'off';
};

const TITLE_TIMEOUT_MS = 10_000;
const TITLE_POLL_MS = 50;

export const exerciseEntry = (id: ExerciseId): MenuEntry => ({ kind: 'exercise', id });
export const yardEntry = (id: LayoutId): MenuEntry => ({ kind: 'yard', id });

export function entryName(messages: Messages, entry: MenuEntry): string {
  return messages[entry.kind === 'exercise' ? EXERCISE_TITLE[entry.id] : LAYOUT_NAME[entry.id]];
}

const catalogue = (lang: string | null): Messages => (lang === 'de' ? de : en);

export async function pageMessages(page: Page): Promise<Messages> {
  return catalogue(await page.locator('html').getAttribute('lang'));
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const screen = (page: Page, id: string): Locator => page.locator(`[data-screen="${id}"]`);

const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Walks from wherever the menu is, through the title and the entry's list, to its setup. */
export async function openSetup(page: Page, messages: Messages, entry: MenuEntry): Promise<void> {
  await toTitle(page, messages);
  const [item, list] =
    entry.kind === 'exercise'
      ? (['exercises', 'exercises'] as const)
      : (['freeYard', 'yards'] as const);
  await screen(page, 'title').getByRole('button', { name: messages[item], exact: true }).click();
  const name = new RegExp(`^${escapeRegExp(entryName(messages, entry))}`);
  await screen(page, list).getByRole('button', { name }).click();
  await startControl(page, messages, entry).waitFor();
}

/** The setup screen, only while it shows `entry`: its heading ends with the entry's name. */
const setupOf = (page: Page, messages: Messages, entry: MenuEntry): Locator =>
  screen(page, 'setup').filter({
    has: page.getByRole('heading', {
      level: 1,
      name: new RegExp(`${escapeRegExp(entryName(messages, entry))}$`),
    }),
  });

export function startControl(page: Page, messages: Messages, entry: MenuEntry): Locator {
  return setupOf(page, messages, entry).getByRole('button', { name: messages.start, exact: true });
}

export function setupBests(page: Page, messages: Messages, entry: MenuEntry): Locator {
  return setupOf(page, messages, entry).locator('[data-menu="bests"]');
}

const radioGroup = (scope: Locator, messages: Messages, name: MessageKey): Locator =>
  scope.getByRole('radiogroup', { name: messages[name], exact: true });

async function choose(scope: Locator, messages: Messages, name: MessageKey, value: string) {
  await radioGroup(scope, messages, name).locator(`input[value="${value}"]`).check();
}

async function read(scope: Locator, messages: Messages, name: MessageKey): Promise<string> {
  return radioGroup(scope, messages, name).locator('input:checked').inputValue();
}

// Settings still render as selects until their screen lands.
const legacyOption = (page: Page, name: string): Locator => page.locator(`[data-menu="${name}"]`);

export async function chooseRunOption<K extends keyof RunOptions>(
  page: Page,
  messages: Messages,
  name: K,
  value: RunOptions[K],
): Promise<void> {
  await choose(screen(page, 'setup'), messages, name, value);
}

export async function runOptionValue(
  page: Page,
  messages: Messages,
  name: keyof RunOptions,
): Promise<string> {
  return read(screen(page, 'setup'), messages, name);
}

export async function startEntry(
  page: Page,
  messages: Messages,
  entry: MenuEntry,
  options: Partial<RunOptions> = {},
): Promise<void> {
  await openSetup(page, messages, entry);
  if (options.truck !== undefined) await chooseRunOption(page, messages, 'truck', options.truck);
  if (options.trailer !== undefined)
    await chooseRunOption(page, messages, 'trailer', options.trailer);
  if (options.lighting !== undefined)
    await chooseRunOption(page, messages, 'lighting', options.lighting);
  if (options.driveView !== undefined)
    await chooseRunOption(page, messages, 'driveView', options.driveView);
  await startControl(page, messages, entry).click();
}

export const startExercise = (
  page: Page,
  messages: Messages,
  id: ExerciseId,
  options?: Partial<RunOptions>,
): Promise<void> => startEntry(page, messages, exerciseEntry(id), options);

export const startYard = (
  page: Page,
  messages: Messages,
  id: LayoutId,
  options?: Partial<RunOptions>,
): Promise<void> => startEntry(page, messages, yardEntry(id), options);

/** A language change swaps the catalogue: callers re-fetch `pageMessages` afterwards. */
export async function chooseSetting<K extends keyof SettingOptions>(
  page: Page,
  _messages: Messages,
  name: K,
  value: SettingOptions[K],
): Promise<void> {
  await legacyOption(page, name).selectOption(value);
  if (name === 'language' && (await pageMessages(page)) !== catalogue(value))
    throw new Error(`language did not switch to ${value}`);
}

export async function settingValue(
  page: Page,
  _messages: Messages,
  name: keyof SettingOptions,
): Promise<string> {
  return legacyOption(page, name).inputValue();
}

/**
 * Returns only once the title shows AND `history.state` is null (a screen's entry is gone); keep both in any reimplementation.
 * Polls from Node: the pinned clock freezes `requestAnimationFrame`, so an in-page wait never fires.
 */
export async function toTitle(page: Page, messages: Messages): Promise<void> {
  const deadline = Date.now() + TITLE_TIMEOUT_MS;
  const title = screen(page, 'title').getByRole('heading', { level: 1, name: messages.appName });
  // Escape goes up one level on a menu screen only: a drive, pause sheet or result takes it for itself.
  const away = page.locator('[data-screen]:not([data-screen="title"])');
  while (!(await title.isVisible())) {
    if (Date.now() > deadline) throw new Error('the title did not show');
    if (await away.isVisible()) await page.keyboard.press('Escape');
    else await sleep(TITLE_POLL_MS);
  }
  while (await page.evaluate(() => history.state !== null)) {
    if (Date.now() > deadline) throw new Error('history entry of a screen outlived the title');
    await sleep(TITLE_POLL_MS);
  }
}
