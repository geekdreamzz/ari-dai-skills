## Summary

<!-- What does this PR do? -->

## Checklist

- [ ] New skill has `skills/<name>/SKILL.md` with correct frontmatter
- [ ] New tool module in `dai/mcp/tools/<name>.py` with `@mcp.tool()` decorators
- [ ] Registered in `dai/mcp/server.py`
- [ ] At least one test added
- [ ] `uv run ruff check .` passes
- [ ] `uv run pytest tests/test_state.py` passes
- [ ] README skills table updated if new skill added
