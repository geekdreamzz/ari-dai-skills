"""Dataspheres tool domain — create and manage workspace spaces."""

from __future__ import annotations
from typing import Optional
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.client import DaiClient
import dai.state as _state


@mcp.tool()
def list_dataspheres() -> list:
    """List all dataspheres accessible to the authenticated user."""
    client = DaiClient.from_state()
    result = client.get("/api/v1/dataspheres")
    items = result if isinstance(result, list) else result.get("dataspheres", result)
    # Each item has a uri field — pass it explicitly so build_url uses the right slug.
    from dai.mcp._links import build_url
    import dai.state as s
    public_url = s.get_public_url()
    for item in items:
        if isinstance(item, dict):
            item["_url"] = build_url("datasphere", uri=item.get("uri", ""), public_url=public_url)
    return items


@mcp.tool()
def get_datasphere(uri: Optional[str] = None) -> dict:
    """Get datasphere details. Defaults to the active datasphere."""
    target = uri or _state.get_active_datasphere()
    if not target:
        raise ValueError("No URI provided and no active datasphere set.")
    client = DaiClient.from_state()
    result = client.get(f"/api/v1/dataspheres/{target}")
    return link(result, "datasphere", uri=target)


@mcp.tool()
def create_datasphere(name: str, uri: str, description: Optional[str] = None, private: bool = True) -> dict:
    """Create a new datasphere."""
    client = DaiClient.from_state()
    result = client.post("/api/v1/dataspheres", json={"name": name, "uri": uri, "description": description or "", "isPrivate": private})
    return link(result, "datasphere", uri=uri)


@mcp.tool()
def update_datasphere(uri: str, name: Optional[str] = None, description: Optional[str] = None) -> dict:
    """Update a datasphere's name or description."""
    client = DaiClient.from_state()
    payload: dict = {}
    if name:
        payload["name"] = name
    if description is not None:
        payload["description"] = description
    result = client.patch(f"/api/v1/dataspheres/{uri}", json=payload)
    return link(result, "datasphere", uri=uri)


@mcp.tool()
def delete_datasphere(uri: str) -> dict:
    """Delete a datasphere. This is irreversible — all content will be lost."""
    client = DaiClient.from_state()
    return client.delete(f"/api/v1/dataspheres/{uri}")
