"""Planner tool domain — tasks, plan modes, Kanban workflows."""

from __future__ import annotations
from typing import Optional, Any
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.mcp._ds import resolve_ds_id
from dai.client import DaiClient


def _slim_task(t: dict) -> dict:
    keys = ("id", "title", "status", "statusGroupId", "priority", "assigneeId", "dueDate", "tags", "planModeIds", "_url")
    return {k: t[k] for k in keys if k in t and t[k] is not None}


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
    result = client.post(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks", json=payload)
    return link(result, "task")


@mcp.tool()
def bulk_create_tasks(tasks: list[dict]) -> list:
    """Bulk create multiple tasks in one request. Each task needs title + statusGroupId."""
    client = DaiClient.from_state()
    result = client.post(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks/bulk", json={"tasks": tasks})
    items = result if isinstance(result, list) else result.get("tasks", [])
    return link(items, "task")


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
    result = client.patch(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks/{task_id}", json=payload)
    return link(result, "task")


@mcp.tool()
def delete_task(task_id: str) -> dict:
    """Delete a task by ID."""
    client = DaiClient.from_state()
    return client.delete(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks/{task_id}")


@mcp.tool()
def bulk_update_tasks(updates: list[dict]) -> list:
    """Bulk update multiple tasks. Each update dict needs 'id' plus any fields to change (statusGroupId, priority, title, etc.)."""
    client = DaiClient.from_state()
    ds_id = resolve_ds_id()
    results = []
    for upd in updates:
        task_id = upd.get("id")
        if not task_id:
            continue
        body = {k: v for k, v in upd.items() if k != "id"}
        result = client.patch(f"/api/v2/dataspheres/{ds_id}/tasks/{task_id}", json=body)
        results.append(link(result, "task"))
    return results


@mcp.tool()
def list_tasks(status_group_id: Optional[str] = None, plan_mode_id: Optional[str] = None,
               priority: Optional[str] = None, limit: int = 50, slim: bool = True) -> list:
    """List tasks with optional filters. slim=True (default) returns only key fields."""
    client = DaiClient.from_state()
    params: dict[str, Any] = {"limit": limit}
    if status_group_id:
        params["statusGroupId"] = status_group_id
    if plan_mode_id:
        params["planModeId"] = plan_mode_id
    if priority:
        params["priority"] = priority
    result = client.get(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks", params=params)
    items = result if isinstance(result, list) else result.get("tasks", result)
    link(items, "task")
    if slim:
        return [_slim_task(t) for t in items if isinstance(t, dict)]
    return items


@mcp.tool()
def list_plan_modes() -> list:
    """List all plan modes (Kanban board configurations) with their status groups."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks/plan-modes")
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
    result = client.post(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks/plan-modes", json=payload)
    return link(result, "plan_mode")


@mcp.tool()
def delete_plan_mode(plan_mode_id: str) -> dict:
    """Delete a plan mode by ID. Tasks are NOT deleted — they remain in the datasphere."""
    client = DaiClient.from_state()
    return client.delete(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks/plan-modes/{plan_mode_id}")


@mcp.tool()
def list_status_groups(plan_mode_id: Optional[str] = None) -> list:
    """List status groups (Kanban columns), optionally scoped to a plan mode."""
    client = DaiClient.from_state()
    params = {}
    if plan_mode_id:
        params["planModeId"] = plan_mode_id
    result = client.get(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks/status-groups", params=params)
    return result if isinstance(result, list) else result.get("statusGroups", [])


@mcp.tool()
def add_comment(task_id: str, content: str, screenshots: Optional[list[str]] = None) -> dict:
    """Add a comment to a task, optionally with screenshot URLs."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {"content": content}
    if screenshots:
        payload["screenshots"] = screenshots
    return client.post(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks/{task_id}/comments", json=payload)


@mcp.tool()
def search_tasks(query: str, limit: int = 20, slim: bool = True) -> list:
    """Search tasks by text. slim=True (default) returns only key fields."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v2/dataspheres/{resolve_ds_id()}/tasks/search", params={"q": query, "limit": limit})
    items = result if isinstance(result, list) else result.get("tasks", [])
    link(items, "task")
    if slim:
        return [_slim_task(t) for t in items if isinstance(t, dict)]
    return items
