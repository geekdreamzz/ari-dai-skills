<!-- dai-sync: skip -->
# all-dai-sdd — Spec-Driven Development

Drive feature implementation from a living spec hosted on Dataspheres AI. Five-column lifecycle with sub-checklist propagation, dependency enforcement, and a live stakeholder dashboard.

---

## Five-Column Lifecycle

```
North Stars  →  Epics  →  Execution  →  Validation  →  Done
```

Every SDD project uses exactly these five columns, in this order. When you create a plan mode for an initiative, you must create five status groups with these exact names — do NOT use the planner's default columns (To Do / In Progress / Done).

---

## Quickstart

```bash
# Load credentials
export $(grep -v '^#' ~/.dataspheres.env | xargs)

# Publish a spec
/all-dai-sdd publish specs/my-feature
```

---

## No Mocks Rule — Hardened Enforcement

**Mocks are bugs. They are never acceptable at any layer of an SDD project.**

A mock is defined as any of the following:
- A stub function that returns hardcoded or synthetic output instead of calling the real tool
- A synthetic data file that substitutes for a real golden dataset
- A `generate_mock_data.py` or equivalent that injects fake inputs to avoid downloading real reference files
- A `unittest.mock`, `MagicMock`, `patch`, or any Python mock/patch mechanism on pipeline functions
- A conditional `if not tool_available: return fake_result` fallback
- Any comment saying "we'll replace this with the real thing later"

**When a dependency is missing, the task is BLOCKED — not worked around.**

### BLOCKED task protocol

1. Mark the task status `BLOCKED` immediately on discovery
2. Post a comment on the task with this exact format:
   ```
   [BLOCKED] <dependency name> not available.
   Required: <exact install steps or acquisition steps>
   Blocks: <list of downstream task IDs>
   Resolution: <what must happen before this task can move to Execution>
   ```
3. Every downstream task that depends on the blocked task is also marked `BLOCKED` with a note referencing the upstream blocker
4. No code in any downstream file may call, import, or reference the blocked tool — not even with a try/except guard
5. The BLOCKED status cascades in the SDD board: no task in Execution or Validation can be marked Done while an upstream blocker is unresolved
6. A task leaves BLOCKED only when the dependency is installed, verified working with `which <tool>` or equivalent, and the verification output is pasted into the task comment

### What this rule means in practice

- GATK4 not installed → `variant_caller.py` exists as a documented interface only; task = BLOCKED
- BWA-meth not on PATH → `methylation.py` = BLOCKED; all Tier 1 Validation tasks = BLOCKED
- FoldX/PyRosetta no license → `energy_calc.py` = BLOCKED; Tier 3 Validation = BLOCKED
- hap.py not installed → `validate_tier1.py` = BLOCKED
- Golden dataset not downloaded → Validation task that uses it = BLOCKED until download verified

### Enforcement in gate checks

At every Execution → Validation gate: scan all task contents for any of:
`mock`, `stub`, `fake`, `patch`, `MagicMock`, `generate_mock`, `synthetic`, `placeholder`, `TODO: replace`

If found → gate fails with:
```
🚫 GATE [N/14] BLOCKED — Mock/stub detected in <file>:<line>
Required: Remove mock, install real dependency, and re-run.
```

This check is mandatory before any task may move to the Validation column.

---

## `/sdd publish <project-dir>` — Gated Publish Protocol

**Every step is mandatory. No step may be skipped, reordered, or batched with another.**

After completing each step you MUST output a gate block before touching anything for the next step:

```
✅ GATE [N/14] <step-name> | <ISO-timestamp> | <evidence>
```

If a step cannot be completed, output this and STOP — do not proceed:

```
🚫 GATE [N/14] BLOCKED — <reason> | Required before continuing: <what must happen>
```

The gate block is the contract. Its absence means the step was skipped. Its evidence line must be falsifiable — paste the actual API response ID, file path, or count. "Done" or "completed" with no evidence is not accepted.

---

### Step 1 of 14 — Load env
→ *Detail: line 193 (Credential Setup)*

```bash
export $(grep -v '^#' ~/.dataspheres.env | xargs)
```

Verify all three vars are non-empty: `DATASPHERES_API_KEY`, `DATASPHERES_BASE_URL`, `DATASPHERES_PUBLIC_URL`.

**Gate evidence required:** `API_KEY=dsk_***, BASE_URL=<value>, PUBLIC_URL=<value>`

---

### Step 2 of 14 — Read tasks.yaml
→ *Detail: line 238 (tasks.yaml shape)*

Parse `<project-dir>/tasks.yaml`. Require `targetDatasphere` field — stop with BLOCKED if missing.

**Gate evidence required:** `initiative=<slug>, targetDatasphere=<uri>, <N> tasks found`

---

### Step 3 of 14 — Confirm target datasphere (interactive)

Print the datasphere URI and base URL. Wait for explicit user confirmation before any writes. This is the point of no return.

**Gate evidence required:** `User confirmed: yes | target=<uri> on <BASE_URL>`

---

### Step 4 of 14 — Resolve datasphere DB id
→ *Detail: line 198 (API Note — datasphereId vs URI)*

```bash
curl -s "$DATASPHERES_BASE_URL/api/v1/dataspheres/<uri>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
```

Capture `datasphere.id` (e.g. `ds_default`). This is the `dsId` used in all v2 API calls. The URI is NOT the dsId.

**Gate evidence required:** `dsId=<id> name=<name>`

---

### Step 5 of 14 — Seed CodeFamilies

Ensure these six CodeFamilies + their values exist in the datasphere:
- `Legacy Impact` — values: `none`, `additive`, `breaking`
- `Rollback Safe` — values: `safe`, `manual`
- `User Approved` — values: `yes`, `no`
- `Tags` — seed value: `<initiative-slug>`
- `Spec Type` — values: `data-schema`, `api-contract`, `algorithm`, `data-flow`, `user-journey`, `architecture`, `component`, `integration`, `acceptance-criteria`, `test-plan`, `ctx-prompt`, `ctx-code`, `ctx-search`, `ctx-doc`, `ctx-legacy`, `result`
- `Spec Domain` — seed value: `<DOMAIN>` (e.g. `AUTH`, `NOTIF`, `PLAN`, `DATA`)

GET first; POST only if missing. Capture family IDs for use in step 10.

**Gate evidence required:** `6 families confirmed (IDs: <id1>...<id6>)`

---

### Step 6 of 14 — Publish vision page
→ *Detail: line 270 (CLAUDE.md Integration)*

Publish `001-*.md` as a DS reader page (status: PUBLISHED, isPubliclyVisible: false, folderName: "Feature Specs"). PUT if slug already exists.

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v1/dataspheres/<uri>/pages" \   # v1 uses URI not dsId
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug":"<slug>","title":"...","content":"...","status":"PUBLISHED","isPubliclyVisible":false,"folderName":"Feature Specs"}'
```

**Gate evidence required:** `slug=<slug> HTTP 200/201`

---

### Step 7 of 14 — Create initiative Plan Mode
→ *Detail: line 77 (Dashboard Page Template — planner URL uses `?mode=`)*

GET existing plan modes first. If none match `tagFilter: ["<initiative>"]`, POST a new one.

**Preferred approach** — pass `columns` in the POST to prevent default columns from being created at all (avoids having to delete `To Do` / `In Progress` / `In Review` in step 8):

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"<Initiative Name>","tagFilter":["<initiative-slug>"],"columns":[{"name":"North Stars","color":"#7c3aed","isDoneState":false},{"name":"Epics","color":"#0891b2","isDoneState":false},{"name":"Execution","color":"#3b82f6","isDoneState":false},{"name":"Validation","color":"#f59e0b","isDoneState":false},{"name":"Done","color":"#22c55e","isDoneState":true}]}'
```

If the API does not accept `columns` on POST (older server version), omit it and clean up defaults in step 8:

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"<Initiative Name>","tagFilter":["<initiative-slug>"]}'
```

Capture `planModeId`. The planner URL is `?mode=<planModeId>` — NOT `?planMode=`.

**Gate evidence required:** `planModeId=<id>`

---

### Step 8 of 14 — Verify 5 scoped status groups (delete defaults if needed)
→ *Detail: line 122 (Column Architecture)*

**CRITICAL — do NOT reuse existing status groups from other plan modes or the datasphere defaults.**

**If `columns` was passed in step 7**, no default columns will exist — this step only needs to verify the 5 groups and correct any `sortOrder` values if needed:

```bash
# Verify all 5 groups exist with correct names
curl "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups?planModeId=<planModeId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
# Expected: North Stars, Epics, Execution, Validation, Done — no other groups
```

**If `columns` was NOT passed in step 7**, the plan mode auto-creates 3 default columns (`To Do`, `In Progress`, `In Review`) AND a `Done` group. You must DELETE the 3 defaults and POST the 4 SDD groups — the auto-created `Done` is kept.

```bash
# 1. GET all groups scoped to this plan mode — find and DELETE the 3 defaults
curl "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
# → filter by planModeId, then DELETE each non-SDD group:
curl -X DELETE "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups/<toDoId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
# Repeat for In Progress and In Review

# 2. POST the 4 SDD groups (North Stars, Epics, Execution, Validation)
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"North Stars","order":0,"planModeId":"<planModeId>"}'
# Repeat for Epics (order:1), Execution (order:2), Validation (order:3)

# 3. GET again — confirm exactly 5 remain: North Stars, Epics, Execution, Validation, Done
```

**Gate evidence required:** `5 groups confirmed: NS=<id> EP=<id> EX=<id> VA=<id> DONE=<id>`

---

### Step 9 of 14 — Publish tasks (bulk)
→ *Detail: line 154 (Task Status vs statusGroupId)*
→ *Detail: North Star Artifact Requirements (enforced here)*

**Pre-publish North Star validation (mandatory before any POST):**

For every `type: north-star` task in tasks.yaml, verify its `content` field contains ALL six required section headings:

```
<h3>Origin Prompts</h3>
<h3>Codebase Context</h3>
<h3>Architecture Constraints</h3>
<h3>Vision</h3>
<h3>North Star Checklist</h3>
<h3>Success Criteria</h3>
```

If any heading is missing:
```
🚫 GATE [9/14] BLOCKED — NS-XXX missing required sections: [list missing]
Required before continuing: Add the missing sections to tasks.yaml content field.
See "North Star Artifact Requirements" section for what each section must contain.
```

Do NOT proceed until all North Stars pass this check.

POST all tasks via bulk endpoint. Each task payload **must** include:
- `statusGroupId` — one of the 5 IDs captured in step 8 (never a foreign group ID)
- `tags` — include the initiative slug so the plan mode filter picks them up
- `content` — full HTML structured as: **spec front matter block → Implementation Files section (EX tasks only) → body sections with heading anchors**

**MANDATORY: Spec front matter block** — every task content MUST begin with this YAML block. A task created without it is a gate failure for step 9:

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-{PREFIX}
title: {task title}
spec_type: {architecture|user-journey|algorithm|test-plan}
version: 1.0.0
status: ACTIVE
column: {north-stars|epics|execution|validation}
epic_ref: {EP-NNN or null for NS tasks}
north_star_ref: {NS-NNN or null for NS tasks}
tags: [{initiative-slug}, sdd, {ns|epic|execution|validation}]
</code></pre>
```

- `spec_type` by column: NS → `architecture`, EP → `user-journey`, EX → `algorithm`, VA → `test-plan`
- `epic_ref`: EX-T1-xxx → `EP-001`, EX-T2-xxx → `EP-002`, EX-T3-xxx → `EP-003`, EX-VH-xxx + VA-xxx → `EP-004`, EX-OR-xxx → `EP-005`, EP-xxx → their parent NS
- `north_star_ref`: all non-NS tasks → `NS-001` (or the relevant NS if multiple exist)

**MANDATORY: Implementation Files section** — every EX task content MUST include this section immediately after the front matter block:

```html
<h3>Implementation Files <!-- #impl --></h3>
<ul>
  <li><code>src/path/to/file.py</code></li>
</ul>
```

List the actual source file(s) this task implements. For BLOCKED tasks, list the intended target file path — it may not exist yet. This section is parsed by the `trace-graph` widget to build the Artifacts tier of the swimlane.

**MANDATORY: Section heading anchors** — every H2 and H3 must carry an anchor comment:

```html
<h2>Acceptance Criteria <!-- #ac --></h2>
<h2>Technical Design <!-- #td --></h2>
<h3>Implementation Files <!-- #impl --></h3>
<h3>Blocked <!-- #blocked --></h3>
```

The anchor format is `<!-- #slug -->` appended to the heading tag content. These are the stable citation targets for code annotations (`// @implements SPEC-AUTH-001#td`).

**Gate check — run before marking step 9 PASS:**
```python
for task in created_tasks:
    assert "spec_id: SPEC-" in task["content"], f"{task['title']} missing front matter"
    if task["title"].startswith("EX-"):
        assert "Implementation Files" in task["content"], f"{task['title']} missing impl files"
    assert "<!-- #" in task["content"], f"{task['title']} missing heading anchors"
```

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/bulk" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"title":"...","statusGroupId":"<scopedGroupId>","tags":["<initiative>"],...}]}'
```

If bulk returns 500, fall back to individual POSTs — but verify every task's `statusGroupId` is from step 8 before posting.

**Gate evidence required:** `<N> tasks created (NS:<n> EP:<n> EX:<n>), all tagged <initiative>, all NS sections verified, all tasks have spec front matter + impl files (EX) + heading anchors`

---

### Step 10 of 14 — Apply CodeApplications

Tag each task with: initiative slug, `sdd`, phase tag, `legacyImpact` value, `rollbackSafe` value, `userApproved` value. Use the CodeFamily IDs from step 5.

**Gate evidence required:** `CodeApplications applied to <N> tasks`

---

### Step 11 of 14 — Create tracker dataset + dataCards + trace datasets

Create or update the tracker dataset. Add dataCards for progress metrics. Skip tracker if the project has no `tracker-schema.yaml`.

Also create two trace datasets (always required — see Trace Health Dashboard section):
1. `<initiative>-traces` — one row per trace entry (from TRACES.yml)
2. `<initiative>-spec-health` — one row per spec (aggregated coverage + drift signal)

Create three data cards from these datasets: Trace Health (donut by status), Spec Coverage by Column (bar), Drift Signals (bar of orphan_count per spec_id). Capture all dataset and data card IDs for use in step 12.

**Gate evidence required:** `tracker=<id> (or: skipped) | traces-dataset=<id> | spec-health-dataset=<id> | 3 data cards created`

---

### Step 12 of 14 — Publish dashboard page

**MANDATORY — use the exact template from the "Dashboard Page Template" section below.** No custom CSS hero banners, no inline style grids — those belong on the close-out Next Steps page only. The step-12 dashboard uses native platform widgets. A page that substitutes custom HTML for platform widgets is a gate failure.

No emojis or raw Unicode in page content (render as `??`). Use HTML entities only.

Required sections (all mandatory, skip none):
1. **Title + subtitle** — plain `<h1>` and `<p>`, no inline styles
2. **Initiative Summary** — `data-widget-type="progress-summary"` with `data-refresh-interval="60"` — renders the full summary card (donut ring, Done/In Progress/Blocked/Pending counts, Next Steps link, Open in Planner link)
3. **Trace Graph** — `data-widget-type="trace-graph"` — renders the 5-tier swimlane (North Stars &rarr; Epics &rarr; Execution &rarr; Validation &rarr; Artifacts) with expandable task cards
4. **Activity feed** — `data-widget-type="task-activity-feed"` — recent comments and screenshots
5. **`<div data-type="doc-footer"></div>`** — always last, no exceptions

**Gate evidence required:** `slug=<dashboard-slug> HTTP 200/201` AND all 5 sections present

---

### Step 13 of 14 — Wire bidirectional links
→ *Detail: line 51 (step 13 in original spec — "do NOT skip")*

Two calls, both required:

**A. Set `trackerUrl` on the plan mode** (surfaces as a button in the planner header):
```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes/<planModeId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"trackerUrl":"$DATASPHERES_PUBLIC_URL/pages/<uri>/<dashboard-slug>"}'
```

**B. Confirm dashboard content includes the planner link** (from step 12). If not present, PUT an updated version now.

**Gate evidence required:** `trackerUrl=<url> set (HTTP 200) | dashboard link verified`

---

### Step 14 of 14 — Publish summary

Output the following, then stop:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SDD PUBLISH COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Initiative:  <slug>
  Datasphere:  <uri> (<dsId>)
  Tasks:       <N> total (NS:<n> EP:<n> EX:<n>)
  Plan mode:   <planModeId>

  Planner:     <PUBLIC_URL>/app/<uri>/planner?mode=<planModeId>
  Dashboard:   <PUBLIC_URL>/pages/<uri>/<dashboard-slug>
  Vision:      <PUBLIC_URL>/pages/<uri>/<vision-slug>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Gate evidence required:** Summary printed with real values (no placeholders)

---

## Dashboard Page Template
→ *Referenced by: Step 12 — MANDATORY. No substitutions.*

**CRITICAL — no emojis or raw Unicode anywhere in this page.** Use HTML entities only. No custom CSS `style=` attributes — the step-12 dashboard uses ONLY native platform widgets. Custom inline styles belong on the close-out Next Steps page, not here.

All 5 sections are required. Replace `<dsId>`, `<uri>`, `<planModeId>`, `<Project>`, `<one-line description>` with real values.

```html
<!-- SECTION 1: Title + subtitle — plain text, no inline styles -->
<h1><Project> &mdash; Initiative Dashboard</h1>
<p><one-line description of the initiative></p>

<!-- SECTION 2: Initiative Summary widget -->
<h2>Initiative Summary</h2>
<div data-type="plannerWidget"
     data-widget-type="progress-summary"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"
     data-refresh-interval="60"></div>

<!-- SECTION 3: Trace Graph widget — 5-tier swimlane (NS > EP > EX > VA > Artifacts) -->
<h2>Trace Graph</h2>
<div data-type="plannerWidget"
     data-widget-type="trace-graph"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<!-- SECTION 4: Activity feed -->
<h2>Live Activity</h2>
<div data-type="plannerWidget"
     data-widget-type="task-activity-feed"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<!-- SECTION 5: doc-footer — ALWAYS LAST -->
<div data-type="doc-footer"></div>
```

The `data-datasphere-uri` attribute enables deep links from the activity feed — each comment card links to its task in the planner at `/app/<uri>/planner?mode=<planModeId>&taskId=<taskId>`.

The `progress-summary` widget renders: donut ring (% complete) + Done / In Progress / Blocked / Pending counts + "Next Steps" link + "Open in Planner" link. It is the authoritative at-a-glance view; do not replace it with a custom ring or custom count grid.

The `trace-graph` widget renders the 5-tier swimlane automatically from the task structure: North Stars &rarr; Epics &rarr; Execution &rarr; Validation &rarr; Artifacts (code files parsed from `Implementation Files` sections). It is expandable and shows task cards per column. Do not replace it with a static Mermaid diagram or custom HTML grid.

**Tag chip deep links (built-in):** Any tag on a task card whose name matches `SPEC-*`, `CTX-*`, or `RESULT-*` is automatically clickable in the Kanban/List views — clicking navigates to `/pages/<uri>/<tag-name-lowercase>`. This means tagging a task with `SPEC-AUTH-001` creates a one-click link from the task card to the corresponding spec page. No extra setup required.

### Valid `data-widget-type` values

**Task-based widgets** — fetch from the planner tasks API. Require `data-datasphere-id` + optional `data-plan-mode-id`.

| Value | Renders |
|---|---|
| `progress-ring` | % complete gauge (donut ring) |
| `column-breakdown` | Count per column with progress bars |
| `active-tasks` | Tasks in Execution / IN_PROGRESS |
| `blocked-tasks` | Blocked tasks |
| `task-activity-feed` | Recent comments + screenshots gallery |

**Spec dataset widgets** — fetch from a dataset. Require `data-datasphere-id` + `data-dataset-id` pointing to a spec tracker dataset where rows have `spec_type`, `status`, and optionally `spec_id`, `title`, `drift`, `drift_reason`.

| Value | Renders | Required columns |
|---|---|---|
| `trace-health` | Matrix: spec_type × status counts | `spec_type`, `status` |
| `drift-alerts` | List of drifted/stale spec items | `status` or `drift` |
| `trace-map` | Tiered SVG (CTX→SPEC→CODE→RESULT), clickable nodes | `spec_type`, `spec_id` |

**Example for spec dataset widgets:**
```html
<div data-type="plannerWidget"
     data-widget-type="trace-health"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<dsUri>"
     data-dataset-id="<spec-tracker-dataset-id>"></div>
```

**Spec front matter cards** — no widget needed. Any YAML fenced code block in a TipTap page that contains a `spec_id:` key is automatically rendered as a SpecFrontMatterCard (status badge, spec type chip, lineage links). Example:
```yaml
spec_id: SPEC-AUTH-001
spec_type: SPEC
status: IN_PROGRESS
title: "Auth token generation"
domain: auth
parent_spec: CTX-AUTH-001
linked_tasks: T-042, T-043
```

---

## Column Architecture
→ *Referenced by: Step 8*

Status groups are scoped to the plan mode. When `createPlanMode` is called with no template, the planner creates its own default columns (To Do / In Progress / Done). These are NOT the SDD columns.

**You must always create 5 new status groups explicitly**, each with `planModeId` set to the new mode's ID. The plan mode auto-creates a `Done` group — GET it rather than POSTing a duplicate (POSTing a second `Done` returns 400).

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"North Stars","order":0,"planModeId":"<planModeId>"}'
# Repeat for Epics (order:1), Execution (order:2), Validation (order:3)
# Then GET status-groups filtered by planModeId to find the auto-created Done group
```

Then assign tasks to the correct groups using `statusGroupId` in the bulk create payload. **Never use a statusGroupId from a different plan mode or from the datasphere defaults** — FK constraint violation if the group belongs to another datasphere, and wrong columns if it belongs to another plan mode in the same datasphere.

---

## API Note — datasphereId vs URI
→ *Referenced by: Step 4, Step 6*

The v2 tasks API (`/api/v2/dataspheres/:datasphereId/...`) requires the **actual DB ID** (`ds_default`, `cmo...`), not the URI (`dataspheres-ai`). The v1 pages API (`/api/v1/dataspheres/:uri/...`) takes the URI.

```bash
# Correct — v2 uses DS id
curl "$DATASPHERES_BASE_URL/api/v2/dataspheres/ds_default/tasks/plan-modes/..."

# Correct — v1 uses URI
curl "$DATASPHERES_BASE_URL/api/v1/dataspheres/dataspheres-ai/pages/..."
```

Passing the URI to a v2 endpoint causes membership lookup to fail → 403 "Moderator access required".

---

## Task Status vs statusGroupId
→ *Referenced by: Step 9*

The planner uses two separate fields:

| Field | Purpose |
|---|---|
| `statusGroupId` | Which column the card appears in |
| `status` | Enum (`TODO`, `IN_PROGRESS`, `DONE`) used by v1 API queries |

When moving tasks to Done, set **both**:

```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/bulk" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"taskIds":[...],"update":{"statusGroupId":"<doneGroupId>","status":"DONE"}}'
```

Setting only `statusGroupId` moves the card visually but leaves `status=TODO` in the DB — v1 task queries will still show tasks as TODO.

---

## Checklist Format — TipTap TaskList

All checklists in task content (Acceptance Checklist, Execution Checklist, North Star Checklist) MUST use the TipTap `taskList` format. Do NOT use `☐`/`☑` Unicode characters — they are not interactive and do not render as real checkboxes.

**Unchecked item:**
```html
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>criterion text</p></li>
</ul>
```

**Checked item (when marking done):**
```html
<li data-type="taskItem" data-checked="true"><p>criterion text</p></li>
```

The platform styles `data-checked="true"` with strikethrough + gray text automatically.

### Epic Execution Checklist format

```html
<h3>Execution Checklist</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>T-001 · short task title</p></li>
  <li data-type="taskItem" data-checked="false"><p>T-002 · short task title</p></li>
</ul>
```

### North Star Checklist format

```html
<h3>North Star Checklist</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>E-001 · Phase 1 name - Epic complete</p></li>
  <li data-type="taskItem" data-checked="false"><p>E-002 · Phase 2 name - Epic complete</p></li>
</ul>
```

---

## Sub-Checklist Propagation

When an Execution task moves to Done:
1. Fetch parent Epic content
2. Find `<li data-type="taskItem" data-checked="false"><p>T-XXX ·` in the Epic HTML
3. Replace `data-checked="false"` → `data-checked="true"` for that item
4. PATCH the Epic task content
5. If no `data-checked="false"` items remain → post comment on Epic: "All Execution tasks complete. Ready for Validation."

When an Epic moves to Done:
1. Find `<li data-type="taskItem" data-checked="false"><p>E-XXX ·` in the parent North Star content
2. Replace `data-checked="false"` → `data-checked="true"` for that item
3. If no `data-checked="false"` items remain → move North Star to Done

---

## Task In-Progress Workflow — Dashboard Visibility

**REQUIRED before starting any task.** Mark the task `IN_PROGRESS` so it appears in the "Active Execution" dashboard widget. Without this, the dashboard shows no in-flight work.

```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"IN_PROGRESS"}'
```

Post a start comment so the activity feed shows movement:

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"[all-dai-sdd-system-message]\n\n🔵 **IN PROGRESS** — Starting <T-XXX>. Depends-on cleared."}'
```

---

## Task Done Workflow — Completion Comment with Screenshots

When marking a task Done, follow this **ordered sequence** — every step is mandatory:

### Step 1: Tick acceptance checklist FIRST (gate — do not skip)

Before posting the comment or moving to Done, **PATCH the task content** to mark every verified acceptance criterion as `data-checked="true"`.

```bash
# Fetch current task content
TASK_JSON=$(curl -s "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY")

# Tick ALL verified criteria (replace false → true for each verified item)
# Use node to safely manipulate the JSON content:
node -e "
const json = $(echo "$TASK_JSON");
const updated = json.content.replace(
  /data-checked=\"false\"><p>YOUR CRITERION TEXT/g,
  'data-checked=\"true\"><p>YOUR CRITERION TEXT'
);
console.log(JSON.stringify({ content: updated }));
" > /tmp/task_patch.json

curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d @/tmp/task_patch.json
```

**To tick ALL criteria at once** (when all are verified):
```bash
UPDATED=$(echo "$TASK_JSON" | sed 's/data-checked=\\"false\\"/data-checked=\\"true\\"/g')
CONTENT=$(echo "$UPDATED" | grep -o '"content":"[^"\\]*\(\\.[^"\\]*\)*"' | head -1 | sed 's/^"content":"//;s/"$//')
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-raw "{\"content\": \"$CONTENT\"}"
```

**VERIFY** the PATCH response includes `data-checked="true"` items before proceeding.

### Step 2: Upload Playwright screenshots

```bash
SCREENSHOT_URLS=""
shopt -s nullglob
for SHOT in tests/e2e/screenshots/**/*.png; do
  RESP=$(curl -s -X POST "$DATASPHERES_BASE_URL/api/media/upload" \
    -H "Authorization: Bearer $DATASPHERES_API_KEY" \
    -F "file=@$(realpath $SHOT)")
  URL=$(echo "$RESP" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
  [ -n "$URL" ] && SCREENSHOT_URLS="${SCREENSHOT_URLS}\"$URL\","
done
SCREENSHOT_URLS="[${SCREENSHOT_URLS%,}]"
```

If no screenshots exist, set `SCREENSHOT_URLS="[]"`.

### Step 3: Post the completion comment

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"content\": \"[all-dai-sdd-system-message]\n\n**Duration:** <Xh Ym>\n\n**Completion summary:** <one paragraph>\n\n**Verified criteria:**\n- <criterion 1>\n- <criterion 2>\n\n**Tests:** npx tsc --noEmit OK\",
    \"screenshots\": $SCREENSHOT_URLS
  }"
```

The `screenshots` array (CDN URLs) shows up as clickable thumbnail gallery in the activity feed widget. The `[all-dai-sdd-system-message]` prefix adds a purple SDD badge on the comment card.

### Step 3b: Code annotation gate — REQUIRED before Step 4

Every file touched by this task MUST have:
```typescript
/**
 * @file src/path/to/file.ts
 * @purpose One sentence.
 * @sdd_task T-XXX
 * @sdd_epic E-XXX
 * @sdd_req R-XXX
 * @sdd_planner <trackerUrl>
 * @aria_strategy ...
 * @tools_meta ...
 */
```
Every exported function/class/model satisfying a requirement MUST have:
```typescript
// @satisfies R-001 — description
export async function myFunction(...) {
```
Do NOT proceed to Step 4 until all touched files have headers and `@satisfies` annotations.

### Step 3c: Create Validation artifact task in Validation column

Title: `V-<T-XXX> &middot; <short title>`  
Tags: `validation-artifact`, `<initiative-slug>`

Content must include these sections:
```html
<h2>Validation Artifact &mdash; T-XXX: <task title></h2>

<h3>Code Evidence</h3>
<p>Files with @sdd_task + @satisfies annotations:</p>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p><code>src/path/to/file.ts</code> &mdash; what it does</p></li>
</ul>
<pre><code class="language-typescript">
// @satisfies R-001 &mdash; description
export async function keyFunction(...) {
  // key implementation lines
}
</code></pre>

<h3>Schema / Data Model Changes</h3>
<pre><code class="language-prisma">
// relevant Prisma model additions, or "None"
</code></pre>

<h3>Test Results</h3>
<pre><code>
npx tsc --noEmit: OK
npx vitest run: X passed, 0 failed
[last 20 lines of test output]
</code></pre>

<h3>Implementation Files</h3>
<ul>
  <li><p>src/path/to/file.ts</p></li>
</ul>
```

The `Implementation Files` section is REQUIRED — the trace graph parses it to draw `execution &rarr; validation &rarr; code` edges.

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"V-T-XXX &middot; short title","statusGroupId":"<validationGroupId>","planModeId":"<planModeId>","priority":"MEDIUM","tags":["validation-artifact","<initiative>"],"content":"<h2>...</h2>..."}'
```

Save the returned `task.id` as `validationTaskId` — include it in the completion comment.

### Step 4: PATCH task to Done

```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"statusGroupId":"<doneGroupId>","status":"DONE"}'
```

Always set BOTH `statusGroupId` and `status` — setting only `statusGroupId` moves the card visually but leaves `status=TODO` in the DB.

---

## Trace Graph — 5-Tier Layout

The planner trace graph renders: **North Stars &rarr; Epics &rarr; Execution &rarr; Validation &rarr; Code Files**.

| Tier | Detected by | Content |
|---|---|---|
| North Stars | `NS-` prefix or North Stars statusGroup | Vision + success criteria |
| Epics | `E-` prefix or Epics statusGroup | Phase spec + execution checklist |
| Execution | `T-` prefix or Execution statusGroup | User story + acceptance criteria |
| Validation | `V-T-` prefix, `validation-artifact` tag, or Validation statusGroup | Code snippets, test results, schema diffs |
| Code Files | Parsed from `Implementation Files` section | Live file trace via `/api/v2/code-trace` |

**Edges:**
- Execution &rarr; Validation: `V-T-001` naming links to `T-001`
- Validation &rarr; Code: `Implementation Files` section in artifact content
- Clicking a Validation node opens the full artifact (code evidence + test output + schema changes)

---

## Encoding Safety — Use HTML Entities in curl Payloads

**CRITICAL:** On Windows and in some terminal environments, raw Unicode characters (em dashes, curly quotes, bullet characters) passed inside `curl -d '...'` or `-d "..."` are encoded as Windows-1252 bytes, which corrupt the database. **Always use HTML entities** for any special character in API payloads.

| Character | Wrong (raw) | Right (entity) |
|---|---|---|
| Em dash | `—` | `&mdash;` |
| Middle dot / bullet | `·` | `&middot;` |
| Left double quote | `"` | `&ldquo;` |
| Right double quote | `"` | `&rdquo;` |
| Checkmark | `✓` | `&#10003;` |
| Arrow | `→` | `&#8594;` |
| Superscript external link | `↗` | `&#8599;` |
| Star / asterisk glyph | `✦` | `&#10022;` |
| Gear / settings glyph | `⚙` | `&#9881;` |

This applies everywhere a string passes through a terminal or shell before reaching the API: `curl -d`, `node -e "..."`, here-doc interpolation, etc. In `.mjs` scripts read by Node directly, raw Unicode is safe because Node uses UTF-8.

---

## Credential Setup
→ *Referenced by: Step 1*

```bash
cat > ~/.dataspheres.env << 'EOF'
DATASPHERES_API_KEY=dsk_...
DATASPHERES_BASE_URL=http://localhost:5173
DATASPHERES_PUBLIC_URL=https://dev.dataspheres.ai
DATASPHERES_DEFAULT_URI=dataspheres-ai
EOF
```

`DATASPHERES_BASE_URL` — where API calls go (always local or tunnel).
`DATASPHERES_PUBLIC_URL` — base for links shown to users (the public/tunnel URL).

---

## tasks.yaml Shape
→ *Referenced by: Step 2*

```yaml
project: my-feature
targetDatasphere: dataspheres-ai   # REQUIRED — no default
initiative: my-feature             # slug used for tagFilter and CodeApplications
folder: "Feature Specs"

statusGroups:                      # reference only — actual groups created via API in step 8
  - { name: "North Stars", order: 0 }
  - { name: "Epics",       order: 1 }
  - { name: "Execution",   order: 2 }
  - { name: "Validation",  order: 3 }
  - { name: "Done",        order: 4, isDoneState: true }

tasks:
  - id: NS-001
    type: north-star
    title: "North Star: ..."
    statusGroup: "North Stars"
    priority: HIGH
    tags: [north-star, my-feature]
    children: [E-001, E-002]
    content: |
      <h3>Origin Prompts</h3>
      <p>Verbatim user requests that defined this feature, with dates. Copy them exactly — paraphrase destroys traceability.</p>
      <blockquote>
      <p><strong>YYYY-MM-DD</strong> &mdash; &ldquo;exact user message 1&rdquo;</p>
      <p><strong>YYYY-MM-DD</strong> &mdash; &ldquo;exact user message 2&rdquo;</p>
      </blockquote>
      <h3>Codebase Context</h3>
      <p>Schema fields, service signatures, and file:line anchors that constrain the implementation. Paste the actual code.</p>
      <pre><code>
      // path/to/file.ts:LINE — ModelName
      fieldName  FieldType  @attribute
      // path/to/service.ts:LINE — function signature
      async functionName(params): ReturnType
      </code></pre>
      <h3>Architecture Constraints</h3>
      <ul>
      <li><p>List things that MUST NOT break (existing features, data contracts).</p></li>
      <li><p>List existing patterns to follow (billing, email, routing).</p></li>
      </ul>
      <h3>Vision</h3>
      <p>One paragraph — the aspirational outcome from the user&apos;s perspective.</p>
      <h3>North Star Checklist</h3>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>E-001 &middot; Phase 1 name - Epic complete</p></li>
        <li data-type="taskItem" data-checked="false"><p>E-002 &middot; Phase 2 name - Epic complete</p></li>
      </ul>
      <h3>Success Criteria</h3>
      <ul>
      <li><p>Observable outcome 1 (verifiable without access to the DB).</p></li>
      <li><p>Observable outcome 2.</p></li>
      </ul>

  - id: E-001
    type: epic
    title: "Phase 1: ..."
    statusGroup: "Epics"
    priority: HIGH
    tags: [epic, my-feature, phase-1]
    parentNorthStar: NS-001
    children: [T-001, T-002]

  - id: T-001
    type: execution
    title: "T-001 · short title"
    statusGroup: "Execution"
    priority: HIGH | MEDIUM | LOW
    tags: [my-feature, sdd, phase-1]
    initiative: my-feature
    parentEpic: E-001
    depends_on: []
    spec_id: SPEC-{DOMAIN}-001        # assigned by Ari at publish time
    context_refs:                      # optional — carried into front matter block
      - type: legacy_code
        ref: src/path/to/old/file.py
        note: Prior implementation reference
    legacyImpact: none | additive | breaking
    rollbackSafe: safe | manual
    userApproved: yes | no
    content: |
      <pre><code class="language-yaml">
      spec_id: SPEC-{DOMAIN}-001
      title: T-001 short title
      version: 1.0.0
      status: ACTIVE
      column: execution
      epic_ref: E-001
      north_star_ref: NS-001
      context_refs: []
      superseded_by: null
      created: YYYY-MM-DD
      updated: YYYY-MM-DD
      author: your-handle
      </code></pre>
      <h2>Acceptance Criteria <!-- #ac --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>Observable criterion 1</p></li>
        <li data-type="taskItem" data-checked="false"><p>Observable criterion 2</p></li>
        <li data-type="taskItem" data-checked="false"><p>Test written and green</p></li>
        <li data-type="taskItem" data-checked="false"><p>Screenshot captured</p></li>
      </ul>
      <h2>Technical Design <!-- #td --></h2>
      <h3>Implementation Scope <!-- #td-scope --></h3>
      <p>Files to touch + what to do in each.</p>
```

---

## North Star Artifact Requirements
→ *Referenced by: Step 9 (gate), tasks.yaml Shape, Sub-Checklist Propagation*

Every North Star task MUST contain four sections **before it is considered publishable**. These are not optional — they are the mechanism that makes all-dai-sdd traceable from user prompt → spec → code.

### Required sections (enforced at Step 9 gate)

| Section | What goes here | Why |
|---|---|---|
| **Origin Prompts** | Verbatim user messages, with ISO dates. Copy-paste — no paraphrase. | Paraphrase breaks the chain. The exact words reveal intent that summaries discard. |
| **Codebase Context** | Schema field names + types, service method signatures, file:line refs. Paste actual code. | The implementation is constrained by what already exists. Every assumption about existing code must be verifiable here. |
| **Architecture Constraints** | What must NOT break. Which existing patterns to follow (billing, email, routing, etc.). | Guards against silent rewrites of working systems. |
| **Vision** | One paragraph outcome from the user's perspective. | The "why" that all child work traces back to. |
| **Success Criteria** | Observable pass/fail outcomes (no DB access needed to verify). | Needed by Validation gate to approve Epic completion. |
| **North Star Checklist** | One `<ul data-type="taskList">` item per Epic. | Drives the auto-tick propagation when Epics complete. |

### Enforcement rule

Step 9 (publish tasks) must scan every `type: north-star` task and verify the presence of all six section headings (`<h3>Origin Prompts</h3>`, `<h3>Codebase Context</h3>`, `<h3>Architecture Constraints</h3>`, `<h3>Vision</h3>`, `<h3>North Star Checklist</h3>`, `<h3>Success Criteria</h3>`) before posting. If any heading is missing, output:

```
🚫 GATE [9/14] BLOCKED — NS-001 missing required sections: [Origin Prompts, Codebase Context]
Required before continuing: Add the missing sections to the North Star content in tasks.yaml
```

### Enforcement rule — during Execution

When an Execution task reveals new codebase context (a schema field that didn't exist in the spec, an architecture constraint that wasn't captured), the developer MUST:

1. PATCH the parent Epic content to add the new context
2. PATCH the North Star's Codebase Context or Architecture Constraints section

This is the self-healing contract. Discovering new facts and silently coding around them is the primary failure mode that destroys traceability.

### What "Codebase Context" includes

- **Schema fields**: `prisma/schema.prisma:LINE — ModelName` with the actual field definitions
- **Service signatures**: `src/server/services/foo.service.ts:LINE — async methodName(params): ReturnType`
- **Billing patterns**: exact `chargeCapacityWithWaterfall` call shape, including which `userId` and `datasphereId` to pass
- **Routing patterns**: endpoint paths, webhook formats, auth header patterns
- **Email patterns**: address format (e.g. `reply+{token}@reply.domain`), SendGrid webhook shape
- **What must NOT break**: existing models or endpoints that share the same DB tables

### Artifact attachments (images, files, search results)

The Dataspheres AI task API supports file attachments and image uploads on comments, not on task content directly. To attach research artifacts (screenshots, search results, design mockups):

1. Upload via `POST /api/media/upload` with `Authorization: Bearer $KEY`
2. Post a comment on the North Star with `screenshots: [<url1>, <url2>]`
3. Reference the comment in the Codebase Context section: `<!-- see attached screenshots in comments -->`

---

## CLAUDE.md Integration
→ *Referenced by: Step 14*

When `install.sh --all` installs skills into a project, the project's `CLAUDE.md` should reference this skill and the column lifecycle. Ari reads the CLAUDE.md on session start — if the column names aren't there, Ari won't know to use the SDD structure.

Template addition for project CLAUDE.md:
```markdown
## Active Initiatives (SDD)

Tracked in Dataspheres AI via all-dai-sdd skill.
Five-column lifecycle: North Stars → Epics → Execution → Validation → Done.
Dashboard: $DATASPHERES_PUBLIC_URL/pages/<uri>/<dashboard-slug>
Planner: $DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>
```

---

## Next Steps Page Template

When all tasks for an initiative are Done (100% completion), generate a close-out "Next Steps & UAT" page on the datasphere. This is published via `POST /api/v1/dataspheres/<uri>/pages` and uses the full platform feature set.

**Structural blocks (in order):**

1. **Hero banner** — dark gradient with gold CTAs linking to planner + tracker
2. **plannerWidget progress-summary** — live progress ring so the page is always current
3. **Epic cards** — one styled card per Epic, Done chip + monospace ID + planner deep-link
4. **UAT sections** — colored callout boxes per subsystem (green/blue/purple/pink)
5. **Loose ends** — amber left-border warning callouts for any known gaps
6. **CTA cards** — side-by-side action cards using `class="not-prose"` to opt out of Tailwind prose
7. **Attribution block** — links to `ari-dai-skills` repo + dataspheres.ai platform
8. **`<div data-type="doc-footer">`** — platform animated multilingual footer (always last)

**Key rules:**
- Use HTML entities — no raw Unicode in JS template literals (see Encoding Safety section)
- `class="not-prose"` opts a div out of Tailwind typography overrides
- `data-type="plannerWidget"` requires `data-datasphere-id` (DB ID, not URI) and `data-plan-mode-id`
- `data-type="doc-footer"` renders the platform footer — always include last
- Page reader URL: `$DATASPHERES_PUBLIC_URL/pages/<uri>/<slug>` — NEVER `/app/<uri>/docs/<slug>`

**Attribution block HTML** (always include at the bottom of every initiative page):

```html
<div class="not-prose" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;text-align:center;margin-bottom:24px;">
  <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.12em;">Powered by</p>
  <div style="display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap;margin-bottom:8px;">
    <a href="https://github.com/geekdreamzz/ari-dai-skills" style="font-size:13px;font-weight:600;color:#0f172a;text-decoration:none;">&#9881; ari-dai-skills</a>
    <span style="color:#cbd5e1;">&#183;</span>
    <a href="https://dataspheres.ai" style="font-size:13px;font-weight:600;color:#a67c00;text-decoration:none;">&#10022; dataspheres.ai</a>
  </div>
  <p style="margin:0;font-size:11px;color:#94a3b8;">Spec-driven development tracked end-to-end in Dataspheres AI</p>
</div>
```

**Planner widget (progress summary):**

```html
<div data-type="plannerWidget"
     data-widget-type="progress-summary"
     data-datasphere-id="<dsId>"
     data-plan-mode-id="<planModeId>"
     data-refresh-interval="60"></div>
```

**Epic card template:**

```html
<div style="border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:14px;background:#f8fafc;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
    <span style="background:#dcfce7;color:#16a34a;font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.05em;">&#10003; Done</span>
    <span style="font-size:12px;font-family:monospace;color:#94a3b8;">E-001</span>
    <a href="$DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>" style="margin-left:auto;font-size:11px;color:#64748b;text-decoration:none;" title="Open in planner">&#8599;</a>
  </div>
  <h3 style="margin:0 0 8px;font-size:16px;font-weight:700;color:#0f172a;">Epic Title</h3>
  <p style="margin:0;color:#475569;font-size:13px;line-height:1.65;">Epic summary.</p>
</div>
```

**UAT section template:**

```html
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 24px;margin-bottom:16px;">
  <h3 style="margin:0 0 14px;font-size:14px;font-weight:700;color:#1e293b;">&#9989;&nbsp; Subsystem UAT</h3>
  <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.8;">
    <li>Criterion 1</li>
    <li>Criterion 2</li>
  </ul>
</div>
```

**Loose ends (amber warning) template:**

```html
<div style="border-left:4px solid #f59e0b;background:#fffbeb;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:12px;">
  <strong style="font-size:13px;color:#92400e;">Known gap: title</strong>
  <p style="margin:6px 0 0;font-size:13px;color:#78350f;">Description of the gap and where to track it.</p>
</div>
```

---

## Spec Traceability Protocol
→ *Referenced by: Steps 9, 11, Drift Prevention Gate Checks*

Every spec task carries a front matter block and section anchors. Together they form the contract that enables bidirectional tracing between specs, code, and context.

**This is not optional.** A spec task without a front matter block cannot be traced. A task in the Execution column without an Implementation Files section cannot appear in the `trace-graph` Artifacts tier. Both are gate failures — a task that reaches Validation without front matter and impl files MUST be patched before the Validation gate can pass.

### Enforcement — Automated Gate Check

Run this check after step 9 and before every Validation gate transition:

```python
import re

def check_spec_tracing(task: dict) -> list[str]:
    """Return list of violation strings. Empty list = pass."""
    violations = []
    content = task.get("content", "") or ""
    title = task.get("title", "")
    prefix = title.split(":")[0].strip()

    if "spec_id: SPEC-" not in content:
        violations.append(f"MISSING front matter (spec_id: SPEC-...)")

    if prefix.startswith("EX-") and "Implementation Files" not in content:
        violations.append("MISSING Implementation Files section")

    if "<!-- #" not in content:
        violations.append("MISSING heading anchors (<!-- #slug -->)")

    if prefix.startswith("EX-") or prefix.startswith("VA-"):
        if "epic_ref:" not in content:
            violations.append("MISSING epic_ref in front matter")
        if "north_star_ref:" not in content:
            violations.append("MISSING north_star_ref in front matter")

    return violations

# Block Validation transition if any violations
for task in execution_tasks:
    v = check_spec_tracing(task)
    if v:
        raise GateError(f"[GATE BLOCKED] {task['title']} — tracing violations: {v}")
```

**Repair command** — if a task is missing front matter (e.g., created before this rule was enforced), PATCH it:

```python
# Prepend front matter to existing content
front_matter = build_front_matter(task)   # uses _fm() helper from sdd_publish.py
impl_section  = build_impl_files(task)    # uses _impl() helper
task_content  = front_matter + impl_section + existing_content
client.patch(f"/api/v2/dataspheres/{ds_id}/tasks/{task_id}", json={"content": task_content})
```

The `patch_task_tracing.py` script in `workspaces/<initiative>/specs/` is the reference implementation for retroactively adding front matter to all tasks.

### Spec ID Format

`SPEC-{DOMAIN}-{NNN}`

- `DOMAIN` — 3-6 char uppercase slug for the feature area (`AUTH`, `NOTIF`, `PLAN`, `DATA`)
- `NNN` — 3-digit integer, unique per domain per datasphere, never reused
- Examples: `SPEC-AUTH-001`, `SPEC-NOTIF-003`, `SPEC-PLAN-012`

IDs are **immutable** — once assigned, the ID persists even if the spec is deprecated or superseded. Deprecated specs stay as permanent records with `status: DEPRECATED`.

### Front Matter Block

Embed this at the very top of every spec task's `content` field as a code block:

```html
<pre><code class="language-yaml">
spec_id: SPEC-AUTH-001
title: JWT Authentication Service
spec_type: api-contract
version: 1.0.0
status: ACTIVE
column: execution
epic_ref: SPEC-AUTH
north_star_ref: NS-002
context_refs:
  - type: decision
    ref: ADR-003
    note: Chose JWT over sessions for stateless scaling
  - type: external_standard
    ref: RFC 7519
    note: JWT spec this implements
  - type: legacy_code
    ref: src/auth/session_auth.py
    note: Prior implementation being replaced
superseded_by: null
created: 2025-01-15
updated: 2025-03-20
author: facelessaicoder
tags: [auth, security, backend]
</code></pre>
```

**Required fields:** `spec_id`, `title`, `status`, `column`, `spec_type`

**Status lifecycle:** `DRAFT → ACTIVE → DEPRECATED → SUPERSEDED`

Skipping `DEPRECATED` before removing a spec is a protocol violation. `superseded_by` must be non-null when status is `SUPERSEDED`.

**`spec_type` values:** `data-schema` | `api-contract` | `algorithm` | `data-flow` | `user-journey` | `architecture` | `component` | `integration` | `acceptance-criteria` | `test-plan`

**`context_refs` types:** `decision` | `constraint` | `external_standard` | `research` | `legacy_code`

### Per-Spec Trace View

Every spec task has a trace view showing the lineage for *this spec only*: what context informed it, what code implements it, what result covers it. Planner tasks are used for all kinds of work — this view is conditional and only appears on tasks whose content contains a `spec_id:` YAML block.

#### How it works today (Tiptap embed — workaround)

Ari adds a Mermaid block inside the task's `content` field as a regular Tiptap node. It lives in the editable body, so it can be accidentally deleted and Ari must PATCH the task every time a new trace is added. This is a stopgap — it works but is fragile.

```html
<h2>Trace View <!-- #trace --></h2>
<div data-type="mermaid" data-source="graph LR
  CTX1[CTX-PROMPT-001\nUser Brief]
  CTX2[CTX-CODE-001\nsession_auth.py]
  SPEC[SPEC-AUTH-001\nJWT Auth]
  CODE1[jwt.py::generate_jwt]
  CODE2[service.py::AuthService]
  RESULT[RESULT-AUTH-001\nBuild Report]
  CTX1 -->|informs| SPEC
  CTX2 -->|informs| SPEC
  SPEC -->|implements| CODE1
  SPEC -->|implements| CODE2
  RESULT -->|summarizes| SPEC"></div>
```

#### Platform request — conditional panel in the task modal

The correct implementation is a **read-only panel rendered outside the Tiptap editor** in the task detail modal. Not part of the editable content. Condition: task `content` contains a YAML block with a `spec_id:` key.

When the condition is true, the task modal renders a collapsible "Spec Trace" section (above or below the content editor) showing:

- **Metadata strip:** `spec_id` pill · `spec_type` badge · `status` badge (DRAFT / ACTIVE / DEPRECATED) · `version` · `column`
- **Mini trace graph:** CTX nodes → this SPEC → CODE nodes → RESULT nodes. Each node is clickable — CTX/RESULT nodes navigate to the spec page, CODE nodes copy the file path or open in the linked repo.
- **Live data source:** reads the initiative's Traces dataset (created in step 11), filtered on `from_ref = spec_id OR to_ref = spec_id`. Auto-refreshes on modal open.

This panel is **invisible on non-SDD tasks** — the condition is only true when `spec_id:` is present. No impact on normal planner use. No editable content to accidentally delete. The trace view stays current without Ari having to PATCH the task.

**The key distinction:** the Tiptap content is the spec. The trace panel is metadata *about* the spec. They should live in separate layers of the modal, not mixed in the same editable body.

---

### Section-Level Anchors

Every H2 and H3 in a spec task gets an explicit anchor comment. These are the stable citation targets for code annotations:

```html
<h2>Acceptance Criteria <!-- #ac --></h2>
<h2>Technical Design <!-- #td --></h2>
<h3>Token Generation Algorithm <!-- #td-token-gen --></h3>
<h3>API Contract <!-- #td-api --></h3>
```

Reference format: `SPEC-AUTH-001#td-api`

**Anchors are stable** — if you rename the heading text, keep the `<!-- #anchor -->` comment. Code annotations point to anchors, not heading text.

---

## Spec Type Taxonomy and Templates
→ *Referenced by: Steps 9, 10, Spec Traceability Protocol*

`spec_type` determines the canonical section structure of a spec task. Ari uses the template for the declared type when creating or scaffolding a spec. Each type also maps to a `Spec Type` CodeFamily value, making specs filterable in the planner by type.

### Full Spec Taxonomy

There are four tiers of specs. Context and Result specs are **pages** (in folders), not planner tasks — they are reference material and output receipts, not work items. Execution specs (in the planner) cite Context specs; Result specs are generated after execution closes.

```
[Context Pages]  →  [Execution Tasks]  →  [Code/Artifacts]  →  [Result Pages]
CTX-*                SPEC-*                (code, pages,          RESULT-*
                                            datasets, images)
```

#### Context Specs (`CTX-*`) — Pages in "Context" folder

| spec_type | ID format | What it captures |
|---|---|---|
| `ctx-prompt` | `CTX-PROMPT-NNN` | Original user request, brief, voice memo transcription |
| `ctx-code` | `CTX-CODE-NNN` | Existing code snippet with filepath + function/class name |
| `ctx-search` | `CTX-SEARCH-NNN` | Research thread output, web search results, competitive analysis |
| `ctx-doc` | `CTX-DOC-NNN` | External/internal documentation, RFC, standard, guide |
| `ctx-legacy` | `CTX-LEGACY-NNN` | Prior implementation being replaced or heavily referenced |

#### Execution Specs (`SPEC-*`) — Planner tasks

| spec_type | Typical Column | What it describes |
|---|---|---|
| `data-schema` | Execution | Database tables, field types, constraints, indexes, migrations |
| `api-contract` | Execution | Endpoints, request/response shapes, auth, error codes |
| `algorithm` | Execution | Pseudocode, step-by-step logic, complexity, edge cases |
| `data-flow` | Execution | How data moves through the system (Mermaid flowchart/sequence) |
| `user-journey` | Execution | User-facing screen flows, happy + sad paths, transitions |
| `architecture` | Execution | Service boundaries, component topology, deployment diagram |
| `component` | Execution | UI component: props, states, interactions, variants |
| `integration` | Execution | Third-party service: auth, webhooks, rate limits, error handling |
| `acceptance-criteria` | Validation | Observable pass/fail criteria, test assertions |
| `test-plan` | Validation | Test scenarios, edge cases, performance bounds, manual QA steps |

#### Result Specs (`RESULT-*`) — Pages in "Build Reports" folder

| spec_type | ID format | What it captures |
|---|---|---|
| `result` | `RESULT-{DOMAIN}-NNN` | Post-execution report: artifacts built, code snippets, test results, trace summary |

---

### Template: `data-schema`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: data-schema
...
</code></pre>

<h2>Schema Definition <!-- #schema --></h2>
<pre><code class="language-sql">
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
</code></pre>

<h2>Field Reference <!-- #fields --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Field</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Type</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Constraints</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Notes</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>id</p></td>
      <td class="tiptap-table-cell"><p>TEXT</p></td>
      <td class="tiptap-table-cell"><p>PRIMARY KEY</p></td>
      <td class="tiptap-table-cell"><p>cuid2 generated</p></td>
    </tr>
  </tbody>
</table>

<h2>Indexes <!-- #indexes --></h2>
<pre><code class="language-sql">CREATE INDEX idx_users_email ON users(email);</code></pre>

<h2>Migration Notes <!-- #migration --></h2>
<p>How to apply, rollback, and backfill.</p>
```

---

### Template: `api-contract`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: api-contract
...
</code></pre>

<h2>Endpoints <!-- #endpoints --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Method</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Path</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Auth</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Notes</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>POST</p></td>
      <td class="tiptap-table-cell"><p>/api/auth/login</p></td>
      <td class="tiptap-table-cell"><p>none</p></td>
      <td class="tiptap-table-cell"><p>Returns access + refresh tokens</p></td>
    </tr>
  </tbody>
</table>

<h2>Request Schema <!-- #request --></h2>
<pre><code class="language-typescript">
interface LoginRequest {
  email: string;
  password: string;
}
</code></pre>

<h2>Response Schema <!-- #response --></h2>
<pre><code class="language-typescript">
interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
</code></pre>

<h2>Error Codes <!-- #errors --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Code</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Status</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Meaning</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>AUTH_001</p></td>
      <td class="tiptap-table-cell"><p>401</p></td>
      <td class="tiptap-table-cell"><p>Invalid credentials</p></td>
    </tr>
  </tbody>
</table>
```

---

### Template: `algorithm`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: algorithm
...
</code></pre>

<h2>Problem Statement <!-- #problem --></h2>
<p>What this algorithm solves and why a custom implementation is needed.</p>

<h2>Pseudocode <!-- #pseudocode --></h2>
<pre><code class="language-python">
def score_item(item, user_context):
    base = item.engagement_score
    if item.datasphere in user_context.admin_spheres:
        base *= 1.8
    freshness = exp(-elapsed_hours / (lookback_hours / 3))
    return base * freshness + 0.1 * freshness
</code></pre>

<h2>Complexity <!-- #complexity --></h2>
<p>Time: O(n log n) — sort step dominates. Space: O(n).</p>

<h2>Edge Cases <!-- #edge-cases --></h2>
<ul>
  <li>Empty pool: return empty list, do not extend lookback</li>
  <li>All items platform DS: apply 0.1x penalty before scoring</li>
</ul>
```

---

### Template: `data-flow`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: data-flow
...
</code></pre>

<h2>Flow Overview <!-- #flow --></h2>
<p>One sentence: what data, from where, to where, and why.</p>

<h2>Sequence Diagram <!-- #sequence --></h2>
<div data-type="mermaid" data-source="sequenceDiagram
  User->>API: POST /auth/login
  API->>DB: SELECT user WHERE email=?
  DB-->>API: user record
  API->>API: verify password hash
  API->>API: generate JWT
  API-->>User: { accessToken, refreshToken }"></div>

<h2>Data Transformations <!-- #transforms --></h2>
<p>Each step where data shape changes — input format, output format, validation applied.</p>

<h2>Error Paths <!-- #errors --></h2>
<p>What happens at each failure point — propagation, fallback, user-visible effect.</p>
```

---

### Template: `user-journey`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: user-journey
...
</code></pre>

<h2>User Goal <!-- #goal --></h2>
<p>What the user is trying to accomplish. One sentence.</p>

<h2>Happy Path <!-- #happy-path --></h2>
<div data-type="mermaid" data-source="flowchart TD
  A[Land on /login] --> B[Enter email + password]
  B --> C{Valid?}
  C -- Yes --> D[Redirect to dashboard]
  C -- No --> E[Show inline error]
  E --> B"></div>

<h2>Sad Paths <!-- #sad-paths --></h2>
<ul>
  <li>Wrong password: inline error, no redirect, no lockout on first attempt</li>
  <li>Account locked: show locked message with support link</li>
  <li>Network error: show retry toast, do not clear form</li>
</ul>

<h2>Screen Inventory <!-- #screens --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Screen</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Route</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>New / Existing</strong></p></td>
    </tr>
  </tbody>
</table>
```

---

### Template: `architecture`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: architecture
...
</code></pre>

<h2>Component Diagram <!-- #components --></h2>
<div data-type="mermaid" data-source="graph TD
  Client --> API_Gateway
  API_Gateway --> Auth_Service
  API_Gateway --> Data_Service
  Auth_Service --> PostgreSQL
  Data_Service --> PostgreSQL
  Data_Service --> Redis"></div>

<h2>Service Boundaries <!-- #boundaries --></h2>
<p>What each service owns, what it does NOT own, and the contract at each boundary.</p>

<h2>Data Stores <!-- #data-stores --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Store</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Type</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Owns</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Access pattern</strong></p></td>
    </tr>
  </tbody>
</table>

<h2>Non-Functional Requirements <!-- #nfr --></h2>
<ul>
  <li>Latency: p99 login &lt; 300ms</li>
  <li>Availability: 99.9% uptime</li>
</ul>
```

---

### Template: `integration`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: integration
...
</code></pre>

<h2>Service Overview <!-- #service --></h2>
<p>What the third-party service does and why we integrate with it.</p>

<h2>Auth and Credentials <!-- #auth --></h2>
<p>Auth method (API key / OAuth / webhook secret). Where credentials are stored. Rotation policy.</p>

<h2>Endpoints Used <!-- #endpoints --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Endpoint</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Purpose</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Rate limit</strong></p></td>
    </tr>
  </tbody>
</table>

<h2>Webhook Contract <!-- #webhooks --></h2>
<p>Events we receive, payload shape, signature verification method.</p>

<h2>Error Handling and Retry <!-- #errors --></h2>
<p>Which errors are retryable, retry policy, dead letter handling, alerting threshold.</p>
```

---

### Template: `acceptance-criteria` (Validation column)

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-VAL-NNN
spec_type: acceptance-criteria
column: validation
validates_ref: SPEC-{DOMAIN}-NNN
...
</code></pre>

<h2>Acceptance Criteria <!-- #ac --></h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>Criterion 1 — observable, pass/fail</p></li>
  <li data-type="taskItem" data-checked="false"><p>Criterion 2</p></li>
</ul>

<h2>Out of Scope <!-- #oos --></h2>
<p>What this spec does NOT validate. Reduces scope creep in QA.</p>
```

---

### Template: `test-plan` (Validation column)

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-TP-NNN
spec_type: test-plan
column: validation
validates_ref: SPEC-{DOMAIN}-NNN
...
</code></pre>

<h2>Test Scenarios <!-- #scenarios --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Scenario</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Input</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Expected</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Type</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>Valid login</p></td>
      <td class="tiptap-table-cell"><p>correct email + password</p></td>
      <td class="tiptap-table-cell"><p>200 + tokens</p></td>
      <td class="tiptap-table-cell"><p>integration</p></td>
    </tr>
  </tbody>
</table>

<h2>Edge Cases <!-- #edge-cases --></h2>
<ul>
  <li>Concurrent login from two devices</li>
  <li>Token refresh during active request</li>
</ul>

<h2>Performance Bounds <!-- #perf --></h2>
<p>e.g. login p99 under 300ms under 100rps load</p>
```

---

### Images in Context and Result Specs

Images are first-class content in context and result specs. Napkin drawings, wireframes, app screenshots, whiteboard photos, UI mockups — all of these belong embedded in the spec page, not in a separate folder or skipped.

**Ari's image protocol when creating any context or result spec:**

1. If the user pastes, attaches, or mentions an image → embed it immediately. Never skip.
2. If the user provides a local file path → `upload_file(path)` first, then embed the returned URL.
3. If the image is already a hosted HTTPS URL → embed directly.
4. If the context involves UI work, flows, or physical sketches → **proactively ask**: "Do you have any screenshots or sketches to include?"

**Embedding pattern (same as pages):**
```html
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="https://cdn.dataspheres.ai/uploads/sketch-001.png" alt="Napkin sketch — auth flow" />
  <figcaption>Napkin sketch from kickoff — JWT flow overview</figcaption>
</figure>
```

For multiple images, embed them in sequence under a `## Visual References` section. Each gets a caption explaining what it shows and why it's relevant to the spec.

---

### Template: `ctx-prompt`

Context specs are created as **pages** in the datasphere (folder: "Context"), not as planner tasks. Ari creates them automatically when the user shares a prompt, research thread, code snippet, or doc as input to an execution spec.

```html
<pre><code class="language-yaml">
spec_id: CTX-PROMPT-001
spec_type: ctx-prompt
title: User Brief — Auth System
status: ACTIVE
created: 2025-01-14
author: facelessaicoder
cited_by: [SPEC-AUTH-001, SPEC-AUTH-002]
</code></pre>

<h2>Original Request <!-- #request --></h2>
<p>Verbatim or lightly cleaned user prompt / voice memo transcription. Preserved exactly — this is the authoritative record of what was asked.</p>

<blockquote><p>"Build a JWT-based auth system. Users log in with email + password. Tokens expire in 15 minutes. Refresh tokens rotate on use. Must work with our current Redis setup."</p></blockquote>

<h2>Visual References <!-- #images --></h2>
<p>Napkin drawings, whiteboard photos, wireframes, or annotated screenshots shared alongside the brief.</p>
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="{uploaded-url}" alt="Napkin sketch — initial auth flow concept" />
  <figcaption>Sketch from kickoff: shows the intended token flow from login to refresh</figcaption>
</figure>

<h2>Key Intent <!-- #intent --></h2>
<ul>
  <li>15-minute access token expiry</li>
  <li>Rotating refresh tokens</li>
  <li>Redis-compatible (existing cluster, no new infra)</li>
</ul>

<h2>Open Questions at Time of Writing <!-- #questions --></h2>
<ul>
  <li>Single-device or multi-device sessions?</li>
  <li>Account lockout policy?</li>
</ul>
```

---

### Template: `ctx-code`

```html
<pre><code class="language-yaml">
spec_id: CTX-CODE-001
spec_type: ctx-code
title: Existing SessionAuth Implementation
status: ACTIVE
created: 2025-01-14
filepath: src/auth/session_auth.py
cited_by: [SPEC-AUTH-001]
</code></pre>

<h2>Source Location <!-- #source --></h2>
<p>File: <code>src/auth/session_auth.py</code></p>
<p>Symbols: <code>SessionAuth</code>, <code>create_session</code>, <code>validate_session</code></p>

<h2>Relevant Snippet <!-- #snippet --></h2>
<pre><code class="language-python">
class SessionAuth:
    def create_session(self, user_id: str) -> str:
        token = secrets.token_hex(32)
        self.redis.setex(f"session:{token}", 3600, user_id)
        return token

    def validate_session(self, token: str) -> str | None:
        return self.redis.get(f"session:{token}")
</code></pre>

<h2>Why Referenced <!-- #why --></h2>
<p>This implementation is being replaced by JWT. The Redis key pattern and expiry logic should be preserved in the new implementation.</p>

<h2>What to Carry Forward <!-- #carry-forward --></h2>
<ul>
  <li>Redis key pattern: <code>session:{token}</code> → adapt to <code>refresh:{token}</code></li>
  <li>TTL handling: keep the same Redis SETEX pattern</li>
</ul>

<h2>Visual References <!-- #images --></h2>
<p>Screenshots of the code in context, IDE views, or annotated diffs. Upload with upload_file() if local.</p>
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="{uploaded-url}" alt="Screenshot: SessionAuth class in IDE" />
  <figcaption>SessionAuth as it exists today — annotated to show the Redis key pattern</figcaption>
</figure>
```

---

### Template: `ctx-search`

```html
<pre><code class="language-yaml">
spec_id: CTX-SEARCH-001
spec_type: ctx-search
title: OAuth 2.0 and JWT Research
status: ACTIVE
created: 2025-01-13
research_thread_id: thread_abc123
cited_by: [SPEC-AUTH-001]
</code></pre>

<h2>Research Query <!-- #query --></h2>
<p>JWT vs session tokens for stateless auth at scale — tradeoffs, refresh token rotation best practices, Redis storage patterns</p>

<h2>Key Findings <!-- #findings --></h2>
<ul>
  <li>JWT: stateless verification, no DB lookup on every request, but revocation requires blocklist</li>
  <li>Refresh token rotation (RFC 6819): each use issues a new refresh token, invalidates old — detects replay attacks</li>
  <li>15-minute access token is industry standard (Google, GitHub use 1 hour; shorter is safer for our use case)</li>
</ul>

<h2>Sources <!-- #sources --></h2>
<ul>
  <li><a href="https://datatracker.ietf.org/doc/html/rfc7519">RFC 7519 — JSON Web Token</a></li>
  <li><a href="https://datatracker.ietf.org/doc/html/rfc6819">RFC 6819 — OAuth 2.0 Threat Model</a></li>
</ul>
```

---

### Template: `ctx-doc`

```html
<pre><code class="language-yaml">
spec_id: CTX-DOC-001
spec_type: ctx-doc
title: SendGrid Inbound Parse API
status: ACTIVE
source_url: https://docs.sendgrid.com/for-developers/parsing-email/inbound-email
created: 2025-02-01
cited_by: [SPEC-NOTIF-003]
</code></pre>

<h2>Document Summary <!-- #summary --></h2>
<p>SendGrid Inbound Parse receives email, parses headers + body, and POSTs JSON to a configured webhook URL. Requires MX record on receiving subdomain.</p>

<h2>Key Constraints <!-- #constraints --></h2>
<ul>
  <li>Webhook must respond 200 within 20 seconds or SendGrid retries</li>
  <li>Attachments sent as multipart form data, max 30MB total</li>
  <li>Envelope JSON contains original To/From before any forwarding</li>
</ul>

<h2>Relevant Sections <!-- #sections --></h2>
<p>Section 3: MX record configuration. Section 7: Webhook payload schema. Section 12: Spam and phishing filtering.</p>
```

---

### Template: `result`

Result specs are **pages** in the "Build Reports" folder. Ari generates them automatically when a task (or batch of tasks) moves to Done. They are the authoritative post-execution record.

```html
<pre><code class="language-yaml">
spec_id: RESULT-AUTH-001
spec_type: result
title: Auth System Build Report
status: FINAL
execution_refs: [SPEC-AUTH-001, SPEC-AUTH-002]
context_refs: [CTX-PROMPT-001, CTX-CODE-001, CTX-SEARCH-001]
created: 2025-03-22
built_by: Ari (claude-sonnet-4-6)
</code></pre>

<h2>What Was Built <!-- #overview --></h2>
<p>One paragraph: the feature, what was implemented, what was not implemented (explicit scope).</p>

<h2>Artifacts Created <!-- #artifacts --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Type</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Ref</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Description</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Spec</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>function</p></td>
      <td class="tiptap-table-cell"><p>src/auth/jwt.py::generate_jwt</p></td>
      <td class="tiptap-table-cell"><p>Generates HMAC-SHA256 JWT with configurable expiry</p></td>
      <td class="tiptap-table-cell"><p>SPEC-AUTH-001#td-token-gen</p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>function</p></td>
      <td class="tiptap-table-cell"><p>src/auth/jwt.py::refresh_token</p></td>
      <td class="tiptap-table-cell"><p>Rotating refresh token with Redis invalidation</p></td>
      <td class="tiptap-table-cell"><p>SPEC-AUTH-001#td-refresh</p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>schema</p></td>
      <td class="tiptap-table-cell"><p>migrations/0042_refresh_tokens.sql</p></td>
      <td class="tiptap-table-cell"><p>refresh_tokens table with user_id FK and expiry</p></td>
      <td class="tiptap-table-cell"><p>SPEC-AUTH-DS-001#schema</p></td>
    </tr>
  </tbody>
</table>

<h2>Key Code Snippets <!-- #snippets --></h2>
<pre><code class="language-python">
# src/auth/jwt.py — core token generation
def generate_jwt(user_id: str, expires_in: int = 900) -> str:
    payload = {"sub": user_id, "exp": time.time() + expires_in, "iat": time.time()}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")
</code></pre>

<h2>Test Results <!-- #tests --></h2>
<ul>
  <li>Unit tests: 12 passing, 0 failing</li>
  <li>Integration tests: 4 passing</li>
  <li>Coverage: 94% on src/auth/jwt.py</li>
</ul>

<h2>Screenshots <!-- #screenshots --></h2>
<p>Visual evidence of the built feature — running UI, test output, terminal output, before/after comparisons. Upload with upload_file() if local.</p>
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="{uploaded-url}" alt="Login flow — working in staging" />
  <figcaption>Login endpoint returning tokens in staging — matches SPEC-AUTH-001#td-api response schema</figcaption>
</figure>
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="{uploaded-url}" alt="Test suite passing" />
  <figcaption>All 16 auth tests green — npx jest src/auth 2025-03-22</figcaption>
</figure>

<h2>Deviations from Spec <!-- #deviations --></h2>
<p>Any spec sections not implemented, scope changes made during execution, or decisions that differ from the original spec. If none: "None — implemented as specced."</p>

<h2>Context That Shaped This Build <!-- #context-influence --></h2>
<ul>
  <li><strong>CTX-PROMPT-001</strong> — Original brief drove the 15-minute expiry and Redis requirement</li>
  <li><strong>CTX-CODE-001</strong> — Redis key pattern from SessionAuth preserved in the refresh token implementation</li>
  <li><strong>CTX-SEARCH-001</strong> — RFC 6819 rotation pattern adopted verbatim</li>
</ul>
```

---

### Tagging for Discoverability

When Ari publishes a spec task (step 9 / 10), it applies the following CodeApplications in addition to the base initiative tags:

| CodeFamily | Value | Source |
|---|---|---|
| `Spec Type` | task `spec_type` value | Parsed from front matter |
| `Spec Domain` | DOMAIN from `spec_id` | Parsed from spec ID prefix |
| `Legacy Impact` | from `tasks.yaml` | As before |
| `Rollback Safe` | from `tasks.yaml` | As before |
| `User Approved` | from `tasks.yaml` | As before |
| `Tags` | initiative slug + `sdd` + spec_type | Enables planner filter by type |

This means in the planner you can filter by `Spec Type = api-contract` to see only contract specs, or `Spec Domain = AUTH` to see only auth-domain work — without touching the initiative tag filter.

---

## Code Trace Annotations
→ *Referenced by: Drift Prevention Gate Checks*

Annotations are one-line comments pointing from implementation to spec. They carry a pointer only — never spec content. The spec is the source of truth.

### Format

```
# spec: SPEC-{DOMAIN}-{NNN}             (whole module or class)
# spec: SPEC-{DOMAIN}-{NNN}#{anchor}    (specific section)
```

### Language Examples

**Python — function and class:**
```python
# spec: SPEC-AUTH-001#td-token-gen
def generate_jwt(user_id: str, expires_in: int = 900) -> str:
    ...

# spec: SPEC-AUTH-001
class AuthService:
    ...
```

**TypeScript:**
```typescript
// spec: SPEC-AUTH-001#td-api
export async function authenticateUser(email: string, password: string): Promise<AuthResult> {
    ...
}
```

**Test files — trace to the validation spec, not the execution spec:**
```python
# spec: SPEC-AUTH-VAL-001#ac-token-expiry
def test_token_expires_after_15_minutes():
    ...
```

**Git commit footer:**
```
feat(auth): implement JWT token generation

spec: SPEC-AUTH-001#td-token-gen
closes: TASK-127
```

### What NOT to Annotate

- Utility helpers with no direct spec correspondence
- Boilerplate, config templates, third-party wrappers
- Code where the spec relationship is obvious from file path and name

Annotate where a future reader would ask "why was this written this way?" or "which spec drove this decision?"

**Context annotation** — when code was directly shaped by an existing codebase reference:

```python
# ctx: CTX-CODE-001  (informs the approach taken here)
def generate_jwt(user_id: str, expires_in: int = 900) -> str:
    ...
```

### Per-symbol annotations — trace graph enrichment

The planner trace graph reads files via the `/api/v2/code-trace` endpoint, which extracts the file-level JSDoc header AND per-function annotations. To make a specific exported function or class traceable to a requirement, add a `@satisfies` comment immediately before it:

**Inline comment style:**
```typescript
// @satisfies R-001 — free-tier gate
export async function checkFreeGate(...): Promise<...> {
```

**JSDoc block style:**
```typescript
/**
 * @satisfies R-002
 * @sdd_req R-002
 */
export function chargeCapacity(...) {
```

The trace graph displays `@satisfies R-XXX` as clickable requirement tags on each function row, with expandable code previews and line-range links. `lineStart`, `lineEnd`, and `snippet` are extracted automatically — you don't write them.

**Rule:** every exported function that satisfies a requirement listed in the parent Epic's acceptance checklist SHOULD have at least a `// @satisfies R-XXX` comment. This creates the full chain: North Star → Epic → Execution task → implementation file → specific function.

---

## Trace Taxonomy

Four tiers, directed edges. These are the only valid trace types.

### Tier 1: Context Specs (`CTX-*`) — pages, reference material

| Type | ID prefix | Entity |
|---|---|---|
| `ctx-prompt` | `CTX-PROMPT-` | Original user request, brief, voice memo |
| `ctx-code` | `CTX-CODE-` | Existing code snippet with filepath + symbol |
| `ctx-search` | `CTX-SEARCH-` | Research thread, web search results |
| `ctx-doc` | `CTX-DOC-` | External/internal doc, RFC, standard |
| `ctx-legacy` | `CTX-LEGACY-` | Prior implementation being replaced |

### Tier 2: Execution Specs (`SPEC-*`) — planner tasks

| Type | Column |
|---|---|
| `north-star` | North Stars |
| `epic` | Epics |
| `execution` | Execution |
| `validation` | Validation |

### Tier 3: Code and Artifacts — generated outputs

| Type | Description |
|---|---|
| `function` | Single function or method |
| `class` | Class or service |
| `module` | File or module |
| `test` | Test function or test class |
| `schema` | Database migration, API schema, type definition |
| `config` | Configuration file implementing a spec constraint |
| `artifact-page` | Dataspheres page created during execution |
| `artifact-dataset` | Dataset created or populated during execution |
| `artifact-image` | AI-generated image produced during execution |
| `artifact-sequence` | Automation sequence created during execution |

### Tier 4: Result Specs (`RESULT-*`) — pages, output receipts

| Type | Entity |
|---|---|
| `result` | Post-execution report: artifacts, code snippets, test results, trace summary |

### Relationship Types (Directed Edges)

| Relationship | Direction | Meaning |
|---|---|---|
| `informs` | CTX → SPEC | This context spec shaped this execution spec |
| `implements` | CODE → SPEC | This code directly implements this spec section |
| `informed_by` | CODE → CTX | This code was shaped by this context (existing code, prior art) |
| `satisfies` | CODE/test → SPEC/validation | This test satisfies this acceptance criterion |
| `derived_from` | SPEC → CTX | This spec exists because of this constraint or decision |
| `supersedes` | SPEC → SPEC | This spec replaces that spec |
| `refines` | SPEC/execution → SPEC/epic | This execution spec elaborates on that epic |
| `validates` | SPEC/validation → SPEC/execution | This validation spec tests that execution spec |
| `depends_on` | SPEC → SPEC | This spec requires that spec to be Active first |
| `summarizes` | RESULT → SPEC/execution | This result report covers what this spec built |
| `includes_artifact` | RESULT → CODE/ARTIFACT | This result report references this output |

---

## TRACES.yml — Trace Appendix
→ *Referenced by: Step 11, Drift Prevention Gate Checks*

`TRACES.yml` lives at the root of the project spec directory alongside `tasks.yaml`. It is machine-readable. Ari generates and maintains it — do not edit by hand.

```yaml
# TRACES.yml — generated by Ari, do not edit manually
# initiative: my-feature
# last_updated: 2025-03-21T09:00:00Z

traces:
  # Context → Spec
  - id: TR-001
    from: { tier: context, type: ctx-prompt, ref: CTX-PROMPT-001 }
    to:   { tier: spec,    ref: SPEC-AUTH-001 }
    relationship: informs
    created: 2025-01-14
    status: active

  - id: TR-002
    from: { tier: context, type: ctx-code, ref: "CTX-CODE-001 (src/auth/session_auth.py::SessionAuth)" }
    to:   { tier: spec,    ref: SPEC-AUTH-001 }
    relationship: informs
    created: 2025-01-14
    status: active

  # Spec → Code
  - id: TR-003
    from: { tier: code, type: function, ref: src/auth/jwt.py::generate_jwt }
    to:   { tier: spec, ref: SPEC-AUTH-001#td-token-gen }
    relationship: implements
    created: 2025-03-20
    verified: 2025-03-21
    status: active

  - id: TR-004
    from: { tier: code, type: function, ref: src/auth/jwt.py::generate_jwt }
    to:   { tier: context, type: ctx-code, ref: CTX-CODE-001 }
    relationship: informed_by
    created: 2025-03-20
    status: active

  # Test → Validation spec
  - id: TR-005
    from: { tier: code, type: test, ref: "tests/test_auth.py::test_token_expires_after_15_minutes" }
    to:   { tier: spec, ref: SPEC-AUTH-VAL-001#ac-token-expiry }
    relationship: satisfies
    created: 2025-03-21
    verified: 2025-03-21
    status: active

  # Result → Execution spec + artifacts
  - id: TR-006
    from: { tier: result, ref: RESULT-AUTH-001 }
    to:   { tier: spec,   ref: SPEC-AUTH-001 }
    relationship: summarizes
    created: 2025-03-22
    status: active

  - id: TR-007
    from: { tier: result, ref: RESULT-AUTH-001 }
    to:   { tier: code,   type: function, ref: src/auth/jwt.py::generate_jwt }
    relationship: includes_artifact
    created: 2025-03-22
    status: active
```

### When Ari Updates TRACES.yml

- **Context spec created:** adds CTX→SPEC `informs` traces to every execution spec in `context_refs`
- **Task published (step 9):** adds SPEC→CTX `informs` and SPEC→CTX `derived_from` traces from each task's `context_refs`
- **Code reviewed (user pastes file or commit):** adds CODE→SPEC `implements` and CODE→CTX `informed_by` traces from `# spec:` and `# ctx:` annotations
- **Spec version bumped:** marks all `implements` traces to that spec as `status: needs_review`
- **Spec moved to DEPRECATED:** marks all traces pointing to that spec as `status: orphaned`
- **Result spec generated:** adds RESULT→SPEC `summarizes` and RESULT→CODE `includes_artifact` traces
- **Any trace update:** regenerates the Mermaid trace graph in the dashboard page (see Trace Health Dashboard)

---

## Drift Prevention Gate Checks
→ *Referenced by: Task Done Workflow*

Ari runs these checks at lifecycle transitions before proceeding. Failing a check outputs a BLOCKED gate — same format as the publish protocol.

### Gate: Execution → Validation

1. **Implementation coverage** — every section anchor (`#td-*`) in the execution spec has at least one `implements` trace in TRACES.yml
2. **No orphan annotations** — all `# spec:` annotations in code resolve to a known ACTIVE spec ID
3. **No DRAFT specs** — all execution specs for this initiative are `status: ACTIVE`

Failure output:
```
🚫 DRIFT GATE BLOCKED — SPEC-AUTH-001#td-token-gen has no implements trace
   Required: add # spec: SPEC-AUTH-001#td-token-gen to the implementing function,
             then update TRACES.yml with a new TR entry (relationship: implements)
```

### Gate: Validation → Done

1. **Test coverage** — every acceptance criterion anchor (`#ac-*`) in the validation spec has a `satisfies` trace
2. **All tests passing** — Ari asks for test output or CI link; does not self-certify
3. **No stale traces** — no `status: needs_review` entries in TRACES.yml for this spec's traces

### Ongoing Drift Alerts

Triggered automatically when:

- A spec's `version` increments → flag all `implements` traces pointing to it: "Spec updated — verify these traces are still accurate before Validation gate"
- A spec moves to `DEPRECATED` → flag all pointing traces as orphaned; prompt to update code annotations or reclassify the trace
- A `CODE/test` trace exists for a spec section but no `CODE/function` trace for the same section → "Spec has test coverage but no implementation trace — possible dead test or missing annotation"

---

## Trace Health Dashboard
→ *Referenced by: Step 11, Dashboard Page Template*

The trace health section in the initiative dashboard uses the platform's dataset + data card infrastructure. It requires the two trace datasets created in step 11.

### Dataset Schemas

**Traces dataset (`<initiative>-traces`):**

| Column | Type | Values |
|---|---|---|
| `trace_id` | text | TR-001, TR-002, ... |
| `from_ref` | text | CTX-PROMPT-001, src/auth/jwt.py::generate_jwt, RESULT-AUTH-001 |
| `from_tier` | select | context, spec, code, result |
| `to_ref` | text | SPEC-AUTH-001#td-token-gen, CTX-CODE-001 |
| `to_tier` | select | context, spec, code, result |
| `relationship` | select | informs, implements, informed_by, satisfies, derived_from, supersedes, refines, validates, depends_on, summarizes, includes_artifact |
| `status` | select | active, orphaned, needs_review |
| `created` | date | |
| `verified` | date | |

**Spec Health dataset (`<initiative>-spec-health`):**

| Column | Type | Notes |
|---|---|---|
| `spec_id` | text | SPEC-AUTH-001, CTX-PROMPT-001, RESULT-AUTH-001 |
| `title` | text | |
| `tier` | select | context, execution, result |
| `spec_type` | select | all spec_type values |
| `spec_status` | select | DRAFT, ACTIVE, DEPRECATED, SUPERSEDED, FINAL |
| `informs_count` | number | count of informs traces (for context specs) |
| `impl_traces` | number | count of implements traces (for execution specs) |
| `test_traces` | number | count of satisfies traces |
| `orphan_count` | number | count of orphaned traces |
| `needs_review_count` | number | |
| `last_verified` | date | |

### Data Cards to Create (Step 11)

```python
# Trace health by status — donut showing active/orphaned/needs_review split
create_data_card(dataset_id="<traces-id>", name="Trace Health", chart_type="donut", group_by="status")

# Implementation coverage per column — bar per execution spec column
create_data_card(dataset_id="<spec-health-id>", name="Spec Coverage by Column",
                 chart_type="bar", x_axis="spec_type", y_axis="impl_traces")

# Drift signals — any spec with orphan_count > 0
create_data_card(dataset_id="<spec-health-id>", name="Drift Signals",
                 chart_type="bar", x_axis="spec_id", y_axis="orphan_count")
```

Capture the three card IDs for substitution into the dashboard template.

### Initiative-Wide Trace Map (Dashboard)

The initiative-wide view uses a **left-to-right swimlane** format — four named subgraphs (Context / Specs / Code / Results) with edges crossing lanes. This makes the CTX→SPEC→CODE→RESULT flow read naturally left to right and stays legible up to ~40 nodes. Ari generates it from TRACES.yml and PATCHes the dashboard page whenever the trace graph changes.

```
graph LR
  subgraph CTX ["Context"]
    CTX_P1["CTX-PROMPT-001\nUser Brief"]
    CTX_C1["CTX-CODE-001\nsession_auth.py"]
    CTX_S1["CTX-SEARCH-001\nOAuth Research"]
  end

  subgraph SPECS ["Execution Specs"]
    SPEC1["SPEC-AUTH-001\nJWT Auth\n(api-contract)"]
    SPEC2["SPEC-AUTH-DS-001\nTokens Schema\n(data-schema)"]
  end

  subgraph CODE ["Code & Artifacts"]
    C1["jwt.py\n::generate_jwt"]
    C2["service.py\n::AuthService"]
    C3["migrations/0042"]
  end

  subgraph RESULTS ["Results"]
    R1["RESULT-AUTH-001\nAuth Build Report"]
  end

  CTX_P1 --> SPEC1
  CTX_C1 --> SPEC1
  CTX_S1 --> SPEC2
  SPEC1 --> C1
  SPEC1 --> C2
  SPEC2 --> C3
  R1 --> SPEC1
  R1 --> SPEC2
```

The swimlane makes the coverage gaps visible immediately: a Spec column node with no incoming CTX edges means the spec has no context citation. A Spec node with no outgoing CODE edges is unimplemented.

The graph lives in the dashboard page under "Trace Map". Ari regenerates and PATCHes it on each TRACES.yml update. For the **platform `trace-map` widget**, this swimlane layout (four fixed lanes, edges between) is the right format to implement — not force-directed, which loses the tier structure above ~20 nodes.

### Platform Requests

**What works today (no platform changes):**
- Per-spec Mermaid block inside task Tiptap content (PATCHed by Ari — fragile stopgap)
- Initiative-wide swimlane Mermaid graph in dashboard page (PATCHed by Ari)
- Dataset table embeds for the full trace appendix and Spec Health Index
- Data cards for coverage and drift metrics

**Platform enhancements — all shipped ✅:**

| Priority | Feature | Status | Notes |
|---|---|---|---|
| **1** | `SpecTraceCard` — conditional panel in task modal | ✅ Shipped | `src/client/components/planner/SpecTraceCard.tsx` — auto-triggers when task content has YAML with `spec_id:`. Collapsible panel outside TipTap. Discovers Traces dataset by name, filters on `from_ref`/`to_ref = spec_id`. |
| **2** | `data-widget-type="trace-map"` | ✅ Shipped | Tiered column SVG (CTX → SPEC → CODE → RESULT) in `PlannerWidgetRenderer`. Clickable nodes — spec nodes navigate, code nodes copy path. Requires `data-dataset-id`. |
| **3** | `data-widget-type="trace-health"` | ✅ Shipped | Matrix table of spec_type × status counts. Requires `data-dataset-id`. |
| **4** | `data-widget-type="drift-alerts"` | ✅ Shipped | Card list of rows with drift/stale/orphan status. Requires `data-dataset-id`. |
| **5** | Planner: `SPEC-*` / `CTX-*` / `RESULT-*` tag deep links | ✅ Shipped | `TaskCard.tsx` — tags matching `/^(SPEC\|CTX\|RESULT)-/i` render as clickable links to `/app/:uri/docs/:tag`. |

---

## Enforcement Hook Hardening

The SDD enforcement hook (`.claude/hooks/sdd-enforce.js`) blocks code edits when SDD mode is active but no task is in-progress. The naive implementation only checked `state.active && !state.activeTaskId`, which left a bypass hole: setting `active: false` directly in `sdd-active.json` via Bash silently disables enforcement without any planner visibility.

### Two Transparent Bypass Paths

Only these two paths are accepted — both leave a visible trail:

1. **Task-in-progress bypass** — mark a genuine task as in-progress with `sdd_task_start`. The planner shows the task as active and the activity feed records the start comment.

2. **`/sdd hotfix <reason>` escape hatch** — for urgent fixes that have no corresponding SDD task. This writes `hotfixReason` into `sdd-active.json` AND posts a comment to the active plan mode so the bypass is visible to stakeholders.

### `/sdd hotfix <reason>` Command

**To enter hotfix mode:**

```bash
# 1. Write hotfix state to sdd-active.json
node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('.claude/sdd-active.json', 'utf8'));
fs.writeFileSync('.claude/sdd-active.json', JSON.stringify({
  ...state,
  active: false,
  hotfixReason: '<reason>'
}, null, 2));
console.log('Hotfix mode enabled:', '<reason>');
"

# 2. Post a comment on the active plan mode so the bypass is visible
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes/<planModeId>/comments" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"[all-dai-sdd-system-message] ⚠️ HOTFIX BYPASS — <reason>. Files modified outside SDD lifecycle."}'
```

**To exit hotfix mode (`/sdd hotfix done`):**

```bash
node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('.claude/sdd-active.json', 'utf8'));
const { hotfixReason, ...rest } = state;
fs.writeFileSync('.claude/sdd-active.json', JSON.stringify({
  ...rest,
  active: true,
  hotfixReason: null
}, null, 2));
console.log('Hotfix mode cleared — SDD enforcement re-enabled');
"
```

### Hardened Hook Pattern

The hardened hook treats `active: false` without `hotfixReason` as a corrupt/bypassed state and blocks it — same as if `active: true` with no task. Only the two transparent paths above are allowed through.

```js
// .claude/hooks/sdd-enforce.js — hardened pattern
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

// Normal inactive state — enforcement off
if (!state.active && !state.hotfixReason) return { block: false };

// Hotfix in progress — allow but warn so the developer sees it
if (!state.active && state.hotfixReason) {
  process.stderr.write('\u26a0\ufe0f SDD HOTFIX MODE: ' + state.hotfixReason + '\n');
  return { block: false };
}

// active:true but no task claimed — block
if (state.active && !state.activeTaskId) {
  return {
    block: true,
    reason: 'SDD enforcement: active initiative \'' + state.initiative + '\' has no task in-progress. \n' +
            'Run sdd_task_start(<taskId>, ...) to claim a task, or /sdd hotfix <reason> for urgent fixes.'
  };
}

// Task in progress — allow
return { block: false };
```

**Key rules:**
- `active: false` alone (no `hotfixReason`) = corrupt/bypassed state → **block**
- `active: false` + `hotfixReason` = legitimate hotfix → **allow + stderr warning**
- `active: true` + `activeTaskId` = task in-progress → **allow**
- `active: true` + no `activeTaskId` = SDD active but no task claimed → **block**