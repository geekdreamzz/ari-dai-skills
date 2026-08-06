---
name: dataspheres
description: Dataspheres tools for Dataspheres AI
---

# Dataspheres

> Tool reference for this resource group, mirrored by hand from the platform live `/api/mcp/schema` schema.

## Tools

### `create_datasphere` — New Datasphere

Creates a new datasphere. Guide the user through:
1. What's the name? (required)
2. Short description/tagline?
3. Public or private?
4. Any topic tags?
5. Generate the purpose HTML using the standard template from the API docs.
Then show a preview card and ask to confirm before creating.
Content must be HTML (not markdown) — use <h2>, <p>, <ul>, <strong>, <blockquote>.

━━━ AUTO-CHAIN ━━━
Creating a datasphere is step 1 of the research workflow. After success, offer to continue:
- "Want me to set up a dataset for tracking {topic}?" → create_dataset
- "Should I draft a welcome page explaining what this is about?" → create_page
Don't fire the next step automatically — ASK the user before chaining. HIL at each hop.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Display name |
| `uri` | string | no | Custom URI slug (auto-generated from name if omitted) |
| `description` | string | no | Short tagline for cards and previews |
| `purpose` | string | no | Rich HTML description — use the standard template: What is [Name], What We Track (ul), Who This Is For, blockquote manifesto |
| `status` | string | no | Visibility |
| `topicTags` | array | no | Tags for discoverability |

### `get_datasphere` — Datasphere Info

Gets full details for a single datasphere — name, URI, description, purpose, status, member count, banner/profile images. Use when the user wants to know details about a specific datasphere.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |

### `list_dataspheres` — My Dataspheres

Lists all dataspheres the user is a member of. Returns name, URI, description, member/post counts, profile image. Use @[ds:id|uri|name|imageUrl] mention format in your response.
- Positive flow: cards render automatically — briefly say "Here are your dataspheres!" and invite the next step (e.g. "Which one would you like to explore?")
- Negative flow: "It looks like you're not a member of any dataspheres yet. Would you like to create your first one?"

### `update_datasphere` — Update Datasphere

Updates a datasphere. Only provide fields to change. Requires MODERATOR+ role.
Guide: 1) Which datasphere? 2) What to change? Show a before/after preview.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | URI of datasphere to update |
| `name` | string | no | New display name |
| `description` | string | no | New tagline |
| `purpose` | string | no | New HTML purpose |
| `status` | string | no | Visibility |
| `topicTags` | array | no | New tags (replaces existing) |
| `systemInstructions` | string | no | AI system prompt for this datasphere |

### `clone_datasphere` — Clone a Blueprint Datasphere

Clones a PUBLIC-BLUEPRINT datasphere's cloneable content (pages, datasets, courses, surveys, schedules, newsletter structure, board columns) with fresh ids and remapped references — NEVER any private or member data (members, subscribers, conversations, journals stay behind). By default creates a brand-new datasphere the caller owns; pass `targetUri` to merge into an existing datasphere they moderate (slugs de-duplicate on merge). Requires confirmation; costs tokens.

Guide the user: 1) confirm the source blueprint (must have `isPublicBlueprint=true`), 2) new sphere or merge into one they moderate?, 3) name for the copy. Preview what will copy via `GET /api/v1/dataspheres/:uri/clone/preview` before firing.

In the app UI this is the "Clone this Datasphere" card on the Create hub and the Clone button on the Inside-this-Datasphere home card (both open the clone modal — window event `open-clone-blueprint`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Source datasphere (public blueprint) to clone |
| `name` | string | no | Name for the new copy (default: "<source> (clone)"). Ignored when `targetUri` set |
| `uri` | string | no | URL slug for the new copy (auto if omitted). Ignored when `targetUri` set |
| `targetUri` | string | no | Clone INTO an existing datasphere you moderate instead of creating a new one |

### `clone_resource` — Clone One Resource from a Blueprint

Copies a single cloneable resource (`page` | `dataset` | `survey` | `course`) from any blueprint into a datasphere the caller owns — fresh ids, references remapped, never private/member data. NOTE: `datasphereUri` here is the TARGET (yours), not the source. Refuses resources flagged non-cloneable. MODERATOR+ on the target; requires confirmation.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | TARGET datasphere (yours) where the clone lands |
| `kind` | string | yes | page \| dataset \| survey \| course |
| `sourceId` | string | yes | Id of the source resource to clone |
| `folderId` | string | no | Optional target folder |

### `convert_resource_draft` + `convert_resource_execute` — Cross-Asset Conversion

Convert any content asset into a sibling of another type: presentation ↔ page ↔ course/modules ↔ form (survey) ↔ dataset — every direction. Two-step **draft/approve/execute** contract (spec: TK-014 / VC-014 | stepped-shell-ux):

1. `convert_resource_draft` fully contextualizes the source (deck slides + speaker notes, course module tree, survey questions, dataset schema+rows, page HTML) and returns an LLM-drafted target **without writing anything** — a `draft` object plus a one-line `summary` (e.g. `Form "Intake" with 7 questions`).
2. Show the summary and key parts of the draft to the user. Apply any edits they ask for directly to the draft object.
3. `convert_resource_execute` persists the (possibly edited) draft in one transaction. Page-like targets (page/presentation/course/survey) land as **DRAFT status** — publishing stays a human decision. Returns ids + the app `url`.

Both tools are MODERATOR+ on the datasphere; drafting costs tokens (LLM, charged to the datasphere capacity pool); execute is LLM-free and requires confirmation.

`convert_resource_draft` — POST `/api/v1/dataspheres/:uri/convert/draft`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere that owns the source (and receives the sibling) |
| `sourceKind` | string | yes | page \| presentation \| course \| survey \| dataset |
| `sourceId` | string | yes | Page id (page/presentation/course/survey) or dataset id |
| `targetKind` | string | yes | Kind to convert INTO (must differ from sourceKind) |
| `instructions` | string | no | User guidance: tone, focus, what to keep/drop |

`convert_resource_execute` — POST `/api/v1/dataspheres/:uri/convert/execute`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere the converted resource is created in |
| `targetKind` | string | yes | Same value used in the draft call |
| `draft` | object | yes | The draft returned by convert_resource_draft (verbatim or user-edited) |
| `folderId` | string | no | Optional folder for page/presentation/course targets |

Draft shapes by target: `page` `{title, html}` · `presentation` `{title, slides:[{title, headline?, bodyHtml, speakerNotes?}]}` · `course` `{title, overviewHtml, modules:[{title, lessons:[{title, html}]}]}` · `survey` `{title, description?, questions:[{questionText, answerFormat: TEXT|LONG_TEXT|MULTIPLE_CHOICE|CHECKBOX, choices?, isRequired?}]}` · `dataset` `{name, description?, schema:[{name,type}], rows:[...]}`.

Gotchas: sourceKind must match the real pageType (passing `page` for a SURVEY page 400s with a hint); MULTIPLE_CHOICE/CHECKBOX questions need ≥2 choices; dataset rows are filtered to schema columns; the engine never invents facts not in the source.

### `create_dashboard` + `update_dashboard` — Intelligence Dashboards

First-class DASHBOARD pages: a 12-column grid of typed widgets for at-a-glance project or store intelligence (spec: TK-004,TK-005 / VC-004,VC-005 | intelligence-dashboards).

**Widget types**: `stat` (KPI number), `timeseries` (line chart), `table`, `status` (RAG light + trend + owner/note), `markdown`, `image`, `embed` (internal resource link or sandboxed external iframe). Data widgets (stat/timeseries/table) bind to a dataset via `query: {datasetId, measure, aggregation (sum|avg|count|min|max|median), groupBy, format (currency|percent|integer|decimal|number), limit}`.

**Three creation lanes**: the Dashboards list template picker; ARI `create_dashboard`/`update_dashboard`; or convert any asset into a dashboard (`convert_resource_draft` with `targetKind=dashboard`). ARI ALWAYS shows the drafted widget list and asks before creating. Pages land as DRAFT. View PARTICIPANT+, create/edit MODERATOR+.

`create_dashboard` — POST `/api/v1/dataspheres/:uri/dashboards`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere the dashboard is created in |
| `template` | string | no | `blank` \| `project` (KPI row + health + burn-down + notes) \| `store-ops` (sales/orders/top-products) |
| `title` | string | no | Dashboard title |
| `spec` | object | no | A full DashboardSpec `{version, grid, settings, widgets[]}`. Omit to start from a template |

`update_dashboard` — PUT `/api/v1/dataspheres/:uri/dashboards/:id`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere that owns the dashboard |
| `dashboardId` | string | yes | Id of the dashboard page |
| `spec` | object | yes | The full updated DashboardSpec |
| `status` | string | no | `DRAFT` \| `PUBLISHED` |

Spec shape: `{ version:1, title, grid:{columns:12, rowHeightPx}, settings:{refreshSeconds}, widgets:[{ id, type, title?, gridPos:{x,y,w,h}, query?, status?, content?, embed? }] }`. Malformed widgets are coerced/dropped server-side (invalid type dropped, grid clamped to 12 cols, widget cap 24, external embeds sandboxed — never `allow-same-origin`+`allow-scripts`). Read GET `/api/v1/dataspheres/:uri/dashboards/:id/widgets/:widgetId/data` for a data widget's executed result.

Gotcha: `dashboard` is a conversion TARGET only (you convert assets INTO a dashboard, not out of one).

### `create_code_family` / `create_code` / `tag_resource` / `query_tagged` — Cross-Resource Tags & Scopes

The Code* tagging substrate (families → codes → applications) is now ARI-drivable and CROSS-RESOURCE (spec: TK-001 / VC-001 | ari-orchestration). One code can be applied to a **page, dataset, graph, document, post, or task** — so a single code (e.g. `astrology`) groups a course page + its datasets + its knowledge graph into one **scope** ARI can retrieve/reason within.

- `create_code_family` — POST `/api/v2/dataspheres/:datasphereId/code-families` `{name, description?, color?}` — a family is a scope KEY (e.g. "Topic"). MODERATOR+.
- `create_code` — POST `/api/v2/code-families/:familyId/codes` `{name, description?, color?}` — a code is a VALUE (e.g. "astrology"). MODERATOR+.
- `tag_resource` — POST `/api/v2/codes/:codeId/apply` `{targetType, targetId, memo?}` — apply a code to any resource. `targetType` ∈ page | dataset | graph | document | post | task | analysis | surveyResponse | linkedUrl | graphNode. MODERATOR+.
- `query_tagged` — GET `/api/v2/codes/:id/applications` — list every resource carrying a code (the scope's members, across types). PARTICIPANT+.

Workflow: create a family + code, apply the code across a course page + its datasets + its graph, then ARI can scope its context to just that project (scoped retrieval reads the indexed codeFamilies/researchCodes).
