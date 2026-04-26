"""
Dataspheres AI REST API client — auth + retry + typed errors.
All tool domains import DaiClient.from_state() — never construct it directly.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from dai import state as _state


class ApiError(Exception):
    def __init__(self, message: str, status_code: int = 0):
        super().__init__(message)
        self.status_code = status_code


class NotAuthenticatedError(ApiError):
    pass


class NotFoundError(ApiError):
    pass


class DaiClient:
    def __init__(self, api_key: str, base_url: str):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    @classmethod
    def from_state(cls) -> "DaiClient":
        return cls(
            api_key=_state.get_api_key(),
            base_url=_state.get_base_url(),
        )

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = f"{self._base_url}{path}"
        last_err: Exception | None = None
        for attempt in range(3):
            try:
                r = httpx.request(
                    method,
                    url,
                    headers=self._headers(),
                    timeout=30.0,
                    **kwargs,
                )
                if r.status_code == 401:
                    raise NotAuthenticatedError("Not authenticated", 401)
                if r.status_code == 404:
                    raise NotFoundError(f"Not found: {path}", 404)
                if r.status_code == 429 or r.status_code == 503:
                    wait = 2 ** attempt
                    time.sleep(wait)
                    last_err = ApiError(f"Rate limited ({r.status_code})", r.status_code)
                    continue
                if r.status_code >= 400:
                    try:
                        body = r.json()
                        msg = body.get("error") or body.get("message") or r.text
                    except Exception:
                        msg = r.text
                    raise ApiError(msg, r.status_code)
                if r.status_code == 204 or not r.content:
                    return None
                return r.json()
            except (NotAuthenticatedError, NotFoundError, ApiError):
                raise
            except httpx.RequestError as e:
                last_err = ApiError(f"Request failed: {e}")
                time.sleep(2 ** attempt)
        raise last_err or ApiError("Request failed after retries")

    def get(self, path: str, params: dict | None = None) -> Any:
        return self._request("GET", path, params=params)

    def post(self, path: str, json: Any = None) -> Any:
        return self._request("POST", path, json=json)

    def put(self, path: str, json: Any = None) -> Any:
        return self._request("PUT", path, json=json)

    def patch(self, path: str, json: Any = None) -> Any:
        return self._request("PATCH", path, json=json)

    def delete(self, path: str, json: Any = None) -> Any:
        return self._request("DELETE", path, json=json)
