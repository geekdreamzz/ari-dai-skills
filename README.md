<div align="center">

# dai-skills

**Give your AI assistant full control over Dataspheres AI**

[![PyPI](https://img.shields.io/pypi/v/dai-skills)](https://pypi.org/project/dai-skills/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## Setup (3 steps)

### 1. Get your API key

Go to **[dataspheres.ai/app/developers?tab=keys](https://dataspheres.ai/app/developers?tab=keys)** and create a new key.

Your key looks like `dsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

### 2. Clone and configure

```bash
git clone https://github.com/geekdreamzz/ari-dai-skills
cd ari-dai-skills
cp .env.example .env
```

Open `.env` and replace `dsk_your_key_here` with your real key. **Don't paste keys into chat** — they end up in conversation history.

> No git? [⬇ Download ZIP](https://github.com/geekdreamzz/ari-dai-skills/archive/refs/heads/main.zip) and unzip it instead.

### 3. Run bootstrap

```bash
./bootstrap.sh
```

This installs uv (if needed), installs dai-skills, authenticates against your API key, and configures the MCP connection — all in one shot.

When it finishes, it will tell you to:
1. **Type `/mcp` in Claude Code** — find `dai-skills` and click Enable
2. **Reload the window** — `Cmd/Ctrl+Shift+P → Reload Window`

That's it. After the reload, open Claude Code in this folder and Ari is ready.

> **Something not working?** Run `dai doctor` — it checks every layer and tells you exactly what to fix.

---

## Try it

```
Create a task called "Launch checklist" in my planner
Draft a newsletter about this week's updates
Run research on our top three competitors
List all my pages and summarize them
```

---

## What you get

14 skill domains — pages, planner, datasets, library, newsletters, surveys, research, dataspheres, sequences, presentations, AI drafting, spec-driven development, context management, and export.

---

## Manual setup (if you prefer to do it yourself)

Requires **Python 3.11+** and [uv](https://docs.astral.sh/uv/).

```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh      # Mac/Linux
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"  # Windows

# Install dai-skills
uv tool install dai-skills

# Authenticate (reads DATASPHERES_BASE_URL from env if set, defaults to prod)
dai login --key dsk_your_key_here

# Verify everything
dai doctor
```

---

## Keeping it updated

```bash
cd ari-dai-skills && git pull
```

Or tell your AI:

```
Update dai-skills to the latest version
```

To pin to a specific release: `git checkout v0.1.0`

---

## Other IDEs

### Cursor

After running `bootstrap.sh`, install the skill into your project:

```bash
./install.sh all-dai-sdd --project /path/to/your/project --ide cursor
```

This writes `all-dai-sdd.mdc` into `.cursor/rules/` so Cursor picks it up automatically. For MCP, add the server manually in **Cursor Settings → MCP**:

```json
{
  "mcpServers": {
    "dai-skills": {
      "command": "dai",
      "args": ["mcp", "start"]
    }
  }
}
```

Then restart Cursor. The `dai` binary path comes from `dai bootstrap` — if Cursor can't find it, run `which dai` and use the full path as `"command"`.

### GitHub Copilot (VS Code)

After running `bootstrap.sh`, install the skill:

```bash
./install.sh all-dai-sdd --project /path/to/your/project --ide copilot
```

This writes `all-dai-sdd.md` into `.github/instructions/`. Copilot picks up `.github/instructions/*.md` files as custom instructions automatically in VS Code.

MCP support in GitHub Copilot is available in VS Code 1.99+. Add the server in `.vscode/mcp.json` inside your project:

```json
{
  "servers": {
    "dai-skills": {
      "type": "stdio",
      "command": "dai",
      "args": ["mcp", "start"]
    }
  }
}
```

Then open the Copilot chat panel and select **Agent mode** — the dai-skills tools will be available.

---

<div align="center">

Built by [Dataspheres AI](https://dataspheres.ai) · *Use all dai. Every dai.*

</div>
