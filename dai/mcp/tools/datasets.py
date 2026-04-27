"""Datasets tool domain — schema, rows, AI generation, export."""

from __future__ import annotations
from typing import Optional, Any
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.mcp._ds import resolve_ds_id
from dai.client import DaiClient


@mcp.tool()
def create_dataset(name: str, columns: list[dict]) -> dict:
    """Create a dataset. Each column: {name, type} where type is text|number|date|boolean|select."""
    client = DaiClient.from_state()
    result = client.post(f"/api/v2/dataspheres/{resolve_ds_id()}/datasets", json={"name": name, "columns": columns})
    return link(result, "dataset")


@mcp.tool()
def list_datasets() -> list:
    """List all datasets in the active datasphere (slim — id, name, column count)."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v2/dataspheres/{resolve_ds_id()}/datasets")
    items = result if isinstance(result, list) else result.get("datasets", [])
    link(items, "dataset")
    return [
        {"id": d.get("id"), "name": d.get("name"), "columnCount": len(d.get("columns", [])), "_url": d.get("_url")}
        for d in items if isinstance(d, dict)
    ]


@mcp.tool()
def update_dataset(dataset_id: str, name: Optional[str] = None, columns: Optional[list[dict]] = None) -> dict:
    """Update a dataset's name or columns."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {}
    if name:
        payload["name"] = name
    if columns is not None:
        payload["columns"] = columns
    result = client.patch(f"/api/v2/dataspheres/{resolve_ds_id()}/datasets/{dataset_id}", json=payload)
    return link(result, "dataset")


@mcp.tool()
def delete_dataset(dataset_id: str) -> dict:
    """Delete a dataset and all its rows."""
    client = DaiClient.from_state()
    return client.delete(f"/api/v2/dataspheres/{resolve_ds_id()}/datasets/{dataset_id}")


@mcp.tool()
def add_rows(dataset_id: str, rows: list[dict]) -> dict:
    """Add rows to a dataset. Each row is a dict of {column_name: value}."""
    client = DaiClient.from_state()
    return client.post(f"/api/v2/dataspheres/{resolve_ds_id()}/datasets/{dataset_id}/rows/bulk", json={"rows": rows})


@mcp.tool()
def get_rows(dataset_id: str, limit: int = 100, offset: int = 0) -> dict:
    """Get rows from a dataset."""
    client = DaiClient.from_state()
    return client.get(f"/api/v2/dataspheres/{resolve_ds_id()}/datasets/{dataset_id}/rows",
                      params={"limit": limit, "offset": offset})


@mcp.tool()
def delete_row(dataset_id: str, row_id: str) -> dict:
    """Delete a single row from a dataset."""
    client = DaiClient.from_state()
    return client.delete(f"/api/v2/dataspheres/{resolve_ds_id()}/datasets/{dataset_id}/rows/{row_id}")


@mcp.tool()
def generate_dataset_rows(dataset_id: str, count: int = 10, prompt: Optional[str] = None) -> dict:
    """AI-generate rows for a dataset using the schema as guidance. Costs capacity."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {"count": count}
    if prompt:
        payload["prompt"] = prompt
    return client.post(f"/api/v2/dataspheres/{resolve_ds_id()}/datasets/{dataset_id}/rows/generate", json=payload)
