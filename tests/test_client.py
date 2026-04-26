"""Unit tests for dai.client — DaiClient HTTP layer."""

from __future__ import annotations

from unittest.mock import MagicMock, call, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_response(status_code: int, json_body=None, text: str = "") -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    r.content = b"body" if json_body is not None or text else b""
    r.text = text
    r.json = MagicMock(return_value=json_body)
    return r


# ---------------------------------------------------------------------------
# Constructor
# ---------------------------------------------------------------------------

def test_init_strips_trailing_slash():
    from dai.client import DaiClient
    c = DaiClient("key", "http://localhost:5173/")
    assert c._base_url == "http://localhost:5173"


def test_from_state(authed_state):
    from dai.client import DaiClient
    c = DaiClient.from_state()
    assert c._api_key == "dsk_test_key_abc123"
    assert c._base_url == "http://localhost:5173"


def test_from_state_raises_when_not_authed(tmp_db):
    from dai.client import DaiClient
    from dai.state import NotAuthenticatedError
    with pytest.raises(NotAuthenticatedError):
        DaiClient.from_state()


# ---------------------------------------------------------------------------
# _request — success paths
# ---------------------------------------------------------------------------

def test_request_200_returns_json(authed_state):
    from dai.client import DaiClient
    body = {"id": "abc", "title": "Hello"}
    mock_resp = _make_response(200, json_body=body)
    with patch("httpx.request", return_value=mock_resp) as mock_req:
        c = DaiClient("key", "http://localhost")
        result = c.get("/api/v1/test")
    assert result == body
    mock_req.assert_called_once()


def test_request_204_returns_none(authed_state):
    from dai.client import DaiClient
    mock_resp = _make_response(204)
    mock_resp.content = b""
    with patch("httpx.request", return_value=mock_resp):
        c = DaiClient("key", "http://localhost")
        result = c.delete("/api/v1/test/abc")
    assert result is None


def test_request_builds_correct_url(authed_state):
    from dai.client import DaiClient
    mock_resp = _make_response(200, json_body={})
    with patch("httpx.request", return_value=mock_resp) as mock_req:
        c = DaiClient("mykey", "http://example.com")
        c.get("/api/v1/dataspheres/foo/pages")
    args, kwargs = mock_req.call_args
    assert args[0] == "GET"
    assert args[1] == "http://example.com/api/v1/dataspheres/foo/pages"


def test_request_sends_auth_header(authed_state):
    from dai.client import DaiClient
    mock_resp = _make_response(200, json_body={})
    with patch("httpx.request", return_value=mock_resp) as mock_req:
        c = DaiClient("dsk_secret", "http://example.com")
        c.post("/api/v1/test", json={"x": 1})
    _, kwargs = mock_req.call_args
    assert kwargs["headers"]["Authorization"] == "Bearer dsk_secret"


# ---------------------------------------------------------------------------
# _request — error paths
# ---------------------------------------------------------------------------

def test_request_401_raises_not_authenticated(authed_state):
    from dai.client import DaiClient, NotAuthenticatedError
    with patch("httpx.request", return_value=_make_response(401, json_body={"error": "Unauthorized"})):
        c = DaiClient("key", "http://localhost")
        with pytest.raises(NotAuthenticatedError) as exc_info:
            c.get("/api/v1/test")
    assert exc_info.value.status_code == 401


def test_request_404_raises_not_found(authed_state):
    from dai.client import DaiClient, NotFoundError
    with patch("httpx.request", return_value=_make_response(404, json_body={"error": "Not found"})):
        c = DaiClient("key", "http://localhost")
        with pytest.raises(NotFoundError) as exc_info:
            c.get("/api/v1/dataspheres/foo/pages/missing")
    assert exc_info.value.status_code == 404


def test_request_400_raises_api_error_with_message(authed_state):
    from dai.client import DaiClient, ApiError
    body = {"error": "Validation failed", "field": "title"}
    with patch("httpx.request", return_value=_make_response(400, json_body=body)):
        c = DaiClient("key", "http://localhost")
        with pytest.raises(ApiError) as exc_info:
            c.post("/api/v1/test", json={})
    assert "Validation failed" in str(exc_info.value)
    assert exc_info.value.status_code == 400


def test_request_500_raises_api_error(authed_state):
    from dai.client import DaiClient, ApiError
    with patch("httpx.request", return_value=_make_response(500, text="Internal Server Error")):
        c = DaiClient("key", "http://localhost")
        with pytest.raises(ApiError) as exc_info:
            c.get("/api/v1/test")
    assert exc_info.value.status_code == 500


# ---------------------------------------------------------------------------
# _request — retry logic
# ---------------------------------------------------------------------------

def test_request_retries_on_429(authed_state):
    from dai.client import DaiClient, ApiError
    # All three attempts return 429
    rate_resp = _make_response(429, json_body={"error": "Rate limited"})
    with patch("httpx.request", return_value=rate_resp) as mock_req:
        with patch("time.sleep"):  # don't actually sleep
            c = DaiClient("key", "http://localhost")
            with pytest.raises(ApiError) as exc_info:
                c.get("/api/v1/test")
    assert mock_req.call_count == 3
    assert exc_info.value.status_code == 429


def test_request_retries_on_503(authed_state):
    from dai.client import DaiClient, ApiError
    slow_resp = _make_response(503, json_body={"error": "Service unavailable"})
    with patch("httpx.request", return_value=slow_resp) as mock_req:
        with patch("time.sleep"):
            c = DaiClient("key", "http://localhost")
            with pytest.raises(ApiError):
                c.get("/api/v1/test")
    assert mock_req.call_count == 3


def test_request_succeeds_after_one_429(authed_state):
    from dai.client import DaiClient
    rate_resp = _make_response(429, json_body={"error": "Rate limited"})
    ok_resp = _make_response(200, json_body={"id": "ok"})
    with patch("httpx.request", side_effect=[rate_resp, ok_resp]):
        with patch("time.sleep"):
            c = DaiClient("key", "http://localhost")
            result = c.get("/api/v1/test")
    assert result == {"id": "ok"}


def test_request_retries_on_network_error(authed_state):
    import httpx
    from dai.client import DaiClient, ApiError
    with patch("httpx.request", side_effect=httpx.ConnectError("refused")) as mock_req:
        with patch("time.sleep"):
            c = DaiClient("key", "http://localhost")
            with pytest.raises(ApiError):
                c.get("/api/v1/test")
    assert mock_req.call_count == 3


# ---------------------------------------------------------------------------
# HTTP method delegation
# ---------------------------------------------------------------------------

def test_get_delegates_correctly(authed_state):
    from dai.client import DaiClient
    ok_resp = _make_response(200, json_body={"items": []})
    with patch("httpx.request", return_value=ok_resp) as mock_req:
        DaiClient("k", "http://h").get("/path", params={"limit": 5})
    args, kwargs = mock_req.call_args
    assert args[0] == "GET"
    assert kwargs["params"] == {"limit": 5}


def test_post_sends_json_body(authed_state):
    from dai.client import DaiClient
    ok_resp = _make_response(201, json_body={"id": "new"})
    with patch("httpx.request", return_value=ok_resp) as mock_req:
        DaiClient("k", "http://h").post("/path", json={"title": "T"})
    _, kwargs = mock_req.call_args
    assert kwargs["json"] == {"title": "T"}


def test_patch_sends_json_body(authed_state):
    from dai.client import DaiClient
    ok_resp = _make_response(200, json_body={"updated": True})
    with patch("httpx.request", return_value=ok_resp) as mock_req:
        DaiClient("k", "http://h").patch("/path/123", json={"status": "DONE"})
    args, kwargs = mock_req.call_args
    assert args[0] == "PATCH"
    assert kwargs["json"] == {"status": "DONE"}
