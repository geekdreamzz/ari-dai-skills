"""Presentations tool domain — slide deck creation and management."""

from __future__ import annotations
from typing import Optional, Any
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.client import DaiClient
import dai.state as _state


def _ds() -> str:
    uri = _state.get_active_datasphere()
    if not uri:
        raise ValueError("No active datasphere. Run: dai use <uri>")
    return uri


@mcp.tool()
def list_presentations() -> list:
    """List all presentations in the active datasphere."""
    client = DaiClient.from_state()
    try:
        result = client.get(f"/api/v1/dataspheres/{_ds()}/presentations")
        items = result if isinstance(result, list) else result.get("presentations", [])
        return link(items, "presentation")
    except Exception as e:
        if "404" in str(e) or "not found" in str(e).lower():
            return []
        raise


@mcp.tool()
def get_presentation(presentation_id: str) -> dict:
    """Get a presentation with all its slides."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v1/dataspheres/{_ds()}/presentations/{presentation_id}")
    return link(result, "presentation")


@mcp.tool()
def create_presentation(title: str, description: Optional[str] = None) -> dict:
    """Create a new presentation."""
    client = DaiClient.from_state()
    result = client.post(f"/api/v1/dataspheres/{_ds()}/presentations", json={"title": title, "description": description or ""})
    return link(result, "presentation")


@mcp.tool()
def add_slide(presentation_id: str, title: str, content: str, layout: str = "default", order: Optional[int] = None) -> dict:
    """Add a slide to a presentation."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {"title": title, "content": content, "layout": layout}
    if order is not None:
        payload["sortOrder"] = order
    return client.post(f"/api/v1/dataspheres/{_ds()}/presentations/{presentation_id}/slides", json=payload)


@mcp.tool()
def update_slide(presentation_id: str, slide_id: str, title: Optional[str] = None, content: Optional[str] = None) -> dict:
    """Update a slide's title or content."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {}
    if title:
        payload["title"] = title
    if content is not None:
        payload["content"] = content
    return client.patch(f"/api/v1/dataspheres/{_ds()}/presentations/{presentation_id}/slides/{slide_id}", json=payload)
