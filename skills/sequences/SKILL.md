---
name: sequences
description: DEPRECATED - the sequencer is retired. Use the graphs skill (agent/schedule/hook nodes) for all automation.
argument-hint: "[action] [options]"
---

# sequences — RETIRED (use /graphs)

> **⚠ DEPRECATED 2026-08-06.** The sequencer is retired: `/sequences*` routes redirect to Graphs, the editor is unrouted, and ARI no longer creates sequences. Everything below exists only to READ legacy data. For any new automation use the **graphs** skill — agent nodes (instructions + capability), schedule nodes (cron), hook nodes (webhooks + platform events), `depends_on` cascades.

Sequences are node-based automation pipelines scoped to a datasphere. Each sequence has a trigger type, a graph of nodes, and an execution history. Sequences run server-side and can be triggered manually, on a schedule, or via webhook.

## Core Workflows

### List sequences

```python
list_sequences()
# → [{"id": "seq_...", "name": "Content Sync", "triggerType": "SCHEDULED", "status": "ACTIVE"}, ...]

list_sequences(status="ACTIVE", trigger_type="MANUAL")
```

Status values: `DRAFT` | `ACTIVE` | `PAUSED` | `ARCHIVED`
Trigger types: `MANUAL` | `SCHEDULED` | `WEBHOOK`

### Create a sequence

```python
create_sequence(
    name="Content Sync",
    description="Sync pages from external CMS every hour",
    trigger_type="SCHEDULED",
    max_cost=0.50,    # optional budget cap in USD per execution
)
# → {"id": "seq_abc123", "name": "Content Sync", "triggerType": "SCHEDULED"}
```

### Get sequence details

```python
get_sequence(sequence_id="seq_abc123")
# → {"id": ..., "name": ..., "graphData": {...}, "status": "ACTIVE", "triggerType": "SCHEDULED"}
```

### Execute a sequence

```python
execute_sequence(sequence_id="seq_abc123")
# → {"id": "exec_...", "sequenceId": "seq_abc123", "status": "PENDING", "startedAt": "..."}

# With input data:
execute_sequence(sequence_id="seq_abc123", input_data={"topic": "AI trends 2026"})
```

### List executions

```python
list_executions(sequence_id="seq_abc123", limit=20)
# → [{"id": "exec_...", "status": "COMPLETED", "startedAt": "...", "completedAt": "...", "cost": 0.03}]

list_executions(sequence_id="seq_abc123", status="FAILED")
```

Execution status: `PENDING` | `RUNNING` | `COMPLETED` | `FAILED`

### Delete a sequence

```python
delete_sequence(sequence_id="seq_abc123")
# → None (204 No Content)
```

## API Reference

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| `list_sequences` | GET | `/api/v2/dataspheres/:dsId/sequences` | Uses DB ID |
| `get_sequence` | GET | `/api/v2/dataspheres/:dsId/sequences/:sequenceId` | |
| `create_sequence` | POST | `/api/v2/dataspheres/:dsId/sequences` | |
| `execute_sequence` | POST | `/api/v2/dataspheres/:dsId/sequences/:sequenceId/execute` | |
| `list_executions` | GET | `/api/v2/dataspheres/:dsId/sequences/:sequenceId/executions` | |
| `delete_sequence` | DELETE | `/api/v2/dataspheres/:dsId/sequences/:sequenceId` | |

All endpoints use the datasphere **DB ID** (not URI) via v2 routes. Resolve it with `list_dataspheres` or `GET /api/v1/dataspheres` before making the request.

**Note:** There is no v1 sequences API. All sequence operations must use v2.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| Missing datasphere ID | Target was not resolved | Call `list_dataspheres` and use the returned database ID |
| 401 | Invalid key | Check `DATASPHERES_API_KEY` in `.env` or `~/.dataspheres.env` |
| 403 | Membership check failed | Ensure you're a datasphere member |
| 404 | Sequence not found | Check `list_sequences()` |
