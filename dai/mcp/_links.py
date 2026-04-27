"""URL builder and response enrichment for Dataspheres AI resources.

Every tool response gets a _url field pointing to the live object in the DS UI.
The public_url (dataspheres.ai vs dev.dataspheres.ai) comes from state so it
works for both local dev and production without hardcoding.
"""

from __future__ import annotations

from typing import Any

import dai.state as _state

# Canonical route patterns — verified against AppRoot.tsx router config.
# {uri} = datasphere URI slug. {id} = resource DB id. {slug} = URL-friendly slug.
_PATTERNS: dict[str, str] = {
    "datasphere":       "/app/{uri}",
    "page":             "/app/{uri}/pages/{slug}",
    "page_public":      "/pages/{uri}/{slug}",
    "task":             "/app/{uri}/planner?task={id}",
    "plan_mode":        "/app/{uri}/planner?mode={id}",
    "newsletter":       "/app/{uri}/newsletters/{id}",
    "newsletter_public": "/newsletters/{id}",   # id = newsletter URI slug here
    "survey":           "/app/{uri}/surveys/{id}/edit",
    "survey_public":    "/s/{uri}/{slug}",
    "sequence":         "/app/{uri}/sequences/{id}",
    "execution":        "/app/{uri}/sequences/{sequence_id}/executions/{id}",
    "dataset":          "/app/{uri}/datasets/{id}",
    "presentation":     "/app/{uri}/presentations/{id}/edit",
    "draft_job":        "/app/{uri}/pages/{page_id}",  # no standalone job URL
}


def build_url(resource_type: str, *, uri: str = "", public_url: str = "", **ids: str) -> str:
    """Return the canonical DS UI URL for a resource."""
    base = (public_url or _state.get_public_url()).rstrip("/")
    pattern = _PATTERNS.get(resource_type, "/app/{uri}")
    try:
        path = pattern.format(uri=uri, **ids)
    except KeyError:
        path = f"/app/{uri}"
    return base + path


def link(result: Any, resource_type: str, **explicit_ids: str) -> Any:
    """Attach _url to a tool result (dict or list of dicts).

    Explicit ids override anything inferred from the result itself.
    Pass uri=<slug> to override the active datasphere (e.g. for cross-ds links).
    Returns the same object mutated in-place (and also returned for chaining).
    """
    # Allow callers to override the datasphere URI explicitly.
    uri = str(explicit_ids.pop("uri", None) or _state.get_active_datasphere() or "")
    public_url = _state.get_public_url()

    if isinstance(result, list):
        for item in result:
            if isinstance(item, dict):
                _attach(item, resource_type, uri, public_url, **explicit_ids)
        return result

    if isinstance(result, dict):
        _attach(result, resource_type, uri, public_url, **explicit_ids)
    return result


def _attach(item: dict, resource_type: str, uri: str, public_url: str, **explicit_ids: str) -> None:
    """Mutate item in-place, adding _url."""
    # Pull common identifier fields from the item so callers don't have to
    inferred: dict[str, str] = {
        "id":          str(item.get("id") or item.get("planModeId") or ""),
        "slug":        str(item.get("slug") or item.get("id") or ""),
        "page_id":     str(item.get("pageId") or item.get("page_id") or item.get("id") or ""),
        "sequence_id": str(item.get("sequenceId") or item.get("sequence_id") or ""),
    }
    merged = {**inferred, **explicit_ids}
    item["_url"] = build_url(resource_type, uri=uri, public_url=public_url, **merged)
