---
name: sequencers
description: DEPRECATED - superseded by graphs (agent/schedule/hook nodes). Read-only access to legacy sequencers only.
---

# Sequencers

> Tool reference for this resource group, mirrored by hand from the platform live `/api/mcp/schema` schema.

> **Superseded by [graphs](../graphs/SKILL.md).** Sequencers are the legacy
> single-template (scheduled web search) automation. The **graphs** skill is the
> general successor: a scheduled web search is now a `batch_web_search` **TASK
> edge** on a knowledge graph (`web_search` node's `queries[]` → the
> `batch-web-search` executor). These sequencer tools still work, but for anything
> new — relationships, typed entities, grouping, reporting — use **graphs**.
<!-- SDD: TK-017 / VC-017 (initiative knowledge-graph) — sequencers -> graphs redirect -->

## Tools

### `create_sequence_v2` — Create Sequence

Creates create a new automation sequence. Requires MODERATOR+ role in the datasphere. Required fields: `datasphereId` (string); `name` (string); `triggerType` (string) — must be one of: MANUAL, SCHEDULED, WEBHOOK. Show a preview of the operation and get explicit confirmation from the user before executing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereId` | string | yes | Datasphere ID |
| `name` | string | yes | Sequence name |
| `triggerType` | string | yes | How the sequence is triggered |

### `create_sequencer` — New Sequencer

Creates a scheduled web search sequencer. Guide:
1. Which datasphere?
2. Name?
3. What search query?
4. Schedule: frequency (hourly/daily/weekly/monthly), time, day (for weekly)?
5. Run immediately too?
Show a preview card with schedule summary before confirming.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `name` | string | yes | Sequencer name |
| `query` | string | yes | Web search query to run on schedule |
| `schedule` | object | yes | Schedule config: {frequency, time?, day?, timezone?} |
| `maxResults` | number | no | Results per run |
| `runNow` | boolean | no | Fire immediately in addition to schedule? |

### `delete_sequence` — Delete Sequence

Deletes delete a sequence and all its executions. Requires ADMIN+ role in the datasphere. Required fields: `datasphereId` (string); `sequenceId` (string). Show a preview of the operation and get explicit confirmation from the user before executing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereId` | string | yes | Datasphere ID |
| `sequenceId` | string | yes | Sequence ID |

### `execute_sequence` — Execute Sequence

Creates trigger manual execution of a sequence. Requires MODERATOR+ role in the datasphere. Required fields: `datasphereId` (string); `sequenceId` (string). Show a preview of the operation and get explicit confirmation from the user before executing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereId` | string | yes | Datasphere ID |
| `sequenceId` | string | yes | Sequence ID |

### `get_sequencer` — Sequencer Details

Gets full details for a single sequencer including recent execution history. Use when the user wants to check the status or results of a specific sequencer.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `sequencerId` | string | yes | Sequencer ID |

### `list_sequencers` — Sequencers

Lists sequencers in a datasphere. Check conversation history first — if dataspheres were already listed, ask which one. Never call list_dataspheres again if already in context.
- Positive flow: "Here are the sequencers in [Datasphere]. Want to run one now, or create a new scheduled workflow?"
- Negative flow: "No sequencers in [Datasphere] yet. Want me to set one up? I can create a scheduled web search that runs automatically."

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |

### `list_sequences_v2` — List Sequences

Retrieves list all automation sequences in a datasphere. Requires PARTICIPANT+ role in the datasphere. Required fields: `datasphereId` (string).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereId` | string | yes | Datasphere ID |

### `run_sequencer` — Run Sequencer

Triggers an immediate sequencer execution. Guide: 1) Which datasphere? 2) Which sequencer? (list them first). Confirm before triggering.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `sequencerId` | string | yes | Sequencer ID to trigger |

### `update_sequencer` — Update Sequencer

Pauses, resumes, or updates a sequencer. Guide: list sequencers so user can pick, then ask what to change (pause/resume/update query/rename).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `sequencerId` | string | yes | Sequencer ID |
| `status` | string | no | Status |
| `triggerType` | string | no | Trigger type |
| `name` | string | no | New name |
| `query` | string | no | New search query |

