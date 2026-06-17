---
name: saved_lists
description: Saved Lists tools for Dataspheres AI
---

# Saved Lists

> Tool reference for this resource group, mirrored by hand from the platform live `/api/mcp/schema` schema.

## Tools

### `list_saved_lists` — List Saved Lists

Retrieves list all saved lists for the current user. Requires PARTICIPANT+ role in the datasphere.

### `save_to_list` — Save to List

Creates save an item to a list (creates default list if none specified). Requires PARTICIPANT+ role in the datasphere. Required fields: `itemId` (string); `itemType` (string) — must be one of: post, page, dataset, linked_url, datasphere. Optional: `listId`, `title`. Show a preview of the operation and get explicit confirmation from the user before executing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `itemId` | string | yes | ID of the item to save |
| `itemType` | string | yes | Type of the item |
| `listId` | string | no | Target list ID (uses default if omitted) |
| `title` | string | no | Display title for the saved item |

