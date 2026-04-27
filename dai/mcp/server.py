"""
dai-skills FastMCP server entry point.
All tool domains self-register on import via @mcp.tool decorators.
"""

from __future__ import annotations

import threading

import dai.state as _state
from dai.mcp.registry import mcp

# Ping / health
@mcp.tool()
def ping() -> dict:
    """Health check — returns server version and active datasphere URI."""
    from dai import __version__
    return {
        "version": __version__,
        "server": "dai-skills",
        "active_datasphere": _state.get_active_datasphere(),
        "authenticated": _state.is_authenticated(),
    }

# Register all tool domains by importing them (side-effect: @mcp.tool decorators fire)
import dai.mcp.tools.pages          # noqa: F401
import dai.mcp.tools.library        # noqa: F401
import dai.mcp.tools.ai             # noqa: F401
import dai.mcp.tools.planner        # noqa: F401
import dai.mcp.tools.datasets       # noqa: F401
import dai.mcp.tools.newsletters    # noqa: F401
import dai.mcp.tools.surveys        # noqa: F401
import dai.mcp.tools.research       # noqa: F401
import dai.mcp.tools.dataspheres    # noqa: F401
import dai.mcp.tools.context        # noqa: F401
import dai.mcp.tools.sequences      # noqa: F401
import dai.mcp.tools.presentations  # noqa: F401
import dai.mcp.tools.export         # noqa: F401
import dai.mcp.tools.sdd            # noqa: F401

# Dynamic loader — registers every tool from /api/mcp/schema that isn't
# already covered by a hand-written module above. Runs in a background
# thread so a slow or unreachable /api/mcp/schema never blocks MCP startup.
from dai.mcp.dynamic import load_remote_tools as _load_remote_tools
threading.Thread(target=_load_remote_tools, daemon=True).start()


def main() -> None:
    """Entry point for `dai mcp start`."""
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
