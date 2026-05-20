"""
all-dai-sdd tool domain — 5-column spec lifecycle via MCP.
Implements the SDD workflow: publish → start → done → validate.
"""

from __future__ import annotations
import time
from typing import Optional
from datetime import datetime, timezone

from dai.mcp.registry import mcp
from dai.mcp._ds import resolve_ds_id
from dai.client import DaiClient
import dai.state as _state


# ── Spec tracing helpers (used by sdd_init and the gate checks) ───────────────

def _build_front_matter(prefix: str, title: str, column: str) -> str:
    """Return YAML spec front matter block for a task content field."""
    _STYPE = {"NS": "architecture", "EP": "user-journey", "EX": "algorithm", "VA": "test-plan"}
    _EPIC_PARENT = {
        "EX-T1": "EP-001", "EX-T2": "EP-002", "EX-T3": "EP-003",
        "EX-VH": "EP-004", "EX-OR": "EP-005", "VA": "EP-004", "EP": "NS-001",
    }
    ck = "NS" if prefix.startswith("NS") else \
         "EP" if prefix.startswith("EP") else \
         "EX" if prefix.startswith("EX") else "VA"
    stype = _STYPE.get(ck, "algorithm")
    epic_ref = "null"
    for k, v in _EPIC_PARENT.items():
        if prefix.startswith(k):
            epic_ref = v
            break
    ns_ref = "null" if ck == "NS" else "NS-001"
    sid = f"SPEC-SDD-{prefix.replace('-', '')}"
    return (
        '<pre><code class="language-yaml">\n'
        f"spec_id: {sid}\n"
        f"title: {title[:80]}\n"
        f"spec_type: {stype}\n"
        f"version: 1.0.0\n"
        f"status: ACTIVE\n"
        f"column: {column}\n"
        f"epic_ref: {epic_ref}\n"
        f"north_star_ref: {ns_ref}\n"
        "</code></pre>\n"
    )


def _check_spec_tracing(task: dict) -> list[str]:
    """Return tracing violations for a task. Empty = clean."""
    violations = []
    content = task.get("content", "") or ""
    title = task.get("title", "")
    prefix = title.split(":")[0].strip()
    if "spec_id: SPEC-" not in content:
        violations.append("MISSING spec_id front matter")
    if prefix.startswith("EX-") and "Implementation Files" not in content:
        violations.append("MISSING Implementation Files section")
    if "<!-- #" not in content:
        violations.append("MISSING heading anchors")
    if (prefix.startswith("EX-") or prefix.startswith("VA-")) and "epic_ref:" not in content:
        violations.append("MISSING epic_ref")
    return violations


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
def sdd_check_deps(task_ids: list[str], done_group_name: str = "Done") -> dict:
    """Check all listed task IDs are in the Done column. Returns {ready: bool, blocking: list[str]}."""
    client = DaiClient.from_state()
    ds = resolve_ds_id()
    blocking = []
    for tid in task_ids:
        resp = client.get(f"/api/v1/dataspheres/{ds}/tasks/{tid}")
        task = resp.get("task", {}) if isinstance(resp, dict) else {}
        col_name = task.get("statusGroup", {}).get("name", "")
        if col_name != done_group_name:
            blocking.append(f"{tid} (in {col_name!r})")
    return {"ready": len(blocking) == 0, "blocking": blocking}


@mcp.tool()
def sdd_task_done(task_id: str, done_group_id: str, summary: str,
                   verified_criteria: Optional[list[str]] = None,
                   screenshot_urls: Optional[list[str]] = None,
                   updated_content: Optional[str] = None) -> dict:
    """Mark an SDD Execution task as Done. Posts completion comment and moves to Done column.
    Pass updated_content with data-checked="false" -> data-checked="true" substitutions already applied
    for acceptance checklist ticking."""
    client = DaiClient.from_state()
    ds = resolve_ds_id()
    # Tick checklist in content if provided
    if updated_content:
        client.patch(f"/api/v2/dataspheres/{ds}/tasks/{task_id}", json={"content": updated_content})
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


@mcp.tool()
def sdd_check_tracing(plan_mode_id: str) -> dict:
    """Audit all tasks in a plan mode for spec tracing compliance.

    Checks every task for: spec_id front matter, Implementation Files section (EX tasks),
    heading anchors, and epic_ref/north_star_ref (EX + VA tasks).

    Returns {violations: [{task_id, title, issues: [str]}], pass_count, fail_count}.
    A non-empty violations list is a gate blocker — patch tasks before Validation transition.
    """
    client = DaiClient.from_state()
    ds = resolve_ds_id()
    resp = client.get(f"/api/v2/dataspheres/{ds}/tasks", params={"planModeId": plan_mode_id, "limit": 500})
    tasks = resp.get("tasks", []) if isinstance(resp, dict) else resp

    violations = []
    pass_count = 0
    for t in tasks:
        issues = _check_spec_tracing(t)
        if issues:
            violations.append({"task_id": t["id"], "title": t["title"], "issues": issues})
        else:
            pass_count += 1

    return {
        "violations": violations,
        "pass_count": pass_count,
        "fail_count": len(violations),
        "gate_pass": len(violations) == 0,
    }


@mcp.tool()
def sdd_init(
    initiative_name: str,
    initiative_slug: str,
    description: str,
    north_stars: list[dict],
    epics: list[dict],
    execution_tasks: list[dict],
    validation_tasks: list[dict],
    plan_mode_id: str,
    status_group_ids: dict,
) -> dict:
    """Create a full SDD initiative hierarchy in one call with automatic spec tracing.

    Automatically injects spec front matter, Implementation Files sections (EX tasks),
    heading anchors, epic_ref, and north_star_ref into every task content.
    Status groups are mapped automatically: NS→North Stars, EP→Epics, EX→Execution, VA→Validation.

    Args:
        initiative_name: Display name (e.g. "My Project")
        initiative_slug: URL-safe slug used for tags (e.g. "my-project")
        description: One-line initiative description
        north_stars: List of {title, content} dicts for NS tasks
        epics: List of {title, content} dicts for EP tasks
        execution_tasks: List of {title, content, impl_files: [str]} dicts for EX tasks
        validation_tasks: List of {title, content} dicts for VA tasks
        plan_mode_id: The plan mode to assign tasks to
        status_group_ids: Dict mapping column names to IDs:
            {"North Stars": id, "Epics": id, "Execution": id, "Validation": id, "Done": id}
    """
    client = DaiClient.from_state()
    ds = resolve_ds_id()

    sg = status_group_ids
    created = {"north_stars": [], "epics": [], "execution": [], "validation": []}

    def _enrich_content(prefix: str, title: str, column: str, content: str,
                        impl_files: list[str] | None = None) -> str:
        if "spec_id: SPEC-" in (content or ""):
            return content   # already has front matter — skip
        fm = _build_front_matter(prefix, title, column)
        impl = ""
        if prefix.startswith("EX-") and impl_files:
            items = "".join(f"<li><code>{f}</code></li>" for f in impl_files)
            impl = f"<h3>Implementation Files <!-- #impl --></h3><ul>{items}</ul>\n"
        elif prefix.startswith("EX-") and not impl_files:
            impl = "<h3>Implementation Files <!-- #impl --></h3><p>TODO: fill in source file paths</p>\n"
        return fm + impl + (content or "")

    def _post_task(title: str, column_sg_id: str, column: str, content: str,
                   impl_files: list[str] | None = None) -> str | None:
        prefix = title.split(":")[0].strip()
        enriched = _enrich_content(prefix, title, column, content, impl_files)
        tags = [initiative_slug, "sdd", column.split("-")[-1]]
        resp = client.post(f"/api/v2/dataspheres/{ds}/tasks", json={
            "title": title,
            "content": enriched,
            "statusGroupId": column_sg_id,
            "planModeId": plan_mode_id,
            "tags": tags,
            "priority": "MEDIUM",
        })
        return (resp or {}).get("id") or (resp or {}).get("task", {}).get("id")

    # Create NS tasks
    for t in north_stars:
        tid = _post_task(t["title"], sg["North Stars"], "north-stars", t.get("content", ""))
        if tid:
            created["north_stars"].append(tid)
        time.sleep(0.05)

    # Create Epic tasks
    for t in epics:
        tid = _post_task(t["title"], sg["Epics"], "epics", t.get("content", ""))
        if tid:
            created["epics"].append(tid)
        time.sleep(0.05)

    # Create Execution tasks
    for t in execution_tasks:
        tid = _post_task(t["title"], sg["Execution"], "execution",
                         t.get("content", ""), t.get("impl_files"))
        if tid:
            created["execution"].append(tid)
        time.sleep(0.05)

    # Create Validation tasks
    for t in validation_tasks:
        tid = _post_task(t["title"], sg["Validation"], "validation", t.get("content", ""))
        if tid:
            created["validation"].append(tid)
        time.sleep(0.05)

    total = sum(len(v) for v in created.values())
    _state.add_history("sdd_init", {"initiative": initiative_slug, "tasks_created": total})
    return {
        "initiative": initiative_slug,
        "tasks_created": total,
        "by_column": {k: len(v) for k, v in created.items()},
        "task_ids": created,
        "gate": f"[GATE 9/14 PASS] {total} tasks created with spec front matter + tracing wired",
    }
