"""
dai CLI — human-facing commands for authentication, context, and skill management.
IDE agents use the MCP server, not the CLI.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table

import dai.state as _state
from dai import __version__
from dai.client import DaiClient, ApiError

app = typer.Typer(
    name="dai",
    help="dai-skills — AI-native Dataspheres AI skill library. Use all dai.",
    no_args_is_help=True,
)
console = Console()


@app.command()
def login(
    key: str = typer.Option(..., "--key", "-k", help="Dataspheres AI API key (dsk_...)"),
    base_url: str = typer.Option("https://dataspheres.ai", "--base-url", "-u", help="API base URL (where HTTP calls go)"),
    public_url: Optional[str] = typer.Option(None, "--public-url", "-p", help="Public UI base URL for links (default: same as --base-url). Set to https://dev.dataspheres.ai when using a tunnel."),
):
    """Authenticate with your Dataspheres AI developer key."""
    if not key.startswith("dsk_"):
        console.print("[red]Error:[/red] API key must start with dsk_")
        raise typer.Exit(1)

    # Validate by hitting the health endpoint
    try:
        client = DaiClient(api_key=key, base_url=base_url)
        client.get("/api/health")
    except ApiError as e:
        console.print(f"[red]Authentication failed:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Connection failed:[/red] {e}")
        raise typer.Exit(1)

    _state.set_credentials(key, base_url, public_url=public_url)
    link_url = public_url or base_url
    console.print(f"[green]✓[/green] Authenticated — API: [bold]{base_url}[/bold]  Links: [bold]{link_url}[/bold]")
    console.print("  Run [cyan]dai status[/cyan] to see your workspace, or [cyan]dai use <datasphere-uri>[/cyan] to get started.")


@app.command()
def logout():
    """Remove stored credentials."""
    _state.clear_credentials()
    _state.clear_context()
    console.print("[yellow]Logged out.[/yellow] Run [cyan]dai login[/cyan] to re-authenticate.")


@app.command()
def status():
    """Show current authentication and active datasphere."""
    if not _state.is_authenticated():
        console.print("[red]Not authenticated.[/red] Run: dai login --key dsk_xxx")
        raise typer.Exit(1)

    active = _state.get_active_datasphere()
    base_url = _state.get_base_url()
    public_url = _state.get_public_url()
    key = _state.get_api_key()
    mode = _state.get_mode()

    mode_label = (
        "[green]local[/green]  (dev server — localhost)"
        if mode == "local"
        else "[blue]remote[/blue] (production — dataspheres.ai)"
    )

    table = Table(show_header=False, box=None, padding=(0, 2))
    table.add_column("Key", style="dim")
    table.add_column("Value", style="bold")
    table.add_row("version", __version__)
    table.add_row("mode", mode_label)
    table.add_row("api_url", base_url)
    table.add_row("public_url", public_url)
    table.add_row("api_key", f"{key[:8]}...{key[-4:]}")
    table.add_row("active_ds", active or "[dim]none — run: dai use <uri>[/dim]")
    table.add_row("tool_domains", "14 (full local install)")
    console.print(table)


@app.command()
def use(
    uri: str = typer.Argument(..., help="Datasphere URI (e.g. my-project)"),
):
    """Set the active datasphere for all subsequent commands."""
    if not _state.is_authenticated():
        console.print("[red]Not authenticated.[/red] Run: dai login --key dsk_xxx")
        raise typer.Exit(1)

    # Verify it exists
    try:
        client = DaiClient.from_state()
        client.get(f"/api/v1/dataspheres/{uri}")
    except Exception as e:
        console.print(f"[red]Datasphere not found:[/red] {uri} ({e})")
        raise typer.Exit(1)

    _state.set_active_datasphere(uri)
    console.print(f"[green]✓[/green] Active datasphere: [bold]{uri}[/bold]")


@app.command()
def update(
    project: Optional[str] = typer.Option(None, "--project", "-p", help="Target project path (default: CWD)"),
):
    """Pull latest dai-skills from GitHub and re-install into your project."""
    dai_dir = Path(__file__).parent.parent.parent

    # Git pull
    console.print("Pulling latest dai-skills...")
    result = subprocess.run(["git", "pull"], cwd=str(dai_dir), capture_output=True, text=True)
    if result.returncode != 0:
        console.print(f"[red]Git pull failed:[/red] {result.stderr}")
        raise typer.Exit(1)
    console.print(f"[green]✓[/green] {result.stdout.strip()}")

    # Re-run install.sh if a project is specified
    if project:
        install_sh = dai_dir / "install.sh"
        subprocess.run([str(install_sh), "--all", "--project", project], check=True)
        console.print(f"[green]✓[/green] Skills reinstalled into {project}")
    else:
        console.print("Run [cyan]dai update --project /path/to/project[/cyan] to reinstall skills.")


# MCP subcommand group
mcp_app = typer.Typer(help="MCP server commands")
app.add_typer(mcp_app, name="mcp")


@mcp_app.command("start")
def mcp_start():
    """Start the dai-skills MCP server (stdio transport for IDE auto-connect)."""
    from dai.mcp.server import main as mcp_main
    mcp_main()


if __name__ == "__main__":
    app()
