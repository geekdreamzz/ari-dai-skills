"""Unit tests for all 14 MCP tool domains.

All tests use mocked DaiClient and state — no real HTTP calls.
The authed_state fixture (from conftest.py) pre-seeds credentials + active DS + DS id cache.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _patch_client(module_path: str, mock_client: MagicMock):
    """Patch DaiClient.from_state in the given module to return mock_client."""
    return patch(f"{module_path}.DaiClient.from_state", return_value=mock_client)


# ---------------------------------------------------------------------------
# pages
# ---------------------------------------------------------------------------

class TestPages:
    MODULE = "dai.mcp.tools.pages"

    def test_create_page(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "p1", "slug": "my-page", "title": "My Page"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.pages import create_page
            result = create_page("My Page", "<p>hello</p>", slug="my-page")
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert "/api/v1/dataspheres/my-ds/pages" in call_args[0][0]
        assert call_args[1]["json"]["title"] == "My Page"
        assert result["slug"] == "my-page"

    def test_create_page_with_folder(self, authed_state, mock_client):
        mock_client.post.return_value = {"slug": "s", "folderName": "Docs"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.pages import create_page
            create_page("T", "C", folder="Docs")
        payload = mock_client.post.call_args[1]["json"]
        assert payload["folderName"] == "Docs"

    def test_get_page(self, authed_state, mock_client):
        mock_client.get.return_value = {"slug": "test", "title": "Test"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.pages import get_page
            result = get_page("test")
        mock_client.get.assert_called_once_with("/api/v1/dataspheres/my-ds/pages/test")
        assert result["title"] == "Test"

    def test_update_page_partial(self, authed_state, mock_client):
        mock_client.put.return_value = {"slug": "test", "title": "New Title"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.pages import update_page
            update_page("test", title="New Title")
        payload = mock_client.put.call_args[1]["json"]
        assert payload == {"title": "New Title"}
        assert "content" not in payload

    def test_delete_page(self, authed_state, mock_client):
        mock_client.delete.return_value = None
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.pages import delete_page
            delete_page("test")
        mock_client.delete.assert_called_once_with("/api/v1/dataspheres/my-ds/pages/test")

    def test_list_pages_returns_list(self, authed_state, mock_client):
        mock_client.get.return_value = [{"slug": "a"}, {"slug": "b"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.pages import list_pages
            result = list_pages()
        assert isinstance(result, list)
        assert len(result) == 2

    def test_list_pages_unwraps_dict(self, authed_state, mock_client):
        mock_client.get.return_value = {"pages": [{"slug": "x"}], "total": 1}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.pages import list_pages
            result = list_pages()
        assert len(result) == 1
        assert result[0]["slug"] == "x"
        assert "_url" in result[0]

    def test_no_active_ds_raises(self, tmp_db):
        import dai.state as state
        state.set_credentials("k", "http://localhost")
        # No active datasphere set
        from dai.mcp.tools.pages import create_page
        with pytest.raises(ValueError, match="No active datasphere"):
            create_page("T", "C")


# ---------------------------------------------------------------------------
# planner
# ---------------------------------------------------------------------------

class TestPlanner:
    MODULE = "dai.mcp.tools.planner"

    def test_ds_id_uses_cache(self, authed_state):
        # authed_state pre-seeds ds_id:my-ds → ds_test_id
        with patch("dai.mcp.tools.planner.DaiClient.from_state") as mock_factory:
            mock_cl = MagicMock()
            mock_factory.return_value = mock_cl
            mock_cl.get.return_value = []  # list_plan_modes return
            from dai.mcp.tools.planner import list_plan_modes
            list_plan_modes()
        # DS id should come from cache, not from an API call to /api/v1/dataspheres/my-ds
        for c in mock_cl.get.call_args_list:
            assert "/api/v1/dataspheres/my-ds" not in str(c)

    def test_ds_id_fetches_when_not_cached(self, tmp_db):
        import dai.state as state
        state.set_credentials("k", "http://localhost")
        state.set_active_datasphere("fresh-ds")
        # No cache entry for fresh-ds
        with patch("dai.mcp.tools.planner.DaiClient.from_state") as mock_factory:
            mock_cl = MagicMock()
            mock_factory.return_value = mock_cl
            mock_cl.get.side_effect = [
                {"id": "ds_fresh_id"},   # /api/v1/dataspheres/fresh-ds
                [],                       # list_plan_modes call
            ]
            from dai.mcp.tools.planner import list_plan_modes
            list_plan_modes()
        # First call must be to resolve the DS id
        first_call = mock_cl.get.call_args_list[0]
        assert "/api/v1/dataspheres/fresh-ds" in first_call[0][0]

    def test_create_task(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "t1", "title": "My task"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.planner import create_task
            result = create_task("My task", "group_abc", priority="HIGH")
        payload = mock_client.post.call_args[1]["json"]
        assert payload["title"] == "My task"
        assert payload["statusGroupId"] == "group_abc"
        assert payload["priority"] == "HIGH"
        assert "ds_test_id" in mock_client.post.call_args[0][0]

    def test_bulk_create_tasks(self, authed_state, mock_client):
        mock_client.post.return_value = {"created": 2}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.planner import bulk_create_tasks
            tasks = [{"title": "A", "statusGroupId": "g1"}, {"title": "B", "statusGroupId": "g1"}]
            result = bulk_create_tasks(tasks)
        payload = mock_client.post.call_args[1]["json"]
        assert payload == {"tasks": tasks}

    def test_update_task_only_sends_provided_fields(self, authed_state, mock_client):
        mock_client.patch.return_value = {"id": "t1"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.planner import update_task
            update_task("t1", status_group_id="done_group")
        payload = mock_client.patch.call_args[1]["json"]
        assert payload == {"statusGroupId": "done_group"}
        assert "title" not in payload

    def test_list_tasks_with_filters(self, authed_state, mock_client):
        mock_client.get.return_value = {"tasks": [{"id": "t1"}]}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.planner import list_tasks
            result = list_tasks(priority="HIGH", limit=10)
        params = mock_client.get.call_args[1]["params"]
        assert params["priority"] == "HIGH"
        assert params["limit"] == 10
        assert result[0]["id"] == "t1"
        assert "_url" in result[0]

    def test_add_comment_with_screenshots(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "c1"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.planner import add_comment
            add_comment("t1", "Great work!", screenshots=["https://example.com/shot.png"])
        payload = mock_client.post.call_args[1]["json"]
        assert payload["content"] == "Great work!"
        assert payload["screenshots"] == ["https://example.com/shot.png"]

    def test_search_tasks(self, authed_state, mock_client):
        mock_client.get.return_value = {"tasks": [{"id": "t1", "title": "Auth bug"}]}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.planner import search_tasks
            result = search_tasks("auth", limit=5)
        params = mock_client.get.call_args[1]["params"]
        assert params["q"] == "auth"
        assert params["limit"] == 5
        assert result[0]["id"] == "t1"
        assert result[0]["title"] == "Auth bug"
        assert "_url" in result[0]


# ---------------------------------------------------------------------------
# ai
# ---------------------------------------------------------------------------

class TestAi:
    MODULE = "dai.mcp.tools.ai"

    def test_draft_content_hits_background_endpoint(self, authed_state, mock_client):
        mock_client.post.return_value = {"jobId": "job_abc", "status": "PENDING"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.ai import draft_content
            result = draft_content("Write about AI", "existing context", "page_xyz")
        url = mock_client.post.call_args[0][0]
        assert url == "/api/v2/ai/draft/background"
        assert "ds_test_id" not in url  # not datasphere-scoped

    def test_draft_content_sends_required_fields(self, authed_state, mock_client):
        mock_client.post.return_value = {"jobId": "job_123"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.ai import draft_content
            draft_content("Hello world", "some context", "page_1")
        payload = mock_client.post.call_args[1]["json"]
        assert payload["content"] == "Hello world"
        assert payload["context"] == "some context"
        assert payload["pageId"] == "page_1"
        assert "modelId" not in payload

    def test_draft_content_sends_model_id_when_provided(self, authed_state, mock_client):
        mock_client.post.return_value = {"jobId": "job_xyz"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.ai import draft_content
            draft_content("Prompt", "Context", "page_1", model_id="claude-opus-4-7")
        payload = mock_client.post.call_args[1]["json"]
        assert payload["modelId"] == "claude-opus-4-7"

    def test_get_draft_jobs(self, authed_state, mock_client):
        mock_client.get.return_value = [{"jobId": "j1", "status": "COMPLETED"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.ai import get_draft_jobs
            result = get_draft_jobs("page_abc")
        url = mock_client.get.call_args[0][0]
        assert url == "/api/v2/ai/draft/jobs/page_abc"
        assert result == [{"jobId": "j1", "status": "COMPLETED"}]

    def test_get_draft_jobs_unwraps_dict(self, authed_state, mock_client):
        mock_client.get.return_value = {"jobs": [{"jobId": "j2"}]}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.ai import get_draft_jobs
            result = get_draft_jobs("page_abc")
        assert result == [{"jobId": "j2"}]

    def test_get_draft_job(self, authed_state, mock_client):
        mock_client.get.return_value = {"jobId": "j1", "status": "COMPLETED", "draftContent": "<p>Hi</p>"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.ai import get_draft_job
            result = get_draft_job("j1")
        url = mock_client.get.call_args[0][0]
        assert url == "/api/v2/ai/draft/job/j1"
        assert result["draftContent"] == "<p>Hi</p>"

    def test_accept_draft(self, authed_state, mock_client):
        mock_client.post.return_value = {"accepted": True}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.ai import accept_draft
            accept_draft("job_abc")
        url = mock_client.post.call_args[0][0]
        assert url == "/api/v2/ai/draft/jobs/job_abc/accept"

    def test_dismiss_draft(self, authed_state, mock_client):
        mock_client.post.return_value = {"dismissed": True}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.ai import dismiss_draft
            dismiss_draft("job_abc")
        url = mock_client.post.call_args[0][0]
        assert url == "/api/v2/ai/draft/jobs/job_abc/dismiss"


# ---------------------------------------------------------------------------
# datasets
# ---------------------------------------------------------------------------

class TestDatasets:
    MODULE = "dai.mcp.tools.datasets"

    def test_create_dataset_uses_ds_id(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "ds1"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.datasets import create_dataset
            create_dataset("Sales", [{"name": "amount", "type": "number"}])
        url = mock_client.post.call_args[0][0]
        assert "ds_test_id" in url

    def test_list_datasets_unwraps_dict(self, authed_state, mock_client):
        mock_client.get.return_value = {"datasets": [{"id": "d1"}]}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.datasets import list_datasets
            result = list_datasets()
        assert result[0]["id"] == "d1"
        assert "_url" in result[0]

    def test_add_rows(self, authed_state, mock_client):
        mock_client.post.return_value = {"inserted": 2}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.datasets import add_rows
            add_rows("ds1", [{"amount": 100}, {"amount": 200}])
        payload = mock_client.post.call_args[1]["json"]
        assert payload == {"rows": [{"amount": 100}, {"amount": 200}]}

    def test_get_rows(self, authed_state, mock_client):
        mock_client.get.return_value = {"rows": [], "total": 0}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.datasets import get_rows
            get_rows("ds1", limit=50, offset=10)
        params = mock_client.get.call_args[1]["params"]
        assert params == {"limit": 50, "offset": 10}


# ---------------------------------------------------------------------------
# research
# ---------------------------------------------------------------------------

class TestResearch:
    MODULE = "dai.mcp.tools.research"

    def test_start_research_creates_conversation_then_sends_message(self, authed_state, mock_client):
        # start_research makes two POST calls: create conversation + send message
        mock_client.post.side_effect = [
            {"id": "conv_abc"},                              # create conversation
            {"id": "msg_xyz"},                               # send message
        ]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.research import start_research
            result = start_research("AI trends 2026")
        assert mock_client.post.call_count == 2
        # First call creates the conversation
        first_url = mock_client.post.call_args_list[0][0][0]
        assert first_url == "/api/v2/assistant/conversations"
        # Second call sends the message
        second_url = mock_client.post.call_args_list[1][0][0]
        assert "conv_abc/messages" in second_url
        assert result["conversationId"] == "conv_abc"

    def test_start_research_sends_web_search_true(self, authed_state, mock_client):
        mock_client.post.side_effect = [{"id": "conv_1"}, {"id": "msg_1"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.research import start_research
            start_research("quantum computing")
        msg_payload = mock_client.post.call_args_list[1][1]["json"]
        assert msg_payload["webSearch"] is True
        assert msg_payload["content"] == "quantum computing"
        assert msg_payload["datasphereId"] == "ds_test_id"

    def test_start_research_uses_custom_title(self, authed_state, mock_client):
        mock_client.post.side_effect = [{"id": "conv_1"}, {"id": "msg_1"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.research import start_research
            start_research("topic", title="My Research Session")
        conv_payload = mock_client.post.call_args_list[0][1]["json"]
        assert conv_payload["title"] == "My Research Session"

    def test_get_research_messages(self, authed_state, mock_client):
        mock_client.get.return_value = [{"id": "m1", "role": "assistant", "content": "Results..."}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.research import get_research_messages
            result = get_research_messages("conv_abc")
        url = mock_client.get.call_args[0][0]
        assert url == "/api/v2/assistant/conversations/conv_abc/messages"
        assert result[0]["role"] == "assistant"

    def test_list_research_conversations(self, authed_state, mock_client):
        mock_client.get.return_value = {"conversations": [{"id": "conv_1"}]}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.research import list_research_conversations
            result = list_research_conversations()
        url = mock_client.get.call_args[0][0]
        assert url == "/api/v2/assistant/conversations"
        assert result == [{"id": "conv_1"}]

    def test_continue_research(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "msg_2"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.research import continue_research
            result = continue_research("conv_abc", "Tell me more about part 3")
        url = mock_client.post.call_args[0][0]
        assert "conv_abc/messages" in url
        payload = mock_client.post.call_args[1]["json"]
        assert payload["content"] == "Tell me more about part 3"
        assert payload["webSearch"] is True


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

class TestExport:
    MODULE = "dai.mcp.tools.export"

    def test_export_page_writes_file(self, authed_state, mock_client, tmp_path, monkeypatch):
        mock_client.get.return_value = {"title": "Hello", "content": "<p>World</p>"}
        monkeypatch.chdir(tmp_path)
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.export import export_page
            result = export_page("hello-world")
        written = Path(result["path"])
        assert written.exists()
        text = written.read_text()
        assert "# Hello" in text
        assert "<p>World</p>" in text

    def test_export_page_custom_filename(self, authed_state, mock_client, tmp_path, monkeypatch):
        mock_client.get.return_value = {"title": "T", "content": "C"}
        monkeypatch.chdir(tmp_path)
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.export import export_page
            result = export_page("slug", filename="custom.md")
        assert result["path"].endswith("custom.md")

    def test_export_tasks_json(self, authed_state, mock_client, tmp_path, monkeypatch):
        mock_client.get.return_value = [{"id": "t1", "title": "Task A"}, {"id": "t2", "title": "Task B"}]
        monkeypatch.chdir(tmp_path)
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.export import export_tasks
            result = export_tasks()
        assert result["count"] == 2
        assert result["format"] == "json"
        import json
        data = json.loads(Path(result["path"]).read_text())
        assert len(data) == 2

    def test_export_tasks_csv(self, authed_state, mock_client, tmp_path, monkeypatch):
        mock_client.get.return_value = [{"id": "t1", "title": "Task A", "status": "DONE"}]
        monkeypatch.chdir(tmp_path)
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.export import export_tasks
            result = export_tasks(format="csv", filename="tasks.csv")
        assert result["format"] == "csv"
        csv_text = Path(result["path"]).read_text()
        assert "id,title,status" in csv_text or "id" in csv_text

    def test_export_tasks_uses_ds_id(self, authed_state, mock_client, tmp_path, monkeypatch):
        """export_tasks must use DB id, not URI, for the v2 tasks endpoint."""
        mock_client.get.return_value = []
        monkeypatch.chdir(tmp_path)
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.export import export_tasks
            export_tasks()
        url = mock_client.get.call_args[0][0]
        assert "ds_test_id" in url
        assert "my-ds" not in url


# ---------------------------------------------------------------------------
# sdd
# ---------------------------------------------------------------------------

class TestSdd:
    MODULE = "dai.mcp.tools.sdd"

    def test_sdd_status_counts_by_column(self, authed_state, mock_client):
        groups = [{"id": "g_exec", "name": "Execution"}, {"id": "g_done", "name": "Done"}]
        tasks = [
            {"id": "t1", "statusGroupId": "g_exec"},
            {"id": "t2", "statusGroupId": "g_done"},
            {"id": "t3", "statusGroupId": "g_done"},
        ]
        mock_client.get.side_effect = [
            {"tasks": tasks},  # /tasks call
            groups,            # /status-groups call
        ]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sdd import sdd_status
            result = sdd_status("pm1")
        assert result["total"] == 3
        assert result["done"] == 2
        assert result["progress_pct"] == round(2 / 3 * 100)
        assert result["by_column"]["Execution"] == 1
        assert result["by_column"]["Done"] == 2

    def test_sdd_status_empty(self, authed_state, mock_client):
        mock_client.get.side_effect = [{"tasks": []}, []]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sdd import sdd_status
            result = sdd_status("pm1")
        assert result["progress_pct"] == 0
        assert result["total"] == 0

    def test_sdd_task_start_patches_and_comments(self, authed_state, mock_client):
        mock_client.patch.return_value = {"id": "t1"}
        mock_client.post.return_value = {"id": "c1"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sdd import sdd_task_start
            result = sdd_task_start("t1", "pm1", "exec_group")
        mock_client.patch.assert_called_once()
        patch_payload = mock_client.patch.call_args[1]["json"]
        assert patch_payload["statusGroupId"] == "exec_group"
        mock_client.post.assert_called_once()
        comment = mock_client.post.call_args[1]["json"]["content"]
        assert "IN PROGRESS" in comment
        assert result["status"] == "in_progress"

    def test_sdd_task_done_posts_comment_then_patches(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "c1"}
        mock_client.patch.return_value = {"id": "t1"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sdd import sdd_task_done
            result = sdd_task_done(
                "t1", "done_group", "Feature complete",
                verified_criteria=["Tests green", "Screenshot captured"],
                screenshot_urls=["https://example.com/shot.png"],
            )
        comment_payload = mock_client.post.call_args[1]["json"]
        assert "Feature complete" in comment_payload["content"]
        assert "Tests green ✅" in comment_payload["content"]
        assert comment_payload["screenshots"] == ["https://example.com/shot.png"]
        patch_payload = mock_client.patch.call_args[1]["json"]
        assert patch_payload["statusGroupId"] == "done_group"
        assert result["status"] == "done"


# ---------------------------------------------------------------------------
# library
# ---------------------------------------------------------------------------

class TestLibrary:
    MODULE = "dai.mcp.tools.library"

    def test_list_library(self, authed_state, mock_client):
        mock_client.get.return_value = [{"id": "m1"}, {"id": "m2"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.library import list_library
            result = list_library(limit=10)
        params = mock_client.get.call_args[1]["params"]
        assert params["limit"] == 10
        assert result == [{"id": "m1"}, {"id": "m2"}]

    def test_delete_media(self, authed_state, mock_client):
        mock_client.delete.return_value = None
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.library import delete_media
            delete_media("media_xyz")
        url = mock_client.delete.call_args[0][0]
        assert "media_xyz" in url

    def test_upload_file_missing_raises(self, authed_state, tmp_path):
        from dai.mcp.tools.library import upload_file
        with pytest.raises(FileNotFoundError):
            upload_file(str(tmp_path / "nonexistent.png"))

    def test_upload_file_sends_multipart(self, authed_state, tmp_path):
        test_file = tmp_path / "img.png"
        test_file.write_bytes(b"fake-png-data")
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"url": "https://example.com/img.png"}
        import dai.state as state
        with patch("httpx.post", return_value=mock_resp) as mock_post:
            from dai.mcp.tools.library import upload_file
            result = upload_file(str(test_file))
        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert "files" in kwargs
        assert result["url"] == "https://example.com/img.png"


# ---------------------------------------------------------------------------
# context
# ---------------------------------------------------------------------------

class TestContext:
    MODULE = "dai.mcp.tools.context"

    def test_get_active_datasphere(self, authed_state, mock_client):
        mock_client.get.return_value = {"uri": "my-ds", "name": "My DS"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.context import get_active_datasphere
            result = get_active_datasphere()
        assert result["active_datasphere"] == "my-ds"

    def test_get_active_datasphere_none(self, tmp_db):
        import dai.state as state
        state.set_credentials("k", "http://localhost")
        from dai.mcp.tools.context import get_active_datasphere
        result = get_active_datasphere()
        assert result["active_datasphere"] is None

    def test_set_active_datasphere(self, authed_state, mock_client):
        mock_client.get.return_value = {"id": "ds_new", "name": "New DS"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.context import set_active_datasphere
            result = set_active_datasphere("new-ds")
        assert result["active_datasphere"] == "new-ds"
        import dai.state as state
        assert state.get_active_datasphere() == "new-ds"

    def test_clear_context(self, authed_state):
        from dai.mcp.tools.context import clear_context
        clear_context()
        import dai.state as state
        assert state.get_active_datasphere() is None

    def test_get_history_empty(self, authed_state):
        from dai.mcp.tools.context import get_history
        result = get_history()
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# dataspheres
# ---------------------------------------------------------------------------

class TestDataspheres:
    MODULE = "dai.mcp.tools.dataspheres"

    def test_list_dataspheres(self, authed_state, mock_client):
        mock_client.get.return_value = [{"uri": "ds1"}, {"uri": "ds2"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.dataspheres import list_dataspheres
            result = list_dataspheres()
        assert len(result) == 2

    def test_get_datasphere(self, authed_state, mock_client):
        mock_client.get.return_value = {"uri": "my-ds", "name": "My DS"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.dataspheres import get_datasphere
            result = get_datasphere("my-ds")
        assert result["uri"] == "my-ds"
        assert "_url" in result
        assert "my-ds" in result["_url"]

    def test_create_datasphere(self, authed_state, mock_client):
        mock_client.post.return_value = {"uri": "new-ds", "name": "New DS"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.dataspheres import create_datasphere
            result = create_datasphere("New DS", uri="new-ds")
        payload = mock_client.post.call_args[1]["json"]
        assert payload["name"] == "New DS"
        assert payload["uri"] == "new-ds"
        assert "_url" in result
        assert "new-ds" in result["_url"]


# ---------------------------------------------------------------------------
# sequences
# ---------------------------------------------------------------------------

class TestSequences:
    MODULE = "dai.mcp.tools.sequences"

    def test_list_sequences_uses_v2_and_ds_id(self, authed_state, mock_client):
        mock_client.get.return_value = [{"id": "s1"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sequences import list_sequences
            result = list_sequences()
        url = mock_client.get.call_args[0][0]
        assert "/api/v2/dataspheres/ds_test_id/sequences" in url
        assert "my-ds" not in url
        assert result[0]["id"] == "s1"
        assert "_url" in result[0]

    def test_list_sequences_unwraps_dict(self, authed_state, mock_client):
        mock_client.get.return_value = {"sequences": [{"id": "s2"}]}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sequences import list_sequences
            result = list_sequences()
        assert result[0]["id"] == "s2"
        assert "_url" in result[0]

    def test_list_sequences_with_filters(self, authed_state, mock_client):
        mock_client.get.return_value = []
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sequences import list_sequences
            list_sequences(status="ACTIVE", trigger_type="SCHEDULED")
        params = mock_client.get.call_args[1]["params"]
        assert params["status"] == "ACTIVE"
        assert params["triggerType"] == "SCHEDULED"

    def test_create_sequence_uses_v2(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "s1", "name": "Daily digest"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sequences import create_sequence
            create_sequence("Daily digest", description="Every morning at 9am", trigger_type="SCHEDULED")
        url = mock_client.post.call_args[0][0]
        assert "/api/v2/dataspheres/ds_test_id/sequences" in url
        payload = mock_client.post.call_args[1]["json"]
        assert payload["name"] == "Daily digest"
        assert payload["triggerType"] == "SCHEDULED"

    def test_execute_sequence(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "exec_1", "status": "PENDING"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sequences import execute_sequence
            result = execute_sequence("seq_abc", input_data={"topic": "AI"})
        url = mock_client.post.call_args[0][0]
        assert "seq_abc/execute" in url
        payload = mock_client.post.call_args[1]["json"]
        assert payload["inputData"] == {"topic": "AI"}
        assert result["status"] == "PENDING"

    def test_list_executions(self, authed_state, mock_client):
        mock_client.get.return_value = [{"id": "exec_1", "status": "COMPLETED"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sequences import list_executions
            result = list_executions("seq_abc", limit=5)
        url = mock_client.get.call_args[0][0]
        assert "seq_abc/executions" in url
        assert mock_client.get.call_args[1]["params"]["limit"] == 5

    def test_delete_sequence(self, authed_state, mock_client):
        mock_client.delete.return_value = None
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.sequences import delete_sequence
            delete_sequence("seq_abc")
        url = mock_client.delete.call_args[0][0]
        assert "seq_abc" in url
        assert "/api/v2/dataspheres/ds_test_id/sequences/seq_abc" in url


# ---------------------------------------------------------------------------
# presentations
# ---------------------------------------------------------------------------

class TestPresentations:
    MODULE = "dai.mcp.tools.presentations"

    def test_list_presentations(self, authed_state, mock_client):
        mock_client.get.return_value = [{"id": "p1"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.presentations import list_presentations
            result = list_presentations()
        assert result[0]["id"] == "p1"
        assert "_url" in result[0]

    def test_create_presentation(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "p1", "title": "Q1 Review"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.presentations import create_presentation
            create_presentation("Q1 Review", description="Quarterly results")
        payload = mock_client.post.call_args[1]["json"]
        assert payload["title"] == "Q1 Review"

    def test_add_slide(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "sl1"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.presentations import add_slide
            add_slide("p1", "Intro", "<p>Welcome</p>", layout="hero", order=0)
        payload = mock_client.post.call_args[1]["json"]
        assert payload["title"] == "Intro"
        assert payload["layout"] == "hero"
        assert payload["sortOrder"] == 0


# ---------------------------------------------------------------------------
# newsletters
# ---------------------------------------------------------------------------

class TestNewsletters:
    MODULE = "dai.mcp.tools.newsletters"

    def test_list_newsletters_uses_correct_path(self, authed_state, mock_client):
        mock_client.get.return_value = [{"id": "nl1"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.newsletters import list_newsletters
            result = list_newsletters()
        url = mock_client.get.call_args[0][0]
        assert url == "/api/dataspheres/ds_test_id/newsletters"
        assert "v1" not in url
        assert isinstance(result, list)

    def test_list_newsletters_unwraps_dict(self, authed_state, mock_client):
        mock_client.get.return_value = {"newsletters": [{"id": "nl2"}]}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.newsletters import list_newsletters
            result = list_newsletters()
        assert result[0]["id"] == "nl2"
        assert "_url" in result[0]

    def test_create_newsletter_uses_correct_path(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "nl1", "name": "Weekly Update"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.newsletters import create_newsletter
            create_newsletter("Weekly Update", slug="weekly-update", system_instructions="Write a summary")
        url = mock_client.post.call_args[0][0]
        assert url == "/api/dataspheres/ds_test_id/newsletters"
        payload = mock_client.post.call_args[1]["json"]
        assert payload["name"] == "Weekly Update"
        assert payload["slug"] == "weekly-update"
        assert payload["systemInstructions"] == "Write a summary"

    def test_create_newsletter_no_v1(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "nl1"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.newsletters import create_newsletter
            create_newsletter("Test", slug="test-nl", system_instructions="...")
        url = mock_client.post.call_args[0][0]
        assert "v1" not in url
        assert "my-ds" not in url

    def test_create_issue(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "iss_1"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.newsletters import create_issue
            create_issue("nl_abc", "Issue #1", "<p>Content</p>", subject="April edition")
        url = mock_client.post.call_args[0][0]
        assert url == "/api/newsletters/nl_abc/issues"
        payload = mock_client.post.call_args[1]["json"]
        assert payload["subject"] == "April edition"

    def test_list_issues(self, authed_state, mock_client):
        mock_client.get.return_value = [{"id": "iss_1"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.newsletters import list_issues
            result = list_issues("nl_abc")
        url = mock_client.get.call_args[0][0]
        assert url == "/api/newsletters/nl_abc/issues"

    def test_send_issue(self, authed_state, mock_client):
        mock_client.post.return_value = {"sent": True}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.newsletters import send_issue
            send_issue("iss_xyz")
        url = mock_client.post.call_args[0][0]
        assert url == "/api/newsletter-issues/iss_xyz/send"

    def test_generate_issue(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "iss_gen"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.newsletters import generate_issue
            generate_issue("nl_abc")
        url = mock_client.post.call_args[0][0]
        assert url == "/api/newsletters/nl_abc/generate"


# ---------------------------------------------------------------------------
# surveys
# ---------------------------------------------------------------------------

class TestSurveys:
    MODULE = "dai.mcp.tools.surveys"

    def test_create_survey_uses_correct_endpoint(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "page_sv1", "title": "NPS 2026"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.surveys import create_survey
            result = create_survey("NPS 2026")
        url = mock_client.post.call_args[0][0]
        assert url == "/api/surveys"
        assert "v1" not in url
        payload = mock_client.post.call_args[1]["json"]
        assert payload["title"] == "NPS 2026"
        assert payload["datasphereUri"] == "my-ds"

    def test_create_survey_with_description(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "page_sv2"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.surveys import create_survey
            create_survey("Dev Survey", description="For developers")
        payload = mock_client.post.call_args[1]["json"]
        assert payload["description"] == "For developers"

    def test_get_survey(self, authed_state, mock_client):
        mock_client.get.return_value = {"id": "page_sv1", "title": "NPS 2026"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.surveys import get_survey
            result = get_survey("page_sv1")
        url = mock_client.get.call_args[0][0]
        assert url == "/api/surveys/page_sv1"

    def test_create_question(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "q1"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.surveys import create_question
            create_question("page_sv1", "Rate us 1-5", "rating")
        url = mock_client.post.call_args[0][0]
        assert url == "/api/surveys/page_sv1/questions"
        payload = mock_client.post.call_args[1]["json"]
        assert payload["text"] == "Rate us 1-5"
        assert payload["type"] == "rating"

    def test_create_question_with_options(self, authed_state, mock_client):
        mock_client.post.return_value = {"id": "q2"}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.surveys import create_question
            create_question("page_sv1", "Choose all that apply", "multiple_choice",
                            options=["A", "B", "C"])
        payload = mock_client.post.call_args[1]["json"]
        assert payload["options"] == ["A", "B", "C"]

    def test_get_responses(self, authed_state, mock_client):
        mock_client.get.return_value = [{"id": "resp_1"}]
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.surveys import get_responses
            result = get_responses("survey_page_abc")
        url = mock_client.get.call_args[0][0]
        assert url == "/api/surveys/survey_page_abc/responses"
        assert url.startswith("/api/surveys/")

    def test_get_analytics(self, authed_state, mock_client):
        mock_client.get.return_value = {"totalResponses": 42, "completionRate": 0.87}
        with _patch_client(self.MODULE, mock_client):
            from dai.mcp.tools.surveys import get_analytics
            result = get_analytics("page_sv1")
        url = mock_client.get.call_args[0][0]
        assert url == "/api/surveys/page_sv1/analytics"
        assert result["totalResponses"] == 42
