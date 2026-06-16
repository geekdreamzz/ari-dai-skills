---
name: render
description: Debug the Render-hosted production deployment directly via the Render MCP — tail service logs, inspect deploys, check service + Postgres health, read env, and correlate errors with deploy/maintenance events. Use when prod is erroring and you need real infrastructure data instead of inferring from the app's error table.
argument-hint: "logs | deploys | services | postgres | events"
disable-model-invocation: false
---

# render — Debug Render production from Claude Code

Talk to Render's control plane directly (logs, deploys, services, Postgres, metrics, env) instead of guessing from inside the app. Built after a long session of inferring prod state from the app's `ErrorLog` table — don't do that; ask Render.

## One-time setup

The Render MCP is a **hosted HTTP server** at `https://mcp.render.com/mcp`, authenticated with a Render API key.

1. Create a key: **https://dashboard.render.com/u/settings** → *API Keys* → *Create API Key*. Render keys are **broadly scoped** (every workspace + service the account can reach) — revoke when done if it was a throwaway.
2. Store it where the other Dataspheres keys live (never inline in configs/chat):
   ```bash
   echo 'RENDER_API_KEY=rnd_xxx' >> ~/.dataspheres.env
   ```
3. Register the server (the key goes into Claude Code's local config, not a committed file):
   ```bash
   source ~/.dataspheres.env
   claude mcp add --transport http render https://mcp.render.com/mcp \
     --header "Authorization: Bearer $RENDER_API_KEY"
   claude mcp list   # → render: https://mcp.render.com/mcp (HTTP) - ✓ Connected
   ```
4. **Restart the Claude Code session.** MCP tools load at session start — a server added mid-session connects but its `render_*` tools aren't callable until you restart.
5. First call each session: set the workspace — *"Set my Render workspace to <name>"* (or `render_select_workspace`). List with `render_list_workspaces`.

## What the tools give you

| Need | Tool (names may vary by MCP version) |
|------|--------------------------------------|
| Find the app/web service + its id | `render_list_services` |
| **Tail / search logs** | `render_list_logs` (filter by service, text, level, time window) |
| Recent deploys + their status/time | `render_list_deploys` / `render_get_deploy` |
| Service detail (status, plan, region) | `render_get_service` |
| Env vars on a service | `render_list_env_vars` (read; mutate only with explicit user OK) |
| Postgres instance + status | `render_list_postgres` / `render_get_postgres` |
| Metrics (CPU/mem/connections) | `render_get_metrics` |

## Debugging playbook (lessons from real incidents)

**1. Correlate errors with deploys before blaming code.** Every deploy **restarts the web service**, and each restart throws a brief connection blip (`Server has closed the connection`, in-flight queries dropped). If error timestamps cluster around `render_list_deploys` times, the "spike" is your own redeploys — *stop deploying and let it settle* before drawing conclusions.

**2. A "database in recovery mode" error is usually NOT your primary crashing.** Distinguish the two with a read-only query against the prod DB:
```sql
SELECT pg_postmaster_start_time(), now()-pg_postmaster_start_time() AS uptime, pg_is_in_recovery();
```
- Long uptime + `pg_is_in_recovery() = false` → the **primary is fine**. The error
  `FATAL: the database system is not yet accepting connections / Consistent recovery state has not been yet reached`
  comes from a **Render HA standby** transiently hit during an internal failover/maintenance — infra, not app code. A few a week is normal. Ride them out with connection-retry tolerance; you cannot fix Render's failover from app code.
- Short/changing uptime → the primary really is restarting → check the Render Postgres plan (sleeping/undersized) via `render_get_postgres` + metrics.

**3. Pool exhaustion vs. connection churn.** Check live load before changing pool size:
```sql
SELECT (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max,
       count(*) AS total,
       count(*) FILTER (WHERE state='active') AS active,
       count(*) FILTER (WHERE state='idle in transaction') AS idle_in_txn
FROM pg_stat_activity;
```
If `total` is far below `max` and `idle_in_txn` is 0, the pool size isn't the problem — look for **what holds/churns connections** (a retry path that `$disconnect()`s the shared client; interactive `$transaction()` awaiting slow non-DB work; unbounded fire-and-forget writes).

**4. Read-only diagnostics against prod are allowed; writes are not.** Use `PRODUCTION_DATABASE_URL` for `SELECT`s only. Never `UPDATE/DELETE/migrate` against prod from here.

**5. Quiet logs ≠ fixed.** The Render *log stream* shows every `console.log/warn` from background jobs and retries — it can look like "tons of errors" while the actual `ErrorLog` is near-empty. Separate **log noise** (reduce verbosity) from **real errors** (the error table / `render_list_logs` filtered to `level=error`).

## Guardrails
- Treat env-var and service mutations as outward-facing: confirm with the user first.
- The API key is account-wide — keep it in `~/.dataspheres.env`, never in a committed file or chat.
- Don't spam deploys while debugging an error rate — each deploy perturbs the very signal you're measuring.
