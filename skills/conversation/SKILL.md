---
name: conversation
description: Conversation tools for Dataspheres AI
---

# Conversation

> Tool reference for this resource group, mirrored by hand from the platform live `/api/mcp/schema` schema.

## Tools

### `dismiss_tool_card` — Remove tool card

Remove an ARI HIL confirmation card (task create, data card create, etc.) from the chat.
Use when:
- The user says things like "never mind", "cancel that", "forget it", "remove this card", "dismiss this".
- You realize the action is no longer applicable (e.g. user redirected the conversation, error is stale, you created a better alternative).
- A previous card errored out and isn't worth retrying.
This is a clean dismissal — the card disappears from the message list and stays gone across refresh. In prose, acknowledge briefly: "Removed." or "Dismissed that card — let me know if you want to go a different direction."

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `conversationId` | string | yes | Conversation id — auto-filled with the current conversation |
| `messageId` | string | no | Message id whose HIL card should be dismissed. Omit to dismiss the most recent active card. |
| `invokeId` | string | no | Specific pending-invocation id. Omit if using messageId. |
| `reason` | string | no | Short human-readable reason (goes into audit metadata). |

