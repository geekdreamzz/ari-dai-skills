#!/usr/bin/env sh
# post-install.sh — runs automatically after `install.sh all-dai-sdd --project <dir>`
# Injects sdd-conductor hooks into the project's .claude/settings.json.
# Does NOT run `sdd-conductor init` (that requires tasks.yaml + live API — per-project manual step).

set -e

PROJECT_DIR="${1:-$(pwd)}"
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"
CONDUCTOR="$SKILL_DIR/../sdd-conductor/sdd-conductor.mjs"

if [ ! -f "$CONDUCTOR" ]; then
  echo "  [sdd-conductor] conductor not found at $CONDUCTOR — skipping hook install"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "  [sdd-conductor] node not found — skipping hook install (install Node.js 18+ to enable)"
  exit 0
fi

node "$CONDUCTOR" install "$PROJECT_DIR"
echo "  [sdd-conductor] Hooks installed. Run: node $CONDUCTOR init  (to set up .sdd-state.json)"
