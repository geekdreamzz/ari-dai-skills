# Skill Registry — ari-dai-skills

This file is the authoritative list of which skills belong in this public repo and which are internal-only.

## Rule: Public vs Internal

| Criterion | Public | Internal |
|-----------|--------|----------|
| Useful to any Dataspheres AI user | ✓ | |
| Contains credentials, passwords, or tokens | | ✗ |
| References specific machine paths | | ✗ |
| Contains proprietary business operations | | ✗ |
| References internal Docker/DB setup | | ✗ |
| References internal brand/company names not public | | ✗ |

Every skill in `skills/` must have a `skill.json` with `"visibility": "public"`.
**Never commit a skill without a `skill.json`.** The pre-commit hook enforces this.

## Internal Skills (never commit here)

These live only in `dataspheres-ai/.claude/skills/` and are NOT pushed to this repo:

| Skill | Reason |
|-------|--------|
| `db-ops` | Docker container names, DB passwords, internal commands |
| `tunnel` | Machine-specific Cloudflare tunnel IDs and credential paths |
| `ops` | Business operations — prospect outreach, revenue triage, grants |
| `schema-drift` | Internal DB migration protocol using private container setup |
| `cold-start` | Internal datasphere seeding with API keys and bot credentials |
| `workspace-router` | Hardcoded local machine paths (`/Users/bunnarithbao/ship/`) |
| `motto` | Internal project-culture enforcement rules |

## Sync Workflow

```
dai-skills (source of truth)  →  push to GitHub  →  copy to dataspheres-ai/.claude/skills/
```

**Never edit skills in `dataspheres-ai/.claude/skills/` first.** Always:
1. Edit in `c:/Users/facel/Projects/dai-skills/skills/<skill>/`
2. `cd "c:/Users/facel/Projects/dai-skills" && git add -A && git commit && git push origin main`
3. Copy changed files back to `dataspheres-ai/.claude/skills/<skill>/`

Internal skills are only edited in `dataspheres-ai/.claude/skills/` and are never synced here.
