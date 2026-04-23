# dai-skills

Claude Code skills for [Dataspheres AI](https://dataspheres.ai).

Each skill is a slash command that runs inside Claude Code. Skills require a Dataspheres AI developer key — they work against any datasphere you own, on any project.

---

## Skills

| Skill | Command | What it does |
|---|---|---|
| [all-dai-sdd](./all-dai-sdd/SKILL.md) | `/all-dai-sdd` | Spec-Driven Development — publish specs, track tasks, live dashboard |

---

## Getting started

### 1. Get a Dataspheres AI developer key

Log in to [dataspheres.ai](https://dataspheres.ai), open any datasphere, go to **Settings → Developers**, and create an API key.

### 2. Set up your credentials

```bash
cat >> ~/.dataspheres.env << 'EOF'
DATASPHERES_API_KEY=dsk_your_key_here
DATASPHERES_BASE_URL=http://localhost:5173
EOF
```

`DATASPHERES_BASE_URL` points to your local dev server by default. Change to `https://dataspheres.ai` for production-only workflows.

### 3. Install skills

Clone this repo and run `install.sh` to add skills to a project:

```bash
git clone https://github.com/dataspheres-ai/dai-skills
cd dai-skills

# Install into a specific project
./install.sh all-dai-sdd --project /path/to/your/project

# Install all skills into a project
./install.sh --all --project /path/to/your/project
```

This copies the skill into `.claude/skills/<skill-name>/` in your project directory. Claude Code picks it up automatically — no restart needed.

### 4. Use a skill

Open Claude Code in your project and invoke:

```
/all-dai-sdd publish specs/my-feature
```

---

## Using all-dai-sdd

Minimal project setup — two files in your repo:

```
specs/my-feature/
├── 001-vision.md        ← spec pages (CommonMark + YAML frontmatter)
├── tasks.yaml           ← task definitions + targetDatasphere
└── tracker-schema.yaml  ← dataset schema + dashboard config
```

`tasks.yaml` must include `targetDatasphere` — the URI of the datasphere to publish to:

```yaml
project: my-feature
targetDatasphere: my-datasphere-uri
```

Then run `/all-dai-sdd publish specs/my-feature` and get back links to:
- Public spec docs
- Planner (filtered by initiative)
- Live tracker dataset
- Progress dashboard

See [all-dai-sdd/SKILL.md](./all-dai-sdd/SKILL.md) for the full workflow.

---

## Updating skills

Skills are plain markdown files. To update:

```bash
cd dai-skills
git pull
./install.sh all-dai-sdd --project /path/to/your/project
```

---

## Contributing

1. Fork this repo.
2. Add or edit a skill in its own directory (`my-skill/SKILL.md`).
3. Update this README's skills table.
4. Open a PR.

Skill frontmatter must include `name`, `description`, and `argument-hint`.

---

## License

MIT
