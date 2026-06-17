---
name: ai
description: Background AI drafting for Dataspheres AI pages
argument-hint: "[action] [options]"
---

# ai — Dataspheres AI Drafter

The AI Drafter generates page content asynchronously. Jobs run in the background and are attached to a specific page. The primary interface is **background drafts** — the streaming endpoint (`POST /api/v2/ai/draft`) is browser-only (SSE) and not suitable for MCP use.

## Core Workflow

### 1. Start a draft job

```python
result = draft_content(
    content="Write a product update covering our Q2 launch",
    context="<h1>Q2 Product Update</h1><p>We shipped X and Y this quarter.</p>",
    page_id="<pageId>",
)
# → {"jobId": "job_abc123", "status": "PENDING"}
```

- `content` — instructions / prompt for the AI
- `context` — existing page content (gives the AI surrounding material to work from)
- `page_id` — the page this draft is for (use `get_page` from the pages skill to find the ID)
- `model_id` — optional; defaults to `claude-sonnet-4-6`

### 2. Poll for completion

```python
jobs = get_draft_jobs(page_id="<pageId>")
# → [{"jobId": "job_abc123", "status": "COMPLETED", "draftContent": "<h2>...</h2>"}]
```

Or fetch a single job:

```python
job = get_draft_job(job_id="job_abc123")
# → {"jobId": ..., "status": "COMPLETED", "draftContent": "...", "error": null}
```

Status values: `PENDING` → `PROCESSING` → `COMPLETED` | `FAILED`

### 3. Accept or dismiss

```python
accept_draft(job_id="job_abc123")   # applies the draft to the page
dismiss_draft(job_id="job_abc123")  # discards it
```

## API Reference

| Tool | Method | Endpoint |
|------|--------|----------|
| `draft_content` | POST | `/api/v2/ai/draft/background` |
| `get_draft_jobs` | GET | `/api/v2/ai/draft/jobs/:pageId` |
| `get_draft_job` | GET | `/api/v2/ai/draft/job/:jobId` |
| `accept_draft` | POST | `/api/v2/ai/draft/jobs/:jobId/accept` |
| `dismiss_draft` | POST | `/api/v2/ai/draft/jobs/:jobId/dismiss` |

## Limitations

- **No streaming.** Streaming (`POST /api/v2/ai/draft`) is SSE and browser-only.
- **No translate or analyze.** These endpoints do not exist. Use the `research` skill (assistant conversations) for general AI queries.
- **Page ID required.** Drafts must be associated with an existing page.

## Cost Note

Each `draft_content` call triggers an LLM completion. Confirm with the user before batch-drafting multiple pages.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| 401 | Invalid API key | Re-run `dai login` |
| 404 on page_id | Page not found | Verify with `get_page` from the pages skill |
| 422 | Missing `content` or `context` | Both fields are required |
