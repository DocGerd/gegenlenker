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

const menu = (page: Page): Locator => page.locator('main.menu');

/** Today's page is its own setup: it is open once `main.menu` shows the entry's control. */
export async function openSetup(page: Page, messages: Messages, entry: MenuEntry): Promise<void> {
  await menu(page).waitFor();
  await startControl(page, messages, entry).waitFor();
}

export function startControl(page: Page, messages: Messages, entry: MenuEntry): Locator {
  const name = entryName(messages, entry).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return menu(page).getByRole('button', { name: new RegExp(`^${name}`) });
}

export function setupBests(page: Page, messages: Messages, entry: MenuEntry): Locator {
  return startControl(page, messages, entry);
}

const option = (page: Page, name: string): Locator => page.locator(`[data-menu="${name}"]`);

async function choose(page: Page, name: string, value: string): Promise<void> {
  await option(page, name).selectOption(value);
}

async function read(page: Page, name: string): Promise<string> {
  return option(page, name).inputValue();
}

export async function chooseRunOption<K extends keyof RunOptions>(
  page: Page,
  _messages: Messages,
  name: K,
  value: RunOptions[K],
): Promise<void> {
  await choose(page, name, value);
}

export async function runOptionValue(
  page: Page,
  _messages: Messages,
  name: keyof RunOptions,
): Promise<string> {
  return read(page, name);
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
  await choose(page, name, value);
  if (name === 'language' && (await pageMessages(page)) !== catalogue(value))
    throw new Error(`language did not switch to ${value}`);
}

export async function settingValue(
  page: Page,
  _messages: Messages,
  name: keyof SettingOptions,
): Promise<string> {
  return read(page, name);
}

/**
 * Returns only once the title shows AND `history.state` is null (a screen's entry is gone); keep both in any reimplementation.
 * Polls from Node: the pinned clock freezes `requestAnimationFrame`, so an in-page wait never fires.
 */
export async function toTitle(page: Page, messages: Messages): Promise<void> {
  await page.getByRole('heading', { name: messages.appName }).waitFor();
  const deadline = Date.now() + TITLE_TIMEOUT_MS;
  while (await page.evaluate(() => history.state !== null)) {
    if (Date.now() > deadline) throw new Error('history entry of a screen outlived the title');
    await new Promise<void>((resolve) => setTimeout(resolve, TITLE_POLL_MS));
  }
}
