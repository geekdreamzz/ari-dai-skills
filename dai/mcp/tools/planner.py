"""Planner tool domain — tasks, plan modes, Kanban workflows."""

from __future__ import annotations
from typing import Optional, Any
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.client import DaiClient
import dai.state as _state


def _ds_id() -> str:
    # v2 endpoints require the DB id, not the URI — passing the URI causes a 403.
    uri = _state.get_active_datasphere()
    if not uri:
        raise ValueError("No active datasphere. Run: dai use <uri>")
    cached = _state.cache_get(f"ds_id:{uri}")
    if cached:
        return cached
    client = DaiClient.from_state()
    result = client.get(f"/api/v1/dataspheres/{uri}")
    ds_id = result["id"]
    _state.cache_set(f"ds_id:{uri}", ds_id, ttl_seconds=3600)
    return ds_id


@mcp.tool()
def create_task(title: str, status_group_id: str, priority: str = "MEDIUM",
                content: Optional[str] = None, tags: Optional[list[str]] = None,
                assignee_id: Optional[str] = None, due_date: Optional[str] = None) -> dict:
    """Create a single task in the active datasphere."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {"title": title, "statusGroupId": status_group_id, "priority": priority}
    if content:
        payload["content"] = content
    if tags:
        payload["tags"] = tags
    if assignee_id:
        payload["assigneeId"] = assignee_id
    if due_date:
        payload["dueDate"] = due_date
    result = client.post(f"/api/v2/dataspheres/{_ds_id()}/tasks", json=payload)
    return link(result, "task")


@mcp.tool()
def bulk_create_tasks(tasks: list[dict]) -> dict:
    """Bulk create multiple tasks in one request. Each task needs title + statusGroupId."""
    client = DaiClient.from_state()
    return client.post(f"/api/v2/dataspheres/{_ds_id()}/tasks/bulk", json={"tasks": tasks})


@mcp.tool()
def update_task(task_id: str, title: Optional[str] = None, status_group_id: Optional[str] = None,
                priority: Optional[str] = None, content: Optional[str] = None) -> dict:
    """Update a task's fields."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {}
    if title:
        payload["title"] = title
    if status_group_id:
        payload["statusGroupId"] = status_group_id
    if priority:
        payload["priority"] = priority
    if content is not None:
        payload["content"] = content
    result = client.patch(f"/api/v2/dataspheres/{_ds_id()}/tasks/{task_id}", json=payload)
    return link(result, "task")


@mcp.tool()
def list_tasks(status_group_id: Optional[str] = None, plan_mode_id: Optional[str] = None,
               priority: Optional[str] = None, limit: int = 50) -> list:
    """List tasks with optional filters."""
    client = DaiClient.from_state()
    params: dict[str, Any] = {"limit": limit}
    if status_group_id:
        params["statusGroupId"] = status_group_id
    if plan_mode_id:
        params["planModeId"] = plan_mode_id
    if priority:
        params["priority"] = priority
    result = client.get(f"/api/v2/dataspheres/{_ds_id()}/tasks", params=params)
    items = result if isinstance(result, list) else result.get("tasks", result)
    return link(items, "task")


@mcp.tool()
def list_plan_modes() -> list:
    """List all plan modes (Kanban board configurations) with their status groups."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v2/dataspheres/{_ds_id()}/tasks/plan-modes")
    items = result if isinstance(result, list) else []
    return link(items, "plan_mode")


@mcp.tool()
def create_plan_mode(name: str, template: Optional[str] = None, tag_filter: Optional[list[str]] = None) -> dict:
    """Create a new plan mode. Templates: default|ops|sprint|research|sales|editorial|crm."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {"name": name}
    if template:
        payload["template"] = template
    if tag_filter:
        payload["tagFilter"] = tag_filter
    result = client.post(f"/api/v2/dataspheres/{_ds_id()}/tasks/plan-modes", json=payload)
    return link(result, "plan_mode")


@mcp.tool()
def list_status_groups(plan_mode_id: Optional[str] = None) -> list:
    """List status groups (Kanban columns), optionally scoped to a plan mode."""
    client = DaiClient.from_state()
    params = {}
    if plan_mode_id:
        params["planModeId"] = plan_mode_id
    result = client.get(f"/api/v2/dataspheres/{_ds_id()}/tasks/status-groups", params=params)
    return result if isinstance(result, list) else []


@mcp.tool()
def add_comment(task_id: str, content: str, screenshots: Optional[list[str]] = None) -> dict:
    """Add a comment to a task, optionally with screenshot URLs."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {"content": content}
    if screenshots:
        payload["screenshots"] = screenshots
    return client.post(f"/api/v2/dataspheres/{_ds_id()}/tasks/{task_id}/comments", json=payload)


@mcp.tool()
def search_tasks(query: str, limit: int = 20) -> list:
    """Search tasks by text."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v2/dataspheres/{_ds_id()}/tasks/search", params={"q": query, "limit": limit})
    items = result if isinstance(result, list) else result.get("tasks", [])
    return link(items, "task")
