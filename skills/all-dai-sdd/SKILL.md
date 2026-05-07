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

### Step 11 of 14 — Create tracker dataset + dataCards + trace datasets

Create or update the tracker dataset. Add dataCards for progress metrics. Skip tracker if the project has no `tracker-schema.yaml`.

Also create two trace datasets (always required — see Trace Health Dashboard section):
1. `<initiative>-traces` — one row per trace entry (from TRACES.yml)
2. `<initiative>-spec-health` — one row per spec (aggregated coverage + drift signal)

Create three data cards from these datasets: Trace Health (donut by status), Spec Coverage by Column (bar), Drift Signals (bar of orphan_count per spec_id). Capture all dataset and data card IDs for use in step 12.

**Gate evidence required:** `tracker=<id> (or: skipped) | traces-dataset=<id> | spec-health-dataset=<id> | 3 data cards created`

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

<h2>Trace Health</h2>
<p>Bidirectional coverage between specs and code. Orphan count should be 0 at any Validation gate.</p>

<div data-type="dataCard"
     data-datacard-id="<trace-health-card-id>"
     data-dataset-id="<traces-dataset-id>"
     data-datasphere-id="<dsId>">[Data Card: Trace Health]</div>

<div data-type="dataCard"
     data-datacard-id="<coverage-card-id>"
     data-dataset-id="<spec-health-dataset-id>"
     data-datasphere-id="<dsId>">[Data Card: Spec Coverage by Column]</div>

<div data-type="dataCard"
     data-datacard-id="<drift-card-id>"
     data-dataset-id="<spec-health-dataset-id>"
     data-datasphere-id="<dsId>">[Data Card: Drift Signals]</div>

<h2>Trace Appendix</h2>
<p>Full trace index -- updated by Ari as specs and code are linked.</p>

<div data-type="datasetEmbed"
     data-dataset-id="<traces-dataset-id>"
     data-datasphere-id="<dsId>">[Dataset: Traces]</div>

<h2>Spec Health Index</h2>
<div data-type="datasetEmbed"
     data-dataset-id="<spec-health-dataset-id>"
     data-datasphere-id="<dsId>">[Dataset: Spec Health]</div>

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

### Step 4: PATCH task to Done

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

---

## Spec Traceability Protocol
→ *Referenced by: Steps 9, 11, Drift Prevention Gate Checks*

Every spec task carries a front matter block and section anchors. Together they form the contract that enables bidirectional tracing between specs, code, and context.

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

### Mermaid Trace Graph (Visualization Appendix)

Ari generates a Mermaid DAG from TRACES.yml and embeds it in the dashboard page as a `data-type="mermaid"` block. This works today with zero platform changes — the Mermaid renderer already handles `graph TD`. Ari PATCHes this block whenever TRACES.yml is updated.

Generated graph format:

```
graph TD
  CTX_PROMPT_001["CTX-PROMPT-001\nUser Brief: auth system"]
  CTX_CODE_001["CTX-CODE-001\nsrc/auth/session_auth.py"]
  SPEC_AUTH_001["SPEC-AUTH-001\nJWT Auth Service\n(api-contract)"]
  CODE_jwt["CODE\nsrc/auth/jwt.py\n::generate_jwt"]
  CODE_svc["CODE\nsrc/auth/service.py\n::AuthService"]
  RESULT_AUTH_001["RESULT-AUTH-001\nAuth Build Report"]

  CTX_PROMPT_001 -->|informs| SPEC_AUTH_001
  CTX_CODE_001 -->|informs| SPEC_AUTH_001
  SPEC_AUTH_001 -->|implements| CODE_jwt
  SPEC_AUTH_001 -->|implements| CODE_svc
  CODE_jwt -->|informed_by| CTX_CODE_001
  RESULT_AUTH_001 -->|summarizes| SPEC_AUTH_001
  RESULT_AUTH_001 -->|includes_artifact| CODE_jwt
  RESULT_AUTH_001 -->|includes_artifact| CODE_svc
```

The graph lives in the dashboard page under a "Trace Map" heading. Ari regenerates and PATCHes it each time a new trace is added to TRACES.yml.

### Platform Requests

**What works today (no platform changes):**
- Mermaid trace graph embedded in dashboard page — fully functional, Ari-generated and maintained
- Dataset table embeds (Trace Appendix, Spec Health Index) — live queryable tables in the dashboard
- Data cards for coverage/drift metrics

**Requested platform enhancements:**

| Feature | What it does | Why it matters |
|---|---|---|
| `data-widget-type="trace-health"` | Native ring gauge reading Traces dataset — zero chart config per initiative | Replaces manual data card setup; consistent across all SDD dashboards |
| `data-widget-type="drift-alerts"` | Card list of orphaned/needs-review traces with inline fix links | Makes drift visible at a glance without reading the appendix table |
| `data-widget-type="trace-map"` | Interactive force-directed graph reading Traces dataset; nodes are clickable (navigate to spec page or file) | Replaces Ari-generated static Mermaid with a live, interactive graph. The biggest visualization win. |
| Planner: `SPEC-*` tag deep link | Clicking a `SPEC-AUTH-001` tag on a task card navigates to the spec page | Closes the planner → spec navigation gap; low effort, high discoverability value |
| Spec front matter renderer | YAML block with `spec_id:` key renders as a structured card: status badge, spec_type, lineage links | Replaces raw code block with a native spec card; makes specs feel first-class in the UI |

The `trace-map` interactive widget is the highest-value ask — the static Mermaid graph works but a clickable, live graph of the full CTX→SPEC→CODE→RESULT lineage would make the appendix genuinely useful during execution, not just as an audit artifact.
