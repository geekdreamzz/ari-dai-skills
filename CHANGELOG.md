# Changelog

All notable changes to dai-skills are documented here.
Format: [Semantic Versioning](https://semver.org). Breaking changes are marked **BREAKING**.

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
