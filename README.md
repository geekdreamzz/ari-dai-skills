<div align="center">

# dai-skills

**Give your AI assistant full control over Dataspheres AI**

[![PyPI](https://img.shields.io/pypi/v/dai-skills)](https://pypi.org/project/dai-skills/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## Setup (3 steps)

### 1. Get your API key

Sign in at [dataspheres.ai](https://dataspheres.ai) → open any datasphere → **Settings → Developers → New Key**.

Your key looks like `dsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.

### 2. Download and open this folder

[**⬇ Download ZIP**](https://github.com/geekdreamzz/ari-dai-skills/archive/refs/heads/main.zip) — no GitHub account needed.

Unzip it, then open the folder in your IDE:
- **Claude Code** — `File → Open Folder`
- **Cursor** — `File → Open Folder`
- **VS Code + Copilot** — `File → Open Folder`

### 3. Tell your AI to set it up

Paste this into the chat (fill in your key and workspace):

```
Set up dai-skills for me.

My Dataspheres AI API key: dsk_your_key_here
My workspace URI: my-workspace

Please install and configure everything so I can use Dataspheres AI tools.
```

Your AI reads this folder, runs the install commands, and configures the MCP connection automatically.

That's it. Once it confirms setup is done, you can ask it to do anything in your Dataspheres AI workspace.

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

```bash
# 1. Install uv (fast Python runner)
curl -LsSf https://astral.sh/uv/install.sh | sh      # Mac/Linux
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"  # Windows

# 2. Install dai-skills
uv tool install dai-skills

# 3. Authenticate
dai login --key dsk_your_key_here --base-url https://dataspheres.ai

# 4. Set your workspace
dai use my-workspace

# 5. Check everything works
dai status
```

---

## Keeping it updated

Re-download the ZIP and open the new folder, or tell your AI:

```
Update dai-skills to the latest version
```

---

<div align="center">

Built by [Dataspheres AI](https://dataspheres.ai) · *Use all dai. Every dai.*

</div>
