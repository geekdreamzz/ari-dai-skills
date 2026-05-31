<div align="center">

# dai-skills

**Spec-driven AI development for Dataspheres AI — install once, run forever.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Architecture Overview](https://dataspheres.ai/pages/dataspheres-ai/all-dai-sdd-architecture) · [dataspheres.ai](https://dataspheres.ai)

</div>

---

## What this is

`dai-skills` gives your AI IDE (Claude Code, Cursor, GitHub Copilot) structured access to the Dataspheres AI platform. The AI reads the skill files, uses your API key from `~/.dataspheres.env`, and calls the REST API directly — no middleware, no extra processes.

### Skills

**Development**

| Skill | What it does |
|-------|-------------|
| `all-dai-sdd` | Spec-driven development — full lifecycle from research to validation, autonomous execution |
| `sdd-conductor` | Enforcement CLI — exit codes + Claude hooks that make lifecycle gates machine-checkable |
| `playwright-tests` | Playwright screenshot tests as first-class SDD validation artifacts |
| `principles` | Coding standards and project principles enforced across all tasks |

**Content & Pages**

| Skill | What it does |
|-------|-------------|
| `pages` | Create, update, and publish pages in any datasphere |
| `documents` | Upload, analyze, and manage documents |
| `library` | Upload and manage media in the datasphere media library |
| `posts` | Create and manage posts and activity feed content |
| `presentations` | Build and manage presentations |

**Data & Research**

| Skill | What it does |
|-------|-------------|
| `research` | AI-powered web research via Dataspheres AI assistant conversations |
| `datasets` | Create and query structured datasets |
| `data_cards` | Build data card visualizations from datasets |
| `knowledge_bank` | Manage the AI knowledge bank and context for a datasphere |
| `context` | Manage AI context windows and prompt context |

**Newsletters & Outreach**

| Skill | What it does |
|-------|-------------|
| `newsletters` | Create and manage AI-powered newsletters, issues, and subscriber sequences |
| `sequences` | Build automated multi-step outreach or drip workflows |
| `sequencers` | Manage sequence runners and scheduling |
| `surveys` | Design, run, and analyze surveys |

**Planner & Tasks**

| Skill | What it does |
|-------|-------------|
| `planner` | Manage Kanban boards, plan modes, and project workflows |
| `tasks` | Create, update, and move individual tasks |
| `saved_lists` | Manage saved lists and collections |

**Platform**

| Skill | What it does |
|-------|-------------|
| `dataspheres` | Create and manage dataspheres |
| `connections` | Manage datasphere connections and integrations |
| `search` | Search across datasphere content |
| `images` | Generate and manage images |
| `media` | Media management utilities |
| `folders` | Organize content into folders |
| `linked_urls` | Manage linked URLs and web content |
| `export` | Export datasphere content |
| `conversation` | Manage AI conversations |
| `ai` | Direct AI completion and generation tools |

---

## Setup (3 steps)

### 1. Get your API key

[dataspheres.ai/app/developers?tab=keys](https://dataspheres.ai/app/developers?tab=keys) → create a key. Looks like `dsk_xxxxxxxx`.

Save it:

```bash
echo "DATASPHERES_API_KEY=dsk_your_key_here" >> ~/.dataspheres.env
echo "DATASPHERES_BASE_URL=https://dataspheres.ai" >> ~/.dataspheres.env
echo "DATASPHERES_PUBLIC_URL=https://dataspheres.ai" >> ~/.dataspheres.env
```

### 2. Clone and install into your project

```bash
git clone https://github.com/geekdreamzz/ari-dai-skills
cd ari-dai-skills
bash install.sh --all --project /path/to/your/project
```

This copies all skills into `.claude/skills/` (or `.cursor/rules/`, `.github/instructions/` — see IDE flags below) and wires three Claude hooks for ambient enforcement.

### 3. Init the SDD conductor (once per project)

```bash
node /path/to/ari-dai-skills/skills/sdd-conductor/sdd-conductor.mjs init
```

Connects to your datasphere, finds the plan mode, and writes `.sdd-state.json`. Done.

---

## Updating

```bash
cd ari-dai-skills && git pull
bash install.sh --all --project /path/to/your/project
```

Or tell your AI: `Update dai-skills to the latest version` and it runs those two commands.

---

## IDE flags

```bash
# Claude Code (default — writes to .claude/skills/)
bash install.sh --all --project /path/to/your/project

# Cursor (writes all-dai-sdd.mdc to .cursor/rules/)
bash install.sh all-dai-sdd --project /path/to/your/project --ide cursor

# GitHub Copilot (writes all-dai-sdd.md to .github/instructions/)
bash install.sh all-dai-sdd --project /path/to/your/project --ide copilot

# Windows without Developer Mode (use copy instead of junction)
bash install.sh --all --project /path/to/your/project --copy
```

---

## all-dai-sdd in depth

### The lifecycle

```
Research → North Stars → Epics → Execution → Validation → Done
```

Every column is a gate. Nothing moves forward without the previous column completing. The AI runs this autonomously — you write the spec, it drives the board.

### How compliance is enforced

Two layers running independently:

**Explicit** — The AI reads `SKILL.md` and calls `sdd-conductor` at each step. The CLI exits non-zero on violations. The AI sees the error and must fix it before continuing.

**Ambient** — Claude hooks fire on every tool use regardless of what the AI intends:

| Hook | Trigger | Action |
|------|---------|--------|
| `check-file-hook` | Any `Write` or `Edit` | Warns if file isn't in the active task's declared impl files |
| `progress-hook` | Any `Bash` command | Detects vitest / playwright / pytest / tsc output → auto-posts test results to the active task |
| `session-start` | Every Claude Code wake-up | Reconciles `.sdd-state.json` with the live board |

### Key commands

```bash
# Ordered mission brief — what to work on next
node sdd-conductor.mjs drive

# After feedback or spec changes
node sdd-conductor.mjs sync

# Before writing code
node sdd-conductor.mjs start <taskId>

# Post a milestone to the board
node sdd-conductor.mjs progress "Tests 12/12 — wiring checklist"

# 5-gate enforced completion
node sdd-conductor.mjs complete <taskId>

# Ralph loop gate (exit 0 = Done, exit 1 = next iteration auto-created)
node sdd-conductor.mjs validate <vaTaskId> --metric 95 --threshold 100 --iteration 1

# Multiple initiatives or projects in parallel
node sdd-conductor.mjs status          # all initiatives + active tasks
node sdd-conductor.mjs switch <slug>   # change current initiative
node sdd-conductor.mjs workspace       # cross-project view
```

### Completion gates — no rubber-stamping

`sdd-conductor complete` enforces 5 gates before marking anything Done:

1. All acceptance checklist items ticked
2. Completion comment with `[all-dai-sdd-system-message]` and `Verified criteria:` section
3. Test evidence exists in comments (auto-posted by `progress-hook`, or explicit `progress` call)
4. One bullet per checked criterion — every criterion needs explicit evidence
5. No mock/stub patterns in any implementation file

### The Ralph loop — continuous refinement

When a validation task fails, `sdd-conductor validate` exit 1 automatically:
- Posts failure comment to the VA task
- Creates the next iteration EX task in Execution (same impl files, criterion: metric ≥ threshold)
- Clears active task state so the new task can be started immediately

Loop continues until the gate passes or a hard blocker is hit. Machine-driven — no LLM forgetfulness.

### Full architecture diagram

→ [all-dai-sdd System Architecture](https://dataspheres.ai/pages/dataspheres-ai/all-dai-sdd-architecture)

---

## Coming soon

- **File attachment API** — upload CSVs, PDFs, logs to the DS media library and embed them inside task content. See `skills/sdd-conductor/FILE-UPLOAD-API.md`.
- **`sdd-conductor upload-evidence <file>`** — upload + attach to active task + post comment in one shot.

---

<div align="center">

Built by [Dataspheres AI](https://dataspheres.ai) &middot; *Use all dai. Every dai.*

</div>
