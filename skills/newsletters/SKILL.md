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

---

## Issue Content Schema (HTML)

Newsletter issues accept HTML in the `content` field. Issues render in two different contexts with different constraints:

**Platform UI** — full Tiptap renderer, all nodes work (data cards, embeds, mermaid, dataset previews).

**Email distribution** — email clients block JS and iframes. Use only the email-safe subset below.

### Email-Safe Elements (always safe)

```html
<!-- Headings -->
<h1>Main headline</h1>
<h2>Section header</h2>
<h3>Subsection</h3>

<!-- Body + inline formatting -->
<p>Text with <strong>bold</strong>, <em>italic</em>, and <a href="https://...">links</a>.</p>

<!-- Lists -->
<ul><li>Bullet item</li></ul>
<ol><li>Numbered item</li></ol>

<!-- Blockquote -->
<blockquote><p>Pull quote or highlight.</p></blockquote>

<!-- Divider -->
<hr />

<!-- Hosted image — must be a public HTTPS URL -->
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="https://cdn.example.com/image.jpg" alt="Description" />
  <figcaption>Optional caption</figcaption>
</figure>

<!-- Basic table -->
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>Cell A</p></td>
      <td class="tiptap-table-cell"><p>Cell B</p></td>
    </tr>
  </tbody>
</table>

<!-- Code block -->
<pre><code class="language-python">print("hello")</code></pre>
```

### NOT Safe for Email Distribution

| Node | Why it fails in email |
|---|---|
| `<div data-type="dataCard" ...>` | Requires JS — blank in email |
| `<div data-type="datasetEmbed" ...>` | Requires JS — blank in email |
| `<div data-type="mermaid" ...>` | Requires JS renderer — blank in email |
| `<figure data-type="embed" data-url="...">` | iframes blocked by email clients |
| `<div data-type="customAudio" ...>` | Audio unsupported in email |

If the newsletter is **platform-only** (readers open it in the browser, never emailed), all page nodes work. If it's distributed via email, stick to the email-safe subset.

### Embedding AI-Generated Images in Issues

`generate_media_image` returns a hosted HTTPS URL. Use it directly in the email-safe `<figure>` node:

```python
# 1. Generate the image
img = generate_media_image(prompt="Hero banner for Q2 launch, clean and modern", style="photorealistic")
url = img["url"]

# 2. Embed in the issue content
content = f"""
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="{url}" alt="Q2 Launch" />
</figure>
<h1>Q2 is here</h1>
<p>Here's what shipped this quarter...</p>
"""
create_issue(newsletter_id="nl_abc123", title="Q2 Launch", content=content, subject="Q2 is live 🚀")
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

---

## Activity Digest (Separate System)

The **Activity Digest** is a personalized email sent to individual members based on their datasphere memberships and activity — it is NOT the same as a newsletter. Newsletters are datasphere-owned publications; the digest is a per-user, platform-managed email.

### Digest vs Newsletter

| Feature | Newsletter | Activity Digest |
|---|---|---|
| Scope | Datasphere publication | Per-user, cross-datasphere |
| Content | Manually written / AI-generated from DS context | Auto-scored from member activity |
| Schedule | Datasphere-controlled | User-controlled (daily/weekly/biweekly) |
| Recipients | DS subscribers | Individual member only |
| Control | DS admin | User's notification settings |

### Check digest settings

```python
get_user_notification_settings(user_id)
# Returns: activityDigestEnabled, activityDigestFrequency, activityDigestDay,
#          activityDigestTime, activityDigestTimezone, activityDigestLastSentAt
```

### Preview what a user's next digest would contain

```python
preview_activity_digest(user_id, data_only=True)
# Returns: sections (by datasphere), totalItems, lookbackHours
# Each item: type, resourceTitle, contentPreview, imageUrl, videoThumbnail, ctaUrl, upvotes
```

Or via the preview script (requires prod DB access):
```bash
DATABASE_URL="$PRODUCTION_DATABASE_URL" npx tsx scripts/preview-digest-prod.ts <userId> --no-ai
# Full HTML: omit --no-ai (charges Anthropic capacity)
```

### See a user's digest history (what was sent before)

```python
get_activity_digest_history(user_id, limit=30)
# Returns: lastSentAt, frequency, enabled, items (with title, datasphere, sentAt)
```

### Scoring algorithm (key signals)

| Signal | Multiplier |
|---|---|
| Platform DS content (crawler noise) | 0.1× penalty |
| OWNER/ADMIN of datasphere | 1.8× boost |
| Active contributor (posted in last 90d) | 1.4× boost |
| Interest match (research query keywords) | up to 1.6× boost |
| YouTube/video content | 3× content-type boost |
| Freshness (exponential decay, half-life = lookback/3) | varies |
| Base floor (prevents zero-score collapse) | +0.1 × freshness |

### Zero-engagement filter

`WEB_SEARCH_COMPLETED` and `SEQUENCE_COMPLETED` with 0 upvotes and 0 replies are **hard-filtered** before scoring — pure machine-generated noise.

### Adaptive lookback

If a user's non-platform community pool has fewer than 5 items in the primary window (7d for weekly), the system automatically extends to 30 days for their community dataspheres. Prevents platform crawler content from dominating in slow community weeks.

### Content quality seeding

After each URL scrape, `Activity.engagementScore` is seeded with a quality baseline (0–8):
- YouTube embed: +3
- Has thumbnail: +1
- LLM summary > 100 chars: +2
- Meaningful title/description: +0.5 each
- Authority domain (youtube.com, substack.com, etc.): +1

This gives ranking signal before any user engagement accumulates.

### API endpoints

| Action | Endpoint |
|---|---|
| Preview digest | `GET /api/users/me/activity-digest/preview?dataOnly=true` |
| Digest history | `GET /api/users/me/activity-digest/history?limit=30` |
| Digest settings | `GET /api/users/me/notification-settings` |

### Ari tools (available in-app)

- `digest_preview` — "Preview my activity digest"
- `digest_history` — "Show my digest history"
- `digest_settings` — "Check my digest settings"

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | Run `dai use <uri>` |
| 401 | Invalid key | Re-run `dai login` |
| 400 on create | Missing `slug` or `systemInstructions` | Both are required |
| 403 | Not a datasphere admin | Newsletter creation requires admin/owner role |
