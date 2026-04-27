"""Surveys tool domain — design, collect, analyze."""

from __future__ import annotations
from typing import Optional
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.client import DaiClient
import dai.state as _state


def _ds() -> str:
    uri = _state.get_active_datasphere()
    if not uri:
        raise ValueError("No active datasphere. Run: dai use <uri>")
    return uri


@mcp.tool()
def create_survey(title: str, description: Optional[str] = None) -> dict:
    """Create a new survey in the active datasphere. Returns the survey object with its pageId."""
    client = DaiClient.from_state()
    payload: dict = {"title": title, "datasphereUri": _ds()}
    if description:
        payload["description"] = description
    result = client.post("/api/surveys", json=payload)
    return link(result, "survey")


@mcp.tool()
def get_survey(survey_id: str) -> dict:
    """Get a survey by its page ID (returned from create_survey)."""
    client = DaiClient.from_state()
    result = client.get(f"/api/surveys/{survey_id}")
    return link(result, "survey")


@mcp.tool()
def create_question(survey_id: str, text: str, question_type: str, options: Optional[list[str]] = None,
                    required: bool = True) -> dict:
    """Add a question to a survey. type: text|rating|multiple_choice|yes_no|scale."""
    client = DaiClient.from_state()
    payload: dict = {"text": text, "type": question_type, "required": required}
    if options:
        payload["options"] = options
    return client.post(f"/api/surveys/{survey_id}/questions", json=payload)


@mcp.tool()
def get_questions(survey_id: str) -> list:
    """Get all questions for a survey."""
    client = DaiClient.from_state()
    result = client.get(f"/api/surveys/{survey_id}/questions")
    return result if isinstance(result, list) else result.get("questions", [])


@mcp.tool()
def get_responses(survey_id: str) -> list:
    """Get all responses for a survey (requires ownership)."""
    client = DaiClient.from_state()
    result = client.get(f"/api/surveys/{survey_id}/responses")
    return result if isinstance(result, list) else result.get("responses", [])


@mcp.tool()
def get_analytics(survey_id: str) -> dict:
    """Get survey analytics — response counts, completion rates, answer distributions."""
    client = DaiClient.from_state()
    return client.get(f"/api/surveys/{survey_id}/analytics")


@mcp.tool()
def delete_survey(survey_id: str) -> dict:
    """Delete a survey and all its questions and responses."""
    client = DaiClient.from_state()
    return client.delete(f"/api/surveys/{survey_id}")
