"""Export tool domain — export DS content to local workspace/ directory."""

from __future__ import annotations
from pathlib import Path
from typing import Optional
from dai.mcp.registry import mcp
from dai.client import DaiClient
import dai.state as _state


def _ds() -> str:
    uri = _state.get_active_datasphere()
    if not uri:
        raise ValueError("No active datasphere. Run: dai use <uri>")
    return uri


def _ds_id() -> str:
    # v2 endpoints require the DB id, not the URI. Resolve and cache.
    uri = _ds()
    cached = _state.cache_get(f"ds_id:{uri}")
    if cached:
        return cached
    client = DaiClient.from_state()
    result = client.get(f"/api/v1/dataspheres/{uri}")
    ds_id = result["id"]
    _state.cache_set(f"ds_id:{uri}", ds_id, ttl_seconds=3600)
    return ds_id


def _workspace() -> Path:
    ws = Path.cwd() / "workspace"
    ws.mkdir(exist_ok=True)
    # Ensure workspace/ is gitignored
    gi = Path.cwd() / ".gitignore"
    if gi.exists():
        content = gi.read_text()
        if "workspace/" not in content:
            gi.write_text(content + "\nworkspace/\n")
    return ws


@mcp.tool()
def export_page(slug: str, filename: Optional[str] = None) -> dict:
    """Export a page to workspace/<filename>.md. Returns the local file path."""
    client = DaiClient.from_state()
    page = client.get(f"/api/v1/dataspheres/{_ds()}/pages/{slug}")
    ws = _workspace()
    name = filename or f"{slug}.md"
    target = ws / name
    # Convert HTML content to a simple markdown wrapper
    content = f"# {page.get('title', slug)}\n\n{page.get('content', '')}\n"
    target.write_text(content, encoding="utf-8")
    return {"path": str(target), "slug": slug, "title": page.get("title")}


@mcp.tool()
def export_tasks(plan_mode_id: Optional[str] = None, format: str = "json", filename: Optional[str] = None) -> dict:
    """Export tasks to workspace/ as JSON or CSV. Returns the local file path."""
    import json
    client = DaiClient.from_state()
    params = {"limit": 500}
    if plan_mode_id:
        params["planModeId"] = plan_mode_id
    tasks = client.get(f"/api/v2/dataspheres/{_ds_id()}/tasks", params=params)
    if not isinstance(tasks, list):
        tasks = tasks.get("tasks", [])
    ws = _workspace()
    name = filename or f"tasks.{format}"
    target = ws / name
    if format == "json":
        target.write_text(json.dumps(tasks, indent=2), encoding="utf-8")
    elif format == "csv":
        import csv
        import io
        if tasks:
            fields = list(tasks[0].keys())
            buf = io.StringIO()
            w = csv.DictWriter(buf, fieldnames=fields, extrasaction="ignore")
            w.writeheader()
            w.writerows(tasks)
            target.write_text(buf.getvalue(), encoding="utf-8")
    return {"path": str(target), "count": len(tasks), "format": format}
