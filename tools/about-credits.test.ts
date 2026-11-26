import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
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

  describe('libraries vendored inside three', () => {
    const JSM = join(ROOT, 'node_modules/three/examples/jsm');
    const LIBS = join(JSM, 'libs');

    const sourceFiles = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
      });

    /** The `three/addons` and `three/examples/jsm` modules the app imports, as files under `jsm`. */
    const appEntries = (): string[] =>
      sourceFiles(join(ROOT, 'src')).flatMap((file) =>
        [
          ...readFileSync(file, 'utf8').matchAll(
            /['"]three\/(?:addons|examples\/jsm)\/([^'"?]+)(?:\?[^'"]*)?['"]/g,
          ),
        ].flatMap((match) => (match[1] === undefined ? [] : [join(JSM, match[1])])),
      );

    /** Names under `libs/` that the app's three modules reach, following their relative imports. */
    const bundledLibs = (): string[] => {
      const found = new Set<string>();
      const seen = new Set<string>();
      const queue = appEntries();
      for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
        if (seen.has(file)) continue;
        seen.add(file);
        const rel = relative(LIBS, file);
        if (!rel.startsWith('..')) {
          found.add(rel.split(sep)[0] ?? rel);
          continue;
        }
        if (!file.endsWith('.js') || !existsSync(file)) continue;
        const specifiers = readFileSync(file, 'utf8').matchAll(
          /(?:from\s*|import\s*\(\s*|new URL\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g,
        );
        for (const [, specifier] of specifiers) {
          if (specifier !== undefined) queue.push(resolve(file, '..', specifier));
        }
      }
      return [...found].sort();
    };

    it('are found by the scan', () => {
      expect(bundledLibs()).toEqual(
        expect.arrayContaining([
          'basis',
          'ktx-parse.module.js',
          'meshopt_decoder.module.js',
          'zstddec.module.js',
        ]),
      );
    });

    it('each have a licence entry', () => {
      const listed = new Set(THIRD_PARTY.flatMap((entry) => entry.libs ?? []));
      expect(bundledLibs().filter((lib) => !listed.has(lib))).toEqual([]);
    });

    it('are listed only while they exist', () => {
      for (const lib of THIRD_PARTY.flatMap((entry) => entry.libs ?? [])) {
        expect(existsSync(join(LIBS, lib))).toBe(true);
      }
    });
  });
});
