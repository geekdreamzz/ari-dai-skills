"""Shared datasphere ID resolver — eliminates the copy/paste _ds_id() across tool modules."""

from __future__ import annotations

import dai.state as _state
from dai.client import DaiClient


def resolve_ds_id() -> str:
    """Return the DB id for the active datasphere, with a 1h cache.

    v2 endpoints require the DB id (not the URI slug).
    /api/v1/dataspheres/{uri} may return {"datasphere": {...}} or {"id": ...} directly —
    this unwraps both shapes so callers never see KeyError: 'id'.
    """
    uri = _state.get_active_datasphere()
    if not uri:
        raise ValueError("No active datasphere. Run: dai use <uri>")
    cached = _state.cache_get(f"ds_id:{uri}")
    if cached:
        return cached
    client = DaiClient.from_state()
    result = client.get(f"/api/v1/dataspheres/{uri}")
    # Unwrap {"datasphere": {...}} or use the dict directly
    ds_data = result.get("datasphere", result) if isinstance(result, dict) else {}
    ds_id = ds_data.get("id") or result.get("id") if isinstance(result, dict) else None
    if not ds_id:
        raise ValueError(f"Could not resolve datasphere ID for '{uri}'. Response: {result}")
    _state.cache_set(f"ds_id:{uri}", ds_id, ttl_seconds=3600)
    return ds_id
