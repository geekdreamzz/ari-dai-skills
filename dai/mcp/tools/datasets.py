"""Datasets tool domain — schema, rows, AI generation, export."""

from __future__ import annotations
from typing import Optional, Any
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.client import DaiClient
import dai.state as _state


def _ds_id() -> str:
    # v2 endpoints require the DB id, not the URI. Resolve and cache.
    uri = _state.get_active_datasphere()
    if not uri:
        raise ValueError("No active datasphere. Run: dai use <uri>")
    cached = _state.cache_get(f"ds_id:{uri}")
    if cached:
        return cached
    client = DaiClient.from_state()
    result = client.get(f"/api/v1/dataspheres/{uri}")
    ds_id = result["id"]
    _state.cache_set(f"ds_id:{uri}", ds_id, ttl_seconds=3600)
    return ds_id


@mcp.tool()
def create_dataset(name: str, columns: list[dict]) -> dict:
    """Create a dataset. Each column: {name, type} where type is text|number|date|boolean|select."""
    client = DaiClient.from_state()
    result = client.post(f"/api/v2/dataspheres/{_ds_id()}/datasets", json={"name": name, "columns": columns})
    return link(result, "dataset")


@mcp.tool()
def list_datasets() -> list:
    """List all datasets in the active datasphere."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v2/dataspheres/{_ds_id()}/datasets")
    items = result if isinstance(result, list) else result.get("datasets", [])
    return link(items, "dataset")


@mcp.tool()
def add_rows(dataset_id: str, rows: list[dict]) -> dict:
    """Add rows to a dataset. Each row is a dict of {column_name: value}."""
    client = DaiClient.from_state()
    return client.post(f"/api/v2/dataspheres/{_ds_id()}/datasets/{dataset_id}/rows/bulk", json={"rows": rows})


@mcp.tool()
def get_rows(dataset_id: str, limit: int = 100, offset: int = 0) -> dict:
    """Get rows from a dataset."""
    client = DaiClient.from_state()
    return client.get(f"/api/v2/dataspheres/{_ds_id()}/datasets/{dataset_id}/rows", params={"limit": limit, "offset": offset})
