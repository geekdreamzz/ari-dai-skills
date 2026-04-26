"""Newsletters tool domain — publication and issue management."""

from __future__ import annotations
from typing import Optional
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.client import DaiClient
import dai.state as _state


def _ds_id() -> str:
    uri = _state.get_active_datasphere()
    if not uri:
        raise ValueError("No active datasphere. Run: dai use <uri>")
    cached = _state.cache_get(f"ds_id:{uri}")
    if cached:
        return cached
    client = DaiClient.from_state()
    result = client.get(f"/api/v1/dataspheres/{uri}")
    ds_id = result["id"]
    _state.cache_set(f"ds_id:{uri}", ds_id, ttl_seconds=3600)
    return ds_id


@mcp.tool()
def list_newsletters() -> list:
    """List all newsletters in the active datasphere."""
    client = DaiClient.from_state()
    result = client.get(f"/api/dataspheres/{_ds_id()}/newsletters")
    items = result if isinstance(result, list) else result.get("newsletters", [])
    return link(items, "newsletter")


@mcp.tool()
def create_newsletter(name: str, slug: str, system_instructions: str,
                      description: Optional[str] = None, schedule_type: Optional[str] = None) -> dict:
    """Create a new newsletter. system_instructions is the AI prompt that drives content generation.
    schedule_type: WEEKLY|MONTHLY|CUSTOM|MANUAL."""
    client = DaiClient.from_state()
    payload: dict = {"name": name, "slug": slug, "systemInstructions": system_instructions}
    if description:
        payload["description"] = description
    if schedule_type:
        payload["scheduleType"] = schedule_type
    result = client.post(f"/api/dataspheres/{_ds_id()}/newsletters", json=payload)
    return link(result, "newsletter")


@mcp.tool()
def get_newsletter(newsletter_id: str) -> dict:
    """Get a newsletter by ID."""
    client = DaiClient.from_state()
    result = client.get(f"/api/newsletters/{newsletter_id}")
    return link(result, "newsletter")


@mcp.tool()
def generate_issue(newsletter_id: str) -> dict:
    """AI-generate a newsletter issue based on the newsletter's system instructions and datasphere context."""
    client = DaiClient.from_state()
    return client.post(f"/api/newsletters/{newsletter_id}/generate", json={})


@mcp.tool()
def create_issue(newsletter_id: str, title: str, content: str, subject: Optional[str] = None) -> dict:
    """Create a newsletter issue manually (draft)."""
    client = DaiClient.from_state()
    return client.post(f"/api/newsletters/{newsletter_id}/issues",
                       json={"title": title, "content": content, "subject": subject or title})


@mcp.tool()
def list_issues(newsletter_id: str) -> list:
    """List issues for a newsletter."""
    client = DaiClient.from_state()
    result = client.get(f"/api/newsletters/{newsletter_id}/issues")
    return result if isinstance(result, list) else result.get("issues", [])


@mcp.tool()
def send_issue(issue_id: str) -> dict:
    """Send a newsletter issue to subscribers."""
    client = DaiClient.from_state()
    return client.post(f"/api/newsletter-issues/{issue_id}/send", json={})
