# SDD Column Templates

Canonical, fill-in-the-blank templates for every tier of the schema-v2 product-lifecycle
board. **These are the templated backbone of the protocol** — every board item is authored
from the template for its column.

| Tier | File | Parent | The item is… |
|------|------|--------|--------------|
| `IN` | [IN.md](IN.md) | — (root) | the verbatim origin prompt |
| `RS` | [RS.md](RS.md) | IN | research & references |
| `PC` | [PC.md](PC.md) | RS | problem & customer segment |
| `VP` | [VP.md](VP.md) | PC | value proposition |
| `SS` | [SS.md](SS.md) | VP | solution specs & scenarios |
| `DO` | [DO.md](DO.md) | SS | desired outcomes |
| `EP` | [EP.md](EP.md) | DO | epic (milestone) |
| `TK` | [TK.md](TK.md) | EP | task (micro-step) |
| `VC` | [VC.md](VC.md) | TK | validation criteria — the Ralph loop work unit |
| `AR` | [AR.md](AR.md) | VC | shipped artifact |

## How they're enforced

These templates are **not advisory**. The required front matter and section headers in each
file are the exact set `verifyV2Template()` in [`../../loop.mjs`](../../loop.mjs) checks. An
item that is missing a required section or front-matter key is **blocked at `--advance`** — it
cannot move forward in the lifecycle. The commit gate ([`scripts/pre-commit-gate.sh`](../../../../../scripts/pre-commit-gate.sh),
section `[9]`) additionally enforces that feature code is committed against an in-progress task
for initiatives that opt into enforcement.

See [`../../PROTOCOL.md`](../../PROTOCOL.md) for the full enforced lifecycle.

## Regenerating

The template files are generated from a single spec (which mirrors `V2_TEMPLATES` in
`loop.mjs`) so they can never silently drift:

```bash
node .claude/skills/all-dai-sdd/templates/columns/generate.mjs \
     .claude/skills/all-dai-sdd/templates/columns
```

If you change the required sections in `loop.mjs`, update `generate.mjs` to match and
regenerate. The two are intentionally kept in lock-step.

## Authoring an item

1. Copy the template for the tier you're creating.
2. Replace `<title>` and fill every `_TODO: fill in._` section — no empty sections.
3. Set `parent_uuid` to the live UUID of the parent-tier item (except `IN`).
4. Run `node loop.mjs --stamp-uuids` to mint this item's own `uuid`.
5. Run `node loop.mjs --advance <id>` — the gate verifies the template before it moves.
