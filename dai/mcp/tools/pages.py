"""Pages tool domain — create, read, update, delete Dataspheres AI pages."""

from __future__ import annotations
from typing import Optional
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
def create_page(title: str, content: str, slug: Optional[str] = None, folder: Optional[str] = None, public: bool = False) -> dict:
    """Create a new page in the active datasphere."""
    client = DaiClient.from_state()
    ds = _ds()
    payload = {"title": title, "content": content, "status": "PUBLISHED", "isPubliclyVisible": public}
    if slug:
        payload["slug"] = slug
    if folder:
        payload["folderName"] = folder
    result = client.post(f"/api/v1/dataspheres/{ds}/pages", json=payload)
    return link(result, "page")


@mcp.tool()
def get_page(slug: str) -> dict:
    """Get a page by its slug."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v1/dataspheres/{_ds()}/pages/{slug}")
    return link(result, "page")


@mcp.tool()
def update_page(slug: str, title: Optional[str] = None, content: Optional[str] = None, public: Optional[bool] = None) -> dict:
    """Update a page's title, content, or visibility."""
    client = DaiClient.from_state()
    payload = {}
    if title is not None:
        payload["title"] = title
    if content is not None:
        payload["content"] = content
    if public is not None:
        payload["isPubliclyVisible"] = public
    result = client.put(f"/api/v1/dataspheres/{_ds()}/pages/{slug}", json=payload)
    return link(result, "page")


@mcp.tool()
def delete_page(slug: str) -> dict:
    """Delete a page by its slug."""
    client = DaiClient.from_state()
    return client.delete(f"/api/v1/dataspheres/{_ds()}/pages/{slug}")


@mcp.tool()
def list_pages(folder: Optional[str] = None, limit: int = 20) -> list:
    """List pages, optionally filtered by folder."""
    client = DaiClient.from_state()
    params = {"limit": limit}
    if folder:
        params["folder"] = folder
    result = client.get(f"/api/v1/dataspheres/{_ds()}/pages", params=params)
    items = result if isinstance(result, list) else result.get("pages", result)
    return link(items, "page")
