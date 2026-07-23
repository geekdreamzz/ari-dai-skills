---
name: export
description: Export datasphere content to local workspace/ files
argument-hint: "[action] [options]"
---

# export — Local Workspace Export

The export skill is an agent workflow: fetch content from a selected datasphere through REST and write it to a local `workspace/` directory. It is useful for backups, offline editing, or feeding content into other tools. There is no separate `export_page` or `export_tasks` runtime.

The `workspace/` directory is automatically added to `.gitignore` if not already there.

## Core Workflows

### Export a page

1. Resolve the target datasphere URI from the request or `DATASPHERES_DEFAULT_URI`.
2. Fetch `GET /api/v1/dataspheres/:uri/pages/:slug`.
3. Write the returned page title and HTML content to `workspace/<slug>.html`, or to the filename requested by the user.
4. Report the absolute output path and do not overwrite an unrelated file without confirmation.

### Export tasks

1. Resolve the target datasphere database ID with `list_dataspheres` or `GET /api/v1/dataspheres`.
2. Fetch `GET /api/v2/dataspheres/:dsId/tasks`, adding the documented plan-mode filter when requested.
3. For JSON, write the returned task array to `workspace/tasks.json`.
4. For CSV, flatten only scalar fields, write an explicit header row, and JSON-encode nested values instead of silently dropping them.
5. Report the task count and absolute output path.

## API Reference

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| Page export | GET | `/api/v1/dataspheres/:uri/pages/:slug` | Uses the human-readable URI |
| Task export | GET | `/api/v2/dataspheres/:dsId/tasks` | Uses the database ID |

## Output Location

All files land in `<cwd>/workspace/`:

```
workspace/
├── q2-update.html
├── tasks.json
└── sprint_tasks.csv
```

## Limitations

- Page content is saved as HTML. This workflow does not attempt lossy HTML-to-Markdown conversion.
- Tasks export fetches up to 500 tasks per call. For larger boards, filter by `plan_mode_id`.
- No media export — use `list_library` from the library skill to get media URLs.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| Missing target datasphere | No URI or database ID was resolved | Call `list_dataspheres` and select the intended workspace |
| 401 | Missing or invalid API key | Check `DATASPHERES_API_KEY` in `.env` or `~/.dataspheres.env` |
| 404 on page | Slug not found | Check `list_pages()` from the pages skill |
| FileNotFoundError | `workspace/` parent not writable | Check directory permissions |
