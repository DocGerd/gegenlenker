import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { THREE_FREE_RENDER } from './three-free-render.ts';

const ROOT = join(import.meta.dirname, '..');
const THREE = /^three(\/|$)/;
// The renderer entries the app shell loads (`render-stage`, `drive`, `main`): they use Three.js.
const RENDERER_ENTRIES = ['src/render/index.ts', 'src/render/probe.ts'];

/** Specifiers loaded at runtime: `import type` and `export type` are erased, inline `type` specifiers are not. */
function runtimeSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) &&
        node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword) ||
      (ts.isExportDeclaration(node) && !node.isTypeOnly)
    ) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        found.push(node.moduleSpecifier.text);
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function resolveRelative(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  return [base, `${base}.ts`, join(base, 'index.ts')].find(
    (path) => /\.(ts|mjs|js)$/.test(path) && existsSync(path),
  );
}

/** First chain of runtime imports from `entry` that reaches Three.js, if any. */
function threeChain(entry: string): string[] | undefined {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | undefined => {
    if (seen.has(file)) return undefined;
    seen.add(file);
    for (const specifier of runtimeSpecifiers(file)) {
      if (THREE.test(specifier)) return [...chain, specifier];
      if (!specifier.startsWith('.')) continue;
      const target = resolveRelative(file, specifier);
      const hit = target && walk(target, [...chain, relative(ROOT, target)]);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(join(ROOT, entry), [entry]);
}

describe('THREE_FREE_RENDER', () => {
  it.each(THREE_FREE_RENDER)('%s exists and reaches no Three.js at runtime', (entry) => {
    expect(existsSync(join(ROOT, entry))).toBe(true);
    expect(threeChain(entry)).toBeUndefined();
  });

  it('lists every render module imported at runtime from outside render', () => {
    const files = execFileSync('git', ['ls-files', '--', '*.ts', '*.mjs', '*.js'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(
        (path) =>
          path !== '' &&
          !path.startsWith('src/render/') &&
          !path.startsWith('dev/') &&
          !/\.(test|spec)\.ts$/.test(path),
      );
    const used = new Set<string>();
    for (const file of files) {
      for (const specifier of runtimeSpecifiers(join(ROOT, file))) {
        if (!specifier.startsWith('.')) continue;
        const target = resolveRelative(join(ROOT, file), specifier);
        const path = target && relative(ROOT, target);
        if (path?.startsWith('src/render/')) used.add(path);
      }
    }
    expect(files.length).toBeGreaterThan(0);
    expect(
      [...used].filter(
        (path) => !THREE_FREE_RENDER.includes(path) && !RENDERER_ENTRIES.includes(path),
      ),
    ).toEqual([]);
  });
});
