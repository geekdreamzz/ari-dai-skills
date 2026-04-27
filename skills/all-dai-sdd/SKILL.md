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

## `/sdd publish <project-dir>` — Full Checklist

Run in order. Each step is required.

1. Load env from `~/.dataspheres.env`
2. Read `tasks.yaml` — require `targetDatasphere`
3. Confirm target datasphere interactively before any writes
4. Resolve DS — GET `/api/v1/dataspheres/<uri>`. Capture the DB `id` (not URI)
5. Seed CodeFamilies (Legacy Impact, Rollback Safe, User Approved, Tags)
6. Publish vision page (001-*.md) as a DS reader page
7. **Ensure status groups** — GET then POST if missing. Must be exactly these 5, with `planModeId` set to the initiative's plan mode:
   - North Stars (order: 0)
   - Epics (order: 1)
   - Execution (order: 2)
   - Validation (order: 3)
   - Done (order: 4, isDoneState: true)
8. Ensure initiative Plan Mode — GET or POST with `tagFilter: ["<initiative>"]`. Capture `planModeId`
9. Publish tasks via POST `/api/v2/dataspheres/<dsId>/tasks/bulk`
10. Apply CodeApplications (initiative tag, req:R-XXX, sdd, legacyImpact, rollbackSafe, userApproved)
11. Create/update tracker dataset + dataCards
12. Generate dashboard page with plannerWidget divs (see template below)
13. **Wire bidirectional links between dashboard and plan mode** (step 13 — do NOT skip):

    ```bash
    # A. Point the plan mode at the dashboard page
    #    → shows as a clickable "tracker" button in the planner header
    curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes/<planModeId>" \
      -H "Authorization: Bearer $DATASPHERES_API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"trackerUrl\":\"$DATASPHERES_PUBLIC_URL/app/<uri>/docs/<dashboard-slug>\"}"

    # B. Prepend a reciprocal planner link inside the dashboard page content
    #    Add this HTML before the <h1>:
    #    <p>📋 <a href="$DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>">
    #       Open in Planner → <initiative> plan mode</a></p>
    #    Then PUT the updated content via the pages API.
    ```

    **Why both directions:** `trackerUrl` surfaces as a button in the plan mode header so anyone in the planner can jump to the dashboard. The dashboard link sends readers into the live board. Neither is set automatically — both must be wired explicitly after the pages and plan mode are created.

14. Post publish summary with counts + links

---

## Dashboard Page Template

```html
<p>📋 <a href="$DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>">Open in Planner → <initiative> plan mode</a></p>
<h1>🚀 <Project> — Initiative Dashboard</h1>
<p>Live progress tracker. All widgets query the planner in real time.</p>

<h2>📊 At a Glance</h2>
<div data-type="plannerWidget"
     data-widget-type="progress-ring"
     data-datasphere-id="<dsId>"
     data-plan-mode-id="<planModeId>"></div>

<h2>📈 Work Distribution</h2>
<div data-type="plannerWidget"
     data-widget-type="column-breakdown"
     data-datasphere-id="<dsId>"
     data-plan-mode-id="<planModeId>"></div>

<h2>⚡ Active Execution</h2>
<div data-type="plannerWidget"
     data-widget-type="active-tasks"
     data-datasphere-id="<dsId>"
     data-plan-mode-id="<planModeId>"></div>

<h2>💬 Live Activity Feed</h2>
<div data-type="plannerWidget"
     data-widget-type="task-activity-feed"
     data-datasphere-id="<dsId>"
     data-plan-mode-id="<planModeId>"></div>
```

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

Status groups are scoped to the plan mode. When `createPlanMode` is called with no template, the planner creates its own default columns (To Do / In Progress / Done). These are NOT the SDD columns.

**You must always create 5 new status groups explicitly**, each with `planModeId` set to the new mode's ID:

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"North Stars","order":0,"planModeId":"<planModeId>"}'
# Repeat for Epics (order:1), Execution (order:2), Validation (order:3), Done (order:4, isDoneState:true)
```

Then assign tasks to the correct groups using `statusGroupId` in the bulk create payload.

---

## API Note — datasphereId vs URI

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

## Sub-Checklist Propagation

When an Execution task moves to Done:
1. Fetch parent Epic content
2. Replace `☐ T-XXX ·` with `☑ T-XXX ·` in the Epic HTML
3. PATCH the Epic task content
4. If all items ticked → post comment on Epic: "All Execution tasks complete. Ready for Validation."

When an Epic moves to Done:
1. Tick the Epic's `☐ E-XXX ·` item in the parent North Star content
2. If all Epic items ticked → move North Star to Done

---

## Credential Setup

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

## CLAUDE.md Integration

When `install.sh --all` installs skills into a project, the project's `CLAUDE.md` should reference this skill and the column lifecycle. Ari reads the CLAUDE.md on session start — if the column names aren't there, Ari won't know to use the SDD structure.

Template addition for project CLAUDE.md:
```markdown
## Active Initiatives (SDD)

Tracked in Dataspheres AI via all-dai-sdd skill.
Five-column lifecycle: North Stars → Epics → Execution → Validation → Done.
Dashboard: $DATASPHERES_PUBLIC_URL/app/<uri>/docs/<dashboard-slug>
Planner: $DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>
```
