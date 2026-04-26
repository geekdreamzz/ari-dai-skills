#!/usr/bin/env sh
# update.sh — pull latest dai-skills and re-install skills into current project
set -e

DAI_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="${1:-$(pwd)}"

echo "🔄 Pulling latest dai-skills..."
cd "$DAI_DIR" && git pull

echo "📦 Re-installing skills into $PROJECT..."
"$DAI_DIR/install.sh" --all --project "$PROJECT"

echo "✅ dai-skills updated. All dai!"
