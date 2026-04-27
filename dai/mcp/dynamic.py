"""
Dynamic tool loader — fetches /api/mcp/schema from the platform at startup
and registers every tool as a real FastMCP FunctionTool.

Hand-written tools in dai/mcp/tools/ take priority: if a tool_id already
exists in the registry, it is skipped here. This means curated tools
(context, dataspheres, SDD) keep their richer local logic.

Any tool added to assistant-tool-registry.service.ts on the platform
automatically appears here on next MCP server startup — zero manual sync.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import httpx
from fastmcp.tools.function_tool import FunctionTool

import dai.state as _state
from dai.mcp._ds import resolve_ds_id
from dai.mcp.registry import mcp

logger = logging.getLogger(__name__)

# Maps platform ToolField.type → JSON Schema type
_TYPE_MAP = {
    "string": "string",
    "number": "number",
    "boolean": "boolean",
    "array": "array",
    "object": "object",
    "file": "string",   # files passed as URLs
}

# Stub used only as a scaffold for model_copy — its fn and schema are always overridden
_STUB = None  # lazy-initialised in load_remote_tools()


def _build_schema(fields: list[dict]) -> dict:
    """Convert platform ToolField[] → JSON Schema object."""
    properties: dict[str, Any] = {}
    required: list[str] = []

    for f in fields:
        prop: dict[str, Any] = {
            "type": _TYPE_MAP.get(f.get("type", "string"), "string"),
            "description": f.get("description", ""),
        }
        if f.get("enum"):
            prop["enum"] = f["enum"]
        if f.get("example"):
            prop["examples"] = [f["example"]]
        if f.get("default") is not None:
            prop["default"] = f["default"]

        properties[f["name"]] = prop

        if f.get("required", False):
            required.append(f["name"])

    schema: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": properties,
    }
    if required:
        schema["required"] = required
    return schema


def _resolve_url(path: str, path_params: dict | None, kwargs: dict, ds_id: str) -> str:
    """Build the full URL, substituting :param placeholders."""
    url = path
    # Standard substitutions
    url = url.replace(":dsId", ds_id).replace(":datasphereId", ds_id)

    if path_params:
        for param, field_name in path_params.items():
            value = kwargs.get(field_name, "")
            url = url.replace(f":{param}", str(value))

    # Drop any remaining unresolved path params
    url = re.sub(r":[a-zA-Z][a-zA-Z0-9_]*", "", url)
    return url


def _make_executor(tool_def: dict):
    """Return an async executor closure for one remote tool.

    Reads state at call time so datasphere changes between calls are handled.
    """
    endpoint = tool_def["endpoint"]
    method = endpoint["method"]
    path = endpoint["path"]
    path_params: dict | None = endpoint.get("pathParams")

    # Field names that are consumed as path params (not body/query)
    path_param_fields: set[str] = set()
    if path_params:
        path_param_fields.update(path_params.values())
    # Standard path params that map to ds_id (not field names)
    _PATH_SENTINELS = {"dsId", "datasphereId"}

    async def executor(**kwargs: Any) -> Any:
        base_url = _state.get_base_url()
        api_key = _state.get_api_key()
        ds_id = resolve_ds_id()

        url = f"{base_url}{_resolve_url(path, path_params, kwargs, ds_id)}"

        # Strip path-consumed and None-valued params from the payload
        payload = {
            k: v for k, v in kwargs.items()
            if k not in path_param_fields and k not in _PATH_SENTINELS and v is not None
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            if method == "GET":
                resp = await client.get(url, headers=headers, params=payload)
            elif method == "POST":
                resp = await client.post(url, headers=headers, json=payload)
            elif method == "PATCH":
                resp = await client.patch(url, headers=headers, json=payload)
            elif method == "PUT":
                resp = await client.put(url, headers=headers, json=payload)
            elif method == "DELETE":
                resp = await client.delete(url, headers=headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")

        resp.raise_for_status()
        try:
            return resp.json()
        except Exception:
            return {"status": resp.status_code, "text": resp.text}

    executor.__name__ = tool_def["id"]
    return executor


def _fetch_schema(base_url: str, api_key: str) -> list[dict]:
    """Fetch tool list from API, fall back to state.db cache if API is unreachable."""
    try:
        resp = httpx.get(
            f"{base_url}/api/mcp/schema",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10.0,
        )
        resp.raise_for_status()
        tools = resp.json().get("tools", [])
        # Persist each tool to the cache (24h TTL)
        for t in tools:
            if t.get("id"):
                _state.tool_schema_set(t["id"], t)
        logger.info("[dynamic] Fetched %d tools from /api/mcp/schema", len(tools))
        return tools
    except Exception as exc:
        logger.warning("[dynamic] /api/mcp/schema unreachable (%s) — loading from cache", exc)
        cached = _state.tool_schema_get_all()
        if cached:
            logger.info("[dynamic] Loaded %d tools from schema cache", len(cached))
        return cached


def load_remote_tools() -> int:
    """Register all platform tools not already covered by hand-written modules.

    Checks state.db cache first (24h TTL) — startup is instant on warm cache.
    Falls back to live API fetch on cache miss or expiry.
    Returns the number of tools registered.
    """
    global _STUB

    try:
        base_url = _state.get_base_url()
        api_key = _state.get_api_key()
    except Exception as exc:
        logger.warning("[dynamic] Skipping remote tools (not authenticated): %s", exc)
        return 0

    # Warm cache path — skip network entirely if all tools are fresh
    cached = _state.tool_schema_get_all()
    if cached:
        tools = cached
        logger.info("[dynamic] Using cached schema (%d tools)", len(tools))
    else:
        tools = _fetch_schema(base_url, api_key)

    if not tools:
        return 0

    if _STUB is None:
        _STUB = FunctionTool.from_function(
            lambda _x="": {},
            name="_dynamic_stub",
            description="stub",
        )

    registered = 0
    for tool_def in tools:
        tool_id = tool_def.get("id")
        if not tool_id:
            continue

        # Hand-written tools take priority
        components = mcp._local_provider._components
        if any(k.startswith(f"tool:{tool_id}") for k in components):
            continue

        try:
            schema = _build_schema(tool_def.get("fields", []))
            executor = _make_executor(tool_def)
            description = tool_def.get("skillDescription") or tool_def.get("label") or tool_id

            tool = _STUB.model_copy(update={
                "name": tool_id,
                "description": description,
                "parameters": schema,
                "fn": executor,
            })
            mcp.add_tool(tool)
            registered += 1
        except Exception as exc:
            logger.warning("[dynamic] Failed to register tool %s: %s", tool_id, exc)

    logger.info("[dynamic] Registered %d remote tools", registered)
    return registered
