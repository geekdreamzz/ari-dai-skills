"""
dai CLI — human-facing commands for authentication, context, and skill management.
IDE agents use the MCP server, not the CLI.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
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


def _load_env_file(path: Path) -> dict[str, str]:
    """Parse a .env file into a dict. Skips comments and blank lines."""
    result: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        result[k.strip()] = v.strip().strip('"').strip("'")
    return result


def _find_dai_bin() -> str:
    """Return the absolute path to the `dai` binary, checking common uv tool locations."""
    found = shutil.which("dai")
    if found:
        return found
    candidates = [
        Path.home() / ".local" / "bin" / "dai",
        Path.home() / ".cargo" / "bin" / "dai",
        Path("/usr/local/bin/dai"),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return "dai"


def _patch_mcp_json(dai_bin: str) -> None:
    """Write absolute dai path into .mcp.json, removing any ${VAR} env block."""
    mcp_path = Path(".mcp.json")
    if not mcp_path.exists():
        return
    try:
        cfg = json.loads(mcp_path.read_text())
        srv = cfg.get("mcpServers", {}).get("dai-skills")
        if srv is None:
            return
        srv["command"] = dai_bin
        srv["args"] = ["mcp", "start"]
        srv.pop("env", None)
        mcp_path.write_text(json.dumps(cfg, indent=2) + "\n")
    except Exception as e:
        console.print(f"  [yellow]Warning:[/yellow] could not patch .mcp.json: {e}")


@app.command()
def login(
    key: str = typer.Option(..., "--key", "-k", help="Dataspheres AI API key (dsk_...)"),
    base_url: Optional[str] = typer.Option(None, "--base-url", "-u", help="API base URL (default: $DATASPHERES_BASE_URL or https://dataspheres.ai)"),
    public_url: Optional[str] = typer.Option(None, "--public-url", "-p", help="Public UI base URL for links (local dev tunnels only)"),
):
    """Authenticate with your Dataspheres AI developer key."""
    if not key.startswith("dsk_"):
        console.print("[red]Error:[/red] API key must start with dsk_")
        raise typer.Exit(1)

    # Resolve base_url: explicit flag > env var > prod default
    if base_url is None:
        env_url = os.getenv("DATASPHERES_BASE_URL")
        if env_url:
            base_url = env_url.rstrip("/")
            console.print(f"[dim]Using DATASPHERES_BASE_URL={base_url}[/dim]")
        else:
            base_url = "https://dataspheres.ai"
            console.print("[dim]Using production API (pass --base-url to override)[/dim]")
    else:
        base_url = base_url.rstrip("/")

    # Validate against a protected endpoint — /api/health does NOT require auth
    try:
        client = DaiClient(api_key=key, base_url=base_url)
        dataspheres = client.get("/api/v1/dataspheres")
    except ApiError as e:
        if e.status_code == 401:
            console.print(f"[red]Invalid API key[/red] — rejected by {base_url}")
            console.print("  Check your key at: https://dataspheres.ai/app/developers?tab=keys")
        else:
            console.print(f"[red]Authentication failed:[/red] {e}")
        raise typer.Exit(1)
    except Exception as e:
        console.print(f"[red]Connection failed:[/red] {e}")
        raise typer.Exit(1)

    _state.set_credentials(key, base_url, public_url=public_url)
    count = len(dataspheres) if isinstance(dataspheres, list) else 0
    console.print(f"[green]✓[/green] Authenticated → [bold]{base_url}[/bold] ({count} workspace{'s' if count != 1 else ''})")
    console.print("  Run [cyan]dai status[/cyan] to verify, or open your IDE.")


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

    try:
        client = DaiClient.from_state()
        client.get(f"/api/v1/dataspheres/{uri}")
    except Exception as e:
        console.print(f"[red]Datasphere not found:[/red] {uri} ({e})")
        raise typer.Exit(1)

    _state.set_active_datasphere(uri)
    console.print(f"[green]✓[/green] Active datasphere: [bold]{uri}[/bold]")


@app.command()
def bootstrap():
    """Zero-to-working setup: install uv, configure MCP, authenticate, verify."""
    console.print("\n[bold]dai-skills bootstrap[/bold]\n")

    # ── 1: uv ───────────────────────────────────────────────────────────────
    console.print("[bold]1/4[/bold] Checking uv...")
    uv_bin = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")

    if not shutil.which("uv"):
        console.print("  uv not found — installing...")
        try:
            if platform.system() == "Windows":
                subprocess.run(
                    ["powershell", "-c", "irm https://astral.sh/uv/install.ps1 | iex"],
                    check=True,
                )
            else:
                subprocess.run("curl -LsSf https://astral.sh/uv/install.sh | sh", shell=True, check=True)
            uv_bin = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
            console.print("  [green]✓[/green] uv installed")
        except subprocess.CalledProcessError as e:
            console.print(f"  [red]Failed to install uv:[/red] {e}")
            console.print("  Install manually: https://docs.astral.sh/uv/getting-started/installation/")
            raise typer.Exit(1)
    else:
        console.print(f"  [green]✓[/green] uv found")

    # ── 2: dai-skills package ────────────────────────────────────────────────
    console.print("[bold]2/4[/bold] Installing dai-skills...")
    try:
        result = subprocess.run(
            [uv_bin, "tool", "install", "dai-skills", "--upgrade"],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip())
        console.print("  [green]✓[/green] dai-skills installed")
    except Exception as e:
        console.print(f"  [red]Failed:[/red] {e}")
        raise typer.Exit(1)

    # ── 3: patch .mcp.json ───────────────────────────────────────────────────
    console.print("[bold]3/4[/bold] Configuring MCP connection...")
    dai_bin = _find_dai_bin()
    _patch_mcp_json(dai_bin)
    console.print(f"  [green]✓[/green] .mcp.json → [dim]{dai_bin} mcp start[/dim]")

    # ── 4: authenticate ──────────────────────────────────────────────────────
    console.print("[bold]4/4[/bold] Authenticating...")

    if _state.is_authenticated():
        try:
            client = DaiClient.from_state()
            client.get("/api/v1/dataspheres")
            console.print("  [green]✓[/green] Already authenticated and verified")
        except Exception:
            console.print("  [yellow]Stored credentials invalid — re-authenticating from .env[/yellow]")
            _state.clear_credentials()

    if not _state.is_authenticated():
        env_path = Path(".env")
        if not env_path.exists():
            console.print("\n  [yellow]No .env file found.[/yellow]")
            console.print("  Copy the template and fill in your key:")
            console.print("    [cyan]cp .env.example .env[/cyan]")
            console.print("  Get your key at: https://dataspheres.ai/app/developers?tab=keys")
            console.print("  Then re-run: [cyan]dai bootstrap[/cyan]")
            raise typer.Exit(1)

        env_vars = _load_env_file(env_path)
        key = env_vars.get("DATASPHERES_API_KEY", "")
        base_url = env_vars.get("DATASPHERES_BASE_URL", "https://dataspheres.ai").rstrip("/")
        pub = env_vars.get("DATASPHERES_PUBLIC_URL") or None

        if not key or not key.startswith("dsk_") or key == "dsk_your_key_here":
            console.print("  [yellow].env found but DATASPHERES_API_KEY is still a placeholder.[/yellow]")
            console.print("  Edit .env and replace dsk_your_key_here with your real key.")
            console.print("  Get it at: https://dataspheres.ai/app/developers?tab=keys")
            raise typer.Exit(1)

        try:
            client = DaiClient(api_key=key, base_url=base_url)
            dataspheres = client.get("/api/v1/dataspheres")
            _state.set_credentials(key, base_url, public_url=pub)
            count = len(dataspheres) if isinstance(dataspheres, list) else 0
            console.print(f"  [green]✓[/green] Authenticated → {base_url} ({count} workspace{'s' if count != 1 else ''})")
        except ApiError as e:
            if e.status_code == 401:
                console.print(f"  [red]Invalid API key[/red] — rejected by {base_url}")
                console.print("  Check: https://dataspheres.ai/app/developers?tab=keys")
            else:
                console.print(f"  [red]Authentication failed:[/red] {e}")
            raise typer.Exit(1)
        except Exception as e:
            console.print(f"  [red]Connection failed:[/red] {e}")
            raise typer.Exit(1)

    # ── Done ─────────────────────────────────────────────────────────────────
    console.print("\n[bold green]Setup complete![/bold green]")
    console.print("\n[yellow bold]One more step — enable the MCP server in Claude Code:[/yellow bold]")
    console.print("  1. Type [cyan]/mcp[/cyan] in the Claude Code chat input")
    console.print("  2. Find [bold]dai-skills[/bold] and click [bold]Enable[/bold]")
    console.print("  3. [cyan]Cmd/Ctrl+Shift+P → Reload Window[/cyan]")
    console.print("\nAfter reload, Ari is ready. All dai!\n")


@app.command()
def doctor():
    """Check every layer of the install — pass/fail with one-line fixes."""
    console.print("\n[bold]dai doctor[/bold]\n")
    all_ok = True

    def check(label: str, passed: bool, fix: str | None = None) -> None:
        nonlocal all_ok
        if passed:
            console.print(f"  [green]✓[/green]  {label}")
        else:
            console.print(f"  [red]✗[/red]  {label}")
            if fix:
                console.print(f"       [dim]→ {fix}[/dim]")
            all_ok = False

    # 1. Python version
    major, minor = sys.version_info[:2]
    check(
        f"Python {major}.{minor} (need 3.11+)",
        major == 3 and minor >= 11,
        "use uv — it bundles its own Python 3.11+",
    )

    # 2. uv installed
    uv_bin = shutil.which("uv")
    check(
        f"uv installed{' at ' + uv_bin if uv_bin else ''}",
        bool(uv_bin),
        "curl -LsSf https://astral.sh/uv/install.sh | sh",
    )

    # 3. dai-skills installed
    dai_bin = shutil.which("dai")
    installed = bool(dai_bin)
    if uv_bin and not installed:
        try:
            r = subprocess.run([uv_bin, "tool", "list"], capture_output=True, text=True, timeout=10)
            installed = "dai-skills" in r.stdout
        except Exception:
            pass
    check(
        f"dai-skills installed{' (dai at ' + dai_bin + ')' if dai_bin else ''}",
        installed,
        "uv tool install dai-skills",
    )

    # 4. .mcp.json — exists, absolute path, no ${VAR}
    mcp_path = Path(".mcp.json")
    if mcp_path.exists():
        try:
            cfg = json.loads(mcp_path.read_text())
            srv = cfg.get("mcpServers", {}).get("dai-skills", {})
            cmd = srv.get("command", "")
            env = srv.get("env", {})
            is_abs = cmd.startswith("/") or (len(cmd) > 2 and cmd[1] == ":")
            has_vars = any("${" in str(v) for v in env.values())
            check(f".mcp.json command is absolute ({cmd or 'missing'})", is_abs, "dai bootstrap")
            check(".mcp.json has no unexpanded ${VAR}", not has_vars, "dai bootstrap")
        except json.JSONDecodeError:
            check(".mcp.json is valid JSON", False, "delete and re-run: dai bootstrap")
    else:
        check(".mcp.json exists", False, "dai bootstrap")

    # 5. Credentials
    authed = _state.is_authenticated()
    check("credentials stored (dai login)", authed, "dai bootstrap  or  dai login --key dsk_xxx")

    # 6. API key validates live
    if authed:
        try:
            client = DaiClient.from_state()
            dataspheres = client.get("/api/v1/dataspheres")
            count = len(dataspheres) if isinstance(dataspheres, list) else "?"
            base = _state.get_base_url()
            check(f"API key valid ({count} workspace(s) at {base})", True)
        except ApiError:
            base = _state.get_base_url()
            check("API key valid", False, f"dai login --key dsk_xxx --base-url {base}")
        except Exception as e:
            check("API reachable", False, f"check network or base URL ({e})")

    # 7. MCP enabled in Claude Code
    claude_json = Path.home() / ".claude.json"
    if claude_json.exists():
        try:
            data = json.loads(claude_json.read_text())
            enabled = data.get("enabledMcpjsonServers", [])
            is_enabled = any("dai-skills" in str(e) for e in enabled)
            check(
                "MCP server enabled in Claude Code",
                is_enabled,
                "type /mcp in Claude Code → find dai-skills → Enable → Reload Window",
            )
        except Exception:
            check(".claude.json readable", False)
    else:
        check(
            "Claude Code config found (~/.claude.json)",
            False,
            "open this folder in Claude Code first, then re-run dai doctor",
        )

    console.print()
    if all_ok:
        console.print("[bold green]All checks passed. You're all dai![/bold green]\n")
        raise typer.Exit(0)
    else:
        console.print("[yellow]Fix the issues above, then run [cyan]dai doctor[/cyan] again.[/yellow]\n")
        raise typer.Exit(1)


@app.command()
def update(
    project: Optional[str] = typer.Option(None, "--project", "-p", help="Target project path (default: CWD)"),
):
    """Pull latest dai-skills from GitHub and re-install into your project."""
    dai_dir = Path(__file__).parent.parent.parent

    console.print("Pulling latest dai-skills...")
    result = subprocess.run(["git", "pull"], cwd=str(dai_dir), capture_output=True, text=True)
    if result.returncode != 0:
        console.print(f"[red]Git pull failed:[/red] {result.stderr}")
        raise typer.Exit(1)
    console.print(f"[green]✓[/green] {result.stdout.strip() or 'Already up to date.'}")

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
