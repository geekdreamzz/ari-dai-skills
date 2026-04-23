---
name: all-dai-sdd
description: Spec-Driven Development for Dataspheres AI. Pulls a feature spec from any datasphere, extracts tasks, tracks progress by updating the spec page in real-time via REST API as work is completed. Works for any project on any datasphere — just set targetDatasphere in tasks.yaml. Use when starting work on a feature spec, updating task status, or reviewing SDD progress.
argument-hint: "init <uri>/<slug> | status | task <number> done | task <number> in-progress | task <number> blocked <reason> | sync | publish <project-dir> | promote <slug>"
---

# Spec-Driven Development (SDD)

Drive feature implementation from a living spec hosted on Dataspheres AI. The spec is the single source of truth — task status, blockers, and progress are tracked directly in the spec page via the REST API.

> **Requires a Dataspheres AI developer key.** Get one from the Developers panel in any datasphere you own. Works for any project on any datasphere.

---

## Core principle: specs are self-healing

**SDD is not "read a frozen spec and execute it to the letter."** That posture produces shortcut-ridden code because the spec can't know what you'll learn mid-execution.

The spec is a **living document that you revise as you reason**. When execution surfaces a truth the spec didn't anticipate, the spec moves. Not the code to match a stale spec.

### When to update the spec (during execution, not after)

The moment you learn any of these, update the spec files locally and republish — before continuing implementation:

| Discovery | Action |
|---|---|
| A requirement's acceptance criteria is unverifiable or wrong | Rewrite it. Make it observable. Republish the page. |
| A task's scope is incorrect (e.g. "build X" when X exists) | Retire the task. Add the real task (e.g. "integrate Y into X"). Update `tasks.yaml`. |
| The architectural premise is wrong (e.g. "build parallel engine" when evolving the existing one is correct) | Revise the relevant spec page's Purpose section. Reframe downstream requirements. Republish. |
| A dependency turns out to be bidirectional / circular | Update `depends_on` in `tasks.yaml` both ways. Note the cycle in the caveats section. |
| You find a bug in a service the spec assumes is correct | Add a new task to fix it. Don't silently work around it. |
| The spec's event/schema shape diverges from reality | Change the spec to match the real shape OR the shape to match the spec — whichever is defensible. Both paths need a note explaining why. |

### How to revise (the discipline)

1. **Edit the markdown locally first** (`specs/<project>/NNN-*.md`). The file is the source of truth; the DS page is a projection.
2. **Keep requirement IDs stable.** `R-001` stays `R-001` even if its text changes 100%. External refs (PRs, @satisfies annotations) depend on ID stability.
3. **Add a "Revision log" section** at the bottom of any spec page you rewrite substantially. One line per change with the reason.
4. **Republish the page** (`/sdd publish <project> --pages-only`) before continuing execution. The planner's tracker will reflect the new state.
5. **Update `tasks.yaml`** in the same pass if requirements split/merge/retire. Run `/sdd publish <project> --tasks-only` to sync.
6. **Note it in the task's content** so the next LLM picking up work knows *why* the task exists in its current form.

### The anti-pattern (what caused the 10× rework loop)

- Reading the spec once at the start of work and treating it as immutable.
- Discovering mid-execution that a requirement is wrong and **silently coding around it** to keep the spec "clean."
- Marking a task "done" because the scaffolding exists, even though the acceptance is unverifiable as written.
- Piling on new primitives rather than revising the spec when the primitive premise is wrong.

When you feel yourself tempted by any of the above — **stop, revise the spec, republish, then resume**. The 3-minute spec revision saves the 3-hour rework.

### Mandatory self-audit before marking any task DONE

Before you flip a task to DONE, ask:
1. **Does the acceptance criterion pass as written?** If the spec says "SQL count = 0" — did you run that SQL? If it says "integration test passes" — is the test in the repo, green, and testing the stated behavior?
2. **Is the implementation wired to a real caller?** A pure function with no call site does not satisfy the requirement.
3. **Would a code reader who knows only the spec text, not the implementation, agree it's done?** If no: the spec and the code disagree. Revise one to match the other before continuing.

If any answer is "no" — do NOT mark DONE. Either complete the work, or revise the spec (with a note in Revision log) so the acceptance is correct. Stub-and-stamp is the failure mode this skill is built to prevent.

---

## How It Works

```
Feature Spec (Dataspheres page)
    ├── Overview, architecture, examples  (human-written)
    └── Task Tracker (appended HTML)      (SDD-managed)
         ├── Phase 1 tasks with status badges
         ├── Phase 2 tasks with status badges
         └── Progress summary bar
```

1. **`/sdd init <uri>/<slug>`** — Pull the spec, parse implementation phases into tasks, append a Task Tracker section, push back to the page.
2. **`/sdd task <n> in-progress`** — Mark a task as in-progress, update the spec page via API.
3. **`/sdd task <n> done`** — Mark a task as complete, update the spec page via API.
4. **`/sdd task <n> blocked <reason>`** — Mark a task as blocked with a reason.
5. **`/sdd status`** — Pull latest spec, display current task tracker status.
6. **`/sdd sync`** — Re-read the spec from the API and reconcile with local state.
7. **`/sdd publish <project-dir>`** — Publish all artifacts (pages + tasks + tracker + dashboard) in one pass.
8. **`/sdd promote <slug>`** — Copy a spec from localhost to production. Requires user confirmation.

---

## Configuration

**Two levels of config — never mix them.**

### User-level: `~/.dataspheres.env`

Credentials only. Shared across all projects.

```bash
DATASPHERES_API_KEY=dsk_...                    # your developer key
DATASPHERES_BASE_URL=http://localhost:5173     # API calls (internal — never changes)
DATASPHERES_PUBLIC_URL=https://dev.dataspheres.ai  # links shown to user (dev tunnel or prod)
```

`BASE_URL` is used for all API calls. `PUBLIC_URL` is used exclusively for the clickable links printed at the end of every publish — it is whatever URL the user can actually open in their browser.

- Local dev with tunnel: `PUBLIC_URL=https://dev.dataspheres.ai`
- Production: `PUBLIC_URL=https://dataspheres.ai`

Load before any SDD command:
```bash
export $(grep -v '^#' ~/.dataspheres.env | xargs)
```

**NEVER put `DATASPHERES_DEFAULT_URI` here.** The target datasphere is per-project and always comes from `tasks.yaml:targetDatasphere`.

### Project-level: `specs/<project>/tasks.yaml`

The `targetDatasphere` field is **required** — it tells SDD which datasphere to publish to. There is no default; every project specifies its own target.

```yaml
project: my-feature
targetDatasphere: my-datasphere-uri    # the URI of YOUR datasphere
folder: "Feature Specs"                # folder for spec pages (default: "Feature Specs")
```

This means you can run SDD on any datasphere you own by just changing `targetDatasphere`. No env var changes needed.

---

## Visibility & Folder Rules

**Visibility model (important):** Three orthogonal controls, don't conflate them.

| Control | What it gates | SDD default |
|---|---|---|
| DS `status` | Who can enter the datasphere at all | `PRIVATE` always (members-only access to everything under `/app/<uri>/...`) |
| Page `status` | Is this page live? `DRAFT` = work-in-progress, `PUBLISHED` = real | `PUBLISHED` for every SDD-managed page, always |
| Page `isPubliclyVisible` | Can non-members see this published page? | `true` for reader-view specs; `false` for internal dashboards/trackers |

**Never use `DRAFT` to mean "internal."** Internal-only pages (dashboard, phase trackers, planner mirrors) are `status: PUBLISHED, isPubliclyVisible: false` — DS privacy keeps non-members out; the page is fully live for members.

- `public: true` frontmatter → `{ status: "PUBLISHED", isPubliclyVisible: true }` (reader view at `/docs/<uri>/<slug>`, no login needed)
- `public: false` or omitted → `{ status: "PUBLISHED", isPubliclyVisible: false }` (members see it at `/app/<uri>/docs/<slug>`, non-members blocked by DS privacy)
- Only use `status: "DRAFT"` during active edits that shouldn't be shown to anyone yet — then flip to PUBLISHED when ready.

**Naming convention:**
- `/docs/<uri>/<slug>` — **reader view** (for external readers; no login required on PUBLIC pages)
- `/app/<uri>/docs` — **editor list view** (members only; where maintainers manage spec content)
- `/app/<uri>/docs/<slug>` — **single-page editor** (members only)

**Folder placement** — read from `tasks.yaml:folder` (default: `"Feature Specs"`). The folder name is used on every page create/update call. Never hardcode it in the skill.

---

## Task Tracker HTML Format

The Task Tracker is appended to the spec page content as a clearly-delimited HTML section. **This is the contract — never change the delimiters or ID scheme.**

```html
<!-- SDD:TASK_TRACKER_START -->
<h2>📋 Task Tracker</h2>
<p><strong>Progress:</strong> 3 of 12 complete (25%)</p>
<p>
  <span style="display:inline-block;background:#22c55e;color:white;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:4px;">✅ 3 Done</span>
  <span style="display:inline-block;background:#3b82f6;color:white;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:4px;">🔵 1 In Progress</span>
  <span style="display:inline-block;background:#ef4444;color:white;padding:2px 8px;border-radius:4px;font-size:12px;margin-right:4px;">🔴 0 Blocked</span>
  <span style="display:inline-block;background:#6b7280;color:white;padding:2px 8px;border-radius:4px;font-size:12px;">⬚ 8 Pending</span>
</p>

<h3>Phase 1: Foundation</h3>
<ul>
  <li><p><span style="display:inline-block;background:#22c55e;color:white;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:bold;margin-right:6px;">DONE</span> <strong>Task 1:</strong> Prisma schema migration</p></li>
  <li><p><span style="display:inline-block;background:#3b82f6;color:white;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:bold;margin-right:6px;">IN PROGRESS</span> <strong>Task 2:</strong> Server CRUD endpoints</p></li>
  <li><p><span style="display:inline-block;background:#6b7280;color:white;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:bold;margin-right:6px;">PENDING</span> <strong>Task 3:</strong> Basic renderer component</p></li>
</ul>

<h3>Phase 2: Visualization</h3>
<ul>
  <li><p><span style="display:inline-block;background:#ef4444;color:white;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:bold;margin-right:6px;">BLOCKED</span> <strong>Task 5:</strong> Add Recharts — <em>Blocked: waiting on bundle size analysis</em></p></li>
</ul>

<p><em>Last updated: 2026-03-27T19:30:00Z by SDD</em></p>
<!-- SDD:TASK_TRACKER_END -->
```

### Status Badges

| Status | Color | Badge |
|--------|-------|-------|
| `DONE` | `#22c55e` (green) | `✅ DONE` |
| `IN PROGRESS` | `#3b82f6` (blue) | `🔵 IN PROGRESS` |
| `BLOCKED` | `#ef4444` (red) | `🔴 BLOCKED` |
| `PENDING` | `#6b7280` (gray) | `⬚ PENDING` |

### Task ID Scheme

Tasks are numbered sequentially across all phases: Phase 1 tasks are 1–N, Phase 2 continues from N+1, etc. Task numbers are stable — never renumber after init.

---

## Workflows

### `/sdd init <uri>/<slug>`

Initialize SDD tracking on an existing single-page spec.

**Steps:**

1. **Parse args** — split on `/` to get `uri` and `slug`. Both are required.

2. **Load env** — `export $(grep -v '^#' ~/.dataspheres.env | xargs)`.

3. **Fetch the spec page:**
```bash
curl -s "$DATASPHERES_BASE_URL/api/v1/dataspheres/<uri>/pages/<slug>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
```

4. **Parse implementation phases** from the spec content. Look for `<h3>Phase N: ...</h3>` followed by `<ul>` with `<li>` items. Each `<li>` becomes a task.

5. **Generate the Task Tracker HTML** using the format above. All tasks start as `PENDING`.

6. **Check if a tracker already exists** — look for `<!-- SDD:TASK_TRACKER_START -->` in the content. If it exists, warn the user and ask before overwriting.

7. **Append the tracker** to the page content (after the last section).

8. **Read folder from `tasks.yaml:folder`** if it exists in the current directory, else default to `"Feature Specs"`.

9. **Push the updated content:**
```bash
curl -X PUT "$DATASPHERES_BASE_URL/api/v1/dataspheres/<uri>/pages/<slug>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "<full-updated-html>", "status": "PUBLISHED", "isPubliclyVisible": false, "folderName": "<folder>"}'
```

10. **Save local state** to `.sdd/` directory (gitignored):
```bash
mkdir -p .sdd
cat > .sdd/<slug>.json << 'EOF'
{
  "slug": "<slug>",
  "uri": "<uri>",
  "folder": "<folder>",
  "initialized": "<ISO timestamp>",
  "tasks": [
    { "id": 1, "phase": "Phase 1: Foundation", "description": "...", "status": "PENDING" }
  ]
}
EOF
```

11. **Add `.sdd/` to `.gitignore`** if not already there.

12. **Display the task list** to the user with IDs and statuses.

---

### `/sdd task <n> in-progress` | `/sdd task <n> done` | `/sdd task <n> blocked <reason>`

Update a task's status.

**Steps:**

1. **Read local state** from `.sdd/<slug>.json`. If no active spec, tell the user to run `/sdd init` first.

2. **Update the task status** in local state.

3. **Fetch current page content** from the API (in case someone else edited it).

4. **Extract the Task Tracker section** between `<!-- SDD:TASK_TRACKER_START -->` and `<!-- SDD:TASK_TRACKER_END -->`.

5. **Regenerate the Task Tracker HTML** from the updated local state (recalculate progress counts, update badge for the target task).

6. **Replace the old tracker** in the page content with the new one.

7. **Push the updated content** via PUT. Read `uri` and `folder` from `.sdd/<slug>.json`.

8. **Confirm** to the user: "Task 3 → DONE. Progress: 4/12 (33%)".

---

### `/sdd status`

Show current SDD progress.

**Steps:**

1. **Find active spec** — look for `.sdd/*.json` in the current directory.
2. **Fetch the spec page** from the API using `uri` + `slug` from the local state file.
3. **Parse the Task Tracker** to get live status.
4. **Display a formatted table** of all tasks grouped by phase with status badges.
5. **Show progress summary**: N of M complete (X%).

---

### `/sdd sync`

Reconcile local state with remote spec.

**Steps:**

1. **Find active spec** — look for `.sdd/*.json`.
2. **Fetch the spec page** from the API.
3. **Parse the Task Tracker section**.
4. **Compare with local `.sdd/<slug>.json`**.
5. **If they differ**, ask the user which source to trust (remote wins by default).
6. **Update local state** to match.

---

## Automatic SDD Integration

When working on a feature that has an active SDD spec (`.sdd/<slug>.json` exists):

1. **Before starting a task** — run the equivalent of `/sdd task <n> in-progress` to mark it active.
2. **After completing a task** — run the equivalent of `/sdd task <n> done` to mark it complete and update the spec.
3. **If blocked** — run `/sdd task <n> blocked <reason>` with context.

This keeps the spec page as a live dashboard of implementation progress.

---

## API Calls Summary

All calls use `Authorization: Bearer $DATASPHERES_API_KEY`. The `<uri>` always comes from `tasks.yaml:targetDatasphere` (multi-file) or the `.sdd/<slug>.json` state (single-file). It is **never** read from an env var.

| Action | Method | Endpoint | Notes |
|--------|--------|----------|-------|
| Fetch spec | GET | `/api/v1/dataspheres/:uri/pages/:slug` | |
| Update spec | PUT | `/api/v1/dataspheres/:uri/pages/:slug` | Always send folder from project config |
| Create spec | POST | `/api/v1/dataspheres/:uri/pages` | |
| List specs | GET | `/api/v1/dataspheres/:uri/pages?folder=<folder>` | Use project folder name |

---

## Error Handling

| Scenario | Action |
|----------|--------|
| No `.sdd/*.json` found | Tell user to run `/sdd init <uri>/<slug>` first |
| Task number out of range | Show valid range and task list |
| API returns 401 | Check `DATASPHERES_API_KEY` in `~/.dataspheres.env`; confirm local server is running if targeting localhost |
| API returns 404 | Check slug and URI match what's in the datasphere |
| Tracker section missing from page | Warn that someone may have removed it, offer to re-append |
| Content conflict (remote changed) | Fetch fresh, re-apply tracker, push |
| `targetDatasphere` missing from `tasks.yaml` | Stop and tell the user — this field is required, there is no default |

---

## Promote to Production (`/sdd promote <slug>`)

Specs live on localhost as DRAFT/PUBLISHED until explicitly promoted to production. This is a one-way copy — local remains the working copy.

**Steps:**

1. **Read `uri`** from `.sdd/<slug>.json` or `tasks.yaml:targetDatasphere`.

2. **Fetch the spec page** from the local server.

3. **Confirm with the user**: "Promote `<slug>` to `<uri>` on dataspheres.ai? This will create/update the page on the live server."

4. **Push to production** (one-shot override — `BASE_URL` only, key from separate prod file):
```bash
PROD_KEY=$(grep DATASPHERES_API_KEY ~/.dataspheres-prod.env | cut -d= -f2)
curl -X PUT "https://dataspheres.ai/api/v1/dataspheres/<uri>/pages/<slug>" \
  -H "Authorization: Bearer $PROD_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title": "<title>", "content": "<full-html>", "status": "PUBLISHED", "isPubliclyVisible": false, "folderName": "<folder>"}'
```

5. **Note:** Pages land as `PUBLISHED, isPubliclyVisible: false` on production by default — members see them, the public doesn't. Flip `isPubliclyVisible` via the UI for public reader view.

---

# Multi-file Spec Projects (`specs/<project>/`)

> For anything bigger than a single page, iterate locally in a repo directory, then publish to DS in one coordinated pass (pages + planner tasks + tracker dataset + dashboard).

Everything below is **project-agnostic** — the same flow works for any spec on any datasphere. Drop files into `specs/my-project/` matching the conventions and the skill publishes them.

## Directory contract

```
specs/<project>/
├── README.md                ← project-specific notes (freeform)
├── 001-<section>.md         ← spec pages with YAML frontmatter
├── 002-<section>.md
├── ...
├── tasks.yaml               ← planner task definitions + project config
└── tracker-schema.yaml      ← dataset schema + datacards + dashboard
```

### Page frontmatter contract

```yaml
---
slug: my-feature-vision                 # stable — used for page upsert
title: "Section title"
folder: Feature Specs                   # folder for this page (overrides tasks.yaml default)
public: true                            # → status: PUBLISHED, isPubliclyVisible: true
version: 1
requirements: [R-001, R-002, R-003]     # requirement IDs on this page
---
```

### Phase structure

Each spec page (`NNN-*.md`) represents a **phase** of the project. Requirements belong to exactly one phase (by R-number hundreds: R-001…R-099 = phase 1, R-101…R-199 = phase 2, etc). Tasks inherit the phase of their requirement.

This lets the dashboard aggregate by `phase_number` and render per-phase progress bars.

Body is CommonMark. Each requirement follows:

```markdown
### R-001 · Short title

Prose requirement.

**Acceptance**
- [ ] Criterion 1
- [ ] Criterion 2

**Verification URL:** _(filled on completion)_
```

### tasks.yaml shape

```yaml
project: <slug>                # matches the dir name
targetDatasphere: <ds-uri>     # REQUIRED — which datasphere to publish to
folder: "Feature Specs"        # default folder for all spec pages (overridable per-page)

# Planner columns
statusGroups:
  - { name: "To Do",       order: 0 }
  - { name: "In Progress", order: 1 }
  - { name: "Blocked",     order: 2 }
  - { name: "Done",        order: 3, isDoneState: true }

tasks:
  - id: T-001                  # stable, not reordered
    requirementId: R-001
    title: "R-001 · short title"
    statusGroup: "To Do"
    priority: HIGH | MEDIUM | LOW
    tags: [tag1, tag2]
    initiative: <initiative-slug>   # groups tasks in Plan Mode filter
    legacyImpact: none | additive | breaking
    rollbackSafe: safe | manual
    userApproved: no | yes     # must be yes before any breaking task can move to IN_PROGRESS
    depends_on: [T-XXX, T-YYY] # prerequisite task IDs
    verificationUrl: ""        # filled when DONE
    content: |                 # rich HTML hand-off doc (see below)
      ...
```

**Column ↔ status coupling (server-side):** The tasks controller auto-maps a task's `statusGroup` name → `TaskStatus` enum when a task is moved between columns. Names that auto-map: "To Do" → TODO, "In Progress" → IN_PROGRESS, "Blocked" → BLOCKED, "Done" → DONE. A group with `isDoneState: true` forces status=DONE regardless of name.

### Task content (the hand-off doc)

`content` is the rich-text body rendered in the planner card. It MUST be a complete hand-off doc so any future LLM or engineer can pick up the task without chasing context. Required sections:

```html
<h3>🎯 User Story</h3>
<p>...why this task exists, lifted from the phase spec...</p>
<p><em>Source spec:</em> <a href="/docs/<uri>/<spec-slug>">Phase N · Name</a></p>

<h3>📋 Requirement</h3>
<blockquote><p><strong>R-XXX</strong> — verbatim requirement prose</p></blockquote>

<h3>✅ Acceptance</h3>
<ul>
  <li><p>☐ criterion 1 — observable behavior</p></li>
  <li><p>☐ criterion 2 — test coverage</p></li>
</ul>

<h3>🛠 Implementation Scope</h3>
<p><strong>Touch these files:</strong></p>
<ul>
  <li><p><code>src/…/path.ts</code> — what to do here</p></li>
</ul>
<p><strong>Architectural pattern:</strong> ...</p>

<h3>🚫 Out of Scope</h3>
<p>...what NOT to build in this task...</p>

<h3>⚠️ Caveats &amp; Risks</h3>
<ul>
  <li><p><strong>Legacy impact:</strong> <code>additive|breaking</code></p></li>
  <li><p><strong>Rollback:</strong> <code>safe|manual</code></p></li>
</ul>

<h3>🔗 Depends on</h3>
<ul>
  <li><p><strong>T-XXX</strong> — prerequisite title (must be DONE first)</p></li>
</ul>

<h3>🔍 Verification</h3>
<p><strong>URL:</strong> <em>_(PR or commit)_</em></p>
<p><strong>@satisfies annotation:</strong> add <code>@satisfies R-XXX</code> to the primary implementation file.</p>
```

**Never store structured config** (legacy_impact, rollback_safe, depends_on, etc.) **as JSON in content.** Those belong in the polymorphic CodeApplication system (see `codeFamilies` + `shadow.columnMap`). Content is for humans + LLMs consuming prose.

### tracker-schema.yaml shape

```yaml
dataset:
  name: "<project> Tracker"
  slug: <project>-tracker
  description: "..."
  minRole: PARTICIPANT
  sourceType: task_shadow              # enables planner → dataset one-way sync
  schema:
    - { name: planner_task_id, type: text, required: true }
    - { name: requirement_id,  type: text, required: true }
    - { name: status,          type: text, required: true }
    - { name: priority,        type: text }
    - { name: title,           type: text }

  shadow:                              # written to Dataset.customInstructions
    tagFilter: [sdd, <project>]        # only tasks with ALL these tags sync in
    identityColumn: planner_task_id    # row key
    columnMap:
      planner_task_id: id
      title: title
      status: status
      priority: priority
      created_at: createdAt
      completed_at: completedAt
      requirement_id: { tagPrefix: "req:" }
      legacy_impact: { fromCodeFamily: "Legacy Impact" }
      rollback_safe:  { fromCodeFamily: "Rollback Safe" }

# Seed BEFORE publishing tasks. Every bounded value (legacyImpact, rollbackSafe, etc.)
# must have a matching CodeFamily here or shadow extraction returns blanks.
codeFamilies:
  - name: "Legacy Impact"
    values: [none, additive, breaking]
  - name: "Rollback Safe"
    values: [safe, irreversible]
  - name: "User Approved"
    values: [yes, no]

dataCards:
  - name: "Status Breakdown"
    slug: <project>-status
    # Natural-language prompt — AI-configure generates the SQL + vizConfig.
    # Do NOT pre-write SQL here.
    prompt: "Show task count by status as a bar chart."
    vizType: bar
    summary: "Tasks by current status"

dashboard:
  slug: <project>-dashboard
  title: "<Project> Progress Dashboard"
  folder: Feature Specs
  public: false                        # dashboard stays internal
  intro: "Live progress for <project>."
  cardOrder: [<project>-status, ...]
```

### Task status vocabulary

Tasks in the planner use a **fixed vocabulary**: `TODO | IN_PROGRESS | DONE | BLOCKED`. Tracker rows inherit these verbatim via shadow-sync.

**Dashboard card prompts MUST reference this vocabulary** — e.g. "rows with status = `TODO`" (not `PENDING`). Fresh projects start with all rows at `TODO`; a card built against `PENDING` renders blank forever.

---

## Commands

### `/sdd publish <project-dir>`

Publish all artifacts to the target datasphere in one pass. Idempotent — safe to re-run.

**Steps:**

1. **Load env** — `export $(grep -v '^#' ~/.dataspheres.env | xargs)`.

2. **Read project config** — parse `tasks.yaml`. Require `targetDatasphere`. Read `folder` (default: `"Feature Specs"`).

3. **Resolve DS** — GET `/api/v1/dataspheres/<targetDatasphere>`. If 404, POST to create with `{ uri: <targetDatasphere>, status: "PRIVATE" }`. If exists but not PRIVATE, PUT to set `status: "PRIVATE"`.

4. **Set DS purpose** — render the maintainer quick-links template (see below) and PUT `/api/v1/dataspheres/<uri>`.

5. **Seed CodeFamilies** (from `tracker-schema.yaml:codeFamilies`):
   - GET `/api/v1/code-families?datasphereId=<id>` → find by name.
   - If missing, POST `/api/v1/code-families` with `{ name, datasphereId }`.
   - For each value, POST `/api/v1/research-codes` if missing.
   - Ensure a `"Tags"` family exists for `sdd`, `<project>`, and `req:R-XXX` tags.

6. **Publish pages** — for each `NNN-*.md`:
   - Read frontmatter + body. Strip frontmatter block before converting.
   - Convert markdown to HTML (use `pandoc` if available, else the minimal converter below).
   - Derive `status` + `isPubliclyVisible` from frontmatter `public` flag.
   - Use `frontmatter.folder` if present, else `tasks.yaml:folder`.
   - POST `/api/v1/dataspheres/:uri/pages` with `{slug, title, content, folderName, status, isPubliclyVisible}`.
   - Same slug → update in place (upsert).

7. **Ensure status groups** — for each `statusGroups` entry, GET then POST if missing.

8. **Ensure initiative Plan Mode** — if `tasks.yaml` has an `initiative` field (any task with `initiative: <slug>`):
   - GET `/api/v2/dataspheres/:dsId/plan-modes` — look for a plan mode whose filter includes the initiative tag.
   - If none found, POST `/api/v2/dataspheres/:dsId/plan-modes` with `{ name: "<initiative> Initiative", tagFilter: ["<initiative>"] }`.
   - This creates a dedicated planner board scoped to all tasks tagged with this initiative — one user can have many projects/initiatives, each with its own board.

9. **Publish tasks** — POST `/api/v2/dataspheres/:dsId/tasks/bulk` with full task list. `content` must be the full hand-off doc HTML.

10. **Apply CodeApplications** — for each task, apply `legacyImpact`, `rollbackSafe`, `userApproved`, `initiative`, `req:R-XXX` tags, and `sdd`/`<project>` base tags:
    - POST `/api/v1/code-applications` with `{ researchCodeId, targetType: "task", targetId }`.
    - Idempotent: GET first, skip if already applied.

11. **Create/update tracker dataset** — POST `/api/v2/dataspheres/:dsId/datasets` with schema + shadow config. Backfill rows via POST `/sync-tasks`.

12. **Create + configure datacards** — for each entry in `dataCards`:
    - POST `/ai-configure` with `{ prompt, vizType }`. **Must return non-null `vizConfig`.**
    - POST card with `{ name, slug, query, vizType, vizConfig, summary }`.

13. **Generate dashboard page** — render HTML with intro + card embeds:
    ```html
    <div data-type="data-card" data-card-id="<cardId>"></div>
    ```
    POST as `{ status: "PUBLISHED", isPubliclyVisible: false }`.

14. **Print summary — always use `$DATASPHERES_PUBLIC_URL`, never `$BASE_URL`, for these links:**
    - Planner (initiative board): `$DATASPHERES_PUBLIC_URL/app/<uri>/planner`
    - Dashboard: `$DATASPHERES_PUBLIC_URL/app/<uri>/docs/<dashboard-slug>`
    - Tracker dataset: `$DATASPHERES_PUBLIC_URL/app/<uri>/datasets/<dataset-slug>`

### `/sdd publish <project> --dry-run`

Print what _would_ change (page titles, task counts, dataset columns) without calling the API.

### `/sdd publish <project> --pages-only | --tasks-only | --tracker-only | --dashboard-only`

Scope the publish to one artifact type.

### `/sdd coverage <project>`

Scan the codebase for `@satisfies R-XXX` JSDoc annotations, match against `tasks.yaml`, update tracker dataset rows:

- `@satisfies` + matching test → task status = DONE, stamp `commit_sha`.
- `@satisfies` only, no test → task status = IN_PROGRESS.
- No annotation → task status stays PENDING.

### `/sdd sync <project>`

Pull current task statuses from planner + tracker dataset, reconcile with local `tasks.yaml`. Report any remote-only changes.

### `/sdd visibility <project>`

Flip every page with `public: true` frontmatter to `{ status: "PUBLISHED", isPubliclyVisible: true }`. Pages with `public: false` stay PUBLISHED + private.

### `/sdd about <project>`

Re-render the datasphere purpose with maintainer quick-links and PUT `/api/v1/dataspheres/:uri`.

### `/sdd dashboard-refresh <project>`

Regenerate every card's `vizConfig` against the current dataset schema + sample rows. Use when cards render blank (vizConfig: null) or when you add rows and need re-configuration.

Steps: for each card, POST `/ai-configure` with current `prompt + vizType`, then PATCH `/cards/:id` with returned `query + vizConfig`.

---

## Safety rails

1. **Never `--force` through `legacyImpact: breaking` without `userApproved: true`.** Confirm interactively before moving a breaking task to IN_PROGRESS.
2. **`targetDatasphere` is required.** The skill stops and asks if it's missing — no default URI.
3. **Requirement IDs are stable.** The skill refuses to publish if a previously-published R-XXX is missing without an explicit `deprecated: true` frontmatter flag on the old page.
4. **Dataset rows are keyed by `task_id`.** Updates are upserts; rows are never deleted unless explicitly asked.

---

## Minimal markdown → HTML converter (if pandoc unavailable)

Handles the subset spec pages use:

- `## X` → `<h2>X</h2>`
- `### X` → `<h3>X</h3>`
- `**X**` → `<strong>X</strong>`
- `` `X` `` → `<code>X</code>`
- `- X` (consecutive lines) → `<ul><li><p>X</p></li>…</ul>`
- `- [ ] X` / `- [x] X` → checkbox list with `☐` / `☑` prefix
- Blank-line separated blocks → `<p>…</p>`
- `> X` → `<blockquote><p>X</p></blockquote>`
- Frontmatter block (between `---` delimiters) — stripped before conversion

Anything more complex → require pandoc (`brew install pandoc` / `apt install pandoc`).

---

## Datasphere purpose — maintainer quick-links

Every SDD-managed datasphere must surface quick-links. Render this template and PUT it as the DS `purpose` field. Driven by `/sdd about <project>`.

```html
<h2>What is <project-name>?</h2>
<p>...one-paragraph hook — what this spec covers and why it matters...</p>

<h2>Maintainer quick-links</h2>
<ul>
  <li><p><strong>📚 Public docs</strong> — <a href="/docs/<uri>">spec pages (no login)</a></p></li>
  <li><p><strong>📋 Planner</strong> — <a href="/app/<uri>/planner">tasks by status</a></p></li>
  <li><p><strong>📊 Tracker dataset</strong> — <a href="/app/<uri>/datasets/<dataset-slug>">live rows</a></p></li>
  <li><p><strong>📈 Dashboard</strong> — <a href="/app/<uri>/docs/<dashboard-slug>">status cards</a></p></li>
  <li><p><strong>✏️ Doc editor</strong> — <a href="/app/<uri>/docs">edit specs (login required)</a></p></li>
</ul>

<h2>Maintainer instructions</h2>
<ol>
  <li><p>Specs live in <code>specs/<project>/NNN-*.md</code> locally in the repo.</p></li>
  <li><p>Edit locally, then <code>/sdd publish specs/<project></code> to push everything.</p></li>
  <li><p>Mark tasks done by adding <code>@satisfies R-XXX</code> JSDoc to code + tests, then <code>/sdd coverage specs/<project></code> flips the tracker row.</p></li>
  <li><p>Breaking changes require <code>userApproved: true</code> in <code>tasks.yaml</code> before the task can move to IN_PROGRESS.</p></li>
</ol>

<blockquote><p>One-sentence thesis for this spec project.</p></blockquote>
```

---

## Getting started (new project)

1. Get a developer key from the **Developers** panel in any datasphere you own.
2. Add it to `~/.dataspheres.env`:
   ```bash
   echo "DATASPHERES_API_KEY=dsk_..." >> ~/.dataspheres.env
   echo "DATASPHERES_BASE_URL=http://localhost:5173" >> ~/.dataspheres.env
   echo "DATASPHERES_PUBLIC_URL=https://dev.dataspheres.ai" >> ~/.dataspheres.env
   ```
3. Create a `specs/<my-project>/` directory with your spec markdown files.
4. Add `tasks.yaml` with `targetDatasphere: <your-datasphere-uri>`.
5. Run `/sdd publish specs/<my-project>`.
6. Open the dashboard URL printed at the end.
7. Add `@satisfies R-XXX` to code as work lands; run `/sdd coverage` to flip tracker rows.

Zero shell scripts. The skill orchestrates everything via `curl` + file reads.

---

## Gotchas (discovered during dogfood)

| Gotcha | Fix |
|---|---|
| `GET /pages` returns `{pages:[],total:0}` even when pages exist | Pass `?status=PUBLISHED` or `?status=DRAFT` explicitly — default hides both |
| Task `status` vocabulary is `TODO / IN_PROGRESS / DONE / BLOCKED` — not `PENDING` | Card prompts + shadow `columnMap` must match this vocabulary exactly |
| Card renders blank on dashboard | `vizConfig: null` — run `/sdd dashboard-refresh <project>` |
| Dataset has rows but card shows zero results | Card `query` references a column not in shadow rows — fix `columnMap` and re-publish tracker |
| `requirement_id` column is null on every row | Tasks aren't tagged `req:R-XXX` — fix `tasks.yaml` and re-run `--tasks-only` |
| CodeFamily values not extracted into rows | CodeApplications weren't applied — re-run step 9 of `/sdd publish` |
| `POST /api/v1/dataspheres` returns 401 | API key needs `datasphere:write` scope — create a fresh key via the Developers panel |
| Every DS has a "Default Tasks" dataset I didn't create | Platform auto-creates a companion dataset per PlanMode. Do NOT delete — planner UI depends on it. SDD's `task_shadow` dataset coexists as a richer projection |
| `targetDatasphere` missing — skill stops | This field is required in `tasks.yaml`. No default URI exists by design |
