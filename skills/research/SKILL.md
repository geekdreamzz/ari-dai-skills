<!-- dai-sync: skip -->
---
name: research
description: AI-powered web research via Dataspheres AI assistant conversations
argument-hint: "[action] [options]"
---

# research — AI Web Research

Research is powered by the Dataspheres AI **assistant conversations** API with `webSearch: true`. There is no dedicated research endpoint — each research session is a conversation with web search enabled. The AI searches the web, synthesizes findings, and returns a structured response.

## Core Workflow

### 1. Start a research session

```python
result = start_research(
    query="What are the best practices for async job queues in 2026?",
    title="Async Queue Research",   # optional — becomes the conversation title
)
# → {"conversationId": "conv_abc123", "messageId": "msg_...", "status": "processing"}
```

The AI starts searching immediately. Because responses stream server-side, the message is created but the content populates asynchronously.

### 2. Poll for the response

```python
messages = get_research_messages(conversation_id="conv_abc123")
# → [
#     {"id": "msg_user", "role": "user", "content": "What are the best..."},
#     {"id": "msg_ai", "role": "assistant", "content": "<full research synthesis>", "webSearchResults": [...]}
#   ]
```

Wait a few seconds after `start_research` before polling — SSE responses complete server-side before being readable via GET.

### 3. Follow up

```python
continue_research(
    conversation_id="conv_abc123",
    follow_up="Can you compare the top 3 options with a table?",
)
```

### 4. List past research sessions

```python
list_research_conversations(limit=20)
# → [{"id": "conv_...", "title": "Async Queue Research", "createdAt": "..."}, ...]
```

## API Reference

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| `start_research` | POST `/conversations` + POST `/conversations/:id/messages` | `/api/v2/assistant/conversations` | Creates conversation, then sends message with `webSearch: true` |
| `get_research_messages` | GET | `/api/v2/assistant/conversations/:id/messages` | Poll after ~3s |
| `list_research_conversations` | GET | `/api/v2/assistant/conversations` | All conversations, not just research |
| `continue_research` | POST | `/api/v2/assistant/conversations/:id/messages` | Adds a follow-up with web search |

## Important Notes

- **No dedicated research endpoint.** `/api/v2/dataspheres/:id/research` does not exist. Research uses the assistant conversations API.
- **The REALITY engine (`/api/v2/reality`) is read-only.** It has no POST endpoint for triggering research.
- **Datasphere context.** Research messages include `datasphereId` so the AI can cross-reference your datasphere's content alongside web results.
- **SSE responses.** The send-message endpoint streams via SSE. The GET messages endpoint returns the completed content once streaming finishes.

## Cost Note

Each `start_research` call triggers a web search + LLM completion. Web searches consume capacity tokens. Confirm with the user before running bulk research loops.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | Run `dai use <uri>` |
| 401 | Invalid key | Re-run `dai login` |
| Empty messages list | Response still streaming | Wait ~3–5 seconds and retry `get_research_messages` |
