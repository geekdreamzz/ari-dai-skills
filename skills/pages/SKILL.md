---
name: pages
description: Create, read, update, and delete rich content pages in Dataspheres AI
argument-hint: "[action] [slug] [options]"
---

# pages — Dataspheres AI Rich Pages

All-dai content creation. Pages are the core unit of knowledge in every datasphere.

## Authentication
Requires `dai login` with a `dsk_` API key. Set active datasphere with `dai use <uri>`.

## Core Workflows

### Create a page
```
create_page(title="Market Research Q1", content="<h1>...</h1>", folder="Research")
```

### Read a page
```
get_page(slug="market-research-q1")
```

### Update a page
```
update_page(slug="market-research-q1", content="<p>Updated content</p>")
```

### List pages in a folder
```
list_pages(folder="Research", limit=20)
```

### Delete a page
```
delete_page(slug="market-research-q1")
```

## Content Format
Content is HTML. Use TipTap-compatible HTML — `<h1>`, `<h2>`, `<p>`, `<ul>/<li>`, `<blockquote>`, `<code>`, `<pre>`.

## Visibility
- `public=True` → visible in reader view at `/docs/<uri>/<slug>` (no login required)
- `public=False` (default) → members only at `/app/<uri>/docs/<slug>`

## Error Patterns
- 404 → slug not found. Check spelling and active datasphere.
- 409 → slug already exists. Use `update_page` instead.
- 401 → not authenticated. Run `dai login`.
