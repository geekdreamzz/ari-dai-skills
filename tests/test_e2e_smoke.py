"""
End-to-end smoke test: install → login → set DS → create page → read back → verify → delete.
Requires DATASPHERES_API_KEY and DATASPHERES_BASE_URL env vars. Skips gracefully if not set.
"""

import os
import pytest

SKIP = not (os.getenv("DATASPHERES_API_KEY") and os.getenv("DATASPHERES_BASE_URL"))
skip_reason = "DATASPHERES_API_KEY / DATASPHERES_BASE_URL not set"


@pytest.mark.skipif(SKIP, reason=skip_reason)
def test_full_smoke_flow(tmp_path, monkeypatch):
    """Login → set DS → create page via client → read back → assert title → delete."""
    from pathlib import Path
    db_path = tmp_path / ".dai-skills" / "state.db"
    monkeypatch.setattr("dai.state._DB_PATH", db_path)

    import dai.state as state
    from dai.client import DaiClient

    api_key = os.environ["DATASPHERES_API_KEY"]
    base_url = os.environ["DATASPHERES_BASE_URL"]
    ds_uri = os.getenv("DATASPHERES_TEST_URI", "dataspheres-ai")

    state.set_credentials(api_key, base_url)
    state.set_active_datasphere(ds_uri)

    client = DaiClient.from_state()

    # Create a test page (use a unique slug to avoid conflicts with prior runs)
    import time as _time
    slug = f"dai-skills-smoke-{int(_time.time())}"
    page = client.post(f"/api/v1/dataspheres/{ds_uri}/pages", json={
        "slug": slug,
        "title": "dai-skills smoke test",
        "content": "<p>E2E smoke test page. Safe to delete.</p>",
        "status": "PUBLISHED",
        "isPubliclyVisible": False,
    })
    page_id = page.get("id") or page.get("slug")
    assert page["slug"] == slug, f"Expected slug {slug}, got {page.get('slug')}"
    assert "dai-skills" in page["title"]

    # Read it back
    fetched = client.get(f"/api/v1/dataspheres/{ds_uri}/pages/{slug}")
    assert fetched["title"] == "dai-skills smoke test"

    # Delete (cleanup) — use slug since that's what the API accepts
    try:
        client.delete(f"/api/v1/dataspheres/{ds_uri}/pages/{slug}")
    except Exception:
        pass  # Best-effort cleanup
