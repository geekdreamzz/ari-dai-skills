#!/usr/bin/env bash
# install.sh — install dai-skills into a Claude Code project
#
# Usage:
#   ./install.sh <skill-name> --project /path/to/project
#   ./install.sh --all --project /path/to/project
#   ./install.sh <skill-name>          (installs into current directory)
#
# Examples:
#   ./install.sh all-dai-sdd --project ~/Projects/my-app
#   ./install.sh --all --project ~/Projects/my-app

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "Usage:"
  echo "  ./install.sh <skill-name> [--project /path/to/project]"
  echo "  ./install.sh --all [--project /path/to/project]"
  echo ""
  echo "Available skills:"
  for dir in "$SCRIPT_DIR"/*/; do
    skill=$(basename "$dir")
    if [[ -f "$dir/SKILL.md" ]]; then
      echo "  - $skill"
    fi
  done
  exit 1
}

# Parse args
SKILL=""
PROJECT_DIR="$(pwd)"
INSTALL_ALL=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      INSTALL_ALL=true
      shift
      ;;
    --project)
      PROJECT_DIR="$2"
      shift 2
      ;;
    --help|-h)
      usage
      ;;
    -*)
      echo "Unknown flag: $1"
      usage
      ;;
    *)
      SKILL="$1"
      shift
      ;;
  esac
done

if [[ -z "$SKILL" && "$INSTALL_ALL" == false ]]; then
  usage
fi

install_skill() {
  local skill_name="$1"
  local source_dir="$SCRIPT_DIR/$skill_name"
  local target_dir="$PROJECT_DIR/.claude/skills/$skill_name"

  if [[ ! -d "$source_dir" ]]; then
    echo "Error: skill '$skill_name' not found in $SCRIPT_DIR"
    exit 1
  fi

  mkdir -p "$target_dir"
  cp -r "$source_dir/"* "$target_dir/"
  echo "✓ Installed $skill_name → $target_dir"
}

if [[ "$INSTALL_ALL" == true ]]; then
  count=0
  for dir in "$SCRIPT_DIR"/*/; do
    skill=$(basename "$dir")
    if [[ -f "$dir/SKILL.md" ]]; then
      install_skill "$skill"
      ((count++))
    fi
  done
  echo ""
  echo "Installed $count skill(s) into $PROJECT_DIR/.claude/skills/"
else
  install_skill "$SKILL"
  echo ""
  echo "Done. Open Claude Code in $PROJECT_DIR and run /$SKILL"
fi
