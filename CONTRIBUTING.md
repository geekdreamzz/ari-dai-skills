# Contributing to dai-skills

Welcome! dai-skills is the open-source AI skill library for Dataspheres AI. Contributions — new skills, bug fixes, tool improvements — are all very welcome. Every contributor is an honorary dai-hard.

## Adding a New Skill

A skill is two things: a prose SKILL.md file (the operating manual for IDE agents) and a Python tool module (the MCP implementation).

### 1. Create the skill prose file

```
skills/<skill-name>/SKILL.md
```

Use this frontmatter:
```yaml
---
name: my-skill
description: One sentence describing what this skill does
argument-hint: "[action] [options]"
---
```

### 2. Create the tool module

```python
# dai/mcp/tools/my_skill.py
from dai.mcp.registry import mcp
from dai.client import DaiClient
import dai.state as _state

@mcp.tool()
def my_tool(param: str) -> dict:
    """Tool description shown to IDE agents."""
    client = DaiClient.from_state()
    # ... implementation
```

### 3. Register in server.py

```python
import dai.mcp.tools.my_skill  # noqa: F401
```

### 4. Write tests

Add at least one happy-path test in `tests/test_tools.py`.

### 5. Open a PR

Use the PR template. CI must pass before merge.

## Code Style

- Python 3.11+
- `ruff` for linting (`uv run ruff check .`)
- `mypy` for type checking (`uv run mypy dai/`)
- No mocks in tests — test against real endpoints (use `skipif` guards)

## Running Tests

```bash
# Unit tests only (no API required)
uv run pytest tests/test_state.py -v

# E2E smoke test (requires dev server)
DATASPHERES_API_KEY=dsk_xxx DATASPHERES_BASE_URL=http://localhost:5173 \
  uv run pytest tests/test_e2e_smoke.py -v
```

## License

MIT. By contributing, you agree your code will be released under the same license.
