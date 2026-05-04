"""Newsletters tool domain — publication and issue management."""

from __future__ import annotations
from typing import Optional
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.mcp._ds import resolve_ds_id
from dai.client import DaiClient


@mcp.tool()
def list_newsletters() -> list:
    """List all newsletters in the active datasphere."""
    client = DaiClient.from_state()
    result = client.get(f"/api/dataspheres/{resolve_ds_id()}/newsletters")
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
    result = client.post(f"/api/dataspheres/{resolve_ds_id()}/newsletters", json=payload)
    return link(result, "newsletter")


@mcp.tool()
def get_newsletter(newsletter_id: str) -> dict:
    """Get a newsletter by ID."""
    client = DaiClient.from_state()
    result = client.get(f"/api/newsletters/{newsletter_id}")
    return link(result, "newsletter")


@mcp.tool()
def update_newsletter(
    newsletter_id: str,
    system_instructions: Optional[str] = None,
    global_context: Optional[str] = None,
    name: Optional[str] = None,
    description: Optional[str] = None,
    ai_model: Optional[str] = None,
    schedule_type: Optional[str] = None,
    enable_web_search: Optional[bool] = None,
    context_window_days: Optional[int] = None,
) -> dict:
    """Update newsletter settings. The two most important fields are:
    - system_instructions: the editorial brief / AI voice prompt
    - global_context: persistent facts (dates, names, locations) the AI always uses
    Only pass fields you want to change — omitted fields are untouched."""
    client = DaiClient.from_state()
    payload: dict = {}
    if system_instructions is not None:
        payload["systemInstructions"] = system_instructions
    if global_context is not None:
        payload["globalContext"] = global_context
    if name is not None:
        payload["name"] = name
    if description is not None:
        payload["description"] = description
    if ai_model is not None:
        payload["aiModel"] = ai_model
    if schedule_type is not None:
        payload["scheduleType"] = schedule_type
    if enable_web_search is not None:
        payload["enableWebSearch"] = enable_web_search
    if context_window_days is not None:
        payload["contextWindowDays"] = context_window_days
    return client.patch(f"/api/newsletters/{newsletter_id}", json=payload)


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
