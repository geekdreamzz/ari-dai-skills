---
name: principles
description: Coding principles, completion standards, file headers, and the dai-skills motto. Read before writing any code or marking any task done.
argument-hint: ""
---

# principles — dai-skills Engineering Standards

> **"TEST ALL CHANGES. NEVER STUB OR MOCK DATA.**
> **I MUST run tests before marking done.**
> **NOTHING is done until it's TESTED and DOCUMENTED.**
> **A FILE IS NOT A FEATURE. A SCHEMA IS NOT A FEATURE.**
> **DONE means: code exists + imported + called + tested + verified.**
> **If it's not wired end-to-end, it's NOT DONE."**

---

## 1. Never Stub

**No stubs. No mock data. No placeholder implementations.**

If a platform capability does not exist, document that limitation instead of fabricating a tool or endpoint:

```markdown
> Not available: question management is not present in the current platform schema.
> Tracking: T-XXX
```

The `[task: T-XXX]` must reference a real task in the planner. No orphan TODOs.

If you discover that an API endpoint doesn't exist, **do not fabricate one**. Instead:
1. Remove the claimed operation
2. Update the SKILL.md to document the limitation
3. File a platform task to add the endpoint

### The stub-and-stamp anti-pattern (what caused the original SKILL.md problem)

Writing a file that exists but contains no real content, then marking the task "done" because the file exists. This is the exact failure mode the motto prohibits. A SKILL.md with only "Quick Start + error patterns" is a stub, not documentation.

---

## 2. Completion Criteria

Before marking any task DONE:

| Check | Requirement |
|-------|-------------|
| Capability exists | The hosted platform implements the documented operation |
| Wired | The skill points to the real tool or REST endpoint |
| Tested | Executable helpers pass syntax and behavior checks |
| Verified | The live schema, developer reference, or a safe API call confirms the contract |
| Documented | The SKILL.md reflects what the tool actually does |

If any answer is NO → it's not DONE.

**Labels for honest tracking:**

| Label | Meaning |
|-------|---------|
| DONE | All 5 checks above pass |
| DOC ONLY | Documentation exists but the platform capability is absent |
| STUB | Claimed workflow returns fake or placeholder data |
| UNTESTED | Implementation exists but no test coverage |
| UNDOCUMENTED | Tool works but SKILL.md not updated |

---

## 3. Skill Structure

Every SKILL.md must start with YAML frontmatter:

```yaml
---
name: <skill-name>
description: <one sentence — what this skill enables, grounded in real capabilities>
argument-hint: "[action] [options]"
---
```

Every public skill must also contain `skill.json`:

```json
{
  "visibility": "public",
  "repo": "github.com/geekdreamzz/ari-dai-skills"
}
```

The `description` field appears in agent skill listings. It must describe what the hosted platform or shipped helper **actually does**, not what you hope it will do someday.

---

## 4. Code Commenting Rules

- **No inline comments unless the WHY is non-obvious.** Well-named identifiers are self-documenting.
- **Do** comment hidden constraints, API gotchas, or workarounds for specific behavior:

```javascript
// v2 membership is keyed by the database ID, so a datasphere URI is invalid here.
const path = `/api/v2/dataspheres/${datasphereId}/tasks`;
```

- **Don't** comment what the code does — only why it does it that way.
- **Don't** add docstrings that repeat the function signature in prose.

---

## 5. Platform Contract Verification

Before documenting a platform operation:

1. **Find the operation** in `/api/mcp/schema` or the developer reference
2. **Confirm the HTTP method and complete path**
3. **Verify request fields, response shape, role requirements, and side effects**
4. **Check URI vs DB ID**: v1 endpoints use URI; v2 endpoints use DB ID
5. **Use a safe read request** when documentation and schema disagree

Calling a v2 endpoint with a URI causes 403 "Moderator access required" — the membership lookup uses DB ID, not URI.

---

## 6. Validation

Every changed skill must be checked for:

1. **Happy path** — the documented fields and endpoint match the platform contract
2. **Error path** — common authentication, authorization, and missing-resource failures have actionable guidance
3. **Context** — the workflow says how to resolve its datasphere URI or database ID
4. **Installer** — the skill installs into a temporary project

For executable JavaScript, run:

```bash
node --check path/to/script.mjs
```

For shell helpers, run `bash -n`. CI performs these checks for every tracked script and smoke-tests `install.sh`.

---

## 7. SKILL.md Requirements

A SKILL.md is only complete when it contains:

- [ ] A real workflow section showing actual tool or REST calls with realistic arguments
- [ ] The correct API endpoint table (verified against the live schema or developer reference)
- [ ] Any critical gotchas (URI vs DB ID, missing endpoints, SSE limitations)
- [ ] Error patterns for the 3 most common failure modes

A SKILL.md that only has "Quick Start + error patterns" is a stub. Stubs are not done.

---

## 8. The dai Brand Motto

Recite before marking any task complete:

> **all dai. work all dai. ship all dai.**

This means: if it's not shipping — tested, wired, documented, and the user can see it work — it's not done. "all dai" is not an aspiration. It's a standard.
