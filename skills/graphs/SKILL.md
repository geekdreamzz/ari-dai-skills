---
name: graphs
description: Knowledge-graph tools for Dataspheres AI — build typed graphs, relate nodes with VISUAL or executable TASK edges, group into colored container bubbles, auto-detect article hero images, embed graphs in pages, run scheduled searches, and report.
---

# Graphs

> Tool reference for the Graphs engine, mirrored by hand from the platform live `/api/mcp/schema` schema. All endpoints are under `/api/v1/dataspheres/:uri/graphs` and accept a `dsk_` API key (unifiedAuth). MODERATOR+ to mutate, PARTICIPANT+ to read.

A **graph** models *literally anything* as typed **nodes** connected by **edges**:
a family tree, a manufacturing supply chain, a recipe with ingredients, an org
chart, a research map, an intelligence dossier. Nodes are either **resource-backed**
(a Dataspheres page, document, dataset, post, survey, newsletter) or **generic
entities** (person, place, organization, thing, animal, event, **article**,
ingredient, web_search, generic). Each node type declares **typed default
properties** — `value`, `array`, or `function` — and the connector types it may have.

**Every node type also carries universal media props:**
- `props.imageUrl` — renders as the node's image banner on the canvas (full image,
  never cropped; broken URLs fall back to the type icon)
- `props.mediaUrl` — a video (`.mp4`/`.webm`) or YouTube/Vimeo URL, previewed in
  the node inspector

**`article` nodes auto-detect their hero.** Give an article node `props.url` and
the server scrapes the page's `og:image`, site name, description and publish date
in the background, filling `imageUrl` / `source` / `summary` / `publishedAt`
(only empty fields — it never overwrites values you set). This also re-fires on
node PATCH when `props` gains a `url`. In the public view, clicking a node that
has `props.url` opens the source.

Edges carry `kind`:
- **VISUAL** — a relationship only, with an overridable display label (e.g.
  `parent_of`, `located_in`, `replaced_by`, `fired_from`). Both endpoints must
  allow the connector; **`related_to` is allowed between ALL node types — use it
  as the safe fallback with a custom `label`** (e.g. "reports on").
- **TASK** — executable. Bound to a node executor + (optional) cron schedule. The
  canonical example is the scheduled web search: a `web_search` node's `queries[]`
  array prop feeds the `batch-web-search` executor via a `batch_web_search` TASK edge.

**Containers (groups) are custom colored bubbles.** A container is a labeled,
colored box nodes can live in — think a red "Terminated" column next to a green
"Replacements" column, crossed by "2025 · Q1/Q2/Q3" quarter bands as a second
dimension. `color` is a `#rrggbb` hex that drives the translucent fill, dashed
border and label chip. Layouts: `FREEFORM` (nodes keep their x/y), `COLUMN` /
`ROW` / `GRID` (auto-arrange), `TIMELINE` (auto-buckets by a node date/number
prop via `groupByField`). **Containers may overlap** — when a node is dropped
where boxes overlap, the container with the highest `order` wins membership.
In the canvas UI, dragging a node in or out of a bubble reassigns `node.groupId`;
via the API set `groupId` on node create/PATCH (`null` = free space). Deleting a
container never deletes its nodes (membership is cleared).

## Sharing, presentation embeds, and tagging

- `PATCH …/graphs/:graphId {"isPublic": true}` enables:
  - **Public read-only view**: `https://<host>/graph/:uri/:graphId`
  - **Presentation widget**: `https://<host>/graph/:uri/:graphId?embed=1` —
    chrome-less, view-only (no admin controls, nodes locked), with pan/zoom, a
    fullscreen button, and a small attribution link.
- **Embed a graph in page content** (reports, presentations) as a TipTap embed
  figure wrapping an iframe. The iframe MUST carry `allowfullscreen allow="fullscreen"`
  or the widget's fullscreen button can't work:

```html
<figure data-embed-figure="true" data-alignment="center" data-size="full"
        data-html="<URI-ENCODED IFRAME>" class="embed-figure">
  <div class="embed-content" data-embed-html="<URI-ENCODED IFRAME>"></div>
  <figcaption class="embed-caption">Caption (plain text only — no anchors).</figcaption>
</figure>
<!-- where the iframe (before encodeURIComponent) is: -->
<iframe src="/graph/:uri/:graphId?embed=1" style="width:100%;height:640px;border:0;border-radius:14px;background:#00060f" loading="lazy" allowfullscreen allow="fullscreen"></iframe>
```

- **Tagging & metadata**: graph nodes participate in the platform's canonical
  tagging substrate. Apply a code with `POST /api/v2/codes/:codeId/apply`
  `{"targetType":"graphNode","targetId":"<nodeId>"}`; list with
  `GET /api/v2/code-applications?targetType=graphNode&targetId=<nodeId>`.

## Canonical workflow: build → relate → contain → attach TASK → execute → share

```bash
DS=dataspheres-ai
H='-H "Authorization: Bearer $DSK_KEY" -H "Content-Type: application/json"'

# 0. Discover the ontology — node types, edge types, their props + allowed edges
curl $H "$BASE/api/v1/dataspheres/$DS/graphs/ontology"

# 1. BUILD — create the graph (isPublic → shareable + embeddable)
GID=$(curl $H -X POST "$BASE/api/v1/dataspheres/$DS/graphs" \
  -d '{"name":"Removals map","isPublic":true}' | jq -r .graph.id)

# 2. ADD TYPED NODES — with position, container, media
ADA=$(curl $H -X POST "$BASE/api/v1/dataspheres/$DS/graphs/$GID/nodes" \
  -d '{"typeKey":"person","label":"Ada","x":200,"y":120,"props":{"name":"Ada","imageUrl":"https://…/ada.jpg"}}' | jq -r .node.id)

# 2b. An ARTICLE node — hero image/source/date auto-detected from the URL
ART=$(curl $H -X POST "$BASE/api/v1/dataspheres/$DS/graphs/$GID/nodes" \
  -d '{"typeKey":"article","label":"Profile of Ada","props":{"url":"https://en.wikipedia.org/wiki/Ada_Lovelace"}}' | jq -r .node.id)

# 3. RELATE — ontology-gated; related_to works between ALL types
curl $H -X POST "$BASE/api/v1/dataspheres/$DS/graphs/$GID/edges" \
  -d "{\"sourceId\":\"$ART\",\"targetId\":\"$ADA\",\"typeKey\":\"related_to\",\"label\":\"reports on\"}"

# 4. CONTAIN — colored bubbles; overlap allowed (highest order wins on drop)
TERM=$(curl $H -X POST "$BASE/api/v1/dataspheres/$DS/graphs/$GID/groups" \
  -d '{"label":"Terminated","color":"#ef4444","layout":"FREEFORM","x":180,"y":20,"width":430,"height":950,"order":3}' | jq -r .group.id)
curl $H -X POST "$BASE/api/v1/dataspheres/$DS/graphs/$GID/groups" \
  -d '{"label":"2025 · Q1","color":"#f59e0b","layout":"FREEFORM","x":140,"y":60,"width":1020,"height":360,"order":0}'
#    Put a node in a container (or move/relabel it) via PATCH:
curl $H -X PATCH "$BASE/api/v1/dataspheres/$DS/graphs/$GID/nodes/$ADA" \
  -d "{\"groupId\":\"$TERM\",\"x\":240,\"y\":130}"

# 5. EDIT / REMOVE relationships and containers
curl $H -X PATCH  "$BASE/api/v1/dataspheres/$DS/graphs/$GID/edges/$EDGE"  -d '{"label":"fired by"}'
curl $H -X DELETE "$BASE/api/v1/dataspheres/$DS/graphs/$GID/edges/$EDGE"
curl $H -X PATCH  "$BASE/api/v1/dataspheres/$DS/graphs/$GID/groups/$TERM" -d '{"color":"#10b981"}'
curl $H -X DELETE "$BASE/api/v1/dataspheres/$DS/graphs/$GID/groups/$TERM"   # nodes survive
curl $H -X DELETE "$BASE/api/v1/dataspheres/$DS/graphs/$GID/nodes/$ART"     # edges cascade

# 6. ATTACH A TASK EDGE — a scheduled web search (queries[] -> batch-web-search)
SRC=$(curl $H -X POST "$BASE/api/v1/dataspheres/$DS/graphs/$GID/nodes" \
  -d '{"typeKey":"web_search","label":"Watch","props":{"queries":["Ada Lovelace legacy"]}}' | jq -r .node.id)
curl $H -X POST "$BASE/api/v1/dataspheres/$DS/graphs/$GID/edges" \
  -d "{\"sourceId\":\"$SRC\",\"targetId\":\"$ADA\",\"typeKey\":\"batch_web_search\",\"kind\":\"TASK\",\"executorType\":\"batch-web-search\",\"sourceProp\":\"queries\"}"

# 7. EXECUTE — run the graph's TASK edges through the executor (costs tokens)
curl $H -X POST "$BASE/api/v1/dataspheres/$DS/graphs/$GID/execute" -d '{}'

# 8. SCHEDULE — fire it on cron, like the legacy sequencer
curl $H -X PUT "$BASE/api/v1/dataspheres/$DS/graphs/$GID/schedule" \
  -d '{"cronExpression":"0 9 * * 1","timezone":"UTC"}'

# 9. SHARE — public view /graph/:uri/$GID · embed /graph/:uri/$GID?embed=1
```

## Tools

### `list_graphs` — Graphs
Lists knowledge graphs in a datasphere. `GET /api/v1/dataspheres/:uri/graphs`. Run first to get graph IDs.

### `get_graph` — Graphs
Get a graph with its nodes, edges, groups and schedules. `GET …/graphs/:graphId`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| graphId | string | yes | Graph ID |

### `get_graph_ontology` — Graphs
List node types + edge/relationship types with their default props and allowed connectors. `GET …/graphs/ontology`. Call this before adding nodes/edges so you use valid `typeKey`s.

### `create_graph` — Graphs
Create a knowledge graph. `POST …/graphs`. MODERATOR+.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | Graph name |
| description | string | no | What the graph maps |
| isPublic | boolean | no | Enable the public read-only view + embeddable `?embed=1` presentation widget |

### `add_graph_node` — Graphs
Add a typed node to a graph. `POST …/graphs/:graphId/nodes`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| typeKey | string | yes | Node type key from the ontology (person, place, article, document, web_search, …) |
| label | string | yes | Node label |
| props | object | no | Typed props. Universal: `imageUrl` (canvas banner), `mediaUrl` (video/embed). `article`: `url` triggers hero auto-detect |
| groupId | string | no | Container to place the node in |
| x, y | number | no | Canvas position |

### `update_graph_node` — Graphs
Update a node's label, props, position, or container membership. `PATCH …/graphs/:graphId/nodes/:nodeId`. Adding `props.url` re-triggers hero auto-detect when `imageUrl` is empty.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | string | yes | Node ID |
| label | string | no | New label |
| props | object | no | Replacement props (validated against the node type — unknown keys 422) |
| groupId | string | no | Container ID, or `null` to remove from its container |
| x, y | number | no | Canvas position |

### `delete_graph_node` — Graphs
Delete a node; its edges cascade. `DELETE …/graphs/:graphId/nodes/:nodeId`.

### `relate_graph_nodes` — Graphs
Create a VISUAL relationship or an executable TASK edge between two nodes. `POST …/graphs/:graphId/edges`. A disallowed connector returns **422**; `related_to` is allowed between ALL node types (safe fallback — pair with a display `label`).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| sourceId | string | yes | Source node ID |
| targetId | string | yes | Target node ID |
| typeKey | string | yes | Edge type key (related_to, parent_of, replaced_by, fired_from, located_in, batch_web_search, …) |
| kind | string | no | `VISUAL` (default) or `TASK` |
| executorType | string | no | For TASK edges, the node executor (e.g. `batch-web-search`) |
| sourceProp | string | no | Source node prop bound to the executor input (e.g. `queries`) |
| label | string | no | Display label shown on the edge (e.g. "reports on") |

### `update_graph_edge` — Graphs
Rename a relationship's display label. `PATCH …/graphs/:graphId/edges/:edgeId` with `{"label":"…"}`.

### `delete_graph_edge` — Graphs
Remove a relationship. `DELETE …/graphs/:graphId/edges/:edgeId`.

### `add_graph_group` — Graphs
Add a custom container bubble — a colored, labeled box nodes can live in. `POST …/graphs/:graphId/groups`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| label | string | yes | Container label (e.g. "Terminated", "2025 · Q1") |
| color | string | no | `#rrggbb` hex — drives the bubble fill, border, and label chip |
| layout | string | no | `FREEFORM` (keep node x/y) \| `COLUMN` \| `ROW` \| `GRID` \| `TIMELINE` |
| groupByField | string | no | For TIMELINE: the node date/number prop to bucket by |
| x, y, width, height | number | no | Box geometry (defaults 0,0,320,480) |
| order | number | no | Draw/priority order — highest wins membership when containers overlap |

### `update_graph_group` — Graphs
Update a container's label, color, layout, position or size. `PATCH …/graphs/:graphId/groups/:groupId`.

### `delete_graph_group` — Graphs
Delete a container — member nodes survive with membership cleared. `DELETE …/graphs/:graphId/groups/:groupId`.

### `execute_graph` — Graphs
Run a graph's TASK edges (e.g. scheduled web searches) through the executor. `POST …/graphs/:graphId/execute`. **Costs tokens — confirm with the user first.**

### `schedule_graph` — Graphs
Upsert a cron schedule for a graph or a specific TASK edge. `PUT …/graphs/:graphId/schedule`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| cronExpression | string | yes | 5-field cron, e.g. `0 9 * * 1` |
| edgeId | string | no | The TASK edge to fire (omit for whole-graph) |

## Notes
- **Ontology enforcement**: an edge is allowed only when its `typeKey` is a real
  edge type AND permitted by both endpoints' `allowedEdges` (TASK edges are
  source-driven). Invalid node `props` return **422** — fetch the ontology first.
- **Hero auto-detect is fire-and-forget**: the node returns immediately; the
  scraped `imageUrl`/`source`/`publishedAt` appear on the node a few seconds
  later. Re-fetch the graph to see them.
- **Public endpoint**: `GET /api/public/dataspheres/:uri/graphs/:graphId` returns
  isPublic graphs without auth (powers the share + embed views).
- **Legacy**: the old `/sequencers` tools still work; a scheduled web search is now
  expressible as a `batch_web_search` TASK edge.
- The v2 (JWT) surface mirrors this at `/api/v2/dataspheres/:datasphereId/graphs`
  (full CRUD on graphs/nodes/edges/groups + `/report`, `/executions`).

<!-- SDD: TK-016 / VC-016 (initiative knowledge-graph) — graphs skill -->
