import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABOUT_CREDITS } from '../src/app/about-credits';
import { aboutCredits, THIRD_PARTY, type LicenceEntry } from './about-credits';
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

  const hasUpstream = (
    entry: LicenceEntry,
  ): entry is LicenceEntry & { readonly upstream: string } => entry.upstream !== undefined;

  it.each(THIRD_PARTY.filter(hasUpstream))(
    'a copied licence equals its upstream file: $name',
    ({ file, upstream }) => {
      expect(lfText(ROOT, join('public/licenses', file))).toBe(lfText(ROOT, upstream));
    },
  );

  const hasBundled = (
    entry: LicenceEntry,
  ): entry is LicenceEntry & { readonly bundled: readonly string[] } => entry.bundled !== undefined;

  it.each(THIRD_PARTY.filter(hasBundled))(
    'a bundled transitive package ships the entry licence text: $name',
    ({ file, covers, bundled }) => {
      const [first] = covers;
      if (first === undefined) throw new Error('a bundled package needs a covering dependency');
      // pnpm keeps a transitive package beside its dependent, not under the root node_modules.
      const siblings = join(realpathSync(join(ROOT, 'node_modules', first)), '..');
      for (const name of bundled) {
        expect(lfText(ROOT, join('public/licenses', file))).toBe(
          lfText(siblings, join(name, 'LICENSE')),
        );
      }
    },
  );
});
