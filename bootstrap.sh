#!/usr/bin/env sh
# bootstrap.sh — zero dependencies: installs uv + dai-skills, then runs `dai bootstrap`
#
# Usage (from the cloned repo):
#   ./bootstrap.sh
#
# Or pipe directly (no clone needed):
#   curl -LsSf https://raw.githubusercontent.com/geekdreamzz/ari-dai-skills/main/bootstrap.sh | sh

set -e

# Add common uv install locations to PATH for this session
export PATH="$HOME/.local/bin:$PATH"

DAI_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd || pwd)"

echo ""
echo "dai-skills bootstrap"
echo "────────────────────"
echo ""

# ── 1. Install uv if missing ─────────────────────────────────────────────────
if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
  echo "✓ uv installed"
else
  echo "✓ uv already installed"
fi

# ── 2. Install dai-skills ────────────────────────────────────────────────────
echo "Installing dai-skills..."
uv tool install dai-skills --upgrade
echo "✓ dai-skills installed"

# ── 3. Hand off to `dai bootstrap` for auth + MCP config + instructions ──────
cd "$DAI_DIR"
dai bootstrap
