<!-- dai-sync: skip -->
---
name: export
description: Export datasphere content to local workspace/ files
argument-hint: "[action] [options]"
---

# export — Local Workspace Export

The export skill pulls content from your active datasphere and writes it to a local `workspace/` directory in the current working directory. Useful for backups, offline editing, or feeding content into other tools.

The `workspace/` directory is automatically added to `.gitignore` if not already there.

## Core Workflows

### Export a page

```python
export_page(slug="q2-update")
# → {"path": "/path/to/workspace/q2-update.md", "slug": "q2-update", "title": "Q2 Update"}
```

The page content (HTML) is saved as Markdown with the title as an `<h1>`. Specify a custom filename:

```python
export_page(slug="q2-update", filename="q2_product_update.md")
```

### Export tasks

```python
export_tasks(format="json")
# → {"path": "/path/to/workspace/tasks.json", "count": 42, "format": "json"}
```

Export as CSV for spreadsheet use:

```python
export_tasks(format="csv", filename="sprint_tasks.csv")
```

Filter to a specific plan mode (Kanban board):

```python
export_tasks(plan_mode_id="<planModeId>", format="json")
```

## API Reference

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| `export_page` | GET | `/api/v1/dataspheres/:uri/pages/:slug` | Writes to `workspace/<filename>.md` |
| `export_tasks` | GET | `/api/v2/dataspheres/:dsId/tasks` | Writes to `workspace/<filename>.json\|csv` |

`export_tasks` uses the DB ID internally (`_ds_id()`) for the v2 tasks endpoint.

## Output Location

All files land in `<cwd>/workspace/`:

```
workspace/
├── q2-update.md
├── tasks.json
└── sprint_tasks.csv
```

## Limitations

- Page content is saved as-is (HTML wrapped in Markdown). There is no HTML-to-Markdown conversion — the exported `.md` files contain raw HTML.
- Tasks export fetches up to 500 tasks per call. For larger boards, filter by `plan_mode_id`.
- No media export — use `list_library` from the library skill to get media URLs.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | Run `dai use <uri>` |
| 404 on page | Slug not found | Check `list_pages()` from the pages skill |
| FileNotFoundError | `workspace/` parent not writable | Check directory permissions |
