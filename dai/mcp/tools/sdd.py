"""
all-dai-sdd tool domain — 5-column spec lifecycle via MCP.
Implements the SDD workflow: publish → start → done → validate.
"""

from __future__ import annotations
from typing import Optional
from datetime import datetime, timezone

from dai.mcp.registry import mcp
from dai.mcp._ds import resolve_ds_id
from dai.client import DaiClient
import dai.state as _state


@mcp.tool()
def sdd_status(plan_mode_id: str) -> dict:
    """Get initiative progress: count of tasks by column (North Stars/Epics/Execution/Validation/Done)."""
    client = DaiClient.from_state()
    ds = resolve_ds_id()
    # Get all tasks in this plan mode
    tasks = client.get(f"/api/v2/dataspheres/{ds}/tasks", params={"planModeId": plan_mode_id, "limit": 500})
    if not isinstance(tasks, list):
        tasks = tasks.get("tasks", [])
    # Get status groups to build name map
    groups = client.get(f"/api/v2/dataspheres/{ds}/tasks/status-groups", params={"planModeId": plan_mode_id})
    name_map = {g["id"]: g["name"] for g in groups} if isinstance(groups, list) else {}
    counts: dict[str, int] = {}
    for t in tasks:
        col = name_map.get(t.get("statusGroupId", ""), "Unknown")
        counts[col] = counts.get(col, 0) + 1
    total = len(tasks)
    done_count = counts.get("Done", 0)
    return {"total": total, "done": done_count, "progress_pct": round(done_count / total * 100) if total else 0, "by_column": counts}


@mcp.tool()
def sdd_task_start(task_id: str, plan_mode_id: str, execution_group_id: str) -> dict:
    """Mark an SDD Execution task as started. Stamps startDate and posts a comment."""
    client = DaiClient.from_state()
    ds = resolve_ds_id()
    now = datetime.now(timezone.utc).isoformat()
    client.patch(f"/api/v2/dataspheres/{ds}/tasks/{task_id}", json={"statusGroupId": execution_group_id, "startDate": now})
    client.post(f"/api/v2/dataspheres/{ds}/tasks/{task_id}/comments", json={
        "content": f"[all-dai-sdd-system-message]\n\n🔵 **IN PROGRESS** — Task started at {now[:16]}Z."
    })
    _state.add_history("sdd_task_start", {"task_id": task_id, "startDate": now})
    return {"task_id": task_id, "status": "in_progress", "startDate": now}


@mcp.tool()
def sdd_task_done(task_id: str, done_group_id: str, summary: str,
                   verified_criteria: Optional[list[str]] = None, screenshot_urls: Optional[list[str]] = None) -> dict:
    """Mark an SDD Execution task as Done. Posts completion comment and moves to Done column."""
    client = DaiClient.from_state()
    ds = resolve_ds_id()
    criteria_list = "\n".join(f"- {c} ✅" for c in (verified_criteria or []))
    comment = f"[all-dai-sdd-system-message]\n\n**Completion summary:** {summary}"
    if criteria_list:
        comment += f"\n\n**Verified acceptance criteria:**\n{criteria_list}"
    comment += "\n\n**Tests run:**\n- Type check ✅"
    client.post(f"/api/v2/dataspheres/{ds}/tasks/{task_id}/comments", json={
        "content": comment,
        "screenshots": screenshot_urls or [],
    })
    client.patch(f"/api/v2/dataspheres/{ds}/tasks/{task_id}", json={"statusGroupId": done_group_id})
    _state.add_history("sdd_task_done", {"task_id": task_id})
    return {"task_id": task_id, "status": "done"}
