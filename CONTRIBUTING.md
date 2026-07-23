# Contributing to dai-skills

Welcome! dai-skills is the open-source AI skill library for Dataspheres AI. Contributions — new skills, bug fixes, tool improvements — are all very welcome. Every contributor is an honorary dai-hard.

## Architecture

This repository ships agent-readable Markdown skills and Node.js utilities. It does not contain the Dataspheres API implementation, a Python package, or a local MCP server. Skills describe platform tools and REST endpoints; agents call the hosted platform directly.

## Adding a New Skill

A public skill consists of an agent operating manual and registry metadata:

```text
skills/<skill-name>/SKILL.md
skills/<skill-name>/skill.json
```

Start `SKILL.md` with:

```yaml
---
name: my-skill
description: One sentence describing what this skill does
argument-hint: "[action] [options]"
---
```

Add public registry metadata:

```json
{
  "visibility": "public",
  "repo": "github.com/geekdreamzz/ari-dai-skills"
}
```

Document only capabilities that exist on the hosted platform. Verify tool names and field shapes against `/api/mcp/schema` or the developer reference, and include the corresponding REST method and endpoint where useful. Never invent an endpoint or describe a planned capability as shipped.

Optional executable helpers must use Node.js 18+ and should avoid dependencies unless the capability genuinely requires one.

## Documentation Standards

- Include a realistic end-to-end workflow, not only a list of operations.
- Explain important authorization, URI-versus-database-ID, and asynchronous-job behavior.
- Include actionable error guidance using `.env` or `~/.dataspheres.env`; do not refer to the retired `dai` CLI.
- For page-producing skills, emit valid TipTap HTML and run the `tiptap-html` gate before publishing.
- Never commit credentials, private machine paths, or internal-only operations. See `REGISTRY.md`.

## Validation

Run the same dependency-free checks as CI:

```sh
git ls-files '*.mjs' | while IFS= read -r file; do node --check "$file"; done
git ls-files '*.sh' | while IFS= read -r file; do bash -n "$file"; done

tmp_dir="$(mktemp -d)"
bash install.sh --all --project "$tmp_dir" --copy
rm -rf "$tmp_dir"
```

CI also verifies that every directory containing `SKILL.md` has valid public `skill.json` metadata.

Use the pull request template and make sure CI passes before merge.

## License

MIT. By contributing, you agree your code will be released under the same license.
