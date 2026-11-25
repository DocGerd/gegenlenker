import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');

/** `path` is repo-relative; undefined for a bare specifier such as `three`. */
export type Edge = {
  readonly specifier: string;
  readonly path: string | undefined;
  readonly dynamic: boolean;
};

/** Specifiers loaded at runtime: `import type` and `export type` are erased, inline `type` specifiers are not. `file` is repo-relative. */
export function runtimeSpecifiers(
  file: string,
): readonly { readonly text: string; readonly dynamic: boolean }[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: { text: string; dynamic: boolean }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) &&
        node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword) ||
      (ts.isExportDeclaration(node) && !node.isTypeOnly)
    ) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        found.push({ text: node.moduleSpecifier.text, dynamic: false });
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({ text: node.arguments[0].text, dynamic: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Repo-relative file a relative `specifier` in repo-relative `from` loads, if it exists. */
export function resolveRelative(from: string, specifier: string): string | undefined {
  const base = join(dirname(from), specifier);
  return [base, `${base}.ts`, join(base, 'index.ts')].find(
    (path) => /\.(ts|mjs|js)$/.test(path) && existsSync(join(ROOT, path)),
  );
}

/** First chain from `entry` to an edge `isBad` accepts. An edge `follow` rejects is skipped before `isBad` sees it. */
export function importChain(
  entry: string,
  isBad: (edge: Edge) => boolean,
  follow: (edge: Edge) => boolean,
): string[] | undefined {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string[] | undefined => {
    if (seen.has(file)) return undefined;
    seen.add(file);
    for (const { text, dynamic } of runtimeSpecifiers(file)) {
      const path = text.startsWith('.') ? resolveRelative(file, text) : undefined;
      const edge: Edge = { specifier: text, path, dynamic };
      if (!follow(edge)) continue;
      if (isBad(edge)) return [...chain, path ?? text];
      const hit = path && walk(path, [...chain, path]);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(entry, [entry]);
}
