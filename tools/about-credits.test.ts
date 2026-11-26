import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABOUT_CREDITS } from '../src/app/about-credits';
import { aboutCredits, THIRD_PARTY } from './about-credits';
import { lfText, ROOT } from './assets/provenance';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

describe('About credits', () => {
  it('the committed About credits match their sources (run pnpm credits when red)', () => {
    expect(ABOUT_CREDITS).toEqual(aboutCredits(ROOT));
  });

  it('every runtime dependency has a licence entry', () => {
    const covered = THIRD_PARTY.flatMap((entry) => entry.covers);
    expect([...covered].sort()).toEqual(Object.keys(pkg.dependencies).sort());
  });

  it('every file in public/licenses is listed', () => {
    const files = readdirSync(join(ROOT, 'public/licenses')).sort();
    expect(THIRD_PARTY.map((entry) => entry.file).sort()).toEqual(files);
  });

  it.each(THIRD_PARTY.filter((entry) => entry.upstream !== undefined))(
    'a copied licence equals its upstream file: $name',
    ({ file, upstream }) => {
      if (upstream === undefined) throw new Error('filtered above');
      expect(lfText(ROOT, join('public/licenses', file))).toBe(lfText(ROOT, upstream));
    },
  );
});
