"""Research tool domain — AI-powered research via assistant conversations."""

from __future__ import annotations
from typing import Optional
from dai.mcp.registry import mcp
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
def start_research(query: str, title: Optional[str] = None) -> dict:
    """Start a research session. Creates a conversation and posts the query with web search enabled.
    Returns {conversationId, messageId} — poll get_research_messages() for the AI response."""
    client = DaiClient.from_state()
    ds_id = _ds_id()
    # Create a dedicated conversation for this research query
    conv = client.post("/api/v2/assistant/conversations", json={"title": title or f"Research: {query[:60]}"})
    conv_id = conv["id"]
    # Send the query with web search enabled
    msg = client.post(
        f"/api/v2/assistant/conversations/{conv_id}/messages",
        json={"content": query, "webSearch": True, "datasphereId": ds_id},
    )
    return {"conversationId": conv_id, "messageId": msg.get("id"), "status": "processing"}


@mcp.tool()
def get_research_messages(conversation_id: str, limit: int = 20) -> list:
    """Get messages from a research conversation. Check for assistant replies to see research output."""
    client = DaiClient.from_state()
    result = client.get(
        f"/api/v2/assistant/conversations/{conversation_id}/messages",
        params={"limit": limit},
    )
    return result if isinstance(result, list) else result.get("messages", [])


@mcp.tool()
def list_research_conversations(limit: int = 20) -> list:
    """List recent research conversations."""
    client = DaiClient.from_state()
    result = client.get("/api/v2/assistant/conversations", params={"limit": limit})
    return result if isinstance(result, list) else result.get("conversations", [])


@mcp.tool()
def continue_research(conversation_id: str, follow_up: str) -> dict:
    """Send a follow-up message to an existing research conversation."""
    client = DaiClient.from_state()
    ds_id = _ds_id()
    msg = client.post(
        f"/api/v2/assistant/conversations/{conversation_id}/messages",
        json={"content": follow_up, "webSearch": True, "datasphereId": ds_id},
    )
    return {"conversationId": conversation_id, "messageId": msg.get("id"), "status": "processing"}
