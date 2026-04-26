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
create_plan_mode(name="Sprint Q2", template="sprint", tag_filter=["q2"])
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
