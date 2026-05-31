# Changelog

All notable changes to dai-skills are documented here.
Format: [Semantic Versioning](https://semver.org). Breaking changes are marked **BREAKING**.

---

## [Unreleased]

### Fixed
- **Default API host is now `https://dataspheres.ai` everywhere.** The repo previously pointed new users at `https://dataspheres-ai.onrender.com` (the old Render host, kept as a historical fallback) and `https://dev.dataspheres.ai` (internal dev subdomain). Both meant new installs would hit hosts the user wasn't running on, producing silent 404s or wrong-environment writes. Touched: `.env.example`, `README.md` (3 refs), `publish-arch-page.mjs`, `skills/all-dai-sdd/SKILL.md` Credential Setup section, and the 5 fallback defaults inside `sdd-conductor.mjs` (the unconfigured fallback was `http://localhost:3000`, which was always wrong — the local platform runs on `:5173` — so misconfigured users got connection-refused instead of a clear auth error against prod). Production is now the default in every code path; local dev requires an explicit `DATASPHERES_BASE_URL=http://localhost:5173` override.

- **SDD trace graph now renders end-to-end.** The platform `extractSddId()` regex was the canonical source of truth for which task-title prefixes the trace graph would recognise, but it only accepted `NS-`/`E-`/`T-`/`V-T-`. The SKILL.md examples throughout the file used `RS-`/`EP-`/`EX-`/`VA-`, so any initiative following the examples produced a spaghetti graph of orphan nodes. Three coordinated changes:
  - **SKILL.md** — Rule 1 of the Trace Graph Linking section is rewritten as a "canonical (readable) form" + "legacy short form" table so the convention is unambiguous. A new Rule 3 documents the front-matter `*_ref:` fields that drive cross-tier edges. The `tasks.yaml` shape example is converted to the canonical readable form throughout (EP-/EX-/VA-).
  - **Trace Graph — 6-Tier Layout** section replaces the prior "5-Tier" version. The Research tier was named everywhere in the protocol but had no slot in the widget; it's now first-class. Each row of the tier table lists both prefix forms.
  - **Cross-project caveat** documented for the first time: `/api/v2/code-trace?file=...` reads from the platform server's `process.cwd()`, so initiatives whose source lives in a separate repo (e.g. a desktop app hosted on the dataspheres.ai SaaS) get an empty Artifacts tier. Three workarounds called out.
- **Mock-scan false positive on `placeholder`.** `sdd-conductor.mjs` was treating every occurrence of `placeholder` in implementation files as a mock-pattern violation, including HTML attribute uses (`placeholder="Type a message…"` on a chat textarea). The pattern is tightened to require a comment marker (`//`/`/*`) or one of `code|impl|implementation|function|content` immediately after, so HTML attributes and identifier names like `setPlaceholderImage` no longer trigger the gate.

### Added
- **Runtime API-key override (`sdd-conductor` v1.2.3).** `loadEnv()` now lets `process.env` values override the same-named keys read from `~/.dataspheres.env` / repo `.env`. Lets you swap the active key per invocation without editing the file or disturbing parallel processes:
  ```bash
  # save bo's key once as a named variable in ~/.dataspheres.env
  BO_PROD_API_KEY=dsk_...
  # then per-call, run any sdd-conductor command as bo without changing the default
  DATASPHERES_API_KEY="$BO_PROD_API_KEY" DATASPHERES_BASE_URL=https://dataspheres.ai \
    node skills/sdd-conductor/sdd-conductor.mjs <cmd>
  ```
  Same convention applied to `publish-arch-page.mjs` — its `--prod` path also gained a fallback to `env.DATASPHERES_PROD_API_KEY` / `env.DATASPHERES_PROD_BASE_URL` so it works with file-based keys instead of requiring `PROD_API_KEY` to be exported.
- **`findFrontMatterRef()`** in the trace graph — pulls `research_ref:`, `execution_ref:`, etc. out of YAML front-matter blocks in task content. Used in coordinated platform updates to `TaskTraceGraphView.tsx` (separate dataspheres-ai PR).

- **macOS `git clone` no longer breaks.** `.cursorrules` and `.github/copilot-instructions.md` were stored as git symlinks whose target paths were ~12KB of markdown content, exceeding macOS's symlink-target limit and aborting checkout with `File name too long`. Replaced with a real `CLAUDE.md` at the repo root plus short relative symlinks (`.cursorrules → CLAUDE.md`, `.github/copilot-instructions.md → ../CLAUDE.md`).
- **`install.sh` preflight** no longer suggests `uv tool install dai-skills`. The `dai-skills` package was intentionally never published to PyPI (see 0.2.0 — "`dai bootstrap` and `bootstrap.sh`"), and the suggestion produced a misleading "package not found" error. Preflight now checks for Node.js, which is what `sdd-conductor` actually needs.
- **`.env.example`** now sets `DATASPHERES_BASE_URL` to the API host (`https://dataspheres-ai.onrender.com`) and adds `DATASPHERES_PUBLIC_URL` for the dashboard host. The single-variable version conflated the two and broke API calls when copied verbatim.

### Removed
- **`.mcp.json`** — stale leftover from the Python/uv/MCP layer that was ripped out in `ee7d57e`. The referenced `dai mcp start` command no longer exists.

---

## [0.2.0] — 2026-04-28

### Added
- **Dynamic tool loader** — fetches `/api/mcp/schema` from the platform at startup and registers all 77 platform tools as real FastMCP tools. New platform tools appear automatically on next MCP server start, zero code changes needed.
- **Per-tool schema cache** — SQLite `tool_schema` table with 24h TTL. Startup is instant on warm cache; network only hit on first boot or cache expiry.
- **`dai sync`** — fetches platform schema, refreshes tool cache, and auto-generates `skills/<group>/SKILL.md` for every resource group. Files marked `<!-- dai-sync: skip -->` are protected.
- **`dai update` schema refresh** — after pulling and reinstalling, `dai update` now also clears and re-fetches the tool schema cache (if authenticated).
- **Source repo registration** — `dai bootstrap` stores the clone path in `state.db` so `dai update` can find the repo after `uv tool install` relocates files to the tools cache.
- **`state.set_source_repo()` / `get_source_repo()`** — new state API for persisting the source repo path across installs.
- **Windows CI** — CI matrix now runs on both `ubuntu-latest` and `windows-latest`.
- **Outcomes-first philosophy** in CLAUDE.md — Ari is explicitly empowered to run local scripts, install dependencies, call external APIs, or do anything that gets the user to their outcome, not just call MCP tools.
- **Full capability breakdown** in CLAUDE.md — `ping()` + complete domain-by-domain tool listing triggered when users ask "what can you do?".
- **`delete_datasphere`**, **`update_datasphere`** tools added to `dataspheres.py`.
- **`delete_survey`** added to `surveys.py`.
- **Background dynamic loader** — moved to daemon thread so a slow or unreachable `/api/mcp/schema` never blocks MCP startup.
- **Rolling history cap** — `history` table capped at 500 rows to prevent unbounded growth.

### Fixed
- **P0 crash `KeyError: 'id'`** — all tool modules now use shared `resolve_ds_id()` from `dai/mcp/_ds.py` instead of a copy-pasted resolver that failed to unwrap the `{"datasphere": {...}}` response wrapper.
- **Auto-select scoring always 0** — `_auto_select_datasphere` now reads `role` at top level and `status` for visibility, matching the actual API shape.
- **Windows `UnicodeEncodeError`** on `✓` — stdout/stderr reconfigured to UTF-8 before Rich Console init.
- **`dai update` for existing clones** — reinstalls the package from local source after git pull so new CLI commands and bug fixes take effect immediately.
- **`build_url` empty query params** — `?task=` (when no id provided) is now stripped; `?task=t1` still works. Path segments still fall back to datasphere home on missing slug.
- **`dai bootstrap` and `bootstrap.sh`** — now install from local clone path (`uv tool install .`) instead of PyPI (which dai-skills is not on). Falls back to GitHub URL if running piped without a clone.
- **`set_active_datasphere`** response wrapper — now correctly unwraps `{"datasphere": {...}}`.
- **Env var bleedthrough in tests** — `tmp_db` fixture now strips all `DATASPHERES_*` env vars via `monkeypatch`, preventing 8 test failures for developers with real credentials in their shell.

### Changed
- **`planner.py` and `datasets.py` deleted** — these domains are now covered entirely by the dynamic loader using the platform schema, which has richer tool descriptions than the hand-written versions.
- **Version source of truth** — `pyproject.toml` is canonical; `dai/__init__.py` reads version via `importlib.metadata` instead of hardcoding.
- **CI test scope** — extended from `test_state.py` only to all of `tests/` (E2E excluded via `--ignore`).
- **`dai update` fallback** — replaced silent `uv tool upgrade dai-skills` (which fails, not on PyPI) with a clear error message and instructions.

### Requires
- Python ≥ 3.11
- uv ≥ 0.4.0
- fastmcp ≥ 2.0.0

---

## [0.1.0] — 2026-04-20

Initial scaffold: 12 hand-written MCP tool domains, `dai` CLI (login, status, doctor, bootstrap, update, sync), SQLite local state, `all-dai-sdd` spec-driven development skill, install/bootstrap scripts for Mac/Linux/Windows.
