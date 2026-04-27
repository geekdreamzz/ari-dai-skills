<!-- dai-sync: skip -->
---
name: context
description: Manage active datasphere context and session state
argument-hint: "[action] [options]"
---

# context — Active Datasphere & Session Management

All MCP tools operate against the **active datasphere**. The context skill lets you inspect and switch that context without leaving your IDE agent session.

## Core Workflows

### Check the active datasphere

```python
get_active_datasphere()
# → {"active_datasphere": "my-ds", "details": {"id": "ds_...", "name": "My DS", "uri": "my-ds"}}
```

Returns `{"active_datasphere": null, "message": "..."}` if none is set.

### Switch datasphere

```python
set_active_datasphere(uri="other-datasphere")
# → {"active_datasphere": "other-datasphere", "name": "Other Datasphere"}
```

This updates the persisted state in `~/.dai-skills/state.db` AND warms the `ds_id` cache so the next v2 API call doesn't need a round-trip to resolve the DB ID.

### Clear context

```python
clear_context()
# → {"cleared": True}
```

Removes the active datasphere from state. Useful when switching between projects or at end of session.

### View recent history

```python
get_history(limit=10)
# → list of recent tool invocations with timestamps
```

## CLI Equivalent

These tools mirror the CLI commands:

| Tool | CLI equivalent |
|------|----------------|
| `get_active_datasphere()` | `dai status` |
| `set_active_datasphere(uri)` | `dai use <uri>` |
| `clear_context()` | `dai use --clear` |
| `get_history()` | `dai history` |

## API Reference

| Tool | Endpoint | Notes |
|------|----------|-------|
| `get_active_datasphere` | GET `/api/v1/dataspheres/:uri` | Reads state first; API call is best-effort |
| `set_active_datasphere` | GET `/api/v1/dataspheres/:uri` | Validates URI exists before saving |
| `clear_context` | — | Local state only, no API call |
| `get_history` | — | Local state only, no API call |

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | `set_active_datasphere(uri="<your-ds>")` |
| 401 | Invalid API key | Re-run `dai login --key dsk_xxx` |
| 404 | URI not found | Check `list_dataspheres()` from the dataspheres skill |
