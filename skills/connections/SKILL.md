---
name: connections
description: Connections tools for Dataspheres AI
---

# Connections

> Tool reference for this resource group, mirrored by hand from the platform live `/api/mcp/schema` schema.

## Tools

### `follow_user` — Connect with User

Creates send a connection request to a user (instant for public profiles). Requires PARTICIPANT+ role in the datasphere. Required fields: `userId` (string). Show a preview of the operation and get explicit confirmation from the user before executing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userId` | string | yes | Target user ID to connect with |

### `list_connections` — List Connections

Retrieves list all accepted connections for the current user. Requires PARTICIPANT+ role in the datasphere.

