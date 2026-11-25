#!/usr/bin/env bash
# Unit tests for nyx-monitor in Docker (Node pinned in .nvmrc). The extension itself
# only runs inside gnome-shell; tests/headless.sh renders it in a throwaway headless shell.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
node_version=$(cat "$here/.nvmrc")
docker run --rm -v "$here":/w:ro -w /w "node:${node_version}-alpine" sh -c '
  node --check extension/extension.js &&
  node --check extension/stats.js &&
  node --check extension/characters.js &&
  node --check extension/skins.js &&
  node --check extension/prefs.js &&
  node --test "tests/*.test.mjs"'
