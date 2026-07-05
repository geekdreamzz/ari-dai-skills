# all-dai-sdd — The Enforced, Templated Protocol

This is the contract. all-dai-sdd is not a suggestion or a set of habits — it is a **protocol**
with three properties that the tooling guarantees:

1. **Templated** — every board item is authored from a canonical template. The template is a
   file; the required structure is a machine-readable spec; the two are kept in lock-step.
2. **Enforced** — the templates, the dependency chain, and the code↔task link are checked by
   gates that *block*, not gates that advise.
3. **Traceable** — every shipped artifact resolves, parent by parent, back to a verbatim user
   prompt. Nothing ships uncited.

> Principle (already true for page templates, now true for every tier):
> **the template is the file; the spec is the contract; the gate enforces both.**

---

## The ten tiers

Each column **is** the parent type of the next. Items never change column; `task.status`
carries lifecycle state (`TODO → IN_PROGRESS → DONE` / `BLOCKED`).

```
IN → RS → PC → VP → SS → DO → EP → TK → VC → AR
```

| Tier | Column | Template |
|------|--------|----------|
| IN | Intake | [templates/columns/IN.md](templates/columns/IN.md) |
| RS | Research & References | [templates/columns/RS.md](templates/columns/RS.md) |
| PC | Problem & Customer Segment | [templates/columns/PC.md](templates/columns/PC.md) |
| VP | Value Proposition | [templates/columns/VP.md](templates/columns/VP.md) |
| SS | Solution Specs & Scenarios | [templates/columns/SS.md](templates/columns/SS.md) |
| DO | Desired Outcomes | [templates/columns/DO.md](templates/columns/DO.md) |
| EP | Epics | [templates/columns/EP.md](templates/columns/EP.md) |
| TK | Tasks | [templates/columns/TK.md](templates/columns/TK.md) |
| VC | Validation Criteria | [templates/columns/VC.md](templates/columns/VC.md) |
| AR | Artifacts | [templates/columns/AR.md](templates/columns/AR.md) |

---

## Templated — where the templates live and how they stay honest

- **The files:** [`templates/columns/*.md`](templates/columns/) — one per tier, with the exact
  required front matter and section headers, plus guidance for each.
- **The spec:** `V2_TEMPLATES` in [`loop.mjs`](loop.mjs) — the same required sections and
  front-matter keys, as data.
- **The link:** [`templates/columns/generate.mjs`](templates/columns/generate.mjs) regenerates
  the files from that spec, so a template can never silently diverge from what the gate checks.

To author an item: copy the tier's template, fill every `_TODO_` section (no empties), set
`parent_uuid`, run `--stamp-uuids`, then `--advance`.

---

## Enforced — the four gates that block

| Gate | Runs on | Blocks when | Command |
|------|---------|-------------|---------|
| **Template gate** | every `--advance` | a required section or front-matter key for the item's tier is missing (`verifyV2Template`) | `loop.mjs --advance <id>` |
| **Chain gate** | every `--advance` + full-board sweep | `parent_uuid` is missing, dangling, or points at the wrong parent tier; duplicates; uncited artifacts | `loop.mjs --trace-audit` |
| **Review gate** | before the Ralph loop runs | the board has not been human-approved (`--request-review` → `--greenlight`) | `loop.mjs --greenlight` |
| **Commit gate** | every `git commit` | an **enforced** initiative has feature code staged with no task in-progress ([`sdd-commit-gate.sh`](sdd-commit-gate.sh)) | — |

### The commit gate — code must trace to a task

[`sdd-commit-gate.sh`](sdd-commit-gate.sh) is a portable, self-contained gate. Wire it into a
host repo's pre-commit hook:

```sh
sh .claude/skills/all-dai-sdd/sdd-commit-gate.sh || exit 1
```

It reads `.sdd-state.json` from the git root and, for the current initiative:

- **A task is in-progress** → pass.
- **No task in-progress, but `src/ apps/ packages/` code is staged:**
  - initiative has `"enforce": true` → **commit BLOCKED** ("start a task first").
  - initiative is `soft` (no flag) → **loud warning**, commit allowed.
- No feature code staged (docs, config, tests only) → pass.

**Enforcement is opt-in per initiative** so it can be rolled out without breaking in-flight work:

- New boards from `--scaffold-v2` are created with `"enforce": true`.
- Pre-existing initiatives are `soft` until you set `"enforce": true` on them in `.sdd-state.json`.
- Opt a single initiative out any time with `"enforce": false`.
- Emergency bypass for one commit (discouraged): `git commit --no-verify`.

---

## Traceable — nothing ships uncited

A VC passing its typed acceptance criteria scaffolds its AR with `status: TODO` and a citation
checklist. The AR cannot reach `DONE` until `verifyV2Artifact` passes:

- `code` → every cited file exists **and** carries the parent VC's uuid/key in a decorator comment
- `media` → per-asset metadata block: file name + sha256 + byte size
- `report` → at least two resolvable links

An empty scaffold can never count as shipped. `--trace-audit` sweeps the whole board and exits
non-zero on any ghost (dangling ref, broken chain, uncited artifact, missing stamp).

---

## The loop, start to finish

```bash
node loop.mjs --scaffold-v2 <slug> --name "<Initiative>"   # 10-tier board, enforce:true
# author IN→AR from templates/columns/*, then:
node loop.mjs --stamp-uuids
node loop.mjs --trace-audit            # chain + template + citation sweep (must be clean)
node loop.mjs --request-review         # surface board + dashboard; loop stays BLOCKED
node loop.mjs --greenlight             # HUMAN go-ahead — only now does work start
node loop.mjs --next                   # serve the next VC with its full parent chain
# ...implement against the in-progress task; commit gate keeps code traced...
node loop.mjs --advance <id>           # template + chain gates verify before it moves
```
