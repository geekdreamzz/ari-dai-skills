<!-- dai-sync: skip -->
---
name: newsletters
description: Create and manage AI-powered newsletters in Dataspheres AI
argument-hint: "[action] [options]"
---

# newsletters — AI-Powered Publications

Newsletters are AI-generated publications scoped to a datasphere. Each newsletter has a `systemInstructions` field that drives content generation — the AI uses this prompt plus the datasphere's knowledge context to write issues.

## Core Workflows

### List newsletters

```python
list_newsletters()
# → [{"id": "nl_...", "name": "Weekly Digest", "slug": "weekly-digest", "type": "STANDARD"}, ...]
```

### Create a newsletter

```python
create_newsletter(
    name="Weekly Digest",
    slug="weekly-digest",              # URL-friendly, unique per datasphere
    system_instructions="Write a friendly weekly summary of our product updates and blog posts. Focus on practical tips for developers.",
    description="Weekly product and developer news",
    schedule_type="WEEKLY",            # WEEKLY | MONTHLY | CUSTOM | MANUAL
)
# → {"id": "nl_...", "name": "Weekly Digest", "slug": "weekly-digest"}
```

**Required fields:** `name`, `slug`, `system_instructions`

### AI-generate an issue

```python
generate_issue(newsletter_id="nl_abc123")
# → {"id": "iss_...", "title": "Weekly Digest — April 28", "status": "DRAFT", "content": "<h2>...</h2>"}
```

The AI reads the newsletter's `systemInstructions`, the datasphere's recent pages and tasks, and generates a complete issue.

### Create an issue manually

```python
create_issue(
    newsletter_id="nl_abc123",
    title="Special Edition: Q2 Launch",
    content="<h1>We launched!</h1><p>...</p>",
    subject="🚀 Q2 is live — here's what's new",
)
```

### List and send issues

```python
list_issues(newsletter_id="nl_abc123")
# → [{"id": "iss_...", "title": "...", "status": "DRAFT|SENT", "sentAt": null}]

send_issue(issue_id="iss_xyz789")
# → {"sent": true, "recipientCount": 142}
```

### Get a newsletter

```python
get_newsletter(newsletter_id="nl_abc123")
# → full newsletter object with config, schedule, and stats
```

## API Reference

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| `list_newsletters` | GET | `/api/dataspheres/:dsId/newsletters` | Uses DB ID internally |
| `create_newsletter` | POST | `/api/dataspheres/:dsId/newsletters` | Uses DB ID internally |
| `get_newsletter` | GET | `/api/newsletters/:newsletterId` | By newsletter ID |
| `generate_issue` | POST | `/api/newsletters/:newsletterId/generate` | AI-generated; costs capacity |
| `create_issue` | POST | `/api/newsletters/:newsletterId/issues` | Manual draft |
| `list_issues` | GET | `/api/newsletters/:newsletterId/issues` | |
| `send_issue` | POST | `/api/newsletter-issues/:issueId/send` | Irreversible — sends email |

**Important:** The newsletters API is mounted at `/api` (not `/api/v1`). The `list_newsletters` and `create_newsletter` endpoints use the datasphere **DB ID**, not the URI. This is handled automatically by `_ds_id()` internally.

## Cost Note

`generate_issue` triggers an LLM completion. Confirm with the user before generating in bulk.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | Run `dai use <uri>` |
| 401 | Invalid key | Re-run `dai login` |
| 400 on create | Missing `slug` or `systemInstructions` | Both are required |
| 403 | Not a datasphere admin | Newsletter creation requires admin/owner role |
