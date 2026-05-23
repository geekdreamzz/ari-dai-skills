<div align="center">

# dai-skills

**Spec-driven AI development for Dataspheres AI — install once, run forever.**

[![PyPI](https://img.shields.io/pypi/v/dai-skills)](https://pypi.org/project/dai-skills/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Architecture Overview](https://dev.dataspheres.ai/pages/dataspheres-ai/all-dai-sdd-architecture) · [dataspheres.ai](https://dataspheres.ai)

</div>

---

## What this is

`dai-skills` gives your AI IDE (Claude Code, Cursor, GitHub Copilot) three things:

1. **MCP tools** — 14 skill domains wired directly into the AI. Ask it to create a task, draft a newsletter, run research, or manage a datasphere and it does it via the live API.

2. **all-dai-sdd** — A spec-driven development skill that drives feature work end-to-end: write a `tasks.yaml`, publish it to a live planner board, and the AI executes tasks in dependency order, validates results, and loops until every acceptance criterion is proven — without drifting.

3. **sdd-conductor** — A zero-dependency Node.js enforcement CLI that makes lifecycle transitions machine-checkable. Exit codes enforce gates. Claude hooks enforce ambient compliance. The AI can't skip steps.

---

## Quick setup

### 1. Get your API key

[dataspheres.ai/app/developers?tab=keys](https://dataspheres.ai/app/developers?tab=keys) → create a new key. Looks like `dsk_xxxxxxxx`.

### 2. Clone and configure

```bash
git clone https://github.com/geekdreamzz/ari-dai-skills
cd ari-dai-skills
cp .env.example .env
# edit .env — set DATASPHERES_API_KEY=dsk_your_key_here
```

> No git? [Download ZIP](https://github.com/geekdreamzz/ari-dai-skills/archive/refs/heads/main.zip)

### 3. Bootstrap

```bash
./bootstrap.sh
```

Installs `uv` (if needed), installs dai-skills, authenticates, and configures the MCP connection. When it finishes:

1. Type `/mcp` in Claude Code → find `dai-skills` → Enable
2. `Cmd/Ctrl+Shift+P → Reload Window`

> **Something wrong?** Run `dai doctor` — it checks every layer and tells you exactly what to fix.

---

## Install a skill into a project

```bash
# Claude Code (default)
./install.sh all-dai-sdd --project /path/to/your/project

# Cursor
./install.sh all-dai-sdd --project /path/to/your/project --ide cursor

# GitHub Copilot
./install.sh all-dai-sdd --project /path/to/your/project --ide copilot

# Install every skill at once
./install.sh --all --project /path/to/your/project
```

`all-dai-sdd` automatically runs a post-install hook that injects three Claude hooks into `.claude/settings.json` — the enforcement layer activates immediately.

Then, once per project:

```bash
node /path/to/dai-skills/skills/sdd-conductor/sdd-conductor.mjs init
```

---

## Skills

| Skill | What it does |
|-------|-------------|
| `all-dai-sdd` | Spec-driven development — full lifecycle from research to validation |
| `playwright-tests` | Playwright screenshot tests as SDD validation artifacts |
| `sdd-conductor` | Enforcement CLI (installed automatically with all-dai-sdd) |

MCP tool domains (available after bootstrap): **pages, planner, datasets, library, newsletters, surveys, research, dataspheres, sequences, presentations, AI drafting, context management, export, spec-driven development.**

---

## all-dai-sdd in depth

### The lifecycle

```
Research → North Stars → Epics → Execution → Validation → Done
```

Every column is a gate. Nothing moves forward without the previous column completing. The AI runs this autonomously — you write the spec, it drives the board.

### How it enforces compliance

Two layers, running independently:

**Explicit** — The AI reads `SKILL.md` and calls `sdd-conductor` at each step. The CLI exits non-zero on violations. The AI sees the error and must fix it before continuing.

**Ambient** — Claude hooks fire on every tool use regardless of what the AI intends:

| Hook | Trigger | Action |
|------|---------|--------|
| `check-file-hook` | Any `Write` or `Edit` | Warns if file isn't in the active task's declared impl files |
| `progress-hook` | Any `Bash` command | Auto-detects vitest / playwright / pytest / tsc output → posts test results to the active task as a comment |
| `session-start` | Every Claude Code wake-up | Reconciles `.sdd-state.json` with the live board |

### The key commands

```bash
# Start a session — ordered mission brief for the full initiative
node sdd-conductor.mjs drive

# After user gives feedback / changes the spec
node sdd-conductor.mjs sync

# Before writing code for a task
node sdd-conductor.mjs start <taskId>

# Post a progress milestone to the board
node sdd-conductor.mjs progress "Tests 12/12 — wiring acceptance checklist"

# After implementation — 5-gate enforced completion
node sdd-conductor.mjs complete <taskId>

# Validation / Ralph loop gate
node sdd-conductor.mjs validate <vaTaskId> --metric 95 --threshold 100 --iteration 1
# exit 0 → VA marked Done, chain propagates up to Epic and NS
# exit 1 → iteration comment posted, next refinement EX task auto-created

# Verify dashboard has all 5 required widgets
node sdd-conductor.mjs dashboard-check <dsUri> <dashboard-slug>
```

### The Ralph loop — continuous refinement

When a validation task fails, the system doesn't stall. `sdd-conductor validate` exit 1 means:
- Failure comment posted to the VA task on the board
- Next iteration EX task auto-created in Execution column (same impl files, criterion: metric ≥ threshold)
- Active task state cleared so the new task can be started
- Loop continues until gate passes or a hard blocker is hit

The loop is machine-driven. No LLM forgetfulness. No "I'll try again later."

### Completion gates — no rubber-stamping

`sdd-conductor complete` enforces 5 gates before marking anything Done:

1. All acceptance checklist items ticked
2. Completion comment with `[all-dai-sdd-system-message]` and `Verified criteria:` section
3. Test evidence exists in comments (auto-posted by `progress-hook`, or explicit `progress` call)
4. Completion comment has one bullet per checked criterion — every criterion needs explicit evidence
5. No mock/stub patterns in any implementation file

### Full architecture diagram

→ [all-dai-sdd System Architecture](https://dev.dataspheres.ai/pages/dataspheres-ai/all-dai-sdd-architecture)

---

## Keeping up to date

```bash
cd ari-dai-skills && git pull
```

Or tell your AI: `Update dai-skills to the latest version`

To update a specific project's skills after pulling:

```bash
./install.sh --all --project /path/to/your/project
```

This reinstalls all skills and re-runs post-install hooks (re-wires conductor).

---

## Other IDEs

### Cursor

After `bootstrap.sh`, install the skill:

```bash
./install.sh all-dai-sdd --project /path/to/your/project --ide cursor
```

Writes `all-dai-sdd.mdc` into `.cursor/rules/`. For MCP, add to **Cursor Settings → MCP**:

```json
{
  "mcpServers": {
    "dai-skills": {
      "command": "dai",
      "args": ["mcp", "start"]
    }
  }
}
```

If Cursor can't find `dai`, run `which dai` and use the full path.

### GitHub Copilot (VS Code)

```bash
./install.sh all-dai-sdd --project /path/to/your/project --ide copilot
```

Writes `all-dai-sdd.md` into `.github/instructions/`. Copilot picks up `*.md` files there automatically.

MCP (VS Code 1.99+) — add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "dai-skills": {
      "type": "stdio",
      "command": "dai",
      "args": ["mcp", "start"]
    }
  }
}
```

Open Copilot chat → Agent mode → tools available.

---

## Coming soon

- **File attachment API** — upload CSVs, PDFs, logs to the DS media library and embed them inside task content via a TipTap `fileEmbed` node. Test result files become first-class trace artifacts in the 5-tier swimlane. See `skills/sdd-conductor/FILE-UPLOAD-API.md`.
- **`sdd-conductor upload-evidence <file>`** — upload + attach to active task + post comment in one shot

---

<div align="center">

Built by [Dataspheres AI](https://dataspheres.ai) &middot; *Use all dai. Every dai.*

</div>
