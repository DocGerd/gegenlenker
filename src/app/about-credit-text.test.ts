import { describe, expect, it } from 'vitest';
import { de } from '../i18n/de';
import { en } from '../i18n/en';
import { assetAuthors, assetKindLabel } from './about-credit-text';
import { ABOUT_CREDITS } from './about-credits';

const english = (key: keyof typeof en): string => en[key];
const german = (key: keyof typeof de): string => de[key];

const words = (text: string): string[] => text.split(/[\s,():]+/).filter(Boolean);

describe('asset credit text', () => {
  it('spells the sky credit out in the UI language, keeping names and host', () => {
    const sky = ABOUT_CREDITS.assets.find(({ kind }) => kind === 'sky');
    if (sky === undefined) throw new Error('the credits list no sky');
    expect(assetAuthors(sky, english)).toBe(
      'Greg Zaal (original) and Jarod Guest (sky edits), Poly Haven',
    );
    expect(assetAuthors(sky, german)).toBe(
      'Greg Zaal (Original) und Jarod Guest (Himmelsbearbeitung), Poly Haven',
    );
  });

  it('names a credit without people by its host', () => {
    expect(assetAuthors({ people: [], host: 'ambientCG' }, german)).toBe('ambientCG');
  });

  it('leaves no English label word in any German credit', () => {
    const labels = (get: (key: keyof typeof en) => string): string[] =>
      ABOUT_CREDITS.assets.flatMap((credit) => [
        assetKindLabel(credit.kind, get),
        assetAuthors(credit, get),
      ]);
    const germanWords = new Set(labels(german).flatMap(words));
    const names = new Set(
      ABOUT_CREDITS.assets.flatMap(({ people, host }) => [
        ...words(host),
        ...people.flatMap(({ name }) => words(name)),
      ]),
    );
    for (const word of labels(english).flatMap(words))
      if (!names.has(word)) expect(germanWords).not.toContain(word);
  });
});
