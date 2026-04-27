"""
Local SQLite state: auth credentials, active datasphere context, cache, history.
All mutable local state lives here. Never use flat dotfiles.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

_DB_PATH = Path.home() / ".dai-skills" / "state.db"


class NotAuthenticatedError(Exception):
    pass


def _conn() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(_DB_PATH))
    con.row_factory = sqlite3.Row
    _ensure_schema(con)
    return con


def _ensure_schema(con: sqlite3.Connection) -> None:
    con.executescript("""
        CREATE TABLE IF NOT EXISTS auth (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS context (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cache (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            expires_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            result TEXT,
            ts REAL NOT NULL
        );
    """)
    con.commit()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def set_credentials(api_key: str, base_url: str, public_url: str | None = None) -> None:
    with _conn() as con:
        con.execute("INSERT OR REPLACE INTO auth VALUES ('api_key', ?)", (api_key,))
        con.execute("INSERT OR REPLACE INTO auth VALUES ('base_url', ?)", (base_url,))
        if public_url:
            con.execute("INSERT OR REPLACE INTO auth VALUES ('public_url', ?)", (public_url,))


def get_api_key() -> str:
    # Env var takes priority — lets Claude Code MCP config work without `dai login`.
    env = os.getenv("DATASPHERES_API_KEY")
    if env:
        return env
    with _conn() as con:
        row = con.execute("SELECT value FROM auth WHERE key='api_key'").fetchone()
    if not row:
        raise NotAuthenticatedError("Not authenticated. Set DATASPHERES_API_KEY env var or run: dai login --key dsk_xxx")
    return row["value"]


def get_base_url() -> str:
    env = os.getenv("DATASPHERES_BASE_URL")
    if env:
        return env.rstrip("/")
    with _conn() as con:
        row = con.execute("SELECT value FROM auth WHERE key='base_url'").fetchone()
    return row["value"] if row else "https://dataspheres.ai"


def get_public_url() -> str:
    """Public-facing base URL for UI links (may differ from base_url in local dev)."""
    env = os.getenv("DATASPHERES_PUBLIC_URL")
    if env:
        return env.rstrip("/")
    with _conn() as con:
        row = con.execute("SELECT value FROM auth WHERE key='public_url'").fetchone()
    return row["value"] if row else get_base_url()


def get_mode() -> str:
    """Return 'local' when base_url points at localhost/127.0.0.1, else 'remote'."""
    url = get_base_url()
    if "localhost" in url or "127.0.0.1" in url or "::1" in url:
        return "local"
    return "remote"


def set_public_url(url: str) -> None:
    with _conn() as con:
        con.execute("INSERT OR REPLACE INTO auth VALUES ('public_url', ?)", (url,))


def clear_credentials() -> None:
    with _conn() as con:
        con.execute("DELETE FROM auth")


def is_authenticated() -> bool:
    try:
        get_api_key()
        return True
    except NotAuthenticatedError:
        return False


# ---------------------------------------------------------------------------
# Context (active datasphere)
# ---------------------------------------------------------------------------

def set_active_datasphere(uri: str) -> None:
    with _conn() as con:
        con.execute("INSERT OR REPLACE INTO context VALUES ('active_ds', ?)", (uri,))


def get_active_datasphere() -> str | None:
    # Env var lets Claude Code MCP users skip `dai use <uri>`.
    env = os.getenv("DATASPHERES_DEFAULT_URI")
    if env:
        return env
    with _conn() as con:
        row = con.execute("SELECT value FROM context WHERE key='active_ds'").fetchone()
    return row["value"] if row else None


def clear_context() -> None:
    with _conn() as con:
        con.execute("DELETE FROM context")


# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------

def cache_set(key: str, value: Any, ttl_seconds: int = 300) -> None:
    with _conn() as con:
        con.execute(
            "INSERT OR REPLACE INTO cache VALUES (?, ?, ?)",
            (key, json.dumps(value), time.time() + ttl_seconds),
        )


def cache_get(key: str) -> Any | None:
    with _conn() as con:
        row = con.execute(
            "SELECT value, expires_at FROM cache WHERE key=?", (key,)
        ).fetchone()
    if not row or row["expires_at"] < time.time():
        return None
    return json.loads(row["value"])


def cache_clear() -> None:
    with _conn() as con:
        con.execute("DELETE FROM cache WHERE expires_at < ?", (time.time(),))


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

def add_history(action: str, result: Any = None) -> None:
    with _conn() as con:
        con.execute(
            "INSERT INTO history (action, result, ts) VALUES (?, ?, ?)",
            (action, json.dumps(result) if result else None, time.time()),
        )
        # Rolling cap — keep only the 500 most recent entries to prevent unbounded growth
        con.execute(
            "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY ts DESC LIMIT 500)"
        )


def get_history(limit: int = 20) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT action, result, ts FROM history ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]
