#!/bin/sh
# =============================================================
# all-dai-sdd — PORTABLE COMMIT GATE
# =============================================================
# Enforces the code↔task link of the SDD protocol at commit time.
# Call it from a project's pre-commit hook:
#
#   sh .claude/skills/all-dai-sdd/sdd-commit-gate.sh || exit 1
#
# Reads .sdd-state.json (from the git root). For the CURRENT initiative:
#   - a task is IN-PROGRESS ...................... pass
#   - no task, feature code staged, enforce:true . BLOCK (exit 1)
#   - no task, feature code staged, soft ......... warn (exit 0)
#   - no feature code staged ..................... pass
#
# "Feature code" = staged files under src/ apps/ packages/ (excluding tests).
# Opt a single initiative out with "enforce": false. Emergency bypass for one
# commit: git commit --no-verify.
# =============================================================

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
STATE="$ROOT/.sdd-state.json"

[ -f "$STATE" ] || { echo "  ${GREEN}✓${NC} SDD: no .sdd-state.json — protocol not active"; exit 0; }

RESULT=$(node -e "
const fs=require('fs');
try {
  const s=JSON.parse(fs.readFileSync('$STATE','utf8'));
  const inits=s.initiatives||{};
  for(const [slug,i] of Object.entries(inits)){
    if(i&&i.activeTask){ const t=i.activeTask;
      process.stdout.write('ACTIVE|'+(t.specId||t.taskId||'?')+'|'+slug+'|'+(i.enforce?'enforced':'soft')); process.exit(0); }
  }
  const cur=s.currentInitiative;
  if(cur&&inits[cur]) process.stdout.write('IDLE|'+cur+'|'+cur+'|'+(inits[cur].enforce?'enforced':'soft'));
  else process.stdout.write('NONE|||soft');
} catch(e){ process.stdout.write('NONE|||soft'); }
" 2>/dev/null || echo "NONE|||soft")

STATUS=$(echo "$RESULT"  | cut -d'|' -f1)
SPEC=$(echo "$RESULT"    | cut -d'|' -f2)
PROJ=$(echo "$RESULT"    | cut -d'|' -f3)
ENFORCE=$(echo "$RESULT" | cut -d'|' -f4)

FEATURE=$(git diff --cached --name-only | grep -E '^(src|apps|packages)/' | grep -vE '\.(test|spec)\.|__tests__|/tests/' || true)

case "$STATUS" in
  ACTIVE)
    echo "  ${GREEN}✓${NC} SDD in-progress: $SPEC (initiative: $PROJ)"; exit 0 ;;
  IDLE)
    if [ -z "$FEATURE" ]; then
      echo "  ${GREEN}✓${NC} SDD initiative '$PROJ' registered — no feature code staged"; exit 0
    elif [ "$ENFORCE" = "enforced" ]; then
      printf "  ${RED}\xE2\x9C\x97 SDD ENFORCED — initiative '%s' has no task in-progress, but this commit stages feature code.${NC}\n" "$PROJ"
      echo "     Start a task first:  node .claude/skills/all-dai-sdd/loop.mjs --next"
      echo "     Or opt out:          set \"enforce\": false on the initiative in .sdd-state.json"
      exit 1
    else
      echo "  ${YELLOW}⚠${NC} Feature code committed with no SDD task in-progress (initiative '$PROJ'). Allowed but untraced — start a task, or set \"enforce\": true to require it."; exit 0
    fi ;;
  *)
    echo "  ${GREEN}✓${NC} SDD: no active initiative"; exit 0 ;;
esac
