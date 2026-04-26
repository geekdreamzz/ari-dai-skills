---
name: dataspheres
description: Create and manage Dataspheres AI workspaces
argument-hint: "[action] [options]"
---

# dataspheres — Workspace Management

A datasphere is a self-contained workspace: pages, tasks, datasets, media, newsletters, surveys, and AI conversations all live inside one. Each datasphere has a unique `uri` (slug) and a DB `id` (CUID).

## Core Workflows

### List your dataspheres

```python
list_dataspheres()
# → [{"id": "ds_default", "uri": "dataspheres-ai", "name": "DATASPHERES AI", "isPrivate": false}, ...]
```

### Get a datasphere

```python
get_datasphere(uri="my-project")
# → {"id": "clx...", "uri": "my-project", "name": "My Project", "isPrivate": true, "memberCount": 3}
```

Omit `uri` to get the active datasphere's details.

### Create a datasphere

```python
create_datasphere(
    name="Marketing Hub",
    uri="marketing-hub",       # URL-friendly slug, must be unique globally
    description="All marketing content and campaigns",
    private=True,              # True = members-only; False = publicly readable
)
# → {"id": "clx...", "uri": "marketing-hub", "name": "Marketing Hub"}
```

After creating, set it as active:

```python
set_active_datasphere(uri="marketing-hub")  # from context skill
```

## API Reference

| Tool | Method | Endpoint |
|------|--------|----------|
| `list_dataspheres` | GET | `/api/v1/dataspheres` |
| `get_datasphere` | GET | `/api/v1/dataspheres/:uri` |
| `create_datasphere` | POST | `/api/v1/dataspheres` |

## URI vs DB ID

| Field | Format | Used where |
|-------|--------|-----------|
| `uri` | `my-project` (slug) | v1 API endpoints, public URLs |
| `id` | `ds_default` or `clx...` (CUID) | v2 API endpoints (tasks, sequences, datasets, newsletters) |

The MCP tools handle this transparently — `_ds()` returns the URI, `_ds_id()` resolves and caches the DB ID.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| 401 | Invalid key | Re-run `dai login` |
| 404 | URI not found | Check `list_dataspheres()` for valid URIs |
| 409 | URI already taken | Choose a different slug |
| 403 on v2 endpoints | Passing URI where DB ID is needed | This is handled by `_ds_id()` internally |
