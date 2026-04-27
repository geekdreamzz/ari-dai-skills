"""Sequences tool domain — automated workflow creation and monitoring."""

from __future__ import annotations
from typing import Optional, Any
from dai.mcp.registry import mcp
from dai.mcp._links import link
from dai.mcp._ds import resolve_ds_id
from dai.client import DaiClient


@mcp.tool()
def list_sequences(status: Optional[str] = None, trigger_type: Optional[str] = None) -> list:
    """List sequences in the active datasphere. Status: DRAFT|ACTIVE|PAUSED|ARCHIVED. TriggerType: MANUAL|SCHEDULED|WEBHOOK."""
    client = DaiClient.from_state()
    params: dict[str, Any] = {}
    if status:
        params["status"] = status
    if trigger_type:
        params["triggerType"] = trigger_type
    result = client.get(f"/api/v2/dataspheres/{resolve_ds_id()}/sequences", params=params)
    items = result if isinstance(result, list) else result.get("sequences", [])
    return link(items, "sequence")


@mcp.tool()
def get_sequence(sequence_id: str) -> dict:
    """Get a sequence by ID, including its graph and run status."""
    client = DaiClient.from_state()
    result = client.get(f"/api/v2/dataspheres/{resolve_ds_id()}/sequences/{sequence_id}")
    return link(result, "sequence")


@mcp.tool()
def create_sequence(name: str, description: Optional[str] = None, trigger_type: str = "MANUAL",
                    max_cost: Optional[float] = None) -> dict:
    """Create a new sequence. TriggerType: MANUAL|SCHEDULED|WEBHOOK."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {"name": name, "triggerType": trigger_type}
    if description:
        payload["description"] = description
    if max_cost is not None:
        payload["maxCost"] = max_cost
    result = client.post(f"/api/v2/dataspheres/{resolve_ds_id()}/sequences", json=payload)
    return link(result, "sequence")


@mcp.tool()
def execute_sequence(sequence_id: str, input_data: Optional[dict] = None) -> dict:
    """Trigger a manual sequence run. Returns an execution record with ID and status."""
    client = DaiClient.from_state()
    payload: dict[str, Any] = {}
    if input_data:
        payload["inputData"] = input_data
    return client.post(f"/api/v2/dataspheres/{resolve_ds_id()}/sequences/{sequence_id}/execute", json=payload)


@mcp.tool()
def list_executions(sequence_id: str, limit: int = 20, status: Optional[str] = None) -> list:
    """List past executions for a sequence. Status: PENDING|RUNNING|COMPLETED|FAILED."""
    client = DaiClient.from_state()
    params: dict[str, Any] = {"limit": limit}
    if status:
        params["status"] = status
    result = client.get(f"/api/v2/dataspheres/{resolve_ds_id()}/sequences/{sequence_id}/executions", params=params)
    return result if isinstance(result, list) else result.get("executions", [])


@mcp.tool()
def delete_sequence(sequence_id: str) -> dict:
    """Delete a sequence by ID."""
    client = DaiClient.from_state()
    return client.delete(f"/api/v2/dataspheres/{resolve_ds_id()}/sequences/{sequence_id}")
