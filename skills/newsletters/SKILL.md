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

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | Run `dai use <uri>` |
| 401 | Invalid key | Re-run `dai login` |
| 400 on create | Missing `slug` or `systemInstructions` | Both are required |
| 403 | Not a datasphere admin | Newsletter creation requires admin/owner role |
