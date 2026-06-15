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
