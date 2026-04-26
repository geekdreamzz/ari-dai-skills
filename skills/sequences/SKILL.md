---
name: sequences
description: Create and run automated workflows in Dataspheres AI
argument-hint: "[action] [options]"
---

# sequences — Automated Workflows

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

All endpoints use the datasphere **DB ID** (not URI) via v2 routes. This is resolved automatically by `_ds_id()`.

**Note:** There is no v1 sequences API. All sequence operations must use v2.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | Run `dai use <uri>` |
| 401 | Invalid key | Re-run `dai login` |
| 403 | Membership check failed | Ensure you're a datasphere member |
| 404 | Sequence not found | Check `list_sequences()` |
