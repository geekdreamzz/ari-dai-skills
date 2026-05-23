# sdd-conductor

Enforcement layer for the all-dai-sdd lifecycle. Zero external dependencies.

## Problem it solves

`all-dai-sdd` is markdown instructions. LLMs read them, then drift. The conductor makes lifecycle transitions **machine-checkable**: start/complete/gate commands exit non-zero on violations, Claude Code surfaces hard errors, and Claude hooks enforce state on every file write.

## Architecture

```
all-dai-sdd (skill/orchestration)
  └── calls sdd-conductor at each lifecycle transition
        ├── sdd-conductor start <taskId>    → verifies deps, marks IN_PROGRESS, writes .sdd-state.json
        ├── sdd-conductor complete <taskId> → verifies checklist + comment, patches Done, propagates epic
        └── sdd-conductor gate <name>       → point-in-time gate check

Claude hooks (ambient enforcement — fires even if LLM forgets)
  ├── PostToolUse(Write|Edit) → check-file-hook (warns if file not in active task's impl list)
  └── SessionStart            → session-start (reconciles .sdd-state.json with live API)

.sdd-state.json (disk-based truth)
  └── activeTask, dsId, planModeId, statusGroupIds
```

## Setup (once per project)

```bash
# 1. Install hooks into the project's .claude/settings.json
node /path/to/dai-skills/skills/sdd-conductor/sdd-conductor.mjs install

# 2. Bootstrap .sdd-state.json (reads tasks.yaml + resolves live API IDs)
node /path/to/dai-skills/skills/sdd-conductor/sdd-conductor.mjs init
```

## Lifecycle commands

```bash
# ── Strategize phase (once before any EX code starts) ──
node sdd-conductor.mjs status                              # verify state initialized
node sdd-conductor.mjs gate impl-files task_abc123        # EX task has impl files listed
node sdd-conductor.mjs dashboard-check my-ds my-dashboard # dashboard has all 5 widgets

# ── Execution phase ──
node sdd-conductor.mjs start task_abc123                  # IN_PROGRESS + file guard on
node sdd-conductor.mjs progress "Tests 12/12 green"       # post milestone to board
node sdd-conductor.mjs complete task_abc123               # gates → Done → epic propagate

# ── Validation / Ralph loop ──
node sdd-conductor.mjs validate task_va001 --metric 85 --threshold 100 --iteration 1
# exit 0 → VA Done on board, loop ends
# exit 1 → iteration comment + next EX refinement task created, keep iterating

# ── Point-in-time gate checks ──
node sdd-conductor.mjs gate deps-done task_abc123
node sdd-conductor.mjs gate checklist task_abc123
node sdd-conductor.mjs gate no-mocks src/server/services/foo.service.ts
node sdd-conductor.mjs gate research-done task_rs001

# ── Status ──
node sdd-conductor.mjs status
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Gate passed / validate passed (VA marked Done) |
| 1 | Gate blocked — violation found / validate failed (loop continues) |
| 2 | Hard error — bad args, API unreachable, no state file |

## Gates enforced by `complete`

1. All `data-checked="false"` items in acceptance checklist → must be checked
2. Completion comment with `[all-dai-sdd-system-message]` + "Verified criteria" must exist
3. No mock/stub patterns in any declared implementation file
4. Task PATCH to Done (statusGroupId + status: DONE)
5. Parent Epic checklist propagated (ticks the child item, comments if epic is fully complete)

## .sdd-state.json schema

```json
{
  "version": "1.0.0",
  "dsId": "ds_xxx",
  "dsUri": "my-datasphere",
  "planModeId": "pm_xxx",
  "initiative": "my-feature",
  "doneGroupId": "sg_xxx",
  "executionGroupId": "sg_yyy",
  "validationGroupId": "sg_zzz",
  "statusGroups": { "research": "sg_aaa", "north stars": "sg_bbb", ... },
  "activeTask": {
    "taskId": "task_xxx",
    "specId": "T-001",
    "title": "T-001 · Something",
    "epicTaskId": "task_yyy",
    "implFiles": ["src/server/services/foo.service.ts"],
    "startedAt": "2026-05-23T10:00:00Z"
  },
  "lastCompleted": { "taskId": "...", "specId": "...", "completedAt": "..." }
}
```
