---
name: ari-dai-skills
description: Drive the Dataspheres AI platform from Claude Code — read conversation history, post messages as the user (via API key), poll for ARI replies, read the Reality Engine debug log, update the plan and outcomes, and control orchestration flow. Use when you need Claude Code to interact with ARI or inspect/modify a running reality session.
argument-hint: "read-history | post-message | poll | debug | plan | emit | control"
disable-model-invocation: false
---

# ARI DAI Skills — Claude Code ↔ Dataspheres AI Platform

This skill lets Claude Code act as a first-class participant in the platform: reading chat history, posting on the user's behalf via API key, monitoring ARI's responses, and inspecting or steering the Reality Engine.

All requests hit **localhost:3000** (local dev) or **https://dataspheres.ai** (prod). Auth is a Bearer JWT — the user's API key works everywhere `unifiedAuth` middleware is used.

---

## 0. Auth — Profile System

All keys and profiles live in `~/.dataspheres.env`. Load it at the start of every task:

```bash
source ~/.dataspheres.env
```

Then activate a profile by setting `$DAI_BASE` and `$DAI_API_KEY`:

### Profile selection table

| Context | Command | Identity |
|---------|---------|----------|
| Local dev DB | `export DAI_BASE=http://localhost:3000 DAI_API_KEY=$DAI_LOCAL_KEY` | facelessaicoder (local) |
| Prod as self | `export DAI_BASE=https://dataspheres.ai DAI_API_KEY=$DAI_PROD_KEY` | facelessaicoder@gmail.com |
| Faceless AI content | `export DAI_BASE=https://dataspheres.ai DAI_API_KEY=$DAI_FACELESS_KEY` | Faceless AI identity |
| Ops / dataforgood | `export DAI_BASE=https://dataspheres.ai DAI_API_KEY=$DAI_OPS_KEY` | bo@dataforgood.institute |

**Rule:** Always use `https://dataspheres.ai` for prod — never `dataspheres-ai.onrender.com`.

**Rule — links shown to the user (HARD):** `$DAI_BASE` / `DATASPHERES_BASE_URL` is for API calls only. Any URL you RELAY TO THE USER (pages, planner boards, dashboards, graphs, reports) must be built from `DATASPHERES_PUBLIC_URL` in `~/.dataspheres.env` — on this dev station that is `https://dev.dataspheres.ai` (the tunnel host that works from any device). Never hand the user a `http://localhost:*` link, and never rewrite a local link to `https://dataspheres.ai` (local content does not exist on prod). If content lives on prod (created with a prod profile), link prod; if it lives on the local DB, link the tunnel host.

All examples below use `$DAI_BASE` and `$DAI_API_KEY`.

### Test user JWT (local dev only)

For conversations owned by test accounts (Carlos, Marcus, etc.) that have no API key, get a short-lived JWT:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"carlos.rodriguez@aa.bb","password":"@bcd.1234$"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
# Use $TOKEN as Bearer for that session's calls
```

All test accounts use password `@bcd.1234$`. See `/db-ops` for the full list.

---

## 1. List Conversations

```bash
curl -s "$DAI_BASE/api/v2/assistant/conversations?limit=10" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '.conversations[] | {id, title, type}'
```

**Response:** `{ conversations: [{id, title, type, lastMessageAt, ...}], cursor, hasMore }`

Params: `limit` (max 100), `cursor` (opaque pagination token), `search`, `type` (PRIVATE|GROUP|DIRECT).

---

## 2. Read Message History

```bash
CONV_ID="<conversationId>"

# Get last 50 messages
curl -s "$DAI_BASE/api/v2/assistant/conversations/$CONV_ID/messages?limit=50" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '.messages[] | {id, role, content, createdAt}'
```

**Response:** `{ messages: [{id, role, content, contentType, createdAt, sender, toolInvocations, metadata}], hasMore, nextCursor }`

Hidden CoT messages (`metadata.hidden === true`) are already filtered out server-side — you see exactly what the user sees.

For older history paginate with `?cursor=<nextCursor>`.

---

## 3. Post a Message (as User via API Key)

**IMPORTANT:** When posting programmatically, include `metadata` with `origin: 'api_key'` so ARI knows the source. ARI will prefix the message in context as `[via API key · <client> · on <device>]`.

```bash
CONV_ID="<conversationId>"

curl -s -X POST "$DAI_BASE/api/v2/assistant/conversations/$CONV_ID/messages" \
  -H "Authorization: Bearer $DAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Please summarize the last 10 messages in this thread.",
    "metadata": {
      "origin": "api_key",
      "client": "Claude Code",
      "device": "WSL2 terminal"
    }
  }'
```

**Response:** SSE stream (`text/event-stream`). Events:

| `type` | Meaning |
|--------|---------|
| `status` | Phase update (e.g. "Thinking...") |
| `ari_status` | ARI tool call status |
| `response_chunk` | Streamed text token (`data.chunk`) |
| `done` | Stream complete |
| `error` | Error (check `data.message`) |

**To consume the stream in bash:**

```bash
curl -s -N -X POST "$DAI_BASE/api/v2/assistant/conversations/$CONV_ID/messages" \
  -H "Authorization: Bearer $DAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"Hello from Claude Code","metadata":{"origin":"api_key","client":"Claude Code","device":"terminal"}}' \
  | while IFS= read -r line; do
      [[ "$line" == data:* ]] && echo "${line#data: }" | jq -r 'select(.type=="response_chunk") | .data.chunk // empty' 2>/dev/null
    done
```

**Capacity gate:** 402 = insufficient capacity. **No ARI in GROUP with `aiDisabled`** unless content starts with `@ARI`.

---

## 4. Poll for New Messages (without SSE)

Use this to check if ARI (or another participant) has replied since your last post, without keeping an open SSE connection.

```bash
CONV_ID="<conversationId>"
AFTER="2026-05-25T10:00:00.000Z"   # ISO timestamp of your last known message

curl -s "$DAI_BASE/api/v2/assistant/conversations/$CONV_ID/poll?after=$AFTER" \
  -H "Authorization: Bearer $DAI_API_KEY" \
  | jq '{aiProcessing: .aiProcessing, messages: [.messages[] | {role, content, createdAt}]}'
```

**Response:** `{ messages: [...], aiProcessing: boolean }`

`aiProcessing: true` means ARI's SSE stream is still running — wait and poll again. Poll every 3–5 seconds; stop when `aiProcessing: false` AND a new `assistant` role message appears.

**Polling loop pattern:**

```bash
wait_for_ari_reply() {
  local conv_id="$1" after="$2" max_polls="${3:-30}"
  for i in $(seq 1 $max_polls); do
    response=$(curl -s "$DAI_BASE/api/v2/assistant/conversations/$conv_id/poll?after=$after" \
      -H "Authorization: Bearer $DAI_API_KEY")
    processing=$(echo "$response" | jq -r '.aiProcessing')
    reply=$(echo "$response" | jq -r '[.messages[] | select(.role=="assistant")] | last | .content // empty')
    if [[ "$processing" == "false" && -n "$reply" ]]; then
      echo "$reply"; return 0
    fi
    sleep 3
  done
  echo "[TIMEOUT: no ARI reply after $((max_polls * 3))s]"; return 1
}

# Usage:
wait_for_ari_reply "$CONV_ID" "2026-05-25T10:00:00.000Z"
```

---

## 5. Read the Full Reality Engine Debug Dump

This is the unfiltered CoT, event log, plan state, tool results, and W&B calibration data. **Owner-only.**

```bash
REALITY_ID="<realityId>"   # Same as conversationId in v2 chat

curl -s "$DAI_BASE/api/v2/reality/$REALITY_ID/debug" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq .
```

**Response shape:**

```json
{
  "orchestration": { /* RealityOrchestration if exists */ },
  "conversation": {
    "notes": "...",   /* metadata.notes — ARI's internal plan/intent scratchpad */
    "...": "..."
  },
  "events": [/* ALL RealityEvents, no visibility filter */],
  "recentMessages": [/* PersonalMessages with metadata.cot included */],
  "planSteps": [],
  "planMutationEvents": [],
  "toolResultCache": [],
  "intentLifecycle": [],
  "wnbAggregate": { /* W&B calibration signals */ },
  "engineMarker": "v2"
}
```

Key fields to inspect:
- `conversation.notes` — ARI's raw intent/plan scratchpad (unstructured prose)
- `events[].type` + `events[].payload` — full event chain
- `recentMessages[].metadata.cot` — chain-of-thought for each message

---

## 6. Read the Structured Plan & Outcomes

The Reality Engine maintains a structured `RealityPlanState` for each session — outcomes (goals) and their tasks.

```bash
REALITY_ID="<realityId>"

curl -s "$DAI_BASE/api/v2/reality-engine/plan/$REALITY_ID" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '.state'
```

**`RealityPlanState` shape:**

```typescript
{
  realityId: string;
  status: 'idle' | 'running' | 'awaiting_input' | 'complete' | 'failed';
  currentOutcomeId: string | null;
  outcomes: Array<{
    id: string;
    title: string;
    kind: 'research' | 'create_page' | 'create_dataset' | 'survey' | 'community_post' | 'chat';
    status: 'idle' | 'running' | 'awaiting_input' | 'complete' | 'failed';
    tasks: Array<{
      id: string;
      outcomeId: string;
      title: string;
      kind: 'tool_call' | 'llm_call' | 'user_input' | 'navigate' | 'fan_out';
      status: 'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped';
      dependsOn: string[];
      parallelGroup: number | null;
      params: Record<string, any>;
      result?: any;
      error?: string | null;
      createdAt: string;
      completedAt?: string | null;
    }>;
    completedAt?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}
```

---

## 7. Update the Plan & Outcomes

Write back a modified `RealityPlanState`. Use this to correct outcomes, add tasks, or mark items done from outside the browser.

```bash
REALITY_ID="<realityId>"

# Read current state first
STATE=$(curl -s "$DAI_BASE/api/v2/reality-engine/plan/$REALITY_ID" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '.state')

# Modify (example: mark first outcome complete)
UPDATED_STATE=$(echo "$STATE" | jq '.outcomes[0].status = "complete"')

# Write back
curl -s -X PUT "$DAI_BASE/api/v2/reality-engine/plan/$REALITY_ID" \
  -H "Authorization: Bearer $DAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"state\": $UPDATED_STATE}" | jq .
```

**Response:** `{ ok: true, realityId: "..." }`

**Caution:** The plan is write-through from the FE Reality Engine handlers. Only mutate fields you understand — overwriting `currentOutcomeId` while ARI is mid-execution can confuse the orchestrator.

---

## 8. Emit an Event into the Reality Engine

Inject arbitrary events into the event chain — useful for triggering tool completion acknowledgments or custom signals.

```bash
REALITY_ID="<realityId>"

curl -s -X POST "$DAI_BASE/api/v2/reality-engine/$REALITY_ID/emit" \
  -H "Authorization: Bearer $DAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "tool_complete",
    "payload": { "toolId": "...", "result": "..." }
  }' | jq .
```

**Response:** `{ logId: "...", result: any, error: null }`

The full request/payload is logged in `RealityEventLog` for audit. Event types are defined in `src/server/v2/reality-engine/types.ts` `EventType` enum.

---

## 9. Orchestration Control

For Reality sessions with active orchestration:

```bash
REALITY_ID="<realityId>"

# Stop all pending steps (marks them SKIPPED)
curl -s -X POST "$DAI_BASE/api/v2/reality/$REALITY_ID/stop" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq .

# Pause at next safe point
curl -s -X POST "$DAI_BASE/api/v2/reality/$REALITY_ID/pause" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq .

# Resume after pause
curl -s -X POST "$DAI_BASE/api/v2/reality/$REALITY_ID/resume" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq .

# Approve a pending step (HIL gate)
STEP_ID="<stepId>"
curl -s -X POST "$DAI_BASE/api/v2/reality/$REALITY_ID/steps/$STEP_ID/approve" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq .

# Skip a step
curl -s -X POST "$DAI_BASE/api/v2/reality/$REALITY_ID/steps/$STEP_ID/skip" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq .
```

---

## 10. Common Patterns

### Summarise a conversation and post the summary back

```bash
CONV_ID="<conversationId>"

# 1. Read history
HISTORY=$(curl -s "$DAI_BASE/api/v2/assistant/conversations/$CONV_ID/messages?limit=50" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq -r '.messages[] | "\(.role): \(.content)"')

# 2. (Claude Code summarises HISTORY here in-context)
SUMMARY="<generated summary>"

# 3. Post summary back
POST_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
curl -s -X POST "$DAI_BASE/api/v2/assistant/conversations/$CONV_ID/messages" \
  -H "Authorization: Bearer $DAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"$SUMMARY\",\"metadata\":{\"origin\":\"api_key\",\"client\":\"Claude Code\",\"device\":\"terminal\"}}" \
  > /dev/null

# 4. Wait for ARI to reply
wait_for_ari_reply "$CONV_ID" "$POST_TIME"
```

### Inspect a session's full context before debugging

```bash
REALITY_ID="<id>"
echo "=== PLAN ===" && curl -s "$DAI_BASE/api/v2/reality-engine/plan/$REALITY_ID" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '.state | {status, currentOutcomeId, outcomes: [.outcomes[] | {id, title, status}]}'

echo "=== NOTES ===" && curl -s "$DAI_BASE/api/v2/reality/$REALITY_ID/debug" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '.conversation.notes'

echo "=== LAST 5 EVENTS ===" && curl -s "$DAI_BASE/api/v2/reality/$REALITY_ID/debug" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '[.events | last(.[]) | {type, createdAt}] | .[-5:]'
```

---

## 11. Upload a file + embed it in a page or task

Upload ANY file (image, screenshot, PDF report, video, audio, doc) and get back a
**public, permanent URL** plus ready-to-paste TipTap `embedMarkup`. This is the
canonical "upload then embed" flow for API-key callers.

**Use `POST /api/v1/dataspheres/:uri/media/upload`** — multipart field `file`, any
mime type. **Do NOT use `/api/media/upload`** — that one is JWT-only and returns 401
for `dsk_` API keys.

```bash
URI="my-datasphere"
# 1. Upload (any mime type). Returns { id, url, mimeType, embedMarkup }.
RESP=$(curl -s -X POST "$DAI_BASE/api/v1/dataspheres/$URI/media/upload" \
  -H "Authorization: Bearer $DAI_API_KEY" \
  -F "file=@./screenshot.png" -F "caption=Dashboard after the fix")
URL=$(echo "$RESP"   | jq -r '.url')          # public, never expires
EMBED=$(echo "$RESP" | jq -r '.embedMarkup')  # ready-to-paste TipTap markup
```

The returned `embedMarkup` is the exact content markup to embed:
- **image** → `<figure data-image-figure data-alignment="center" data-size="large"><img src="URL" alt="..."><figcaption>...</figcaption></figure>` (renders inline)
- **video/audio** → a `<video>`/`<audio>` player
- **PDF / report / other** → a `📄 <a href="URL">…</a>` download link

**Embed into a page** — PUT the markup into the page `content`:

```bash
curl -s -X PUT "$DAI_BASE/api/v1/dataspheres/$URI/pages/my-page" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d "$(jq -n --arg c "<h2>Results</h2><p>See below:</p>$EMBED" '{content:$c}')"
```

**Embed into a task** — PATCH the markup into the task `content` (same idea):
`PATCH /api/v1/dataspheres/$URI/tasks/$TASK_ID` with `{ "content": "...<figure …>…" }`.

Notes:
- The `url` is public (no auth) and permanent — safe to embed on public pages.
- Min role MODERATOR; scope `media:upload` (empty-scope keys have it). Max 100 MB.
- ARI (in-app) can do the same via the `upload_media_file` registry tool.

---

## Key Facts

| Thing | Detail |
|-------|--------|
| **realityId === conversationId** | Same ID — the v2 chat IS the reality session |
| **API key auth** | Bearer token accepted everywhere `unifiedAuth` or `authenticateToken` is used |
| **POST /messages response** | SSE stream — use `-N` flag in curl; parse `data:` lines |
| **Poll interval** | 3–5s recommended; stop when `aiProcessing: false` AND assistant message present |
| **Debug endpoint** | Owner-only — no admin override |
| **Plan write** | Read first, mutate, write back — don't overwrite fields you don't own |
| **ARI in GROUP chats** | Won't respond unless `aiDisabled` is false OR message starts with `@ARI` |
| **Hidden messages** | Already filtered — you see exactly the user-visible thread |
| **Capacity 402** | User's datasphere is out of capacity — can't post AI-triggering messages |

---

## Files (for code reference)

| File | Role |
|------|------|
| `src/server/v2/routes/assistant.routes.ts` | Conversation + message routes |
| `src/server/v2/controllers/assistant.controller.ts` | Conversation list + message history |
| `src/server/v2/controllers/completions.controller.ts` | POST message → SSE stream handler |
| `src/server/v2/routes/reality-engine.routes.ts` | Plan read/write + emit routes |
| `src/server/v2/routes/reality.routes.ts` | Debug + stop/pause/resume/approve/skip |
| `src/server/v2/reality-engine/types.ts` | `RealityPlanState`, `PlanOutcome`, `EventType` |
| `src/server/v2/services/assistant-context-builder.service.ts` | Where `origin: 'api_key'` metadata prefix is applied |

---

## 12. Graph Runtime — Manage Graphs, Nodes, Edges, Triggers, Schedules & Runs

<!-- spec: TK-17 / VC-17 | initiative: graph-runtime · audited + corrected 2026-08-06 -->

The knowledge graph IS the automation runtime (the sequencer is retired — `/sequences*` redirects here; never create sequences). Three RUNNABLE node types ride the ontology alongside knowledge types:

| typeKey | Required props | What it does |
|---------|----------------|--------------|
| `agent` | `instruction` (free text), `capability` (see full list below), optional `model` | Executes as a tracked, cancellable AgentRun; its goal composes the instruction + capability + upstream `depends_on` outputs |
| `schedule` | `cron` (validated), `timezone` (**always pass it** — omitted means SERVER-LOCAL time, not UTC) | Fires downstream agents on its cron (15s tick; `nextRunAt` armed at create) |
| `hook` | `slug` (`^[a-z0-9][a-z0-9-]{2,63}$` — must START alphanumeric, so `-intake` is rejected) | Fires downstream agents on webhook POST — or on PLATFORM EVENTS via `props.event.kinds` (see Event lane) |

**Agent capabilities (complete list, 13):** `research`, `web_search`, `create_page`, `update_page`, `create_report`, `create_dataset`, `update_dataset`, `draft_newsletter`, `run_analysis`, `create_survey`, `send_message`, plus two **deterministic** ones that call a service directly with ZERO tokens: `sync_integration` (requires `props.connectionId`) and `refresh_url_scrape` (requires `props.linkedUrlId`) — missing their required prop is a 422. Also `analyze_linked_context`.

`depends_on` edges (`{sourceId: X, targetId: Y}` = "X depends on Y") form a validated DAG — cycles are rejected **422**. A dependent runs after ALL its upstreams, receives their outputs (+ producing run ids) as structured inputs, and AUTO-CASCADES when an upstream refreshes. A failed dependency SKIPs its dependents. Trigger nodes point at agents with `feeds` edges.

**Auth note:** every endpoint below (v1 AND v2) accepts your `dsk_` API key (unifiedAuth, since 2026-08-06). Earlier the `/api/v2` lanes were JWT-only and 401'd on keys.

### Graph / node / edge CRUD

```bash
# List graphs
curl -s "$DAI_BASE/api/v1/dataspheres/<uri>/graphs" -H "Authorization: Bearer $DAI_API_KEY"

# Create a graph (MODERATOR+)
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/<uri>/graphs" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Market runtime"}'           # -> 201 {graph:{id,...}}

# BULK-BUILD a whole graph in ONE call — ALWAYS prefer this over a per-node loop
# (max 200 nodes / 400 edges; partial success reported in errors[]):
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/populate" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"nodes":[{"ref":"a","typeKey":"agent","label":"A researches","props":{"instruction":"Research X","capability":"research"}},{"ref":"s","typeKey":"schedule","label":"Daily","props":{"cron":"0 9 * * *","timezone":"UTC"}}],"edges":[{"sourceRef":"s","targetRef":"a","typeKey":"feeds"}]}'

# Create a single AGENT node (props validated server-side; bad capability -> 422)
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/nodes" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"typeKey":"agent","label":"A researches","props":{"instruction":"Research X and report findings","capability":"research"}}'

# Create a SCHEDULE node (cron validated + armed; bad cron -> 422; PASS timezone)
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/nodes" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"typeKey":"schedule","label":"Every morning","props":{"cron":"0 9 * * *","timezone":"UTC"}}'

# Create a HOOK node (slug must start alphanumeric; bad slug -> 422)
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/nodes" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"typeKey":"hook","label":"On intake","props":{"slug":"intake-7f"}}'

# Wire the DAG: B depends_on A (cycle-closing edges -> 422)
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/edges" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"sourceId":"<B_NODE_ID>","targetId":"<A_NODE_ID>","typeKey":"depends_on","kind":"VISUAL"}'

# Trigger wiring: the schedule/hook node FEEDS the agent(s) it fires
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/edges" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"sourceId":"<SCHEDULE_NODE_ID>","targetId":"<A_NODE_ID>","typeKey":"feeds","kind":"VISUAL"}'

# Also available: DELETE /graphs/:id · PATCH/DELETE /graphs/:id/edges/:edgeId ·
# groups CRUD (/graphs/:id/groups) · GET /graphs/:id/ontology (typeKey catalog) ·
# publish gate: PATCH {"isPublic":true} on a 0-node graph -> 422
```

### Triggers: schedule nodes, hook nodes, EVENT hooks, whole-graph cron

```bash
# Re-configure a trigger node (cron re-armed immediately; PATCH validates too)
curl -s -X PATCH "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/nodes/$SCHED_NODE_ID" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"props":{"cron":"*/30 * * * *","timezone":"UTC"}}'

# Fire a hook node from outside (no auth — the slug IS the secret; wrong slug -> 403,
# and a wrong slug is indistinguishable from a missing one — no existence oracle)
curl -s -X POST "$DAI_BASE/api/public/graph-webhooks/$GRAPH_ID/hooks/intake-7f" \
  -H "Content-Type: application/json" -d '{"payload":1}'   # -> 202 {hookNodeId, runIds:[...]}

# EVENT lane: a hook node can ALSO fire on platform activity instead of (or as well
# as) webhooks — set props.event.kinds; polled on the same 15s tick, 60s debounce:
curl -s -X PATCH "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/nodes/$HOOK_NODE_ID" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"props":{"slug":"intake-7f","event":{"kinds":["document_uploaded","dataset_changed"]}}}'
# kinds: document_uploaded, dataset_changed, page_changed, post_created,
#        member_joined, survey_completed, linked_url_added

# WHOLE-GRAPH cron (separate mechanism from schedule NODES — creates a
# GraphSchedule row that runs the graph's TASK edges, defaults timezone UTC):
curl -s -X PUT "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/schedule" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"cron":"0 7 * * 1"}'
# Prefer schedule NODES for agent automations; the graph-level schedule is for
# legacy TASK-edge graphs. Delete via DELETE /api/v2/.../graphs/:id/schedules/:scheduleId
```

### Execute, cancel, list runs

```bash
# Execute ONE agent node now -> 202 {runId, nodeId, conversationId, capability, upstreamCount}
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/<uri>/graphs/$GRAPH_ID/nodes/$NODE_ID/execute" \
  -H "Authorization: Bearer $DAI_API_KEY"

# Execute the WHOLE DAG in dependency waves -> 202 {executionId}
curl -s -X POST "$DAI_BASE/api/v2/dataspheres/$DS_ID/graphs/$GRAPH_ID/execute-dag" \
  -H "Authorization: Bearer $DAI_API_KEY"
# Readback: outputData.waves = [[...wave0], [...wave1]], outputData.runs per node
curl -s "$DAI_BASE/api/v2/dataspheres/$DS_ID/graphs/$GRAPH_ID/executions/$EXECUTION_ID" \
  -H "Authorization: Bearer $DAI_API_KEY"
# All executions: GET /api/v2/dataspheres/$DS_ID/graphs/$GRAPH_ID/executions
# Health report:  GET /api/v2/dataspheres/$DS_ID/graphs/$GRAPH_ID/report

# List your runs (graph runs carry context.graphId/graphNodeId + trigger provenance)
curl -s "$DAI_BASE/api/v2/agent-runs/mine" -H "Authorization: Bearer $DAI_API_KEY"

# One run — context.trigger is one of: manual | schedule | hook | cascade | event
curl -s "$DAI_BASE/api/v2/agent-runs/$RUN_ID" -H "Authorization: Bearer $DAI_API_KEY"

# Cancel a running run -> 200 {status:"CANCELLED"}; already terminal -> 409
curl -s -X POST "$DAI_BASE/api/v2/agent-runs/$RUN_ID/cancel" -H "Authorization: Bearer $DAI_API_KEY"

# Ad-hoc DAG without a graph: POST /api/v2/agent-runs/dag · tool defs: GET /api/v2/agent-runs/tools
```

### Observe a run / cascade via the event stream

```bash
# Replay + tail the run's typed events (thought, tool_call, token_delta, billing, done)
curl -s "$DAI_BASE/api/v2/agent-runs/$RUN_ID/events?after=0" -H "Authorization: Bearer $DAI_API_KEY"
# Live SSE (resumable from the last seq):
curl -s -N "$DAI_BASE/api/v2/agent-runs/$RUN_ID/stream?after=0" -H "Authorization: Bearer $DAI_API_KEY"
```

**Cascade observation:** after a refreshed node completes, poll the graph — dependents flip `props.lastRunStatus` `stale -> running -> complete`, each with `props.lastRunId`; read those runs to see `context.trigger: "cascade"` and `context.causeRunId`. Per-graph toggle: `PATCH /api/v1/dataspheres/<uri>/graphs/$GRAPH_ID` with `{"layout":{"cascadeEnabled":false}}` (merges into layout; fixed 2026-08-06 — previously v1 silently dropped it).

### Key facts

| Thing | Detail |
|-------|--------|
| **Roles** | PARTICIPANT reads; MODERATOR+ mutates/executes (403 otherwise) |
| **Auth** | `dsk_` API keys work on ALL lanes (v1 + v2) via unifiedAuth |
| **Validation** | agent capability enum (13), schedule cron parse, hook slug format, deterministic-capability required props, depends_on cycles — all 422 with reasons |
| **Budget breaker** | Lifetime graph spend >= `Graph.maxCost` (**default $10**) SILENTLY stops all automatic triggers (cron/webhook/event/cascade) — webhook still returns `202 {runIds: []}`. If a cron "just stopped", check spend and raise: `PATCH {"maxCost": 50}` |
| **Timezone** | Schedule NODES with no `timezone` run on SERVER-LOCAL time; graph-level schedules default UTC. Always pass `timezone` |
| **Rate limit** | Public webhook lanes: 30 req/graph/min (both the hook-node route and the legacy `/:graphId/:secret` HMAC route) |
| **Node run state** | On the node itself: `props.lastRunId/lastRunStatus/lastResult/lastError` (`running/complete/failed/skipped/stale`) |
| **Billing** | Every run charges once via the capacity waterfall with receipt provenance (modelId, tokens, lane); deterministic capabilities cost zero tokens |
| **Conversation-synced graphs** | Workflow kickoff auto-creates the graph; runs surface as live cards in the owning conversation |
| **ARI tools** | Same operations in-chat: `create_graph`, `create_graph_node`, `link_nodes`, `set_node_trigger`, `execute_graph_node`, `cancel_graph_run`, `list_graph_runs` |

## 13. DepWatch — Dependency Supply-Chain Scans & Watches

<!-- spec: TK-005 / VC-005 | initiative: pain-supply-watch -->

Paste a `package.json`, get back: OSV advisories for your exact pinned versions, packages whose LATEST adds install scripts your pin doesn't have, and packages published inside your cooldown window. Public page: `https://dataspheres.ai/depwatch`.

Two lanes:

| Lane | Endpoint | Auth | Limit |
|------|----------|------|-------|
| Anonymous | `POST /api/public/dep-watch/scan` | none | 10 scans / 10 min per IP |
| API key | `POST /api/v2/dep-watch/scan` | Bearer `dsk_` key | 100 scans / 10 min per user |

Keys are generated in the developer portal: `https://dataspheres.ai/app/developers`.

```bash
# Send ONLY the dependency maps — that's all the scanner reads, and a full package.json
# (its `scripts` section is shell commands) trips the edge WAF into an HTML 403
# ("Unexpected token '<'"). Observed 2026-08-05 with this repo's own package.json.
BODY=$(jq -c '{packageJson: ({dependencies, devDependencies} | tojson), cooldownDays: 7}' package.json)

# Scan (either lane — body is identical)
curl -s -X POST "$DAI_BASE/api/v2/dep-watch/scan" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" -d "$BODY" \
  | jq '{depCount, advisories: (.advisories | length), hookFlags: (.hookFlags | length), cooldownFlags: (.cooldownFlags | length), failures: (.failures | length)}'
```

**Report fields:** `advisories[]` (name, version, ids, summary), `hookFlags[]` (latest adds install script pin lacks), `cooldownFlags[]` (published < cooldownDays ago AND latest ahead of pin), `failures[]` (packages that could NOT be verified — never silently omitted), `latestVersions{}` (name → latest).

### Watches — daily scan + email alerts

Save a watch and the platform re-scans it daily (06:00 UTC sweep + boot catch-up) and emails you ONLY when there is news: new advisory ids or new releases of watched packages (with install-script / cooldown callouts). Stable lists produce silence, not daily nags. Every email carries a one-click unsubscribe link.

```bash
# Save a watch (same deps-only rule as scans)
curl -s -X POST "$DAI_BASE/api/v2/dep-watch/subscriptions" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d "$(jq -c '{packageJson: ({dependencies, devDependencies} | tojson), label: "my-app", cooldownDays: 7}' package.json)"

# List / re-scan now / remove
curl -s "$DAI_BASE/api/v2/dep-watch/subscriptions" -H "Authorization: Bearer $DAI_API_KEY"
curl -s -X POST "$DAI_BASE/api/v2/dep-watch/subscriptions/$WATCH_ID/run-now" -H "Authorization: Bearer $DAI_API_KEY"
curl -s -X DELETE "$DAI_BASE/api/v2/dep-watch/subscriptions/$WATCH_ID" -H "Authorization: Bearer $DAI_API_KEY"

# Recent vulnerability guides feed (public)
curl -s "$DAI_BASE/api/public/dep-watch/guides" | jq '.guides[] | {title, url}'
```

Files: `src/server/services/dep-watch.service.ts` (scanner), `src/server/services/dep-watch-alerts.service.ts` (diff + email + scheduler), `src/server/routes/dep-watch.routes.ts` (public), `src/server/v2/routes/dep-watch-subscriptions.routes.ts` (member lanes).


---

## 14. Mining Reality Engine Traces for Harness Improvement

<!-- Harness self-improvement (HN 49164896 gap 4, 2026-08-06) -->

Auto-improving a harness requires production traces — you cannot fix friction you never see. The debug endpoint (§5) is that feed: every event, tool call, CoT line, and W&B calibration signal for a session. These recipes turn it into harness signals. Owner-only; run them across your own recent sessions.

```bash
REALITY_ID="<realityId>"
DUMP=$(curl -s "$DAI_BASE/api/v2/reality/$REALITY_ID/debug" -H "Authorization: Bearer $DAI_API_KEY")

# 1. FAILED / RETRIED TOOL CALLS — which tools error repeatedly? (top harness fix candidates)
echo "$DUMP" | jq '[.events[] | select(.payload.status? == "failed" or .payload.ok? == false)
  | {type, tool: (.payload.eventType // .payload.name), turn: .payload.turn}]
  | group_by(.tool) | map({tool: .[0].tool, failures: length}) | sort_by(-.failures)'

# 2. TOOL LATENCY / CHATTINESS — how many events per tool family per session?
#    A tool that takes 15 calls to load context is a tool that needs a better shape
#    (the classic fix: collapse 20k tokens / 15 calls into one purpose-built call).
echo "$DUMP" | jq '[.events[].payload.eventType // .events[].type] | group_by(.)
  | map({event: .[0], count: length}) | sort_by(-.count) | .[0:15]'

# 3. CALIBRATION DRIFT — the W&B aggregate says whether ARI's confidence matches
#    outcomes. Falling calibration after a harness change = the change hurt.
echo "$DUMP" | jq '.wnbAggregate'

# 4. EMPTY-PROMISE / TRUTH-GATE HITS — replies that promised actions never executed.
#    Every hit is a harness bug (prompt or tool affordance), not a model mood.
echo "$DUMP" | jq '[.events[] | select(.payload.eventType? == "false_promise")] | length'

# 5. UNUSED CONTEXT — compare what rode the context vs what the turn touched:
#    conversation.notes lists the plan; events show which tools/resources were used.
echo "$DUMP" | jq '{planned: .conversation.notes, touched: [.events[].payload.eventType] | unique}'
```

**Feed the loop:** run these after any heavy session, then file what you find where it becomes work, not vibes —

- Platform-side friction → an SDD intake item: `node loop.mjs --intake --intake-summary "..." --intake-type instruction`
- Harness-side friction discovered during an SDD initiative → it belongs in the **mandatory retro** (`node loop.mjs --retro`), which the board's close-out gate already demands — see the all-dai-sdd skill § Harness Self-Improvement for telemetry, `--retro`, and the board→benchmark (`--export-evals` / `--run-evals`) commands.

The division of labor: **traces tell you what hurt, telemetry tells you what it cost, the retro makes it work, the eval pack proves the fix didn't regress anything.**
