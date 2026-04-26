"""Context tool domain — manage active datasphere and session state."""

from __future__ import annotations
from importlib.metadata import version as _pkg_version, PackageNotFoundError
from typing import Optional
from dai.mcp.registry import mcp
from dai.client import DaiClient
import dai.state as _state


def _package_version() -> str:
    try:
        return _pkg_version("dai-skills")
    except PackageNotFoundError:
        return "unknown"


def _auto_select_datasphere(client: DaiClient) -> tuple[str | None, list, dict | None]:
    """Fetch all dataspheres, cache them, and pick the best default.

    Priority: private datasphere the user owns → first owned → first in list.
    Returns (selected_uri, all_items, selected_details).
    """
    try:
        result = client.get("/api/v1/dataspheres")
        items = result if isinstance(result, list) else result.get("dataspheres", [])
    except Exception:
        return None, [], None

    if not items:
        return None, [], None

    # Cache the full list for this session
    _state.cache_set("all_dataspheres", items, ttl_seconds=3600)

    # Pick best default: prefer private + owner, then any owned, then first
    def _score(ds: dict) -> int:
        role = (ds.get("membership") or {}).get("role", "")
        vis = ds.get("visibility", "")
        if role == "OWNER" and vis == "PRIVATE":
            return 3
        if role == "OWNER":
            return 2
        if role == "ADMIN":
            return 1
        return 0

    best = max(items, key=_score)
    uri = best.get("uri")
    if uri:
        _state.set_active_datasphere(uri)
        _state.cache_set(f"ds_id:{uri}", best.get("id"), ttl_seconds=3600)
    return uri, items, best


@mcp.tool()
def get_context() -> dict:
    """Return the full session context: mode, active datasphere, all dataspheres, and link base.

    mode='local'  → talking to a local dev server (localhost). Full 14-domain tool set.
    mode='remote' → talking to the production Dataspheres AI API. Full 14-domain tool set.

    If no datasphere is active yet, auto-selects the user's private datasphere and
    caches the full list so Ari can surface all available workspaces without extra calls.

    Use this at the start of every session.
    """
    mode = _state.get_mode()
    base_url = _state.get_base_url()
    public_url = _state.get_public_url()
    uri = _state.get_active_datasphere()

    client = DaiClient.from_state()
    all_dataspheres = _state.cache_get("all_dataspheres")
    details = None

    if not uri or not all_dataspheres:
        # First run or cache expired — fetch and auto-select
        uri, all_dataspheres, details = _auto_select_datasphere(client)
    else:
        try:
            details = client.get(f"/api/v1/dataspheres/{uri}")
        except Exception:
            pass

    return {
        "mode": mode,
        "active_datasphere": uri,
        "datasphere_details": details,
        "all_dataspheres": all_dataspheres or [],
        "api_url": base_url,
        "public_url": public_url,
        "tool_source": "dai-skills (local Python MCP server)",
        "tool_domains": 14,
        "package_version": _package_version(),
    }


@mcp.tool()
def get_active_datasphere() -> dict:
    """Get the currently active datasphere URI and details."""
    uri = _state.get_active_datasphere()
    if not uri:
        return {"active_datasphere": None, "message": "No active datasphere. Run: dai use <uri>"}
    try:
        client = DaiClient.from_state()
        details = client.get(f"/api/v1/dataspheres/{uri}")
        return {"active_datasphere": uri, "details": details}
    except Exception:
        return {"active_datasphere": uri, "details": None}


@mcp.tool()
def set_active_datasphere(uri: str) -> dict:
    """Switch the active datasphere for all subsequent tool calls."""
    client = DaiClient.from_state()
    details = client.get(f"/api/v1/dataspheres/{uri}")
    _state.set_active_datasphere(uri)
    # Invalidate DS ID cache
    _state.cache_set(f"ds_id:{uri}", details.get("id"), ttl_seconds=3600)
    return {"active_datasphere": uri, "name": details.get("name")}


@mcp.tool()
def clear_context() -> dict:
    """Clear the active datasphere context."""
    _state.clear_context()
    return {"cleared": True}


@mcp.tool()
def get_history(limit: int = 10) -> list:
    """Get recent action history."""
    return _state.get_history(limit)
