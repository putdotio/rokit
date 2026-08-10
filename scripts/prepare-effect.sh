#!/usr/bin/env sh

set -eu

if [ -n "${CI:-}" ]; then
  exit 0
fi

effect_upstream="https://github.com/Effect-TS/effect.git"
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
effect_ref="$(node -e '
const { readFileSync } = require("node:fs");
const packageJson = JSON.parse(readFileSync(process.argv[1], "utf8"));
const version = packageJson.dependencies?.effect;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("package.json dependencies.effect must be an exact version");
  process.exit(1);
}
process.stdout.write(`effect@${version}`);
' "$script_dir/../package.json")"
repo_dir="$(dirname "$script_dir")/.repos/effect"

if [ -e "$repo_dir" ] && [ ! -d "$repo_dir/.git" ]; then
  echo "Effect source path exists but is not a Git checkout: $repo_dir" >&2
  exit 1
fi

if [ ! -d "$repo_dir/.git" ]; then
  mkdir -p "$repo_dir"
  git -C "$repo_dir" init --quiet
fi

if [ -n "$(git -C "$repo_dir" status --porcelain=v1)" ]; then
  echo "Effect source checkout has local changes: $repo_dir" >&2
  echo "Commit, stash, or remove those changes before running this command again." >&2
  exit 1
fi

current_remote="$(git -C "$repo_dir" remote get-url origin 2>/dev/null || true)"
if [ -z "$current_remote" ]; then
  git -C "$repo_dir" remote add origin "$effect_upstream"
elif [ "$current_remote" != "$effect_upstream" ]; then
  git -C "$repo_dir" remote set-url origin "$effect_upstream"
fi

git -C "$repo_dir" fetch --depth 1 --force origin "refs/tags/$effect_ref:refs/tags/$effect_ref"
target_commit="$(git -C "$repo_dir" rev-list -n 1 "$effect_ref")"
current_commit="$(git -C "$repo_dir" rev-parse HEAD 2>/dev/null || true)"

if [ "$current_commit" != "$target_commit" ]; then
  git -C "$repo_dir" checkout --detach "$target_commit"
fi

printf 'Effect source ready at %s (%s)\n' "$repo_dir" "$effect_ref"
