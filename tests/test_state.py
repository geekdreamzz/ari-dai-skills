"""Unit tests for dai.state — SQLite auth/context/cache/history."""

import os
import time
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def tmp_db(tmp_path):
    """Redirect state DB to a temp dir for each test."""
    db_path = tmp_path / ".dai-skills" / "state.db"
    with patch("dai.state._DB_PATH", db_path):
        yield db_path


def test_auth_roundtrip():
    import dai.state as state
    state.set_credentials("dsk_test123", "http://localhost:5173")
    assert state.get_api_key() == "dsk_test123"
    assert state.get_base_url() == "http://localhost:5173"


def test_not_authenticated_error():
    import dai.state as state
    from dai.state import NotAuthenticatedError
    with pytest.raises(NotAuthenticatedError):
        state.get_api_key()


def test_is_authenticated():
    import dai.state as state
    assert not state.is_authenticated()
    state.set_credentials("dsk_x", "http://localhost")
    assert state.is_authenticated()


def test_context_set_get():
    import dai.state as state
    assert state.get_active_datasphere() is None
    state.set_active_datasphere("my-project")
    assert state.get_active_datasphere() == "my-project"


def test_cache_expiry():
    import dai.state as state
    state.cache_set("k", {"v": 1}, ttl_seconds=1)
    assert state.cache_get("k") == {"v": 1}
    time.sleep(1.1)
    assert state.cache_get("k") is None


def test_history_append():
    import dai.state as state
    state.add_history("test_action", {"key": "val"})
    h = state.get_history()
    assert len(h) == 1
    assert h[0]["action"] == "test_action"


def test_clear_credentials():
    import dai.state as state
    state.set_credentials("dsk_x", "http://localhost")
    state.clear_credentials()
    assert not state.is_authenticated()
