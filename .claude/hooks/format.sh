#!/usr/bin/env bash
# PostToolUse(Edit|Write): format the edited file with the same ignore files as `pnpm format`.
# Resolves the checkout from the file, not from cwd or CLAUDE_PROJECT_DIR, so worktrees work.
# A formatter is not a gate: every failure path exits 0 and prints nothing.

command -v jq >/dev/null || exit 0
file=$(jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -f "$file" ] || exit 0

common_dir() { git -C "$1" rev-parse --path-format=absolute --git-common-dir 2>/dev/null; }
root=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) || exit 0
common=$(common_dir "$root")
[ -n "$common" ] && [ "$common" = "$(common_dir "$(dirname "${BASH_SOURCE[0]}")")" ] || exit 0

prettier=$root/node_modules/.bin/prettier
[ -x "$prettier" ] || prettier=$(dirname "$common")/node_modules/.bin/prettier
[ -x "$prettier" ] || exit 0

cd "$root" || exit 0
"$prettier" --write --ignore-unknown \
  --ignore-path .gitignore --ignore-path .prettierignore \
  --ignore-path "$(git rev-parse --git-path info/exclude)" \
  -- "$file" >/dev/null 2>&1
exit 0
