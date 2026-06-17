---
name: principles
description: Coding principles, completion standards, file headers, and the dai-skills motto. Read before writing any code or marking any task done.
argument-hint: ""
---

# principles — dai-skills Engineering Standards

> **"TEST ALL CHANGES. NEVER STUB OR MOCK DATA.**
> **If I stub/mock, I MUST add a TODO comment to fix it IMMEDIATELY.**
> **I MUST run tests before marking done.**
> **NOTHING is done until it's TESTED and DOCUMENTED.**
> **A FILE IS NOT A FEATURE. A SCHEMA IS NOT A FEATURE.**
> **DONE means: code exists + imported + called + tested + verified.**
> **If it's not wired end-to-end, it's NOT DONE."**

---

## 1. Never Stub

**No stubs. No mock data. No placeholder implementations.**

If a real implementation isn't possible right now, add a TODO — not a fake one:

```python
# TODO: IMPLEMENT — create_question() when surveys v2 adds question management [task: T-XXX]
# Currently: raises NotImplementedError
raise NotImplementedError("Survey question management not yet available in API")
```

The `[task: T-XXX]` must reference a real task in the planner. No orphan TODOs.

If you discover that an API endpoint doesn't exist, **do not fabricate one**. Instead:
1. Remove the tool or mark it with `NotImplementedError`
2. Update the SKILL.md to document the limitation
3. File a task to add the endpoint

### The stub-and-stamp anti-pattern (what caused the original SKILL.md problem)

Writing a file that exists but contains no real content, then marking the task "done" because the file exists. This is the exact failure mode the motto prohibits. A SKILL.md with only "Quick Start + error patterns" is a stub, not documentation.

---

## 2. Completion Criteria

Before marking any task DONE:

| Check | Requirement |
|-------|-------------|
| Code exists | The implementation is written |
| Wired | The tool is registered and callable via MCP |
| Tested | At least one test covers the happy path |
| Verified | A real API call confirms the endpoint works |
| Documented | The SKILL.md reflects what the tool actually does |

If any answer is NO → it's not DONE.

**Labels for honest tracking:**

| Label | Meaning |
|-------|---------|
| DONE | All 5 checks above pass |
| FILE ONLY | Module exists but no tool registered |
| STUB | Tool registered but returns fake/empty data |
| UNTESTED | Implementation exists but no test coverage |
| UNDOCUMENTED | Tool works but SKILL.md not updated |

---

## 3. File Front Matter

Every Python tool file must start with a module docstring:

```python
"""<Domain> tool domain — <one-line description of what these tools do>."""
```

Every SKILL.md must start with YAML frontmatter:

```yaml
---
name: <skill-name>
description: <one sentence — what this skill enables, grounded in real capabilities>
argument-hint: "[action] [options]"
---
```

The `description` field is what appears in tool listings and MCP capability summaries. It must describe what the tools **actually do**, not what you hope they'll do someday.

---

## 4. Code Commenting Rules

- **No inline comments unless the WHY is non-obvious.** Well-named identifiers are self-documenting.
- **Do** comment hidden constraints, API gotchas, or workarounds for specific behavior:

```python
def _ds_id() -> str:
    # v2 endpoints require the DB id, not the URI — passing the URI causes a 403
    # because membership is stored by datasphereId not uri.
    ...
```

- **Don't** comment what the code does — only why it does it that way.
- **Don't** add docstrings that repeat the function signature in prose.

---

## 5. API Endpoint Verification

Before writing any tool that calls an API endpoint:

1. **Find the route file** in `src/server/routes/` or `src/server/v2/routes/`
2. **Confirm the mount point** from `src/server/index.ts` or the v2 router
3. **Verify the body shape** from the controller
4. **Check URI vs DB ID**: v1 endpoints use URI; v2 endpoints use DB ID

The correct helper:
- `_ds()` → URI (for `/api/v1/dataspheres/:uri/...`)
- `_ds_id()` → DB ID (for `/api/v2/dataspheres/:dsId/...`)

Calling a v2 endpoint with a URI causes 403 "Moderator access required" — the membership lookup uses DB ID, not URI.

---

## 6. Test Coverage

Every new tool function must have at minimum:

1. **Happy path test** — correct call with mocked `DaiClient`, verifies URL + body
2. **Error path test** — tool raises `ValueError` or propagates `ApiError` correctly
3. **State test** — if the tool reads `_ds()` or `_ds_id()`, test the "no active datasphere" case

Run tests before marking any tool task done:

```bash
cd /path/to/dai-skills
python -m pytest tests/ -v
```

All tests must pass. No skipped tests without documented reason.

---

## 7. SKILL.md Requirements

A SKILL.md is only complete when it contains:

- [ ] A real workflow section showing actual tool calls with realistic arguments
- [ ] The correct API endpoint table (verified against the route files)
- [ ] Any critical gotchas (URI vs DB ID, missing endpoints, SSE limitations)
- [ ] Error patterns for the 3 most common failure modes

A SKILL.md that only has "Quick Start + error patterns" is a stub. Stubs are not done.

---

## 8. The dai Brand Motto

Recite before marking any task complete:

> **all dai. work all dai. ship all dai.**

This means: if it's not shipping — tested, wired, documented, and the user can see it work — it's not done. "all dai" is not an aspiration. It's a standard.
