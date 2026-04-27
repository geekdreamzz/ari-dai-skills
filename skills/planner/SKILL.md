<!-- dai-sync: skip -->
---
name: planner
description: Manage Kanban tasks, plan modes, and project workflows in Dataspheres AI
argument-hint: "[action] [options]"
---

# planner — Dataspheres AI Kanban & Task Management

The dai planner skill lets you manage tasks, columns, and board configurations — all dai, every dai.

## Core Workflows

### Create a task
```
create_task(title="Fix auth bug", status_group_id="<id>", priority="HIGH", tags=["backend"])
```

### Bulk create tasks
```
bulk_create_tasks(tasks=[
  {"title": "Task 1", "statusGroupId": "<id>", "priority": "HIGH"},
  {"title": "Task 2", "statusGroupId": "<id>", "priority": "MEDIUM"},
])
```

### List tasks
```
list_tasks(plan_mode_id="<id>", limit=50)
```

### Update a task
```
update_task(task_id="<id>", status_group_id="<done-group-id>")
```

### Search tasks
```
search_tasks(query="auth bug")
```

### List plan modes (boards)
```
list_plan_modes()
```

### Create a plan mode with template
Templates: `default` | `ops` | `sprint` | `research` | `sales` | `editorial` | `crm`
```
create_plan_mode(name="Sprint Q2", template="sprint", tag_filter=["q2", "sprint"])
```

### Create a plan mode with custom columns + tag filter
`tag_filter` scopes which tasks appear in this board. Infer it from the name automatically.
`columns` overrides `template` when both are provided.
```
create_plan_mode(name="Wedding Planning", tag_filter=["wedding"], columns=[
  {"name": "Ideas & Vision", "color": "#8B5CF6", "isDoneState": false},
  {"name": "To Book / Confirm", "color": "#F59E0B", "isDoneState": false},
  {"name": "In Progress", "color": "#3B82F6", "isDoneState": false},
  {"name": "Vendor Confirmed", "color": "#22C55E", "isDoneState": false},
  {"name": "Done", "color": "#6B7280", "isDoneState": true},
])
```

### Update a plan mode (rename, tag filter, or replace/append columns)
`tag_filter` and `columns` are full replacements. `add_columns` is append-only.
**Always call `list_plan_modes` first before using `columns`** — omitted columns are deleted
and their tasks remapped to column[0] of the new list.
```
update_plan_mode(mode_id="<id>", name="New Name")
update_plan_mode(mode_id="<id>", tag_filter=["wedding"])

# Full column replace (read current first, include everything you want to keep)
update_plan_mode(mode_id="<id>", columns=[
  {"name": "Ideas & Vision", "color": "#8B5CF6", "isDoneState": false},
  {"name": "To Book / Confirm", "color": "#F59E0B", "isDoneState": false},
  {"name": "In Progress", "color": "#3B82F6", "isDoneState": false},
  {"name": "Vendor Confirmed", "color": "#22C55E", "isDoneState": false},
  {"name": "Signed & Done", "color": "#6B7280", "isDoneState": true},
])

# Append-only — safe without reading first
update_plan_mode(mode_id="<id>", add_columns=[
  {"name": "Awaiting Review", "color": "#F59E0B", "isDoneState": false},
])
```

### Add a single column to an existing plan mode
```
create_status_group(name="Blocked", color="#EF4444", plan_mode_id="<id>", is_done_state=false)
```

### List columns (status groups)
```
list_status_groups(plan_mode_id="<id>")
```

### Add a comment to a task
```
add_comment(task_id="<id>", content="Done — tested on staging ✅")
```

## Priority Values
`HIGH` | `MEDIUM` | `LOW`

## SDD Integration
For spec-driven development with the 5-column lifecycle (North Stars → Epics → Execution → Validation → Done), use the `all-dai-sdd` skill which wraps the planner with the full lifecycle protocol.

## Error Patterns
- "No active datasphere" → run `dai use <uri>`
- 404 on task_id → task was deleted or wrong datasphere
