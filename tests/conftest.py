"""Shared fixtures for dai-skills tests."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def tmp_db(tmp_path: Path):
    """Redirect SQLite state DB to an isolated temp dir for every test."""
    db_path = tmp_path / ".dai-skills" / "state.db"
    with patch("dai.state._DB_PATH", db_path):
        yield db_path


@pytest.fixture()
def authed_state(tmp_db):
    """Pre-populate state with credentials and an active datasphere."""
    import dai.state as state
    state.set_credentials("dsk_test_key_abc123", "http://localhost:5173")
    state.set_active_datasphere("my-ds")
    # Cache the DS id so _ds_id() doesn't make a real HTTP call
    state.cache_set("ds_id:my-ds", "ds_test_id", ttl_seconds=3600)
    return state


@pytest.fixture()
def mock_client():
    """Return a MagicMock that can stand in for DaiClient."""
    client = MagicMock()
    client.get = MagicMock(return_value={})
    client.post = MagicMock(return_value={})
    client.put = MagicMock(return_value={})
    client.patch = MagicMock(return_value={})
    client.delete = MagicMock(return_value={})
    return client
