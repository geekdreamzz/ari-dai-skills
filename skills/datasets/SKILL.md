---
name: datasets
description: Create and manage structured datasets in Dataspheres AI
argument-hint: "[action] [options]"
---

# datasets — Structured Data in Dataspheres AI

Datasets are typed, row-based data stores scoped to a datasphere. They power DataCards (embedded visualizations) in pages and the planner dashboard.

## Core Workflows

### Create a dataset

```python
create_dataset(
    name="Q2 Pipeline",
    columns=[
        {"name": "company", "type": "text"},
        {"name": "deal_value", "type": "number"},
        {"name": "close_date", "type": "date"},
        {"name": "qualified", "type": "boolean"},
        {"name": "stage", "type": "select"},
    ]
)
# → {"id": "ds_...", "name": "Q2 Pipeline", "columns": [...]}
```

Column types: `text` | `number` | `date` | `boolean` | `select`

### List datasets

```python
list_datasets()
# → [{"id": "...", "name": "...", "rowCount": 42}, ...]
```

### Add rows

```python
add_rows(
    dataset_id="<id>",
    rows=[
        {"company": "Acme Corp", "deal_value": 50000, "close_date": "2026-06-30", "qualified": True, "stage": "Proposal"},
        {"company": "Beta Ltd", "deal_value": 12000, "close_date": "2026-05-15", "qualified": False, "stage": "Discovery"},
    ]
)
# → {"inserted": 2, "total": 44}
```

### Query rows

```python
get_rows(dataset_id="<id>", limit=100, offset=0)
# → {"rows": [...], "total": 44, "limit": 100, "offset": 0}
```

## API Reference

| Tool | Method | Endpoint |
|------|--------|----------|
| `create_dataset` | POST | `/api/v2/dataspheres/:dsId/datasets` |
| `list_datasets` | GET | `/api/v2/dataspheres/:dsId/datasets` |
| `add_rows` | POST | `/api/v2/dataspheres/:dsId/datasets/:datasetId/rows/bulk` |
| `get_rows` | GET | `/api/v2/dataspheres/:dsId/datasets/:datasetId/rows` |

All endpoints use the datasphere **DB ID** (not URI). The `_ds_id()` helper resolves this automatically.

## Use With DataCards

DataCards embed live dataset queries into pages and planner dashboards. After creating a dataset and populating rows, embed a DataCard widget in a page's HTML content using the `data-type="dataCard"` div — see the `pages` skill for the widget format.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | Run `dai use <uri>` |
| 401 | Invalid key | Re-run `dai login` |
| 400 on `add_rows` | Column name mismatch | Ensure row keys match column names exactly |
