---
name: presentations
description: Create and manage slide decks in Dataspheres AI
argument-hint: "[action] [options]"
---

# presentations — Slide Decks

Presentations are ordered collections of slides stored in a datasphere. Each slide has a title, content (HTML), and a layout. Presentations can be embedded in pages or shared as standalone decks.

## Core Workflows

### List presentations

```python
list_presentations()
# → [{"id": "pres_...", "title": "Q2 Roadmap", "slideCount": 12}, ...]
```

### Create a presentation

```python
create_presentation(
    title="Q2 Roadmap",
    description="Product roadmap for Q2 2026",
)
# → {"id": "pres_abc123", "title": "Q2 Roadmap", "slides": []}
```

### Add slides

```python
add_slide(
    presentation_id="pres_abc123",
    title="Vision",
    content="<h2>Our goal for Q2</h2><p>Ship the AI drafter and sequence builder.</p>",
    layout="default",
    order=1,
)
# → {"id": "slide_...", "title": "Vision", "sortOrder": 1}
```

Layouts: `default` | `centered` | `split` | `blank` (exact values depend on your deployment)

### Update a slide

```python
update_slide(
    presentation_id="pres_abc123",
    slide_id="slide_xyz789",
    content="<h2>Updated vision</h2><p>New content here.</p>",
)
```

### Get a presentation with all slides

```python
get_presentation(presentation_id="pres_abc123")
# → {"id": "...", "title": "...", "slides": [{"id": ..., "title": ..., "content": ..., "sortOrder": 1}, ...]}
```

## API Reference

| Tool | Method | Endpoint |
|------|--------|----------|
| `list_presentations` | GET | `/api/v1/dataspheres/:uri/presentations` |
| `create_presentation` | POST | `/api/v1/dataspheres/:uri/presentations` |
| `get_presentation` | GET | `/api/v1/dataspheres/:uri/presentations/:id` |
| `add_slide` | POST | `/api/v1/dataspheres/:uri/presentations/:id/slides` |
| `update_slide` | PATCH | `/api/v1/dataspheres/:uri/presentations/:id/slides/:slideId` |

All endpoints use the datasphere URI (not DB ID) — these are v1 endpoints.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | Run `dai use <uri>` |
| 401 | Invalid key | Re-run `dai login` |
| 404 | Presentation or slide not found | Check `list_presentations()` |
