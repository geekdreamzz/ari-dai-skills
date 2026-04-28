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

Ensure these four CodeFamilies + their values exist in the datasphere:
- `Legacy Impact` — values: `none`, `additive`, `breaking`
- `Rollback Safe` — values: `safe`, `manual`
- `User Approved` — values: `yes`, `no`
- `Tags` — seed value: `<initiative-slug>`

GET first; POST only if missing. Capture family IDs for use in step 10.

**Gate evidence required:** `4 families confirmed (IDs: <id1>, <id2>, <id3>, <id4>)`

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

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"<Initiative Name>","tagFilter":["<initiative-slug>"]}'
```

Capture `planModeId`. The planner URL is `?mode=<planModeId>` — NOT `?planMode=`.

**Gate evidence required:** `planModeId=<id>`

---

### Step 8 of 14 — Create 5 scoped status groups + delete defaults
→ *Detail: line 122 (Column Architecture)*

**CRITICAL — do NOT reuse existing status groups from other plan modes or the datasphere defaults.** Creating the plan mode auto-creates 3 default columns (`To Do`, `In Progress`, `In Review`) AND a `Done` group. You must DELETE the 3 defaults and POST the 4 SDD groups — the auto-created `Done` is kept.

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

**Gate evidence required:** `5 groups confirmed (3 defaults deleted): NS=<id> EP=<id> EX=<id> VA=<id> DONE=<id>`

---

### Step 9 of 14 — Publish tasks (bulk)
→ *Detail: line 154 (Task Status vs statusGroupId)*

POST all tasks via bulk endpoint. Each task payload must include:
- `statusGroupId` — one of the 5 IDs captured in step 8 (never a foreign group ID)
- `tags` — include the initiative slug so the plan mode filter picks them up
- `content` — full HTML with acceptance checklist and implementation scope

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/bulk" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"title":"...","statusGroupId":"<scopedGroupId>","tags":["<initiative>"],...}]}'
```

If bulk returns 500, fall back to individual POSTs — but verify every task's `statusGroupId` is from step 8 before posting.

**Gate evidence required:** `<N> tasks created (NS:<n> EP:<n> EX:<n>), all tagged <initiative>`

---

### Step 10 of 14 — Apply CodeApplications

Tag each task with: initiative slug, `sdd`, phase tag, `legacyImpact` value, `rollbackSafe` value, `userApproved` value. Use the CodeFamily IDs from step 5.

**Gate evidence required:** `CodeApplications applied to <N> tasks`

---

### Step 11 of 14 — Create tracker dataset + dataCards

Create or update the tracker dataset. Add dataCards for progress metrics. Skip if the project has no `tracker-schema.yaml`.

**Gate evidence required:** `dataset=<id> (or: skipped — no tracker-schema.yaml)`

---

### Step 12 of 14 — Publish dashboard page
→ *Detail: line 74 (Dashboard Page Template)*

Use the exact template from line 74. Widgets: `progress-ring`, `column-breakdown`, `active-tasks`, `task-activity-feed`. **No other `data-widget-type` values are valid** — any other value crashes the renderer.

The planner link in the dashboard content MUST use `?mode=<planModeId>` — not `?planMode=`. No emojis in page content (they render as `??` in the platform renderer).

```html
<p><a href="$DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>">[Planner] <initiative> plan mode</a></p>
```

**Gate evidence required:** `slug=<dashboard-slug> HTTP 200/201`

---

### Step 13 of 14 — Wire bidirectional links
→ *Detail: line 51 (step 13 in original spec — "do NOT skip")*

Two calls, both required:

**A. Set `trackerUrl` on the plan mode** (surfaces as a button in the planner header):
```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes/<planModeId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"trackerUrl":"$DATASPHERES_PUBLIC_URL/app/<uri>/docs/<dashboard-slug>"}'
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
  Dashboard:   <PUBLIC_URL>/app/<uri>/docs/<dashboard-slug>
  Vision:      <PUBLIC_URL>/app/<uri>/docs/<vision-slug>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Gate evidence required:** Summary printed with real values (no placeholders)

---

## Dashboard Page Template
→ *Referenced by: Step 12*

**CRITICAL — no emojis or special Unicode anywhere in this page.** The platform's page renderer displays emojis as `??` or diamond question marks. Use plain ASCII only in all titles, headings, link text, and widget labels.

```html
<p><a href="$DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>">[Planner] <initiative> plan mode</a></p>
<h1><Project> - Initiative Dashboard</h1>
<p>Live progress tracker. All widgets query the planner in real time.</p>

<h2>At a Glance</h2>
<div data-type="plannerWidget"
     data-widget-type="progress-ring"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<h2>Work Distribution</h2>
<div data-type="plannerWidget"
     data-widget-type="column-breakdown"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<h2>Active Execution</h2>
<div data-type="plannerWidget"
     data-widget-type="active-tasks"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<h2>Live Activity Feed</h2>
<div data-type="plannerWidget"
     data-widget-type="task-activity-feed"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<h2>Quick Links</h2>
<ul>
  <li><p><a href="$DATASPHERES_PUBLIC_URL/app/<uri>/docs/<vision-slug>">Vision and Architecture</a></p></li>
</ul>
```

The `data-datasphere-uri` attribute enables deep links from the activity feed — each comment card links to its task in the planner at `/app/<uri>/planner?mode=<planModeId>&taskId=<taskId>`.

### Valid `data-widget-type` values

| Value | Renders |
|---|---|
| `progress-ring` | % complete gauge |
| `column-breakdown` | Count per column |
| `active-tasks` | Tasks in Execution / IN_PROGRESS |
| `blocked-tasks` | Blocked tasks with reasons |
| `task-activity-feed` | Recent comments + screenshots |

**Any other value crashes the renderer** (`Cannot read properties of undefined (reading 'icon')`). Only use values from this table.

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

## Task Done Workflow — Completion Comment with Screenshots

When marking a task Done, post a structured completion comment. The activity feed widget on the dashboard renders these comments — including screenshot thumbnails that link to full-size images.

### Upload Playwright screenshots

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

### Post the completion comment

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

### Then PATCH task to Done

```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"statusGroupId":"<doneGroupId>","status":"DONE"}'
```

Always set BOTH `statusGroupId` and `status` — setting only `statusGroupId` moves the card visually but leaves `status=TODO` in the DB.

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
    legacyImpact: none | additive | breaking
    rollbackSafe: safe | manual
    userApproved: yes | no
    content: |
      <h3>Acceptance Checklist</h3>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>Observable criterion 1</p></li>
        <li data-type="taskItem" data-checked="false"><p>Observable criterion 2</p></li>
        <li data-type="taskItem" data-checked="false"><p>Test written and green</p></li>
        <li data-type="taskItem" data-checked="false"><p>Screenshot captured</p></li>
      </ul>
      <h3>Implementation Scope</h3>
      <p>Files to touch + what to do in each.</p>
```

---

## CLAUDE.md Integration
→ *Referenced by: Step 14*

When `install.sh --all` installs skills into a project, the project's `CLAUDE.md` should reference this skill and the column lifecycle. Ari reads the CLAUDE.md on session start — if the column names aren't there, Ari won't know to use the SDD structure.

Template addition for project CLAUDE.md:
```markdown
## Active Initiatives (SDD)

Tracked in Dataspheres AI via all-dai-sdd skill.
Five-column lifecycle: North Stars → Epics → Execution → Validation → Done.
Dashboard: $DATASPHERES_PUBLIC_URL/app/<uri>/docs/<dashboard-slug>
Planner: $DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>
```
