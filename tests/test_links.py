"""Tests for dai.mcp._links — URL builder and response enrichment."""

from __future__ import annotations

from unittest.mock import patch

import pytest


# ---------------------------------------------------------------------------
# build_url
# ---------------------------------------------------------------------------

class TestBuildUrl:

    def test_page_url(self):
        from dai.mcp._links import build_url
        url = build_url("page", uri="my-ds", public_url="https://dataspheres.ai", slug="q2-update")
        assert url == "https://dataspheres.ai/app/my-ds/pages/q2-update"

    def test_page_public_url(self):
        from dai.mcp._links import build_url
        url = build_url("page_public", uri="my-ds", public_url="https://dataspheres.ai", slug="q2-update")
        assert url == "https://dataspheres.ai/pages/my-ds/q2-update"

    def test_task_url(self):
        from dai.mcp._links import build_url
        url = build_url("task", uri="my-ds", public_url="https://dataspheres.ai")
        assert url == "https://dataspheres.ai/app/my-ds/planner"

    def test_plan_mode_url_includes_mode_query(self):
        from dai.mcp._links import build_url
        url = build_url("plan_mode", uri="my-ds", public_url="https://dataspheres.ai", id="pm_abc")
        assert url == "https://dataspheres.ai/app/my-ds/planner?mode=pm_abc"

    def test_newsletter_url(self):
        from dai.mcp._links import build_url
        url = build_url("newsletter", uri="my-ds", public_url="https://dataspheres.ai", id="nl_123")
        assert url == "https://dataspheres.ai/app/my-ds/newsletters/nl_123"

    def test_survey_url(self):
        from dai.mcp._links import build_url
        url = build_url("survey", uri="my-ds", public_url="https://dataspheres.ai", id="sv_abc")
        assert url == "https://dataspheres.ai/app/my-ds/surveys/sv_abc/edit"

    def test_sequence_url(self):
        from dai.mcp._links import build_url
        url = build_url("sequence", uri="my-ds", public_url="https://dataspheres.ai", id="seq_abc")
        assert url == "https://dataspheres.ai/app/my-ds/sequences/seq_abc"

    def test_dataset_url(self):
        from dai.mcp._links import build_url
        url = build_url("dataset", uri="my-ds", public_url="https://dataspheres.ai", id="ds_xyz")
        assert url == "https://dataspheres.ai/app/my-ds/datasets/ds_xyz"

    def test_presentation_url(self):
        from dai.mcp._links import build_url
        url = build_url("presentation", uri="my-ds", public_url="https://dataspheres.ai", id="pres_1")
        assert url == "https://dataspheres.ai/app/my-ds/presentations/pres_1/edit"

    def test_datasphere_url(self):
        from dai.mcp._links import build_url
        url = build_url("datasphere", uri="my-ds", public_url="https://dataspheres.ai")
        assert url == "https://dataspheres.ai/app/my-ds"

    def test_trailing_slash_stripped_from_public_url(self):
        from dai.mcp._links import build_url
        url = build_url("datasphere", uri="my-ds", public_url="https://dataspheres.ai/")
        assert url == "https://dataspheres.ai/app/my-ds"

    def test_unknown_type_falls_back_to_datasphere_home(self):
        from dai.mcp._links import build_url
        url = build_url("unknown_type", uri="my-ds", public_url="https://dataspheres.ai")
        assert url == "https://dataspheres.ai/app/my-ds"

    def test_missing_slug_gives_partial_url(self):
        from dai.mcp._links import build_url
        # Missing slug → KeyError handled gracefully, falls back to datasphere home
        url = build_url("page", uri="my-ds", public_url="https://dataspheres.ai")
        assert url == "https://dataspheres.ai/app/my-ds"

    def test_dev_public_url(self):
        from dai.mcp._links import build_url
        url = build_url("page", uri="my-ds", public_url="https://dev.dataspheres.ai", slug="test")
        assert url == "https://dev.dataspheres.ai/app/my-ds/pages/test"


# ---------------------------------------------------------------------------
# link() — reads state for uri and public_url
# ---------------------------------------------------------------------------

class TestLink:

    def test_link_adds_url_to_dict(self, authed_state):
        from dai.mcp._links import link
        import dai.state as s
        s.set_public_url("https://dataspheres.ai")
        result = link({"id": "p1", "slug": "my-page"}, "page")
        assert "_url" in result
        assert "my-ds" in result["_url"]
        assert "my-page" in result["_url"]

    def test_link_adds_url_to_each_list_item(self, authed_state):
        from dai.mcp._links import link
        import dai.state as s
        s.set_public_url("https://dataspheres.ai")
        items = [{"id": "t1"}, {"id": "t2"}]
        result = link(items, "task")
        assert all("_url" in item for item in result)
        assert all("my-ds" in item["_url"] for item in result)

    def test_link_infers_slug_from_id(self, authed_state):
        from dai.mcp._links import link
        import dai.state as s
        s.set_public_url("https://dataspheres.ai")
        result = link({"id": "my-page-slug"}, "page")
        assert "my-page-slug" in result["_url"]

    def test_link_explicit_ids_override_inferred(self, authed_state):
        from dai.mcp._links import link
        import dai.state as s
        s.set_public_url("https://dataspheres.ai")
        result = link({"id": "wrong-slug"}, "page", slug="correct-slug")
        assert "correct-slug" in result["_url"]
        assert "wrong-slug" not in result["_url"]

    def test_link_returns_same_object(self, authed_state):
        from dai.mcp._links import link
        import dai.state as s
        s.set_public_url("https://dataspheres.ai")
        original = {"id": "x"}
        returned = link(original, "task")
        assert returned is original

    def test_link_noop_on_non_dict_items_in_list(self, authed_state):
        from dai.mcp._links import link
        import dai.state as s
        s.set_public_url("https://dataspheres.ai")
        items = ["string", None, {"id": "t1"}]
        result = link(items, "task")
        assert result[0] == "string"
        assert result[1] is None
        assert "_url" in result[2]

    def test_link_uses_public_url_from_state(self, authed_state):
        from dai.mcp._links import link
        import dai.state as s
        s.set_public_url("https://dev.dataspheres.ai")
        result = link({"id": "t1"}, "task")
        assert result["_url"].startswith("https://dev.dataspheres.ai")


# ---------------------------------------------------------------------------
# state.get_public_url fallback
# ---------------------------------------------------------------------------

class TestPublicUrlState:

    def test_falls_back_to_base_url_when_not_set(self, authed_state):
        import dai.state as s
        # authed_state sets base_url to http://localhost:5173, no public_url set
        pub = s.get_public_url()
        assert pub == "http://localhost:5173"

    def test_returns_set_public_url(self, authed_state):
        import dai.state as s
        s.set_public_url("https://dev.dataspheres.ai")
        assert s.get_public_url() == "https://dev.dataspheres.ai"

    def test_set_credentials_stores_public_url(self, tmp_db):
        import dai.state as s
        s.set_credentials("dsk_test", "http://localhost:5173", public_url="https://dev.dataspheres.ai")
        assert s.get_public_url() == "https://dev.dataspheres.ai"

    def test_set_credentials_without_public_url_falls_back(self, tmp_db):
        import dai.state as s
        s.set_credentials("dsk_test", "https://dataspheres.ai")
        assert s.get_public_url() == "https://dataspheres.ai"
