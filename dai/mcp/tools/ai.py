"""AI tool domain — background drafting via the Dataspheres AI Drafter."""

from __future__ import annotations
from typing import Optional
from dai.mcp.registry import mcp
from dai.client import DaiClient
import dai.state as _state


@mcp.tool()
def draft_content(content: str, context: str, page_id: str, model_id: Optional[str] = None) -> dict:
    """Start a background AI draft job. content=prompt/instructions, context=surrounding material,
    page_id=the page this draft is for. Returns {jobId, status}."""
    client = DaiClient.from_state()
    payload: dict = {"content": content, "context": context, "pageId": page_id}
    if model_id:
        payload["modelId"] = model_id
    return client.post("/api/v2/ai/draft/background", json=payload)


@mcp.tool()
def get_draft_jobs(page_id: str) -> list:
    """List AI draft jobs for a page. Returns list of {jobId, status, draftContent, createdAt}."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v2/ai/draft/jobs/{page_id}")
    return result if isinstance(result, list) else result.get("jobs", [])


@mcp.tool()
def get_draft_job(job_id: str) -> dict:
    """Get a single AI draft job by ID. Returns {jobId, status, draftContent, error}."""
    client = DaiClient.from_state()
    return client.get(f"/api/v2/ai/draft/job/{job_id}")


@mcp.tool()
def accept_draft(job_id: str) -> dict:
    """Accept a completed draft job, applying it to the page."""
    client = DaiClient.from_state()
    return client.post(f"/api/v2/ai/draft/jobs/{job_id}/accept", json={})


@mcp.tool()
def dismiss_draft(job_id: str) -> dict:
    """Dismiss (discard) a draft job."""
    client = DaiClient.from_state()
    return client.post(f"/api/v2/ai/draft/jobs/{job_id}/dismiss", json={})
