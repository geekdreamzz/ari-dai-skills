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
dai-skills (source of truth)  ←→  GitHub  ←→  dataspheres-ai/.claude/skills/
```

### Outbound — publishing changes you made locally

**Never edit skills in `dataspheres-ai/.claude/skills/` first.** Always:
1. Edit in `c:/Users/facel/Projects/dai-skills/skills/<skill>/`
2. `cd "c:/Users/facel/Projects/dai-skills" && git add -A && git commit && git push origin main`
3. Copy changed files back to `dataspheres-ai/.claude/skills/<skill>/`

### Inbound — pulling changes from others

When someone else pushes to this repo (or you pull new commits), run:

```bash
# 1. Pull the latest from GitHub
cd "c:/Users/facel/Projects/dai-skills" && git pull origin main

# 2. Let the conductor self-update all skill files it knows about
#    (sdd-conductor.mjs, SKILL.md, loop.mjs — fetched directly from raw.githubusercontent.com)
node "c:/Users/facel/Projects/dataspheres-ai/.claude/skills/sdd-conductor/sdd-conductor.mjs" update

# 3. For any skill files NOT covered by `update`, copy manually:
#    cp "c:/Users/facel/Projects/dai-skills/skills/<skill>/<file>" \
#       "c:/Users/facel/Projects/dataspheres-ai/.claude/skills/<skill>/<file>"
```

`node sdd-conductor.mjs update` is the canonical way to pull the latest public skills into any project — it fetches directly from GitHub so it works on any machine, not just this one.

Internal skills are only edited in `dataspheres-ai/.claude/skills/` and are never synced here.
