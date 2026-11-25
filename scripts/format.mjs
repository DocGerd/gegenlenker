// Runs Prettier over the checkout with the repo's ignore files plus the shared .git/info/exclude.
// Usage: node scripts/format.mjs --check|--write
// Prettier resolves ignore patterns against the ignore file's directory, so the shared exclude is
// copied into the checkout root first: used in place from a worktree nested under the main
// checkout, `**/.claude/worktrees/` would match every file of that worktree. The copy is named per
// process (concurrent runs) and git-ignored (a killed run leaves it behind).
// `.claude/hooks/format.sh` does the same for single files: keep both in step.
import { execFileSync, spawnSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import process from 'node:process';

const mode = process.argv[2];
if (mode !== '--check' && mode !== '--write') {
  console.error('Usage: node scripts/format.mjs --check|--write');
  process.exit(2);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const exclude = resolve(git('rev-parse', '--git-path', 'info/exclude'));
const copy = resolve(
  git('rev-parse', '--show-toplevel'),
  `.git-exclude.${process.pid}.prettier-tmp`,
);
const prettier = createRequire(import.meta.url).resolve('prettier/bin/prettier.cjs');

writeFileSync(copy, existsSync(exclude) ? readFileSync(exclude, 'utf8') : '');
let result;
try {
  result = spawnSync(
    process.execPath,
    [
      prettier,
      mode,
      '.',
      '--ignore-path',
      '.gitignore',
      '--ignore-path',
      '.prettierignore',
      '--ignore-path',
      copy,
    ],
    { stdio: 'inherit' },
  );
} finally {
  rmSync(copy, { force: true });
}
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
