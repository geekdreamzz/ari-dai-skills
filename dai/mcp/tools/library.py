"""Library tool domain — media upload and management."""

from __future__ import annotations
from typing import Optional
from pathlib import Path
import httpx
from dai.mcp.registry import mcp
from dai.client import DaiClient, ApiError
import dai.state as _state


def _ds() -> str:
    uri = _state.get_active_datasphere()
    if not uri:
        raise ValueError("No active datasphere. Run: dai use <uri>")
    return uri


@mcp.tool()
def upload_file(file_path: str, description: Optional[str] = None) -> dict:
    """Upload a file to the media library. Returns the media URL."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")
    api_key = _state.get_api_key()
    base_url = _state.get_base_url()
    with open(path, "rb") as f:
        resp = httpx.post(
            f"{base_url}/api/media/upload",
            headers={"Authorization": f"Bearer {api_key}"},
            files={"file": (path.name, f)},
            data={"description": description or ""},
            timeout=60.0,
        )
    if resp.status_code >= 400:
        raise ApiError(f"Upload failed: {resp.text}", resp.status_code)
    return resp.json()


@mcp.tool()
def list_library(limit: int = 20, search: Optional[str] = None) -> list:
    """List media library items."""
    client = DaiClient.from_state()
    params = {"limit": limit}
    if search:
        params["q"] = search
    result = client.get(f"/api/v1/dataspheres/{_ds()}/media", params=params)
    return result if isinstance(result, list) else result.get("items", [])


@mcp.tool()
def delete_media(media_id: str) -> dict:
    """Delete a media item by ID."""
    client = DaiClient.from_state()
    return client.delete(f"/api/v1/dataspheres/{_ds()}/media/{media_id}")
