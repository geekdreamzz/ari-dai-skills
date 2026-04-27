"""
End-to-end smoke test: login → create page → read back → verify → delete.
Requires DATASPHERES_API_KEY and DATASPHERES_BASE_URL env vars. Skips if not set.
"""

import os
import time
import pytest

SKIP = not (os.getenv("DATASPHERES_API_KEY") and os.getenv("DATASPHERES_BASE_URL"))
skip_reason = "DATASPHERES_API_KEY / DATASPHERES_BASE_URL not set"


@pytest.fixture(scope="session")
def e2e_client():
    """Authenticated DaiClient for E2E tests."""
    if SKIP:
        pytest.skip(skip_reason)
    from dai.client import DaiClient
    return DaiClient(
        api_key=os.environ["DATASPHERES_API_KEY"],
        base_url=os.environ["DATASPHERES_BASE_URL"],
    )


@pytest.fixture(scope="session", autouse=True)
def cleanup_stale_test_dataspheres(e2e_client):
    """Delete test-e2e-* / conv-test-ds-* dataspheres left by previous runs."""
    try:
        all_ds = e2e_client.get("/api/v1/dataspheres") or []
        stale = [
            ds for ds in all_ds
            if isinstance(ds, dict) and any(
                ds.get("uri", "").startswith(prefix)
                for prefix in ("test-e2e-ds-", "conv-test-ds-", "dai-skills-smoke-ds-")
            )
        ]
        for ds in stale:
            try:
                e2e_client.delete(f"/api/v1/dataspheres/{ds['uri']}")
            except Exception:
                pass
        if stale:
            print(f"\n  Cleaned up {len(stale)} stale test datasphere(s)")
    except Exception:
        pass
    yield


@pytest.mark.skipif(SKIP, reason=skip_reason)
def test_full_smoke_flow(e2e_client, tmp_path, monkeypatch):
    """Create page → read back → assert title → delete."""
    import dai.state as state
    db_path = tmp_path / ".dai-skills" / "state.db"
    monkeypatch.setattr("dai.state._DB_PATH", db_path)

    ds_uri = os.getenv("DATASPHERES_TEST_URI", "dataspheres-ai")
    state.set_credentials(
        os.environ["DATASPHERES_API_KEY"],
        os.environ["DATASPHERES_BASE_URL"],
    )
    state.set_active_datasphere(ds_uri)

    slug = f"dai-skills-smoke-{int(time.time())}"
    page = e2e_client.post(f"/api/v1/dataspheres/{ds_uri}/pages", json={
        "slug": slug,
        "title": "dai-skills smoke test",
        "content": "<p>E2E smoke test page. Safe to delete.</p>",
        "status": "PUBLISHED",
        "isPubliclyVisible": False,
    })
    assert page["slug"] == slug
    assert "dai-skills" in page["title"]

    fetched = e2e_client.get(f"/api/v1/dataspheres/{ds_uri}/pages/{slug}")
    assert fetched["title"] == "dai-skills smoke test"

    try:
        e2e_client.delete(f"/api/v1/dataspheres/{ds_uri}/pages/{slug}")
    except Exception:
        pass
