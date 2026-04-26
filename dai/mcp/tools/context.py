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


@mcp.tool()
def get_context() -> dict:
    """Return the full session context: mode, active datasphere, API endpoint, and link base.

    mode='local'  → talking to a local dev server (localhost). Full 14-domain tool set.
    mode='remote' → talking to the production Dataspheres AI API. Full 14-domain tool set.

    Use this at the start of any session to orient yourself before taking action.
    The hosted /api/mcp endpoint returns mode='hosted' with a subset of tools.
    """
    uri = _state.get_active_datasphere()
    mode = _state.get_mode()
    base_url = _state.get_base_url()
    public_url = _state.get_public_url()

    details = None
    if uri:
        try:
            client = DaiClient.from_state()
            details = client.get(f"/api/v1/dataspheres/{uri}")
        except Exception:
            pass

    return {
        "mode": mode,
        "active_datasphere": uri,
        "datasphere_details": details,
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
