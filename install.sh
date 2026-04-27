#!/usr/bin/env bash
# install.sh — install dai-skills into any AI IDE project
#
# Usage:
#   ./install.sh <skill-name> [--project /path] [--copy] [--ide cursor|claude|copilot]
#   ./install.sh --all [--project /path]
#
# Default behavior: symlink (live — edits in dai-skills reflect instantly everywhere)
# Use --copy for machines where symlinks aren't supported (Windows without Dev Mode)
#
# IDE targets (--ide):
#   claude   → .claude/skills/<skill>/          (default)
#   cursor   → .cursor/rules/<skill>.mdc
#   copilot  → .github/instructions/<skill>.md
#
# Examples:
#   ./install.sh all-dai-sdd --project ~/Projects/my-app
#   ./install.sh all-dai-sdd --project ~/Projects/my-app --ide cursor
#   ./install.sh --all --project ~/Projects/my-app
#   ./install.sh all-dai-sdd --copy               (copy instead of symlink)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_DIR="$SCRIPT_DIR/skills"

# Preflight: Python 3.11+ required (uv manages its own Python, so this only matters for plain pip users)
if command -v python3 >/dev/null 2>&1; then
  PY_VER=$(python3 -c 'import sys; print(sys.version_info[:2])' 2>/dev/null || echo "(0, 0)")
  if python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)' 2>/dev/null; then
    : # ok
  else
    echo "Warning: Python 3.11+ required. Found: $(python3 --version 2>&1)"
    echo "  Use uv (recommended) — it bundles its own Python:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh && uv tool install dai-skills"
  fi
fi

usage() {
  echo "Usage: ./install.sh <skill> [--project /path] [--copy] [--ide claude|cursor|copilot]"
  echo ""
  echo "Available skills:"
  for dir in "$SKILLS_DIR"/*/; do
    skill=$(basename "$dir")
    [[ -f "$dir/SKILL.md" ]] && echo "  - $skill"
  done
  exit 1
}

# Defaults
SKILL=""
PROJECT_DIR="$(pwd)"
INSTALL_ALL=false
USE_COPY=false
IDE="claude"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)        INSTALL_ALL=true; shift ;;
    --project)    PROJECT_DIR="$2"; shift 2 ;;
    --copy)       USE_COPY=true; shift ;;
    --ide)        IDE="$2"; shift 2 ;;
    --help|-h)    usage ;;
    -*)           echo "Unknown flag: $1"; usage ;;
    *)            SKILL="$1"; shift ;;
  esac
done

[[ -z "$SKILL" && "$INSTALL_ALL" == false ]] && usage

# Resolve target path per IDE
target_path() {
  local skill_name="$1"
  case "$IDE" in
    claude)   echo "$PROJECT_DIR/.claude/skills/$skill_name" ;;
    cursor)   echo "$PROJECT_DIR/.cursor/rules" ;;
    copilot)  echo "$PROJECT_DIR/.github/instructions" ;;
    *)        echo "Unknown IDE: $IDE" >&2; exit 1 ;;
  esac
}

# Try symlink; fall back to copy on failure (Windows without Dev Mode)
link_or_copy() {
  local src="$1"
  local dst="$2"

  if [[ "$USE_COPY" == true ]]; then
    mkdir -p "$(dirname "$dst")"
    cp -r "$src" "$dst"
    echo "  (copied)"
    return
  fi

  mkdir -p "$(dirname "$dst")"
  if ln -sf "$src" "$dst" 2>/dev/null && readlink "$dst" &>/dev/null; then
    echo "  (symlinked — edits in dai-skills are live)"
  elif command -v powershell.exe &>/dev/null; then
    # Windows: use directory junction (no admin needed, live like a symlink)
    local win_src win_dst
    win_src=$(echo "$src" | sed 's|/|\\|g' | sed 's|^\\\\?\\||')
    win_dst=$(echo "$dst" | sed 's|/|\\|g' | sed 's|^\\\\?\\||')
    powershell.exe -NoProfile -Command "New-Item -ItemType Junction -Path '$win_dst' -Target '$win_src' -Force | Out-Null" 2>/dev/null \
      && echo "  (junction — edits in dai-skills are live)" \
      || { cp -r "$src" "$dst"; echo "  (copied — junction failed)"; }
  else
    cp -r "$src" "$dst"
    echo "  (copied — enable symlinks for live updates)"
  fi
}

install_skill() {
  local skill_name="$1"
  local source_dir="$SKILLS_DIR/$skill_name"

  if [[ ! -d "$source_dir" ]]; then
    echo "Error: skill '$skill_name' not found"
    exit 1
  fi

  local target
  case "$IDE" in
    claude)
      target="$(target_path "$skill_name")"
      # Remove existing dir/link before relinking
      [[ -e "$target" || -L "$target" ]] && rm -rf "$target"
      link_or_copy "$source_dir" "$target"
      echo "✓ $skill_name → $target"
      ;;
    cursor)
      # Cursor reads .mdc files from .cursor/rules/ — write SKILL.md as <skill>.mdc
      local rules_dir
      rules_dir="$(target_path "$skill_name")"
      mkdir -p "$rules_dir"
      local dst="$rules_dir/${skill_name}.mdc"
      [[ -e "$dst" || -L "$dst" ]] && rm -f "$dst"
      link_or_copy "$source_dir/SKILL.md" "$dst"
      echo "✓ $skill_name → $dst"
      ;;
    copilot)
      # Copilot reads markdown files from .github/instructions/
      local inst_dir
      inst_dir="$(target_path "$skill_name")"
      mkdir -p "$inst_dir"
      local dst="$inst_dir/${skill_name}.md"
      [[ -e "$dst" || -L "$dst" ]] && rm -f "$dst"
      link_or_copy "$source_dir/SKILL.md" "$dst"
      echo "✓ $skill_name → $dst"
      ;;
  esac
}

if [[ "$INSTALL_ALL" == true ]]; then
  count=0
  for dir in "$SKILLS_DIR"/*/; do
    skill=$(basename "$dir")
    if [[ -f "$dir/SKILL.md" ]]; then
      install_skill "$skill"
      ((count++))
    fi
  done
  echo ""
  echo "Installed $count skill(s) into $PROJECT_DIR (ide: $IDE)"
else
  install_skill "$SKILL"
  echo ""
  echo "Done. Open your IDE in $PROJECT_DIR and use the skill."
fi
