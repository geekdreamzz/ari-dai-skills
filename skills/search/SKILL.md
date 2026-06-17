---
name: search
description: Search tools for Dataspheres AI
---

# Search

> Tool reference for this resource group, mirrored by hand from the platform live `/api/mcp/schema` schema.

## Tools

### `create_perspective` — Create Perspective

Creates create a saved search perspective as first-class content. Requires PARTICIPANT+ role in the datasphere. Required fields: `name` (string); `query` (string). Optional: `filters`. Show a preview of the operation and get explicit confirmation from the user before executing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Perspective name |
| `query` | string | yes | Search query |
| `filters` | object | no | Search filters to save |

### `list_perspectives` — List Perspectives

Retrieves list all saved search perspectives. Requires PARTICIPANT+ role in the datasphere.

