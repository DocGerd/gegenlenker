import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { prodManifest } from './prod-manifest';

const dirs: string[] = [];
const tree = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'prod-manifest-'));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

it('lists every nested file as a sha256sum line, sorted by path bytes', () => {
  const dir = tree({ 'b.txt': 'b', 'assets/z.js': 'z', 'a.txt': 'a', 'assets/B.js': 'B' });
  const paths = prodManifest(dir)
    .trimEnd()
    .split('\n')
    .map((line) => line.slice(66));
  expect(paths).toEqual(['a.txt', 'assets/B.js', 'assets/z.js', 'b.txt']);
  expect(prodManifest(dir)).toContain(
    'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb  a.txt\n',
  );
});

it('changes when one byte of one file changes, and not otherwise', () => {
  const files = { 'index.html': 'x', 'assets/app.js': 'y' };
  expect(prodManifest(tree(files))).toBe(prodManifest(tree(files)));
  expect(prodManifest(tree({ ...files, 'assets/app.js': 'z' }))).not.toBe(
    prodManifest(tree(files)),
  );
});

it('refuses a hidden path, which neither artifact upload keeps', () => {
  expect(() => prodManifest(tree({ 'index.html': 'x', '.well-known/a.txt': 'a' }))).toThrow(
    'is hidden',
  );
});

it('refuses an empty tree', () => {
  expect(() => prodManifest(tree({}))).toThrow('has no files');
});
