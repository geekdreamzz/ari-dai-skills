<!-- dai-sync: skip -->
# all-dai-sdd — Spec-Driven Development

Drive feature implementation from a living spec hosted on Dataspheres AI. Seven-column lifecycle with pre-flight research gating, sub-checklist propagation, dependency enforcement, artifact tracing, and a live stakeholder dashboard.

---

## Claude-as-Executor — The Prime Directive

**Claude Code is the engineer. Not the user.**

Claude runs every command, installs every dependency, downloads every file, writes every line of code, runs every test, fixes every bug, and manages every process — autonomously, without talking to the user.

**What Claude does in LOOP mode:**
- Reads each task spec completely
- Executes every step using Bash and PowerShell tools
- Installs software (conda, pip, npm, apt, winget, silent installers)
- Downloads files (Invoke-WebRequest, curl)
- Creates directories, writes config files, edits code
- Runs tests and captures real output
- Diagnoses failures, tries alternatives, retries until working
- Updates task content with actual command outputs and findings
- Creates new EX/VA tasks when it discovers spec gaps
- Advances tasks only when AC criteria are verified by real output

**When Claude must NOT contact the user:**
- A command fails → diagnose and fix it
- A dependency is missing → install it
- A spec step is wrong → rewrite the spec, fix the approach
- A test fails → debug, fix, re-run
- An approach doesn't work → research alternatives, try them
- An install takes 30 minutes → wait, check output, continue

**The ONLY hard blockers requiring user escalation:**
1. Physical hardware unavailable (GPU not detected, no network)
2. Credential/token only the user possesses (Hugging Face token, paid API key)
3. License agreement requiring human acceptance in GUI with no CLI equivalent
4. System-level permission Claude cannot obtain (kernel driver requiring secure boot disable)

Everything else: Claude solves it. Silently. Until 100% done.

---

## Eight-Column Lifecycle

```
Intake  →  Research  →  North Stars  →  Epics  →  Execution  →  Validation  →  Artifacts  →  Done
```

Every SDD project uses exactly these eight columns, in this order. When you create a plan mode for an initiative, you must create eight status groups with these exact names — do NOT use the planner's default columns (To Do / In Progress / Done).

**The Intake column is the visible front door.** Any prompt, bug report, UAT result, or stakeholder feedback that arrives WHILE the loop is running becomes a card in the Intake column (`node loop.mjs --intake ...` creates both the `.sdd-intake.json` queue entry and the board card). Stakeholders see the queue; the loop processes it: critical items block `--next` until triaged, and `--triage INT-NNN` converts the card into an EX+VA pair and moves the intake card to Done. A board at "100% Done" with pending intake is NOT complete — `--next` returns `intake-pending`, not `complete`.

### Roles & Responsibilities

| Component | Owns | Must NOT do |
|---|---|---|
| **Claude (planner)** | Mode detection, asking the user clarifying questions BEFORE board generation, authoring RS/NS/EP/EX/VA content with verbatim user instructions embedded | Generate the board from assumptions when requirements are ambiguous |
| **Claude (executor)** | Working each checklist item: code → test → `--check-item` with evidence, then `--advance` | Asking the user anything during execution (see Prime Directive); mass-ticking checklists |
| **loop.mjs** | Sequencing (`--next`), per-item gating (`--check-item`), task gates (`--advance`), intake queue, remediation scaffolding, AR creation, IN_PROGRESS + `sdd-active` tracking, milestone comments up the hierarchy | Advancing anything without evidence (the bare mechanical loop is disabled) |
| **ralph-run.mjs** | The blind loop: fresh `claude --print` per task, sigil parsing, failure log injection | Bypassing loop.mjs gates |
| **sdd-conductor.mjs** | init, verify-gates, dashboard-check, update-dashboard, checklist propagation cascades (EX→EP→NS) | Board task advancement |
| **verify_gates.py** | The 12 structural invariants (trace chain, research gate, origin blockquotes…) | Behavioral verification (that is evidence gating in loop.mjs) |
| **User** | Origin prompts, clarity answers, UAT verdicts (`--uat <id> --outcome pass|fail`), intake submissions | — |

### User Clarity Protocol (planning phases only)

During **NEW / PUBLISH / APPEND** modes — before generating board content — Claude MUST surface ambiguities to the user instead of guessing:

1. Extract the core functional and non-functional requirements from the user's prompt.
2. List anything materially ambiguous (target platform? performance budget? auth model? visual style? scope boundary?).
3. Ask the user those questions in ONE batch (not a drip). Wait for answers.
4. Embed the original prompt AND every clarity answer **verbatim** into the tickets: RS/NS `Origin Prompts` sections quote them in `<blockquote>` with attribution + date; EX/VA inherit the relevant constraint lines in their FR/NFR sections.

This protocol applies ONLY to planning. Once the board is published and the loop is running, the Claude-as-Executor Prime Directive applies: no questions, solve everything autonomously — new information arrives via the Intake column instead.

**The Artifacts column is mandatory, not optional.** When a VA task passes its gate, the loop runner and conductor auto-create an AR (Artifact) task in the Artifacts column. AR tasks are the permanent, self-contained record of what was produced — they must be fully readable from the Dataspheres AI web UI with no local filesystem access required.

**AR task content rules (all mandatory):**

1. **Embed file contents directly** — paste the full text of every script, config, or spec file into a `<pre><code>` block. A local file path alone is useless; the web UI cannot open `C:\Users\...` paths.
2. **For binary artifacts** (images, videos, compiled models, .pt/.onnx files): upload to Dataspheres AI storage and embed the returned URL, OR include a `metadata.json` block with file name, SHA-256 checksum, size in bytes, and a description. Never store binary paths without a checksum.
3. **Embed real test output** — copy-paste the actual stdout/stderr from the verification run. Not a summary, the raw output.
4. **Add front matter** to every generated code file as inline comments at the top:
   ```
   # artifact: AR-016
   # initiative: faceless-pipeline
   # generated: 2026-06-08
   # verified-by: claude-sonnet-4-6
   # checksum: sha256:<hash>
   ```
5. **Stubs are a gate failure.** An AR task that contains only YAML front matter, file paths, or placeholder descriptions — with no embedded content — must be patched before the initiative can reach DONE mode.

Claude must populate AR tasks at the moment each VA passes — not deferred, not delegated to the user.

**The Research column is the origin gate.** Nothing enters North Stars without a corresponding Research task that has passed Validation. This is not optional and cannot be waived.

**Gate rules are JS-verified.** Run `node sdd-conductor.mjs verify-gates` to check all 10 gate invariants against the live board. CLEAN = all tasks pass. VIOLATIONS = list of exact task IDs and rules violated. Fix violations before advancing tasks.

---

## Research Column — Hard Rules

The Research column exists to prevent the most expensive category of SDD failure: **running Execution against an unvalidated approach**. A 153-minute HaplotypeCaller run producing F1=0.005 because the tool was wrong for the data type is the canonical example of what Research gates prevent.

### What a Research task must contain

Every Research task (`RS-NNN · <title>`) must contain ALL of the following sections:

```html
<h3>Origin Prompts <!-- #origin --></h3>
<h3>Problem Statement <!-- #problem --></h3>
<h3>Non-Functional Requirements <!-- #nfr --></h3>
<h3>Approach Under Evaluation <!-- #approach --></h3>
<h3>Search Results <!-- #search-results --></h3>
<h3>Codebase Context <!-- #codebase --></h3>
<h3>Sources <!-- #sources --></h3>
<h3>Feasibility Evidence <!-- #feasibility --></h3>
<h3>Recommendation <!-- #rec --></h3>
<h3>Validation Criteria <!-- #vc --></h3>
```

#### Non-Functional Requirements — mandatory section (hardened)

The `Non-Functional Requirements` section must document all system constraints extracted from the user's origin prompt. These become gates on every downstream EX and VA task.

**Every RS task must list NFRs explicitly.** Common NFR categories:

| Category | Example |
|---|---|
| Execution model | "100% local — all inference on RTX 5080 16GB VRAM, no cloud APIs" |
| Cost | "Zero cost — no paid API keys, no commercial inference fees" |
| Memory | "Total pipeline VRAM ≤ 14GB; system RAM ≤ 32GB" |
| Latency | "End-to-end pipeline < 120s per output" |
| Dependencies | "No internet at inference time; self-contained after model download" |

**The gate rejects any RS recommendation that references a paid/cloud API node.** Known violators: `KlingVirtualTryOnNode`, `FluxKontextProImageNode`, `FluxKontextMaxImageNode`, `RecraftImageInpaintingNode`, `RunwayImageToVideoNode`, and all other `api_node: true` ComfyUI nodes. If a node requires `auth_token_comfy_org` or `api_key_comfy_org` in its hidden inputs — it is a paid API node.

**How to check:** query `GET https://comfy.dataspheres.ai/object_info/<NodeName>` — if `"api_node": true` in the response, it is paid/cloud. Do NOT use it if the NFR requires local execution.

**The failure this prevents:** RS-001 recommending `KlingVirtualTryOnNode` (Kling cloud VTON API, $0.04/image) when the NFR clearly states "run everything 100% free on local RTX 5080 16GB VRAM."

#### Origin Prompts — verbatim requirement (hardened)

The `Origin Prompts` section must contain the **verbatim, quoted text** of every user prompt or brief that triggered this work. Not a summary. Not a paraphrase. The exact words.

**Correct:**
```html
<h3>Origin Prompts <!-- #origin --></h3>
<blockquote>
  <p>"build me a WGBS variant calling pipeline for NA12878 chr22 — gate on SNP F1 ≥ 0.95 vs GIAB NISTv4.2.1"</p>
  <p><em>— facelessaicoder, 2026-05-20</em></p>
</blockquote>
```

**Acceptable when no direct prompt exists:**
```html
<h3>Origin Prompts <!-- #origin --></h3>
<p>N/A — self-initiated research; no explicit user prompt. Triggered by failed HaplotypeCaller run on WGBS data (see RS-001 Feasibility Evidence).</p>
```

**Wrong (gate fails):**
```html
<h3>Origin Prompts <!-- #origin --></h3>
<p>The user wants a variant calling pipeline.</p>
```

A paraphrase is not an origin prompt. The gate accepts: a `<blockquote>` with verbatim text, OR a note explaining why no direct prompt exists. A vague summary with neither is a gate failure.

#### Search Results — verbatim excerpts required (hardened)

The `Search Results` section must contain the **actual returned search result excerpts** from `start_research` or `web_search` — not a summary of what was found. Each result must be quoted verbatim with its source cited.

**Correct:**
```html
<h3>Search Results <!-- #search-results --></h3>
<blockquote>
  <p>"GATK HaplotypeCaller is not designed for use on bisulfite-converted reads. For WGBS data, tools such as BisSNP or Bismark's SNP calling module should be used instead."</p>
  <cite><a href="https://gatk.broadinstitute.org/hc/en-us/articles/360035531672">GATK HaplotypeCaller overview</a></cite>
</blockquote>
<blockquote>
  <p>"BisSNP achieves F1=0.97 on GIAB NA12878 chr22 WGBS data with bisulfite-aware realignment..."</p>
  <cite><a href="https://doi.org/10.1093/bioinformatics/btu395">Liu et al., 2012</a></cite>
</blockquote>
```

**Acceptable when no external search was run:**
```html
<h3>Search Results <!-- #search-results --></h3>
<p>N/A — purely internal architectural decision based on existing team knowledge. No external search conducted; see Codebase Context for the prior code this builds on.</p>
```

**Wrong (gate fails):**
```html
<h3>Search Results <!-- #search-results --></h3>
<p>Search results confirmed that GATK is not suitable and BisSNP is the recommended tool.</p>
```

The gate accepts: `<blockquote>` excerpts from actual search results, OR a note explaining why no external search applies. A summary with neither is a gate failure.

#### Codebase Context — existing code paths + snippets required (hardened)

The `Codebase Context` section must reference the **actual existing source files** in the codebase that are relevant to the approach being evaluated, with at least one verbatim code snippet. If no existing code is relevant, declare it explicitly.

**Correct (existing code present):**
```html
<h3>Codebase Context <!-- #codebase --></h3>
<p>Relevant existing files:</p>
<ul>
  <li><code>src/pipeline/variant_caller.py</code> — current HaplotypeCaller wrapper</li>
  <li><code>src/pipeline/bwa_aligner.py</code> — alignment step this task replaces</li>
</ul>
<pre><code class="language-python">
# src/pipeline/variant_caller.py:42
def call_variants(bam_path: str, reference: str) -> str:
    return subprocess.run([
        "gatk", "HaplotypeCaller",
        "-I", bam_path, "-R", reference, "-O", "output.vcf.gz"
    ], check=True)
</code></pre>
<p>This is the function we are replacing — BisSNP requires a different invocation pattern.</p>
```

**Acceptable when no existing code applies:**
```html
<h3>Codebase Context <!-- #codebase --></h3>
<p>Not applicable — this is a greenfield pipeline component. No prior implementation exists in this repo for WGBS variant calling.</p>
```

Or even just:
```html
<h3>Codebase Context <!-- #codebase --></h3>
<p>N/A — no existing code in this area.</p>
```

**Wrong (gate fails):**
```html
<h3>Codebase Context <!-- #codebase --></h3>
<p>We will need to look at the existing pipeline code before implementing.</p>
```

The gate accepts: `src/` paths + `<pre><code>` snippet showing relevant existing code, OR a note explaining why none applies. A vague intention to look later is a gate failure — the agent must make the call at research time, not defer it.

#### Sources — citation requirement (hardened)

Every Research task must cite **at least two sources** with URL or DOI. Sources must be relevant to the approach under evaluation — not generic documentation links.

```html
<h3>Sources <!-- #sources --></h3>
<ul>
  <li><a href="https://doi.org/10.1093/bioinformatics/btu395">BisSNP: Fast DNA methylation and SNP calling (Liu et al.)</a> — bisulfite-aware SNP calling, validated on WGBS data</li>
  <li><a href="https://gatk.broadinstitute.org/hc/en-us/articles/360035531672">GATK HaplotypeCaller docs</a> — explicitly states not designed for bisulfite-converted reads</li>
</ul>
```

Inline citations without URLs are accepted only when citing internal documents, where the document path replaces the URL.

#### Feasibility Evidence — dry-run requirement for compute-heavy work

For any Execution task that involves >10 minutes of compute, the Research task must include a dry-run gate:

```html
<h3>Feasibility Evidence <!-- #feasibility --></h3>
<p><strong>Dry-run:</strong> Ran <code>[tool] on [1M-read / 100kbp subset]</code> — runtime: Xm, output: [file or metric], confirms approach viable.</p>
```

If the dry-run fails or is skipped: task is BLOCKED. The full run may not start.

### Research → North Star gate

**A North Star may not enter the Epics column until its Research task is in the Done column.**

The blocking is enforced via the `research_ref` field in the North Star front matter. At every NS → Epics transition, the system checks:

```python
research_task = get_task(ns.research_ref)
assert research_task.column == 'done', f"NS {ns.id} blocked — Research task {ns.research_ref} not Done"
```

If the Research task is in any column other than Done, the NS is marked BLOCKED with:
```
[BLOCKED] NS-XXX cannot enter Epics — Research task RS-XXX is in [column], not Done.
Required: Complete RS-XXX validation and move it to Done before this NS can proceed.
```

### Research task ID format

```
RS-001 · <concise description of what is being researched>
```

Research tasks use `RS-` prefix. The trace graph adds a Research tier above North Stars:

```
Research (RS)  →  North Stars (NS)  →  Epics (EP)  →  Execution (EX)  →  Validation (VA)  →  Artifacts
```

### Live Research Invocation — `start_research` integration

**Ari does not scaffold empty RS tasks.** When all-dai-sdd creates a Research task, it runs the research live and populates the task with real findings before moving on.

#### When to invoke `start_research`

Invoke research whenever any of these conditions are true — in **any mode**:

| Trigger | Action |
|---|---|
| Creating a new RS task (any mode) | Run `start_research` → populate Sources, Feasibility Evidence, Recommendation |
| APPEND mode hits an unresolved approach question | Research first, then draft EX tasks from findings |
| AUDIT finds RS task with < 2 sources | Re-run research to fill the gap |
| User asks "which tool / approach / library should we use?" | Research before answering |
| Any EX task requires a non-obvious technical decision | Create RS task + invoke research inline |

#### How to invoke

```python
# 1. Start research — returns immediately, populates async
result = start_research(
    query="<precise question about the approach under evaluation>",
    title="RS-NNN · <title>",
)
conv_id = result["conversationId"]

# 2. Wait ~4s, then poll
import time; time.sleep(4)
messages = get_research_messages(conversation_id=conv_id)
findings = messages[-1]["content"]  # AI synthesis with web citations

# 3. Follow up if needed
continue_research(conversation_id=conv_id, follow_up="Compare the top 3 options in a table")

# 4. Populate the RS task — Sources come from webSearchResults, not invented
sources = messages[-1].get("webSearchResults", [])
```

The research **query must match the Approach Under Evaluation** section exactly — it should be phrased as the specific technical question being resolved, not a generic topic.

#### Citation rule

Every URL in the RS task `## Sources` section must come from `webSearchResults` returned by `start_research` or `continue_research`. Invented URLs or generic doc links fail the Research gate.

#### Lightweight lookups: `web_search`

For quick single-question lookups (not full RS tasks), use `web_search` directly:
```python
results = web_search(query="rtg vcfeval --region --bed-regions mutual exclusion")
```
Use this for: flag compatibility checks, version lookups, error messages. For full approach validation (new tool choice, architectural decision), use `start_research` and create an RS task.

### What the Research column prevents (by example)

| What skipping Research caused | What a Research task would have forced |
|---|---|
| HaplotypeCaller on WGBS → F1=0.005, 153 min wasted | RS: "Verify HaplotypeCaller supports bisulfite reads" → BLOCKED, BisSNP sourced first |
| `--region` + `--bed-regions` conflict in vcfeval | RS: "Validate rtg vcfeval flags for region-restricted calling" → flag conflict caught in dry-run |
| Stale mocks passing unit tests, prod migration fails | RS: "Verify integration test approach against real DB" → mock-free approach validated |

---

---

## Entry Points — all-dai-sdd Runs Anytime

`/all-dai-sdd` can be invoked at any stage of a project. On every invocation, the first step is always: **assess current state, then determine mode**.

### Step 0 — State Assessment (always runs first)

**Priority order — check from top, first match wins. Do not read further once a match is found.**

| Priority | Condition | Mode |
|---|---|---|
| **1 — highest** | Any VA task in Validation column has ≥1 comment containing "Ralph loop" or "failed iteration" | **LOOP** — resume immediately; supersedes all other modes |
| **2** | `done_count === total_count && total_count > 0` | **DONE** — generate Next Steps & UAT page immediately; no confirmation |
| **3** | Board exists, no tasks.yaml | **AUDIT** |
| **4** | Board exists, tasks.yaml exists | **SYNC** |
| **5** | No board, tasks.yaml exists | **PUBLISH** |
| **6** | No board, no tasks.yaml | **NEW** |

**LOOP supersedes everything.** A failing VA task means the system is mid-iteration — resume before doing anything else. Do not run AUDIT, SYNC, or NEW while a Ralph loop iteration is in flight.

**DONE mode supersedes NEW/PUBLISH/AUDIT/SYNC.** When all tasks are Done, generate the Next Steps page before doing anything else.

Before taking any further action, answer these six questions:

1. **Does any VA task in the Validation column have ≥1 failed iteration comment?** → if YES → **LOOP immediately** (skip remaining questions)
2. **Is there an active datasphere?** → call `get_context()` or check for `targetDatasphere` in tasks.yaml
3. **Does a plan mode already exist for this initiative?** → `list_plan_modes(dsId)`
4. **Are there existing tasks on the board?** → `list_tasks(dsId, planModeId)`
5. **Is there a local tasks.yaml?** → check `<project-dir>/tasks.yaml`
6. **Are ALL tasks in the Done column?** → count tasks where `statusGroupId === doneGroupId`; if `done === total && total > 0` → **DONE mode is mandatory, runs immediately, no confirmation needed**

**Session resume:** also check `.sdd-state.json` for `activeTaskId` — if set, Claude was mid-task when the last session ended. Run `node loop.mjs --next` to confirm it's still the right task, then resume from it rather than re-scanning the board from scratch.

### Mode: NEW (full publish)
→ Proceed to Step 1 of the 14-step publish protocol below.

### Mode: PUBLISH (board doesn't exist, tasks.yaml does)
→ Skip directly to Step 4 (resolve dsId), then continue from there.

### Mode: DONE (all tasks in Done column) ⚠️ HARD GATE

**Triggered when:** `done_count === total_count && total_count > 0`

This mode runs **immediately and autonomously** — no user confirmation, no skipping. It is not optional.

**Steps (Claude executes all of these without waiting):**

1. Pull all tasks from the live board — confirm `done_count === total_count`
2. Pull the page list for the datasphere — check if a Next Steps & UAT page already exists (slug contains `next-steps` or `uat`)
3. **If page already exists:** post a comment to the most recently completed NS task confirming the page URL, then stop
4. **If page does NOT exist:** generate it immediately using the "Next Steps Page Template" section below — no confirmation required
5. **To build the page content:**
   - Read every NS task's title and description (to name the Epic cards)
   - Read every EX task's verdict comment for the UAT AC lines
   - Collect any known gaps from evidence comments tagged `[HARD BLOCKER]` or `[PARTIAL PASS]`
   - Build the full HTML following the exact template structure (hero → progress widget → epic cards → UAT → loose ends → CTA → attribution → footer)
6. Publish the page as `status: PUBLISHED`, `isInternal: true`, slug `<initiative>-next-steps`
7. Output the page URL to the user

**This gate exists because:** 100% Done without a summary page means the work is invisible to stakeholders. Every completed initiative MUST have a human-readable close-out page.

**Failure mode this prevents:** Claude advances all 61 tasks to Done, posts evidence, and stops — leaving the user with no summary of what was built, what's verified, and what still needs manual testing.

### Mode: AUDIT (board exists, no local spec)
1. Pull all tasks from the live board via API
2. **Check for DONE mode first** — if all tasks are Done, switch to DONE mode immediately
3. Generate a `tasks.yaml` representing current board state
4. Run `node sdd-conductor.mjs verify-gates` against it — report violations
5. Assess what's missing: Research tasks without sources? NS without research_ref? EX tasks without epic_ref? Epics without EX tasks?
6. Generate the delta: new tasks to add, existing tasks to update, violations to fix
7. Confirm with user, then apply

### Mode: SYNC (both exist)
1. Load tasks.yaml
2. Pull live board state from API
3. Diff: tasks in yaml not on board → CREATE; tasks on board not in yaml → flag as ORPHANED; tasks in both → check for content drift
4. Run `node sdd-conductor.mjs verify-gates` on the merged state
5. Apply delta — create missing, update drifted, report orphans
6. Always run `node sdd-conductor.mjs verify-gates` after sync to confirm CLEAN

### Mode: LOOP

Triggered automatically when: (a) a VA task in the Validation column has at least one failed iteration, or (b) the user says "keep going", "run continuously", "drive to done", "loop until 100%", or similar.

---

#### ⚠️ CRITICAL: Claude IS the executor — never rubber-stamp

The worst failure mode in SDD is an AI marking tasks Done without doing the work. Ticking all checkboxes and posting a boilerplate "PASS" comment while the implementation is untested or broken is **worse than leaving the task in Execution** — it creates false confidence.

**Claude must:**
- READ each task's full content before advancing it
- EXECUTE the implementation (run commands, write files, call APIs)
- ANALYZE outputs — real results vs the AC thresholds, not assumed
- UPDATE tasks with learnings — bugs found, approaches tried, fixes applied
- Only ADVANCE when the evidence is real and traceable

**Claude must NOT:**
- Tick all checkboxes without verifying each criterion
- Post a gate comment before running anything
- Mark a VA task Done without actually testing the acceptance criteria
- Assume an EX task is complete because the spec says it should work
- Use `node loop.mjs` (bare, no flags) when Claude is in the conversation — that path rubber-stamps

---

#### AI-Driven Loop Protocol (mandatory when Claude is active)

```bash
# Step 1 — read the next task (marks it IN_PROGRESS + sdd-active on the board)
node skills/all-dai-sdd/loop.mjs --next
# → outputs JSON: { status, done, total, pct, task: { id, title, key, type, content } }

# Step 2 — PER-ITEM PROTOCOL: work the checklist ONE ITEM AT A TIME.
# For EACH unchecked item, in order: do the real work for that single item
# (write the code, run the test, capture the screenshot), then verify it:
node skills/all-dai-sdd/loop.mjs --check-item <taskId> --item <N|"text match"> --evidence "
<real output for THIS item — command output, test result, file path, measured value>
"
# Each --check-item ticks exactly ONE box and posts a per-item evidence comment
# (this is the item's artifact record; it appears in the live activity feed and
# is aggregated into the AR task when the VA passes). Items mentioning
# screenshot/playwright/e2e require a screenshot path or 'N passed' output.
# On failure of an item: fix it, or if blocked / the plan is wrong, pivot:
#   node loop.mjs --create-fix <taskId> --reason "what is wrong; what must change"

# Step 3 — when EVERY box was earned, advance with overall evidence
node skills/all-dai-sdd/loop.mjs --advance <taskId> --evidence "
[EXECUTED]
<command or test that was run>

[OUTPUT]
<actual output — file paths, numbers, error messages, screenshots>

[VERDICT]
<what passed, what failed, what was fixed>
"
# --advance REJECTS the task if any checklist item is still unchecked — there is
# no mass-ticking. Evidence is validated: min 200 chars, boilerplate rejected,
# UI VA tasks require fresh on-disk screenshots + Playwright 'N passed' output.
# On success the loop posts a milestone comment to the parent EP and NS so the
# live activity feed shows hierarchy-level progress.
#
# Task-type specifics for step 2:
#   EX task: implement code (with spec front-matter comments), verify files exist, smoke test
#   VA task: run each AC criterion via --check-item; UI flows need real Playwright interactions
#   EP task: requiresAcVerification:true — verify every AC/FR/NFR item individually
#   NS task: same as EP
#   RS task: requiresResearch:true — start_research() FIRST, Sources from webSearchResults
```

**`validation_kind` front matter routes VA evidence gates.** A VA task whose title pattern-matches UI keywords gets the screenshot gate by default. When the validation is NOT visual, declare it in the VA front matter (or stamp it at triage with `--validation-kind`):

| `validation_kind` | Evidence gate requires |
|---|---|
| *(absent — UI default)* | Fresh on-disk screenshots (<24h), Playwright `N passed`, ≥2 shots for interaction flows |
| `api` / `backend` | Quoted `/api/` endpoint paths + asserted HTTP status codes + test runner `N passed` — API tests are first-class artifacts |
| `benchmark` | Measured values with units (ms, MB, %, req/s) compared against AC thresholds + runner output |

**Decorator linkage is exact-key, enforced at --advance.** Every file in an EX task's Implementation Files must reference THIS spec's key — `// artifact: EX-NNN` in the header for new files, or an inline decorator at the change site for shared files (`// spec: EX-NNN | initiative: <slug> — what this change does`). A header citing some other spec does not link the file. Front matter refs (`execution_ref`, `epic_ref`, `north_star_ref`) must resolve to real tasks on the board, and the `<!-- #ac -->` heading anchor must be present — all three are hard advance gates.

**Evidence must contain real substance:**

| Task type | Evidence must include |
|---|---|
| EX | File existence check (`ls -la path/to/file`), import or smoke test output |
| VA | Actual measured value vs AC threshold (e.g. `denoise=0.90 → output saved at outputs/test.png`) |
| EP | Each AC/FR/NFR item quoted + individual pass/fail verdict + child task keys confirmed Done |
| NS | Each AC/FR/NFR item quoted + individual pass/fail verdict + all child Epics confirmed Done |
| RS | ≥2 real URLs from `webSearchResults`, verbatim excerpts quoted, feasibility finding documented |
| AR | **Embedded content only** — full file text in `<pre><code>` blocks for text files; uploaded URL or metadata.json (name + sha256 + size) for binaries; raw test output pasted verbatim. A path without content is a gate failure. |

---

## Image Generation VA Gate (HARD GATE — never skip)

Any VA task whose title contains: `synthesis`, `transfer`, `garment`, `character`, `render`, `inpaint`, `upscale`, `pipeline`, `tryon`, `outfit`, `cloth`, `generates`, `wears`, `image` — is an **image generation VA task** and requires visual evidence.

**Before calling `--advance` on an image generation VA task, Claude MUST:**

1. **Run the generation code** and capture the output file path and ComfyUI job URL
2. **Use the `Read` tool on the output image file** (e.g. `Read outputs/test/stage1_char.png`) — you must see the actual pixels, not just confirm a file exists
3. **Write a visual description** of what is actually visible: identity match, garment placement, scene, artifacts, failures
4. **Evaluate each AC criterion** based on what you see — not based on "the job completed"

**Your evidence string for image VA tasks MUST contain:**
- The output file URL (ComfyUI `/view?filename=...` or local path)
- A visual description of what the output image shows (minimum 3 sentences)
- Explicit pass/fail verdict per AC criterion based on visual inspection

**The gate rejects these as sole evidence:**
- `"job ran"` / `"job completed"` — you saw no pixels
- `"file saved to outputs/"` — you saw no pixels
- `"no RuntimeError"` — technical success ≠ visual correctness
- `"output at URL [X]"` with no visual description — you didn't look
- `"pid = <uuid>"` alone — a job ID is not a visual confirmation

**The failure this prevents:** advancing VA-022 (garment transfer) with `pid=0c7aa6ba` as evidence — only to discover the "garment transfer" output is the reference image plastered behind a naked character. The pipeline ran. The output was garbage. The gate should have caught it.

**What to do when a task fails:**
1. Post a comment on the task documenting what failed and why
2. Fix the issue (edit code, install dependency, change approach)
3. Re-run and verify the fix works
4. Advance with evidence that includes the failure → fix → re-run trace
5. If unfixable: mark task BLOCKED with a detailed blocker comment

---

#### Mechanical Loop (headless / no AI in context)

The bare mechanical loop is for CI/CD or unattended runs where no AI is present. It ticks checklists and moves tasks but posts only structural gate comments — **it does not test, execute, or verify anything**.

```bash
node skills/all-dai-sdd/loop.mjs                      # active initiative
node skills/all-dai-sdd/loop.mjs --initiative <slug>  # specific initiative
node skills/all-dai-sdd/loop.mjs --dry-run            # preview only
```

**When Claude is in the conversation, this mode is BANNED.** If you see the bare loop suggested, override it with the AI-driven protocol above.

---

#### Utility modes

```bash
node loop.mjs --backfill-artifacts                      # create AR tasks for Done VA tasks retroactively
node loop.mjs --health                                  # validate initiative config + board (13 structural checks)
node loop.mjs --create-fix <taskId> --reason "..."     # create EX+VA remediation pair for a failing task
node loop.mjs --create-fix <taskId> --reason "..." --dry-run  # preview without writing
```

#### Continuous Intake (follow-up instructions, UAT results, stakeholder feedback)

The intake queue (`/.sdd-intake.json`, scoped per initiative) is the structured way to feed new work into a running initiative without breaking traceability. Four commands:

**Add a new intake item:**
```bash
node loop.mjs --intake \
  --intake-type instruction \          # instruction | uat-result | stakeholder-feedback
  --intake-priority high \             # critical | high | normal
  --intake-summary "Short description" \
  --intake-body "Full context or instructions"
```
- `critical` priority **blocks `--next`** until triaged — use for must-fix-before-continuing work
- `high` / `normal` appear as `pendingIntake` advisory in the `--next` output (non-blocking)

**Triage an item → board tasks:**
```bash
# Create new EX+VA board tasks from the intake item:
node loop.mjs --triage INT-001 --target-type EX
node loop.mjs --triage INT-001 --target-type EX --dry-run   # preview

# Or add context to an existing task as a comment:
node loop.mjs --triage INT-001 --target-ref EP-002
```

**Check the intake queue (auto-sweeps done triaged items):**
```bash
node loop.mjs --intake-status
node loop.mjs --intake-status --pending-only
```

**Run UAT on a VA task:**
```bash
# UAT pass → moves VA to Done + creates AR artifact + logs intake uat-result:
node loop.mjs --uat VA-003 --outcome pass --evidence "19/19 tests passed. Screenshot: tests/e2e/screenshots/..."

# UAT fail → creates EX+VA remediation pair + logs intake uat-result:
node loop.mjs --uat VA-003 --outcome fail --evidence "Modal close button not found; screenshot missing from AR-003"
```

**`--next` intake awareness:**
- If any `critical` intake items are pending → returns `{ status: "intake-blocked", pendingIntake: [...] }` — triage them first
- If `high`/`normal` items are pending → returns the normal next task but adds `pendingIntake: [...]` advisory field

**LOOP mode is the default behavior — not an exception.** Not waiting for the user is the rule. But not waiting does not mean not verifying.

**Loop completion → DONE mode is automatic.** When `node loop.mjs --next` returns `{ "status": "complete", "generateNextStepsPage": true }`, Claude must immediately transition to DONE mode — generate the Next Steps & UAT page as specified above. No user prompt required. No re-invocation of `/all-dai-sdd` required. The `generateNextStepsPage: true` flag IS the trigger. Stopping after loop completion without generating the page is an incomplete execution.

### Mode: REFACTOR
Triggered when user says "refactor", "restructure", or "reorganize":
1. Pull live board state
2. Run `node sdd-conductor.mjs verify-gates` — report all violations as baseline
3. Propose restructured task set (new epics, reassigned tasks, updated refs)
4. Show diff: what moves, what gets added, what gets removed
5. Confirm, then apply via bulk update

### Mode: VERIFY
Triggered when user says "verify", "check gates", or "verify gates":
1. Pull live board or use local tasks.yaml
2. Run `node sdd-conductor.mjs verify-gates`
3. Report CLEAN (all good) or VIOLATIONS with exact counterexamples (task ID + rule)
4. If violations found: propose minimal fixes (which tasks need which field changes)
5. Apply fixes on user confirmation

### Mode: APPEND
Triggered when user describes new work to add to an existing initiative:
1. Pull current epics
2. **If approach is unresolved** → invoke `start_research` before drafting any tasks
3. Draft new tasks (Research first if new approach, otherwise EX tasks under existing Epic)
4. Run `node sdd-conductor.mjs verify-gates` on combined set
5. Confirm, then bulk create

### Mode: RESEARCH
Triggered when user asks "research X", "look up Y", "which approach should we use for Z", or "is X the right tool for Y":
1. Invoke `start_research(query=<precise question>)` — do not ask the user to do this manually
2. Poll `get_research_messages` (~4s wait)
3. Follow up via `continue_research` if answer is incomplete or needs comparison table
4. If the question is an architectural decision: create a full RS task populated with findings
5. If it's a quick lookup (flag compatibility, version, error meaning): answer directly from search results, no RS task needed
6. Always cite URLs from `webSearchResults` — never invent sources

---

## sdd-conductor — Enforcement Layer

**all-dai-sdd depends on `sdd-conductor` for hard lifecycle enforcement.** Markdown instructions are advisory; conductor commands are machine-checkable. A non-zero exit is a hard gate — Claude Code surfaces the error and the LLM cannot proceed.

### One-time setup (run in the project being tracked)

```bash
# 1. Install Claude hooks into the project's .claude/settings.json
node /path/to/dai-skills/skills/sdd-conductor/sdd-conductor.mjs install

# 2. Bootstrap .sdd-state.json (resolves dsId, planModeId, statusGroupIds from the live API)
node /path/to/dai-skills/skills/sdd-conductor/sdd-conductor.mjs init
```

After setup, `.sdd-state.json` in the project root is the single source of truth. Claude hooks fire automatically on every file write and session start — no extra steps required.

### What the conductor enforces

| Command | Gate | Exits 1 if |
|---|---|---|
| `start <taskId>` | Deps-done | Any `depends_on` task not in Done column |
| `complete <taskId>` | Checklist | Any `data-checked="false"` item remains (AC + FR + NFR) |
| `complete <taskId>` | Comment | No `[all-dai-sdd-system-message]` completion comment |
| `complete <taskId>` | No-mocks | Mock/stub pattern found in impl files |
| `validate <vaTaskId>` | Anti-rubber-stamp | Any AC/FR/NFR item unchecked — lists exactly which ones |
| `validate <vaTaskId>` | Chain: VA→EX | Moves parent EX to Done after VA passes |
| `validate <vaTaskId>` | Chain: EX→Epic | Runs Epic AC/FR/NFR validation when all EX done |
| `validate <vaTaskId>` | Chain: Epic→NS | Runs NS AC/FR/NFR validation when all Epics done |
| `gate deps-done <id>` | Deps | Same as start |
| `gate checklist <id>` | Checklist | Same as complete |
| `gate no-mocks <file>` | Mocks | Same as complete |
| `gate research-done <id>` | Research | RS task not in Done |
| `gate hierarchy <id>` | Parent refs | VA missing execution_ref / EX missing epic_ref / Epic missing north_star_ref |
| `check-file-hook` (auto) | File guard | File written not in active task's `Implementation Files` (warning, not block) |
| `session-start` (auto) | Drift | Active task out of sync with live API |

---

## Quickstart

```bash
# Run on any project — all-dai-sdd detects the right mode automatically
/all-dai-sdd <project-dir-or-initiative-name>

# Examples:
/all-dai-sdd specs/dai-desktop        # auto-detects: SYNC or NEW
/all-dai-sdd --verify dai-desktop     # force VERIFY mode — run verify-gates
/all-dai-sdd --refactor dai-desktop   # force REFACTOR mode
/all-dai-sdd --append dai-desktop     # force APPEND mode (add new tasks)
/all-dai-sdd --audit dai-desktop      # force AUDIT mode (pull board → generate yaml)

# Always safe to run — assessment is read-only until you confirm the delta
```

---

## No Mocks Rule — Hardened Enforcement

**Mocks are bugs. They are never acceptable at any layer of an SDD project.**

**Gate rules are JS-verified by `sdd-conductor verify-gates` — not just asserted.** CLEAN means no task in the initiative violates any invariant. VIOLATIONS output lists the exact task ID and rule that failed.

A mock is defined as any of the following:
- A stub function that returns hardcoded or synthetic output instead of calling the real tool
- A synthetic data file that substitutes for a real golden dataset
- A `generate_mock_data.py` or equivalent that injects fake inputs to avoid downloading real reference files
- A `unittest.mock`, `MagicMock`, `patch`, or any Python mock/patch mechanism on pipeline functions
- A conditional `if not tool_available: return fake_result` fallback
- Any comment saying "we'll replace this with the real thing later"

**When a dependency is missing, the task is BLOCKED — not worked around.**

### BLOCKED task protocol

1. Mark the task status `BLOCKED` immediately on discovery
2. Post a comment on the task with this exact format:
   ```
   [BLOCKED] <dependency name> not available.
   Required: <exact install steps or acquisition steps>
   Blocks: <list of downstream task IDs>
   Resolution: <what must happen before this task can move to Execution>
   ```
3. Every downstream task that depends on the blocked task is also marked `BLOCKED` with a note referencing the upstream blocker
4. No code in any downstream file may call, import, or reference the blocked tool — not even with a try/except guard
5. The BLOCKED status cascades in the SDD board: no task in Execution or Validation can be marked Done while an upstream blocker is unresolved
6. A task leaves BLOCKED only when the dependency is installed, verified working with `which <tool>` or equivalent, and the verification output is pasted into the task comment

### What this rule means in practice

- GATK4 not installed → `variant_caller.py` exists as a documented interface only; task = BLOCKED
- BWA-meth not on PATH → `methylation.py` = BLOCKED; all Tier 1 Validation tasks = BLOCKED
- FoldX/PyRosetta no license → `energy_calc.py` = BLOCKED; Tier 3 Validation = BLOCKED
- hap.py not installed → `validate_tier1.py` = BLOCKED
- Golden dataset not downloaded → Validation task that uses it = BLOCKED until download verified

### Enforcement in gate checks

At every Execution → Validation gate: scan all task contents for any of:
`mock`, `stub`, `fake`, `patch`, `MagicMock`, `generate_mock`, `synthetic`, `placeholder`, `TODO: replace`

If found → gate fails with:
```
🚫 GATE [N/14] BLOCKED — Mock/stub detected in <file>:<line>
Required: Remove mock, install real dependency, and re-run.
```

This check is mandatory before any task may move to the Validation column.

---

## Mode: NEW/PUBLISH — Gated Publish Protocol (14 Steps)

This protocol runs when starting a new initiative (Mode: NEW) or publishing a local spec to a new board (Mode: PUBLISH). For existing initiatives, see Entry Points above — the right mode is auto-detected.

**Every step is mandatory. No step may be skipped, reordered, or batched with another.**

After completing each step you MUST output a gate block before touching anything for the next step:

```
✅ GATE [N/14] <step-name> | <ISO-timestamp> | <evidence>
```

If a step cannot be completed, output this and STOP — do not proceed:

```
🚫 GATE [N/14] BLOCKED — <reason> | Required before continuing: <what must happen>
```

The gate block is the contract. Its absence means the step was skipped. Its evidence line must be falsifiable — paste the actual API response ID, file path, or count. "Done" or "completed" with no evidence is not accepted.

---

### Step 1 of 14 — Load env
→ *Detail: line 193 (Credential Setup)*

```bash
export $(grep -v '^#' ~/.dataspheres.env | xargs)
```

Verify all three vars are non-empty: `DATASPHERES_API_KEY`, `DATASPHERES_BASE_URL`, `DATASPHERES_PUBLIC_URL`.

**Gate evidence required:** `API_KEY=dsk_***, BASE_URL=<value>, PUBLIC_URL=<value>`

---

### Step 2 of 14 — Read tasks.yaml
→ *Detail: line 238 (tasks.yaml shape)*

Parse `<project-dir>/tasks.yaml`. Require `targetDatasphere` field — stop with BLOCKED if missing.

**Gate evidence required:** `initiative=<slug>, targetDatasphere=<uri>, <N> tasks found`

---

### Step 3 of 14 — Confirm target datasphere (interactive)

Print the datasphere URI and base URL. Wait for explicit user confirmation before any writes. This is the point of no return.

**Gate evidence required:** `User confirmed: yes | target=<uri> on <BASE_URL>`

---

### Step 4 of 14 — Resolve datasphere DB id
→ *Detail: line 198 (API Note — datasphereId vs URI)*

```bash
curl -s "$DATASPHERES_BASE_URL/api/v1/dataspheres/<uri>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
```

Capture `datasphere.id` (e.g. `ds_default`). This is the `dsId` used in all v2 API calls. The URI is NOT the dsId.

**Gate evidence required:** `dsId=<id> name=<name>`

---

### Step 5 of 14 — Seed CodeFamilies

Ensure these six CodeFamilies + their values exist in the datasphere:
- `Legacy Impact` — values: `none`, `additive`, `breaking`
- `Rollback Safe` — values: `safe`, `manual`
- `User Approved` — values: `yes`, `no`
- `Tags` — seed value: `<initiative-slug>`
- `Spec Type` — values: `data-schema`, `api-contract`, `algorithm`, `data-flow`, `user-journey`, `architecture`, `component`, `integration`, `acceptance-criteria`, `test-plan`, `ctx-prompt`, `ctx-code`, `ctx-search`, `ctx-doc`, `ctx-legacy`, `result`
- `Spec Domain` — seed value: `<DOMAIN>` (e.g. `AUTH`, `NOTIF`, `PLAN`, `DATA`)

GET first; POST only if missing. Capture family IDs for use in step 10.

**Gate evidence required:** `6 families confirmed (IDs: <id1>...<id6>)`

---

### Step 6 of 14 — Publish vision page
→ *Detail: line 270 (CLAUDE.md Integration)*

Publish `001-*.md` as a DS reader page (status: PUBLISHED, isPubliclyVisible: false, folderName: "Feature Specs"). PUT if slug already exists.

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v1/dataspheres/<uri>/pages" \   # v1 uses URI not dsId
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"slug":"<slug>","title":"...","content":"...","status":"PUBLISHED","isPubliclyVisible":false,"isInternal":true,"folderName":"Feature Specs"}'
```

**Gate evidence required:** `slug=<slug> HTTP 200/201`

---

### Step 7 of 14 — Create initiative Plan Mode
→ *Detail: line 77 (Dashboard Page Template — planner URL uses `?mode=`)*

GET existing plan modes first. If none match `tagFilter: ["<initiative>"]`, POST a new one.

**Preferred approach** — pass `columns` in the POST to prevent default columns from being created at all (avoids having to delete `To Do` / `In Progress` / `In Review` in step 8):

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"<Initiative Name>","tagFilter":["<initiative-slug>"],"columns":[{"name":"Intake","color":"#64748b","isDoneState":false},{"name":"Research","color":"#6366f1","isDoneState":false},{"name":"North Stars","color":"#7c3aed","isDoneState":false},{"name":"Epics","color":"#0891b2","isDoneState":false},{"name":"Execution","color":"#3b82f6","isDoneState":false},{"name":"Validation","color":"#f59e0b","isDoneState":false},{"name":"Artifacts","color":"#8B5CF6","isDoneState":true},{"name":"Done","color":"#22c55e","isDoneState":true}]}'
```

If the API does not accept `columns` on POST (older server version), omit it and clean up defaults in step 8:

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"<Initiative Name>","tagFilter":["<initiative-slug>"]}'
```

Capture `planModeId`. The planner URL is `?mode=<planModeId>` — NOT `?planMode=`.

**Gate evidence required:** `planModeId=<id>`

---

### Step 8 of 14 — Verify 6 scoped status groups (delete defaults if needed)
→ *Detail: Column Architecture section*

**CRITICAL — do NOT reuse existing status groups from other plan modes or the datasphere defaults.**

**If `columns` was passed in step 7**, no default columns will exist — this step only needs to verify the 6 groups and correct any `sortOrder` values if needed:

```bash
# Verify all 6 groups exist with correct names
curl "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups?planModeId=<planModeId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
# Expected: Research, North Stars, Epics, Execution, Validation, Done — no other groups
```

**If `columns` was NOT passed in step 7**, the plan mode auto-creates 3 default columns (`To Do`, `In Progress`, `In Review`) AND a `Done` group. You must DELETE the 3 defaults and POST the 5 SDD groups — the auto-created `Done` is kept.

```bash
# 1. GET all groups scoped to this plan mode — find and DELETE the 3 defaults
curl "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
# → filter by planModeId, then DELETE each non-SDD group:
curl -X DELETE "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups/<toDoId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
# Repeat for In Progress and In Review

# 2. POST the 5 SDD groups (Research, North Stars, Epics, Execution, Validation)
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Research","order":0,"planModeId":"<planModeId>"}'
# Repeat for North Stars (order:1), Epics (order:2), Execution (order:3), Validation (order:4)
# Then GET to find the auto-created Done group

# 3. GET again — confirm exactly 6 remain: Research, North Stars, Epics, Execution, Validation, Done
```

**Gate evidence required:** `6 groups confirmed: RS=<id> NS=<id> EP=<id> EX=<id> VA=<id> DONE=<id>`

---

### Step 9 of 14 — Publish tasks (bulk)
→ *Detail: line 154 (Task Status vs statusGroupId)*
→ *Detail: North Star Artifact Requirements (enforced here)*

**Pre-publish Research task validation (mandatory, runs before North Star check):**

For every `type: research` task in tasks.yaml, verify:
1. Content contains ALL nine required section headings: `Origin Prompts`, `Problem Statement`, `Approach Under Evaluation`, `Search Results`, `Codebase Context`, `Sources`, `Feasibility Evidence`, `Recommendation`, `Validation Criteria`
2. `Origin Prompts` section contains a `<blockquote>` with verbatim user text
3. `Search Results` section contains at least one `<blockquote>` with a quoted excerpt
4. `Codebase Context` section contains `src/` paths + `<pre><code>` snippet, OR the explicit declaration `N/A — no existing code`
5. `Sources` section contains at least two `<a href=` links
6. Front matter `spec_type: research`

If any check fails:
```
🚫 GATE [9/14] BLOCKED — RS-XXX missing required content: [list failures]
Required: Origin Prompts must contain verbatim blockquote. Search Results must have ≥1 blockquote excerpt.
Codebase Context must have src/ paths + snippet or N/A declaration. Sources must have ≥2 URLs.
```

**Pre-publish North Star validation (mandatory before any POST):**

For every `type: north-star` task in tasks.yaml, verify its `content` field contains ALL six required section headings AND the front matter `research_ref` field:

```
<h3>Origin Prompts <!-- #origin --></h3>       ← must contain <blockquote> with verbatim prompt text
<h3>Codebase Context <!-- #codebase --></h3>   ← must contain src/ paths + <pre><code> OR "N/A — no existing code"
<h3>Architecture Constraints <!-- #arch --></h3>
<h3>Vision <!-- #vision --></h3>
<h3>North Star Checklist <!-- #checklist --></h3>
<h3>Success Criteria <!-- #sc --></h3>
```

**Plus front matter + content checks:**
```python
assert "research_ref:" in task["content"], f"{task['title']} missing research_ref in front matter"
assert 'research_ref: null' not in task["content"], f"{task['title']} research_ref must not be null — point to RS-NNN"
assert "<blockquote>" in origin_prompts_section, f"{task['title']} Origin Prompts must contain verbatim quoted text in <blockquote>"
assert has_codebase_paths(task["content"]) or na_declared(task["content"], "codebase"), \
    f"{task['title']} Codebase Context must have src/ paths or a note explaining why none apply"
assert has_codebase_snippet(task["content"]) or na_declared(task["content"], "codebase"), \
    f"{task['title']} Codebase Context must have <pre><code> snippet or a note explaining why none apply"
```

The `Codebase Context` section in a North Star task documents the **existing code surface** that the North Star's architecture builds on top of or replaces. Same rules as the RS Codebase Context gate: real `src/` paths, at least one verbatim snippet (or explicit N/A declaration). This is not optional even for new features — if there is no existing code, say so explicitly.

If any check fails:
```
🚫 GATE [9/14] BLOCKED — NS-XXX missing required sections or front matter: [list missing]
Required before continuing: Add missing sections, set research_ref to RS-NNN, add verbatim
prompt in <blockquote> inside Origin Prompts, and add src/ paths + <pre><code> (or N/A declaration)
inside Codebase Context.
```

Do NOT proceed until all North Stars pass this check.

POST all tasks via bulk endpoint. Each task payload **must** include:
- `statusGroupId` — one of the 5 IDs captured in step 8 (never a foreign group ID)
- `tags` — include the initiative slug so the plan mode filter picks them up
- `content` — full HTML structured as: **spec front matter block → Implementation Files section (EX tasks only) → body sections with heading anchors**

**MANDATORY: Spec front matter block** — every task content MUST begin with this YAML block. A task created without it is a gate failure for step 9:

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-{PREFIX}
title: {task title}
spec_type: {research|architecture|user-journey|algorithm|test-plan}
version: 1.0.0
status: ACTIVE
column: {research|north-stars|epics|execution|validation}
research_ref: {RS-NNN — REQUIRED for all NS tasks; null only for RS tasks themselves}
epic_ref: {EP-NNN or null for NS/RS tasks}
north_star_ref: {NS-NNN or null for NS/RS tasks}
tags: [{initiative-slug}, sdd, {rs|ns|epic|execution|validation}]
</code></pre>
```

- `spec_type` by column: RS → `research`, NS → `architecture`, EP → `user-journey`, EX → `algorithm`, VA → `test-plan`
- `research_ref`: every NS task **must** have this field pointing to its RS task. Omitting it or setting it to `null` on a non-RS task is a gate failure at Step 9.
- `epic_ref`: EX-T1-xxx → `EP-001`, EX-T2-xxx → `EP-002`, EX-T3-xxx → `EP-003`, EX-VH-xxx + VA-xxx → `EP-004`, EX-OR-xxx → `EP-005`, EP-xxx → their parent NS
- `north_star_ref`: all non-NS, non-RS tasks → `NS-001` (or the relevant NS if multiple exist)

**MANDATORY: Implementation Files section** — every EX task content MUST include this section immediately after the front matter block:

```html
<h3>Implementation Files <!-- #impl --></h3>
<ul>
  <li><code>src/path/to/file.py</code></li>
</ul>
```

List the actual source file(s) this task implements. For BLOCKED tasks, list the intended target file path — it may not exist yet. This section is parsed by the `trace-graph` widget to build the Artifacts tier of the swimlane.

**MANDATORY: Section heading anchors** — every H2 and H3 must carry an anchor comment:

```html
<h2>Acceptance Criteria <!-- #ac --></h2>
<h2>Technical Design <!-- #td --></h2>
<h3>Implementation Files <!-- #impl --></h3>
<h3>Blocked <!-- #blocked --></h3>
```

The anchor format is `<!-- #slug -->` appended to the heading tag content. These are the stable citation targets for code annotations (`// @implements SPEC-AUTH-001#td`).

**Gate check — run before marking step 9 PASS:**
```python
for task in created_tasks:
    assert "spec_id: SPEC-" in task["content"], f"{task['title']} missing front matter"
    if task["title"].startswith("EX-"):
        assert "Implementation Files" in task["content"], f"{task['title']} missing impl files"
    assert "<!-- #" in task["content"], f"{task['title']} missing heading anchors"
```

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/bulk" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tasks":[{"title":"...","statusGroupId":"<scopedGroupId>","tags":["<initiative>"],...}]}'
```

If bulk returns 500, fall back to individual POSTs — but verify every task's `statusGroupId` is from step 8 before posting.

**Gate evidence required:** `<N> tasks created (RS:<n> NS:<n> EP:<n> EX:<n>), all tagged <initiative>, all RS sections verified (incl. Search Results + Codebase Context), all NS sections verified (incl. Codebase Context), all tasks have spec front matter + impl files (EX) + heading anchors`

---

### Step 9.5 of 14 — Gate verification

Run the JS gate verifier against the published tasks BEFORE applying CodeApplications.
This checks all 10 invariants against the live board state via the API.

**Run the verifier:**
```bash
node sdd-conductor.mjs verify-gates
```

**Invariants checked (10 total):**

| Invariant | Description |
|---|---|
| INV-1 | Research gate: NS tasks in Epics+ must reference a Done RS task via `research_ref` |
| INV-2 | EX tasks must have `epic_ref`, `north_star_ref`, `validation_ref` |
| INV-3 | EX ref resolution: `epic_ref` and `north_star_ref` must match a task on the board |
| INV-4 | VA tasks must have `execution_ref`, `epic_ref`, `north_star_ref` |
| INV-5 | Epic tasks must have `north_star_ref` |
| INV-6 | EX tasks in Execution column must have Implementation Files listed |
| INV-7 | Task title prefix must match column (RS-/NS-/E-/T-/V-T-) |
| INV-8 | No bare `<ul>` wrapping `taskItem` elements in checklists |
| INV-9 | EX/VA tasks with content must have at least one checklist item |
| INV-10 | `spec_id` frontmatter must match the title prefix |

**If CLEAN (all invariants hold):**
```
✅ VERIFY-GATES: CLEAN — N tasks checked, 0 invariant violations.
```

**If violations found → STOP:**
```
🚫 VERIFY-GATES: N invariant violation(s) across M tasks:
  INV-1  (1 violation)
    NS-001 [epics]: NS advanced to "epics" but RS-001 is not Done (research)
Required: Fix all violations, re-run verify-gates, confirm CLEAN before Step 10.
```

**Gate evidence required:** Output line starting with `✅ VERIFY-GATES: CLEAN`

---

### Step 10 of 14 — Apply CodeApplications

Tag each task with: initiative slug, `sdd`, phase tag, `legacyImpact` value, `rollbackSafe` value, `userApproved` value. Use the CodeFamily IDs from step 5.

**Gate evidence required:** `CodeApplications applied to <N> tasks`

---

### Step 11 of 14 — Create tracker dataset + dataCards + trace datasets

Create or update the tracker dataset. Add dataCards for progress metrics. Skip tracker if the project has no `tracker-schema.yaml`.

Also create two trace datasets (always required — see Trace Health Dashboard section):
1. `<initiative>-traces` — one row per trace entry (from TRACES.yml)
2. `<initiative>-spec-health` — one row per spec (aggregated coverage + drift signal)

Create three data cards from these datasets: Trace Health (donut by status), Spec Coverage by Column (bar), Drift Signals (bar of orphan_count per spec_id). Capture all dataset and data card IDs for use in step 12.

**Gate evidence required:** `tracker=<id> (or: skipped) | traces-dataset=<id> | spec-health-dataset=<id> | 3 data cards created`

---

### Step 12 of 14 — Publish dashboard page

**MANDATORY — use the exact template from the "Dashboard Page Template" section below.** No custom CSS hero banners, no inline style grids — those belong on the close-out Next Steps page only. The step-12 dashboard uses native platform widgets. A page that substitutes custom HTML for platform widgets is a gate failure.

No emojis or raw Unicode in page content (render as `??`). Use HTML entities only.

Required sections (all mandatory, skip none):
1. **Title + subtitle** — plain `<h1>` and `<p>`, no inline styles
2. **Initiative Summary** — `data-widget-type="progress-summary"` with `data-refresh-interval="60"` — renders the full summary card (donut ring, Done/In Progress/Blocked/Pending counts, Next Steps link, Open in Planner link)
3. **Trace Graph** — `data-widget-type="trace-graph"` — renders the 5-tier swimlane (North Stars &rarr; Epics &rarr; Execution &rarr; Validation &rarr; Artifacts) with expandable task cards
4. **Activity feed** — `data-widget-type="task-activity-feed"` — recent comments and screenshots
5. **`<div data-type="doc-footer"></div>`** — always last, no exceptions

**Gate evidence required:** `slug=<dashboard-slug> HTTP 200/201` AND all 6 sections present (run `update-dashboard` to generate the Current Focus section before checking)

**Required fields:** `status: PUBLISHED`, `isInternal: true`, `isPubliclyVisible: false` — SDD dashboards are always internal.

---

### Step 13 of 14 — Wire bidirectional links
→ *Detail: line 51 (step 13 in original spec — "do NOT skip")*

Two calls, both required:

**A. Set `trackerUrl` on the plan mode** (surfaces as a button in the planner header):
```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes/<planModeId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"trackerUrl":"$DATASPHERES_PUBLIC_URL/pages/<uri>/<dashboard-slug>"}'
```

**B. Confirm dashboard content includes the planner link** (from step 12). If not present, PUT an updated version now.

**Gate evidence required:** `trackerUrl=<url> set (HTTP 200) | dashboard link verified`

---

### Step 14 of 14 — Publish summary

Output the following, then stop:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  SDD PUBLISH COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Initiative:  <slug>
  Datasphere:  <uri> (<dsId>)
  Tasks:       <N> total (NS:<n> EP:<n> EX:<n>)
  Plan mode:   <planModeId>

  Planner:     <PUBLIC_URL>/app/<uri>/planner?mode=<planModeId>
  Dashboard:   <PUBLIC_URL>/pages/<uri>/<dashboard-slug>
  Vision:      <PUBLIC_URL>/pages/<uri>/<vision-slug>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Gate evidence required:** Summary printed with real values (no placeholders)

---

## Dashboard Page Template
→ *Referenced by: Step 12 — MANDATORY. No substitutions.*

**CRITICAL — no emojis or raw Unicode anywhere in this page.** Use HTML entities only. No custom CSS `style=` attributes — the step-12 dashboard uses ONLY native platform widgets. Custom inline styles belong on the close-out Next Steps page, not here.

All 5 sections are required. Replace `<dsId>`, `<uri>`, `<planModeId>`, `<Project>`, `<one-line description>` with real values.

```html
<!-- SECTION 1: Title + subtitle — plain text, no inline styles -->
<h1><Project> &mdash; Initiative Dashboard</h1>
<p><one-line description of the initiative></p>

<!-- SECTION 2: Initiative Summary widget -->
<h2>Initiative Summary</h2>
<div data-type="plannerWidget"
     data-widget-type="progress-summary"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"
     data-refresh-interval="60"></div>

<!-- SECTION 3: Current Focus — conductor-generated in-progress hierarchy -->
<!-- Run: node sdd-conductor.mjs update-dashboard <dsUri> <slug> to regenerate -->
<!-- Shows: NS → Epic → Active EX → Pending VA with status for every in-progress item -->
<h2>Current Focus <!-- #focus --></h2>
<!-- sdd-conductor inserts hierarchy table here — do not edit manually -->

<!-- SECTION 4: Trace Graph widget — 6-tier swimlane (Research > NS > EP > EX > VA > Artifacts) -->
<h2>Trace Graph</h2>
<div data-type="plannerWidget"
     data-widget-type="trace-graph"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<!-- SECTION 5: Activity feed -->
<h2>Live Activity</h2>
<div data-type="plannerWidget"
     data-widget-type="task-activity-feed"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<!-- SECTION 6: doc-footer — ALWAYS LAST -->
<div data-type="doc-footer"></div>
```

The `data-datasphere-uri` attribute enables deep links from the activity feed — each comment card links to its task in the planner at `/app/<uri>/planner?mode=<planModeId>&taskId=<taskId>`.

The `progress-summary` widget renders: donut ring (% complete) + Done / In Progress / Blocked / Pending counts + "Next Steps" link + "Open in Planner" link. It is the authoritative at-a-glance view; do not replace it with a custom ring or custom count grid.

The `trace-graph` widget renders the 6-tier swimlane automatically from the task structure: Research &rarr; North Stars &rarr; Epics &rarr; Execution &rarr; Validation &rarr; Artifacts (code files parsed from `Implementation Files` sections). It is expandable and shows task cards per column. Research nodes show their source count and verbatim prompt excerpt. Do not replace it with a static Mermaid diagram or custom HTML grid.

**Tag chip deep links (built-in):** Any tag on a task card whose name matches `SPEC-*`, `CTX-*`, or `RESULT-*` is automatically clickable in the Kanban/List views — clicking navigates to `/pages/<uri>/<tag-name-lowercase>`. This means tagging a task with `SPEC-AUTH-001` creates a one-click link from the task card to the corresponding spec page. No extra setup required.

### Valid `data-widget-type` values

**Task-based widgets** — fetch from the planner tasks API. Require `data-datasphere-id` + optional `data-plan-mode-id`.

| Value | Renders |
|---|---|
| `progress-ring` | % complete gauge (donut ring) |
| `column-breakdown` | Count per column with progress bars |
| `active-tasks` | Tasks in Execution / IN_PROGRESS |
| `blocked-tasks` | Blocked tasks |
| `task-activity-feed` | Recent comments + screenshots gallery |

**Spec dataset widgets** — fetch from a dataset. Require `data-datasphere-id` + `data-dataset-id` pointing to a spec tracker dataset where rows have `spec_type`, `status`, and optionally `spec_id`, `title`, `drift`, `drift_reason`.

| Value | Renders | Required columns |
|---|---|---|
| `trace-health` | Matrix: spec_type × status counts | `spec_type`, `status` |
| `drift-alerts` | List of drifted/stale spec items | `status` or `drift` |
| `trace-map` | Tiered SVG (CTX→SPEC→CODE→RESULT), clickable nodes | `spec_type`, `spec_id` |

**Example for spec dataset widgets:**
```html
<div data-type="plannerWidget"
     data-widget-type="trace-health"
     data-datasphere-id="<dsId>"
     data-datasphere-uri="<dsUri>"
     data-dataset-id="<spec-tracker-dataset-id>"></div>
```

**Spec front matter cards** — no widget needed. Any YAML fenced code block in a TipTap page that contains a `spec_id:` key is automatically rendered as a SpecFrontMatterCard (status badge, spec type chip, lineage links). Example:
```yaml
spec_id: SPEC-AUTH-001
spec_type: SPEC
status: IN_PROGRESS
title: "Auth token generation"
domain: auth
parent_spec: CTX-AUTH-001
linked_tasks: T-042, T-043
```

---

## Column Architecture
→ *Referenced by: Step 8*

Status groups are scoped to the plan mode. When `createPlanMode` is called with no template, the planner creates its own default columns (To Do / In Progress / Done). These are NOT the SDD columns.

**You must always create 6 new status groups explicitly**, each with `planModeId` set to the new mode's ID. The plan mode auto-creates a `Done` group — GET it rather than POSTing a duplicate (POSTing a second `Done` returns 400).

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/status-groups" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Research","order":0,"planModeId":"<planModeId>"}'
# Repeat for North Stars (order:1), Epics (order:2), Execution (order:3), Validation (order:4)
# Then GET status-groups filtered by planModeId to find the auto-created Done group
```

**Column gate rules (enforced at every column transition):**

| From | To | Gate |
|---|---|---|
| Research | North Stars | Research task must be in Done; RS task has ≥2 sources and verbatim blockquote |
| North Stars | Epics | `research_ref` resolves to a Done RS task |
| Epics | Execution | No BLOCKED upstream tasks |
| Execution | Validation | No mocks/stubs in any implementation file (mock scan required) |
| Validation | Done | Validation criteria explicitly passed with evidence |
| Any | Done (direct) | BLOCKED — skipping Validation is never permitted |

**Validation gate failure → Ralph loop (mandatory):**

A VA task that fails its acceptance criteria does not stall. Failure immediately triggers the Ralph loop: diagnose root cause → apply best known fix → re-run → check gate → repeat. See [Ralph Loop Protocol](#ralph-loop-protocol--autonomous-validation-iteration). The loop runs autonomously without waiting for user input between iterations. Only a hard blocker (see below) or max iterations stops it.

Then assign tasks to the correct groups using `statusGroupId` in the bulk create payload. **Never use a statusGroupId from a different plan mode or from the datasphere defaults** — FK constraint violation if the group belongs to another datasphere, and wrong columns if it belongs to another plan mode in the same datasphere.

---

## Spec Generation Rules — Applies to All Modes

When all-dai-sdd creates or updates any task spec (in any mode), these rules are non-negotiable:

### Research tasks (RS-NNN) — always first, always live
- Every new initiative requires RS-001 before NS-001 can be created
- Every new technical approach (new tool, new algorithm, new architecture decision) requires a Research task before Execution tasks are written
- **When creating an RS task, invoke `start_research` immediately** — populate Sources and Feasibility Evidence from real `webSearchResults`, not from prior knowledge
- Research tasks must have: ≥2 source citations (from `webSearchResults`), verbatim Origin Prompts in blockquote, feasibility evidence
- If `start_research` is unavailable (offline/API error): mark RS task as `status: blocked`, note the failure, do not proceed to NS

### North Star tasks (NS-NNN)
- Must have `research_ref` pointing to a Done RS task before advancing past NorthStars column
- Origin Prompts section must contain verbatim user quotes, not paraphrase

### Epic tasks (EP-NNN / E-NNN)
- Must have `north_star_ref`
- Must have an Execution Checklist listing all child EX tasks
- Cannot move to Done until all child EX tasks are Done

### Execution tasks (T-NNN / EX-NNN)
- Must have `epic_ref` and `north_star_ref`
- Must have `Implementation Files` section listing actual source files
- Code annotations in those files should reference the spec: `// @implements SPEC-DAI-T001`

### verify-gates check — mandatory after any batch of creates/updates
After creating or updating 3+ tasks in any mode, always run:
```bash
node sdd-conductor.mjs verify-gates
```
CLEAN required before reporting completion. Any violations (INV-1 through INV-10) must be fixed before the mode exits.

---

## API Note — datasphereId vs URI
→ *Referenced by: Step 4, Step 6*

The v2 tasks API (`/api/v2/dataspheres/:datasphereId/...`) requires the **actual DB ID** (`ds_default`, `cmo...`), not the URI (`dataspheres-ai`). The v1 pages API (`/api/v1/dataspheres/:uri/...`) takes the URI.

```bash
# Correct — v2 uses DS id
curl "$DATASPHERES_BASE_URL/api/v2/dataspheres/ds_default/tasks/plan-modes/..."

# Correct — v1 uses URI
curl "$DATASPHERES_BASE_URL/api/v1/dataspheres/dataspheres-ai/pages/..."
```

Passing the URI to a v2 endpoint causes membership lookup to fail → 403 "Moderator access required".

---

## Task Status vs statusGroupId
→ *Referenced by: Step 9*

The planner uses two separate fields:

| Field | Purpose |
|---|---|
| `statusGroupId` | Which column the card appears in |
| `status` | Enum (`TODO`, `IN_PROGRESS`, `DONE`) used by v1 API queries |

When moving tasks to Done, set **both**:

```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/bulk" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"taskIds":[...],"update":{"statusGroupId":"<doneGroupId>","status":"DONE"}}'
```

Setting only `statusGroupId` moves the card visually but leaves `status=TODO` in the DB — v1 task queries will still show tasks as TODO.

---

## Trace Graph Linking — Hard Requirements

The trace graph widget builds edges by parsing task titles, task content HTML, and front-matter refs. **Three rules are non-negotiable** — violating any of them produces a spaghetti graph (all-to-all fallback edges instead of surgical parent→child links) or orphan nodes that never connect.

### Rule 1 — Task titles MUST start with the SDD ID prefix

**Canonical (readable) form — recommended for new initiatives:**

| Task type | Title format | Example |
|---|---|---|
| Research | `RS-001 · <title>` | `RS-001 · Validate variant caller for WGBS data` |
| North Star | `NS-001 · <title>` | `NS-001 · Subscriber journey vision` |
| Epic | `EP-001 · <title>` | `EP-001 · Engagement data layer` |
| Execution | `EX-001 · <title>` | `EX-001 · Engagement scoring service` |
| Validation | `VA-001 · <title>` | `VA-001 · Validate EX-001 engagement scoring` |

**Legacy short form — still accepted for backward compatibility:**

| Task type | Legacy title format |
|---|---|
| Epic | `E-001 · ...` |
| Execution | `T-001 · ...` |
| Validation | `V-T-001 · ...` |

`extractSddId()` recognises both forms: `RS-`, `NS-`, `EP-` / `E-`, `EX-` / `T-`, `VA-` / `V-T-` (with optional `-rwN` suffix for Ralph-loop iterations). Pick one convention per initiative and stick to it. Using a non-SDD ID like `R-001` or `Bug-7` as the title prefix means the node gets no SDD ID — every edge falls back to "connect all nodes in this tier."

### Rule 2 — Checklists MUST use `data-type="taskList"` format

The graph's `findChecklistRefs()` parser reads `<li data-type="taskItem">` elements to discover Epic→Execution and NS→Epic edges. HTML entities like `&#9744;` (☐) inside plain `<ul><li>` are **not** parsed — the entity stays as a raw string in stored HTML and matches neither the TipTap parser nor the `☐` regex fallback. Always use the format shown in [§ Checklist Format](#checklist-format--tiptap-tasklist) below.

### Rule 3 — Front-matter `*_ref:` fields drive cross-tier edges

The graph walks edges in two passes: first via front-matter refs, then via checklist refs as a fallback. Every task tier (except RS) must declare its parent ref in the YAML front-matter block at the top of `content`:

| Task type | Required front-matter ref | Edge it produces |
|---|---|---|
| Research (RS) | none | (RS is the origin tier) |
| North Star (NS) | `research_ref: RS-NNN` | RS → NS |
| Epic (EP) | `north_star_ref: NS-NNN` | NS → EP (also via NS's checklist) |
| Execution (EX) | `epic_ref: EP-NNN` + `north_star_ref: NS-NNN` | EP → EX (also via EP's checklist) |
| Validation (VA) | `execution_ref: EX-NNN` + `epic_ref` + `north_star_ref` | EX → VA |

Omitting a `*_ref` field doesn't fail publish, but it leaves an orphan node in the trace graph. The conductor's `gate hierarchy <id>` checks all four refs and exits 1 if any are missing.

**Why both refs AND checklists?** Refs guarantee a single canonical parent (no ambiguity). Checklists let an Epic explicitly enumerate which EX tasks it owns (useful when an EX serves multiple Epics in the same initiative). The graph prefers refs when present, falls back to checklist parsing otherwise.

---

## Checklist Format — TipTap TaskList

All checklists in task content (Acceptance Checklist, Execution Checklist, North Star Checklist) MUST use the TipTap `taskList` format. Do NOT use `☐`/`☑` Unicode characters — they are not interactive and do not render as real checkboxes.

**Unchecked item:**
```html
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>criterion text</p></li>
</ul>
```

**Checked item (when marking done):**
```html
<li data-type="taskItem" data-checked="true"><p>criterion text</p></li>
```

The platform styles `data-checked="true"` with strikethrough + gray text automatically.

### Epic Execution Checklist format

```html
<h3>Execution Checklist</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>T-001 · short task title</p></li>
  <li data-type="taskItem" data-checked="false"><p>T-002 · short task title</p></li>
</ul>
```

### North Star Checklist format

```html
<h3>North Star Checklist</h3>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>E-001 · Phase 1 name - Epic complete</p></li>
  <li data-type="taskItem" data-checked="false"><p>E-002 · Phase 2 name - Epic complete</p></li>
</ul>
```

---

## Hierarchical Validation Chain

The SDD validation flow is bottom-up and strictly ordered. Every tier must be individually verified before the next tier can close. **No rubber-stamping at any level.**

```
Validation Ticket (VA)
  → verifies parent Execution Task (EX)
      → verifies parent Epic (EP)
          → verifies parent North Star (NS)
              → triggers Research review + Next Steps summary page
```

### Hierarchy rules (enforced by front matter + conductor)

| Task type | Belongs to | Has many |
|---|---|---|
| North Star (NS) | (initiative root) | many Epics |
| Epic (EP) | one North Star | many Execution Tasks |
| Execution Task (EX) | one Epic | one Validation Ticket |
| Validation Ticket (VA) | one Execution Task | — |

Every task must declare its parent in front matter:
- VA: `execution_ref`, `epic_ref`, `north_star_ref`
- EX: `validation_ref`, `epic_ref`, `north_star_ref`
- Epic: `north_star_ref`

Check with: `node sdd-conductor.mjs gate hierarchy <taskId>`

### Required sections in every task (all three are checklists)

Each task at every tier (NS, Epic, EX, VA) must contain these three checklist sections:

```html
<h2>Acceptance Criteria <!-- #ac --></h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>Observable, testable criterion 1</p></li>
</ul>

<h2>Functional Requirements <!-- #fr --></h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>FR-1: What the system must do</p></li>
</ul>

<h2>Non-Functional Requirements <!-- #nfr --></h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>NFR-1: Performance / reliability / security constraint</p></li>
</ul>
```

These are distinct from the **Execution Checklist** (auto-ticked by conductor) and **North Star Checklist** (auto-ticked when Epics close). AC/FR/NFR must be manually verified.

### Validation flow — step by step

**Step 1 — VA ticket verifies parent EX task:**
1. The VA ticket references the parent EX task via `execution_ref` in front matter
2. Pull the parent EX task; read its AC, FR, and NFR checklist items
3. For each item: verify it is accurate and actually tested — do NOT tick unless there is real evidence
4. PATCH each verified item: `data-checked="false"` → `data-checked="true"` in the VA task
5. Call `sdd-conductor validate <vaTaskId> --metric <n> --threshold <n>`
6. Conductor gates if any items are unchecked (lists exactly which items need evidence)
7. On pass: conductor moves VA to Done, auto-moves EX to Done, ticks EX in Epic's Execution Checklist

**Step 2 — Epic is validated when all its EX tasks are done:**
1. Conductor detects all Execution Checklist items are ticked in the Epic
2. Conductor checks Epic's own AC, FR, NFR items — if any unchecked, posts a blocking comment listing them
3. For each unchecked item: verify it is accurate and tested; PATCH to checked
4. If all verified: conductor moves Epic to Done, ticks Epic in NS's North Star Checklist
5. If any fail: create new EX tasks or update plan — re-run `/all-dai-sdd`

**Step 3 — NS is validated when all its Epics are done:**
1. Conductor detects all North Star Checklist items are ticked in the NS
2. Conductor checks NS's own AC, FR, NFR items
3. Same pattern: verify each individually, PATCH when verified
4. If all verified: conductor moves NS to Done, posts final research review trigger
5. If any fail: update plan with new Epics/EX tasks — re-run `/all-dai-sdd`

**Step 4 — Final Research Review (after all NS Done) ⚠️ MANDATORY — DO NOT SKIP:**
1. Verify all RS tasks linked to the initiative are in Done column
2. Read the verbatim origin prompts from each NS task (the `<blockquote>` in Origin Prompts)
3. Compare what was promised vs. what was delivered — document any gaps
4. **Write the Next Steps & UAT summary page immediately** — use the template in this spec, no confirmation required
5. Publish the page, output the URL — this step is not complete until a real page URL exists

**This is not advisory.** 100% Done without a summary page is an incomplete execution. The page IS the deliverable that makes the work real to the stakeholder. Claude must generate it the moment all NS tasks reach Done — autonomously, without being asked.

### Refine-and-rerun on failure

When any verification step fails (a checklist item can't be verified):
1. Post a diagnosis comment on the failed task explaining what is missing and why
2. Create new EX tasks or update existing tasks to address the gap
3. Update the Epic/NS checklist to include the new task
4. Re-run `/all-dai-sdd` — it will detect the new tasks and include them in the next iteration

**Never rubber-stamp.** Checking an item without real evidence is a data integrity failure — it breaks the traceability chain from user prompt → spec → code → verified result.

### Sub-checklist auto-propagation (Execution Checklist only)

The Execution Checklist in Epics and North Star Checklist in NS tasks are auto-ticked by the conductor. These are separate from AC/FR/NFR:

When an Execution task is validated (VA passes):
1. Conductor ticks `T-XXX` item in parent Epic's Execution Checklist
2. If all EX items ticked → runs Epic AC/FR/NFR validation (Step 2 above)

When an Epic is verified and moved to Done:
1. Conductor ticks `E-XXX` item in parent NS's North Star Checklist
2. If all Epic items ticked → runs NS AC/FR/NFR validation (Step 3 above)

---

## Strategize Phase — Pre-Implementation Enforcement

**Run once before any EX task code starts.** This is the gathering phase that makes the board honest before a single line of code is written. Skipping it means the trace graph, progress-summary, and activity feed show stale or empty data through the entire sprint.

---

### Strategize checklist (mandatory — all 6 must pass)

```bash
# 1. Verify .sdd-state.json is initialized
node sdd-conductor.mjs status

# 2. Verify all EX tasks have Implementation Files sections
#    (conductor gate — exits 1 with the offending task if missing)
for taskId in <ex-task-id-1> <ex-task-id-2>; do
  node sdd-conductor.mjs gate impl-files $taskId
done

# 3. Verify NS→EP→EX dependency chain is intact
for taskId in <ex-task-ids>; do
  node sdd-conductor.mjs gate deps-done $taskId
done

# 4. Verify dashboard page has all 5 required sections
node sdd-conductor.mjs dashboard-check <dsUri> <dashboard-slug>

# 5. Verify no Execution task is being started without its Research gate cleared
#    (if the initiative has RS tasks)
for rsTaskId in <rs-task-ids>; do
  node sdd-conductor.mjs gate research-done $rsTaskId
done

# 6. Verify plan mode trackerUrl is set (links dashboard ↔ planner)
node sdd-conductor.mjs status  # shows trackerUrl warning if missing
```

**All 6 checks must pass before Step 1 of any EX task begins.** If any check exits 1, fix it first — do not proceed with implementation.

---

### What each check protects

| Check | What it prevents |
|---|---|
| `status` | Starting a task with stale/wrong dsId or missing planModeId |
| `gate impl-files` | Trace graph showing no Artifacts tier (impl files are the source of code links) |
| `gate deps-done` | Running EX tasks that depend on unfinished research or upstream EX |
| `dashboard-check` | Publishing a broken dashboard where progress-summary or trace-graph widget is missing |
| `gate research-done` | Building the wrong approach (the canonical 153-min wasted run) |
| `status` trackerUrl | Planner header missing the dashboard link — stakeholders can't reach the tracker |

---

### Dashboard template enforcement — 6 required sections

Every SDD dashboard page **must** contain exactly these six sections. `dashboard-check` verifies them:

| # | Section | Widget / Element | Failure mode if missing |
|---|---|---|---|
| 1 | Title + subtitle | Plain `<h1>` and `<p>` | No context for visitors |
| 2 | Initiative Summary | `data-widget-type="progress-summary"` | No progress ring / Done counts |
| 3 | Current Focus | `<!-- #focus -->` heading + conductor-generated hierarchy table | No visible NS→EP→EX→VA in-progress chain |
| 4 | Trace Graph | `data-widget-type="trace-graph"` | No NS→EP→EX→VA→Artifacts swimlane |
| 5 | Live Activity | `data-widget-type="task-activity-feed"` | No comment/screenshot stream |
| 6 | Doc footer | `<div data-type="doc-footer"></div>` | Missing footer (truncated look) |

**Section 3 — Current Focus — is conductor-generated.** It is NOT a platform widget. It is an HTML hierarchy table showing every in-progress NS, its in-progress Epics, the active EX task(s), and pending VA task(s). The conductor generates and PATCH-es it on every `update-dashboard` call.

```bash
# Generate / refresh the Current Focus section:
node sdd-conductor.mjs update-dashboard <dsUri> <dashboard-slug>
```

This command reads the live board, builds the hierarchy of all in-progress tasks, and PATCHes the section between `<!-- #focus -->` and the next `<h2>`. Run it:
- After every task status change
- At the start of every session (part of `drive` output)
- Before sharing a dashboard link with stakeholders

**Template quick-reference:**

```html
<h1><Project> &mdash; Initiative Dashboard</h1>
<p><one-line description></p>

<h2>Initiative Summary</h2>
<div data-type="plannerWidget" data-widget-type="progress-summary"
     data-datasphere-id="<dsId>" data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>" data-refresh-interval="60"></div>

<h2>Current Focus <!-- #focus --></h2>
<!-- sdd-conductor inserts hierarchy table here — run update-dashboard to regenerate -->

<h2>Trace Graph</h2>
<div data-type="plannerWidget" data-widget-type="trace-graph"
     data-datasphere-id="<dsId>" data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<h2>Live Activity</h2>
<div data-type="plannerWidget" data-widget-type="task-activity-feed"
     data-datasphere-id="<dsId>" data-datasphere-uri="<uri>"
     data-plan-mode-id="<planModeId>"></div>

<div data-type="doc-footer"></div>
```

No inline `style=` attributes. No emojis or raw Unicode. No custom CSS grids. No substitutions.

---

## Task In-Progress Workflow — Dashboard Visibility

**REQUIRED before starting any task.** Run `sdd-conductor start` — this verifies dependencies, marks the task IN_PROGRESS, posts the start comment, and writes the active task to `.sdd-state.json` in one shot. The hooks then guard every file write against the active task's impl files list.

```bash
# ── First time in a session (or after user gives feedback) ──
# Get the ordered mission brief — what to do next end-to-end
node sdd-conductor.mjs drive

# ── After user changes the spec / gives mid-plan feedback ──
# Reconcile the live board against tasks.yaml
node sdd-conductor.mjs sync

# ── Before writing code for a specific task ──
# MANDATORY — run this before writing a single line of code
node /path/to/dai-skills/skills/sdd-conductor/sdd-conductor.mjs start <taskId>
```

**Exit codes:** 0 = ready to code | 1 = deps not Done (shows which) | 2 = task not found

**During implementation — post progress updates at key milestones** (these appear in the board's activity feed and trace graph):

```bash
# After each meaningful milestone (tests written, integration complete, etc.)
node sdd-conductor.mjs progress "Tests written and passing (12/12) | Next: wire up integration"
node sdd-conductor.mjs progress "Integration complete — wiring acceptance checklist items"
```

The `PostToolUse(Bash)` hook also auto-posts test results to the active task whenever you run vitest, playwright, pytest, or tsc — the board updates as a side effect of running tests, with no extra curl needed.

If `sdd-conductor` is not available, fall back to manual curl (but fix the conductor first):

```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status":"IN_PROGRESS"}'

curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"[all-dai-sdd-system-message]\n\n**IN PROGRESS** — Starting <T-XXX>. Depends-on cleared."}'
```

---

## Task Done Workflow — Completion Comment with Screenshots

When marking a task Done, follow this **ordered sequence** — every step is mandatory:

### Step 1: Tick acceptance checklist FIRST (gate — do not skip)

Before posting the comment or moving to Done, **PATCH the task content** to mark every verified acceptance criterion as `data-checked="true"`.

```bash
# Fetch current task content
TASK_JSON=$(curl -s "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY")

# Tick ALL verified criteria (replace false → true for each verified item)
# Use node to safely manipulate the JSON content:
node -e "
const json = $(echo "$TASK_JSON");
const updated = json.content.replace(
  /data-checked=\"false\"><p>YOUR CRITERION TEXT/g,
  'data-checked=\"true\"><p>YOUR CRITERION TEXT'
);
console.log(JSON.stringify({ content: updated }));
" > /tmp/task_patch.json

curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d @/tmp/task_patch.json
```

**To tick ALL criteria at once** (when all are verified):
```bash
UPDATED=$(echo "$TASK_JSON" | sed 's/data-checked=\\"false\\"/data-checked=\\"true\\"/g')
CONTENT=$(echo "$UPDATED" | grep -o '"content":"[^"\\]*\(\\.[^"\\]*\)*"' | head -1 | sed 's/^"content":"//;s/"$//')
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-raw "{\"content\": \"$CONTENT\"}"
```

**VERIFY** the PATCH response includes `data-checked="true"` items before proceeding.

### Step 2: Upload Playwright screenshots

```bash
SCREENSHOT_URLS=""
shopt -s nullglob
for SHOT in tests/e2e/screenshots/**/*.png; do
  RESP=$(curl -s -X POST "$DATASPHERES_BASE_URL/api/media/upload" \
    -H "Authorization: Bearer $DATASPHERES_API_KEY" \
    -F "file=@$(realpath $SHOT)")
  URL=$(echo "$RESP" | sed -n 's/.*"url":"\([^"]*\)".*/\1/p')
  [ -n "$URL" ] && SCREENSHOT_URLS="${SCREENSHOT_URLS}\"$URL\","
done
SCREENSHOT_URLS="[${SCREENSHOT_URLS%,}]"
```

If no screenshots exist, set `SCREENSHOT_URLS="[]"`.

### Step 3: Post the completion comment

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"content\": \"[all-dai-sdd-system-message]\n\n**Duration:** <Xh Ym>\n\n**Completion summary:** <one paragraph>\n\n**Verified criteria:**\n- <criterion 1>\n- <criterion 2>\n\n**Tests:** npx tsc --noEmit OK\",
    \"screenshots\": $SCREENSHOT_URLS
  }"
```

The `screenshots` array (CDN URLs) shows up as clickable thumbnail gallery in the activity feed widget. The `[all-dai-sdd-system-message]` prefix adds a purple SDD badge on the comment card.

### Step 3b: Code annotation gate — REQUIRED before Step 4

Every file touched by this task MUST have:
```typescript
/**
 * @file src/path/to/file.ts
 * @purpose One sentence.
 * @sdd_task T-XXX
 * @sdd_epic E-XXX
 * @sdd_req R-XXX
 * @sdd_planner <trackerUrl>
 * @aria_strategy ...
 * @tools_meta ...
 */
```
Every exported function/class/model satisfying a requirement MUST have:
```typescript
// @satisfies R-001 — description
export async function myFunction(...) {
```
Do NOT proceed to Step 4 until all touched files have headers and `@satisfies` annotations.

### Step 3c: Create Validation artifact task in Validation column

Title: `V-<T-XXX> &middot; <short title>`  
Tags: `validation-artifact`, `<initiative-slug>`

Content must include these sections:
```html
<h2>Validation Artifact &mdash; T-XXX: <task title></h2>

<h3>Code Evidence</h3>
<p>Files with @sdd_task + @satisfies annotations:</p>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="true"><p><code>src/path/to/file.ts</code> &mdash; what it does</p></li>
</ul>
<pre><code class="language-typescript">
// @satisfies R-001 &mdash; description
export async function keyFunction(...) {
  // key implementation lines
}
</code></pre>

<h3>Schema / Data Model Changes</h3>
<pre><code class="language-prisma">
// relevant Prisma model additions, or "None"
</code></pre>

<h3>Test Results</h3>
<pre><code>
npx tsc --noEmit: OK
npx vitest run: X passed, 0 failed
[last 20 lines of test output]
</code></pre>

<h3>Implementation Files</h3>
<ul>
  <li><p>src/path/to/file.ts</p></li>
</ul>
```

The `Implementation Files` section is REQUIRED — the trace graph parses it to draw `execution &rarr; validation &rarr; code` edges.

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"V-T-XXX &middot; short title","statusGroupId":"<validationGroupId>","planModeId":"<planModeId>","priority":"MEDIUM","tags":["validation-artifact","<initiative>"],"content":"<h2>...</h2>..."}'
```

Save the returned `task.id` as `validationTaskId` — include it in the completion comment.

### Step 4: Run sdd-conductor complete (enforced gate)

After steps 1–3c are done, run the conductor complete command. It verifies the checklist, confirms the completion comment exists, scans impl files for mocks, patches to Done, and propagates the epic checklist — all in one call.

```bash
# MANDATORY — this is the only way to mark a task Done
node /path/to/dai-skills/skills/sdd-conductor/sdd-conductor.mjs complete <taskId>
```

**Exit 1 scenarios (conductor blocks completion):**
- Any `data-checked="false"` item remains in the acceptance checklist
- No completion comment with `[all-dai-sdd-system-message]` and "Verified criteria" found
- Mock/stub pattern detected in any implementation file

If conductor exits 1, fix the reported issue and re-run. Do NOT manually curl to Done to bypass it.

If `sdd-conductor` is unavailable, fall back to manual curl — but note this skips the checklist and mock gates:

```bash
curl -X PATCH "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"statusGroupId":"<doneGroupId>","status":"DONE"}'
```

Always set BOTH `statusGroupId` and `status` — setting only `statusGroupId` moves the card visually but leaves `status=TODO` in the DB.

---

## Trace Graph — 6-Tier Layout

The planner trace graph renders: **Research &rarr; North Stars &rarr; Epics &rarr; Execution &rarr; Validation &rarr; Code Files**.

| Tier | Detected by | Content |
|---|---|---|
| Research | `RS-` prefix or Research statusGroup | Origin prompt + sources + feasibility + recommendation |
| North Stars | `NS-` prefix or North Stars statusGroup | Vision + success criteria + `research_ref: RS-NNN` front matter |
| Epics | `EP-` / `E-` prefix or Epics statusGroup | Phase spec + execution checklist (`EX-` or `T-` items) + `north_star_ref` |
| Execution | `EX-` / `T-` prefix or Execution statusGroup | User story + acceptance criteria + `epic_ref` + `Implementation Files` |
| Validation | `VA-` / `V-T-` prefix, `validation-artifact` tag, or Validation statusGroup | Code snippets, test results + `execution_ref: EX-NNN` |
| Code Files | Parsed from `Implementation Files` section | Live file trace via `/api/v2/code-trace` |

**Edges (in walk-order — the graph tries front-matter refs first, then checklists, then statusGroup fallback):**
- Research &rarr; North Star: `research_ref: RS-NNN` in the NS task's front matter
- North Star &rarr; Epic: NS task's `North Star Checklist` items list `EP-NNN` / `E-NNN`, OR each EP carries `north_star_ref: NS-NNN`
- Epic &rarr; Execution: EP task's `Execution Checklist` items list `EX-NNN` / `T-NNN`, OR each EX carries `epic_ref: EP-NNN`
- Execution &rarr; Validation: VA task's `execution_ref: EX-NNN` front matter (or `V-T-001` ↔ `T-001` naming convention)
- Validation &rarr; Code: `Implementation Files` section in artifact content
- Clicking a Validation node opens the full artifact (code evidence + test output + schema changes)

**Cross-project caveat (known platform limitation):** the `/api/v2/code-trace?file=...` endpoint reads files from the dataspheres-ai server's `process.cwd()`. For initiatives whose code lives in a separate repo (e.g. dai-desktop hosted on dataspheres.ai SaaS), impl-file paths won't resolve to code nodes — the Artifacts tier renders empty. Workarounds: (a) run dataspheres-ai locally with the target repo in cwd, (b) propose a GitHub URL fallback for `code-trace` upstream, or (c) embed code snippets directly in the VA task's `Code Evidence` section as inline `<pre><code>` blocks.

---

## Encoding Safety — Use HTML Entities in curl Payloads

**CRITICAL:** On Windows and in some terminal environments, raw Unicode characters (em dashes, curly quotes, bullet characters) passed inside `curl -d '...'` or `-d "..."` are encoded as Windows-1252 bytes, which corrupt the database. **Always use HTML entities** for any special character in API payloads.

| Character | Wrong (raw) | Right (entity) |
|---|---|---|
| Em dash | `—` | `&mdash;` |
| Middle dot / bullet | `·` | `&middot;` |
| Left double quote | `"` | `&ldquo;` |
| Right double quote | `"` | `&rdquo;` |
| Checkmark | `✓` | `&#10003;` |
| Arrow | `→` | `&#8594;` |
| Superscript external link | `↗` | `&#8599;` |
| Star / asterisk glyph | `✦` | `&#10022;` |
| Gear / settings glyph | `⚙` | `&#9881;` |

This applies everywhere a string passes through a terminal or shell before reaching the API: `curl -d`, `node -e "..."`, here-doc interpolation, etc. In `.mjs` scripts read by Node directly, raw Unicode is safe because Node uses UTF-8.

---

## Credential Setup
→ *Referenced by: Step 1*

```bash
cat > ~/.dataspheres.env << 'EOF'
DATASPHERES_API_KEY=dsk_...
DATASPHERES_BASE_URL=https://dataspheres.ai
DATASPHERES_PUBLIC_URL=https://dataspheres.ai
DATASPHERES_DEFAULT_URI=dataspheres-ai
EOF
```

`DATASPHERES_BASE_URL` — where API calls go. Production is `https://dataspheres.ai`; override to `http://localhost:5173` only when running a local dev server.
`DATASPHERES_PUBLIC_URL` — base for user-facing links (planner, dashboard). Same host as `BASE_URL` in production.

---

## tasks.yaml Shape
→ *Referenced by: Step 2*

```yaml
project: my-feature
targetDatasphere: dataspheres-ai   # REQUIRED — no default
initiative: my-feature             # slug used for tagFilter and CodeApplications
folder: "Feature Specs"

statusGroups:                      # reference only — actual groups created via API in step 8
  - { name: "North Stars", order: 0 }
  - { name: "Epics",       order: 1 }
  - { name: "Execution",   order: 2 }
  - { name: "Validation",  order: 3 }
  - { name: "Done",        order: 4, isDoneState: true }

tasks:
  - id: NS-001
    type: north-star
    title: "North Star: ..."
    statusGroup: "North Stars"
    priority: HIGH
    tags: [north-star, my-feature]
    children: [E-001, E-002]
    content: |
      <h3>Origin Prompts</h3>
      <p>Verbatim user requests that defined this feature, with dates. Copy them exactly — paraphrase destroys traceability.</p>
      <blockquote>
      <p><strong>YYYY-MM-DD</strong> &mdash; &ldquo;exact user message 1&rdquo;</p>
      <p><strong>YYYY-MM-DD</strong> &mdash; &ldquo;exact user message 2&rdquo;</p>
      </blockquote>
      <h3>Codebase Context</h3>
      <p>Schema fields, service signatures, and file:line anchors that constrain the implementation. Paste the actual code.</p>
      <pre><code>
      // path/to/file.ts:LINE — ModelName
      fieldName  FieldType  @attribute
      // path/to/service.ts:LINE — function signature
      async functionName(params): ReturnType
      </code></pre>
      <h3>Architecture Constraints</h3>
      <ul>
      <li><p>List things that MUST NOT break (existing features, data contracts).</p></li>
      <li><p>List existing patterns to follow (billing, email, routing).</p></li>
      </ul>
      <h3>Vision</h3>
      <p>One paragraph — the aspirational outcome from the user&apos;s perspective.</p>
      <h3>North Star Checklist</h3>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>EP-001 &middot; Phase 1 name - Epic complete</p></li>
        <li data-type="taskItem" data-checked="false"><p>EP-002 &middot; Phase 2 name - Epic complete</p></li>
      </ul>
      <h3>Success Criteria</h3>
      <ul>
      <li><p>Observable outcome 1 (verifiable without access to the DB).</p></li>
      <li><p>Observable outcome 2.</p></li>
      </ul>
      <h2>Acceptance Criteria <!-- #ac --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>All Epics verified and individually accepted</p></li>
        <li data-type="taskItem" data-checked="false"><p>Observable outcome 1 confirmed with evidence</p></li>
      </ul>
      <h2>Functional Requirements <!-- #fr --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>FR-1: High-level system behavior this NS delivers</p></li>
      </ul>
      <h2>Non-Functional Requirements <!-- #nfr --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>NFR-1: Initiative-level quality bar (benchmark target, SLA, etc.)</p></li>
      </ul>

  - id: EP-001
    type: epic
    title: "EP-001 · Phase 1 short title"
    statusGroup: "Epics"
    priority: HIGH
    tags: [epic, my-feature, phase-1]
    parentNorthStar: NS-001
    north_star_ref: NS-001
    children: [EX-001, EX-002]
    content: |
      <pre><code class="language-yaml">
      spec_id: SPEC-{DOMAIN}-EP-001
      title: Phase 1 short title
      version: 1.0.0
      status: ACTIVE
      column: epics
      north_star_ref: NS-001
      </code></pre>
      <h2>Phase Summary</h2>
      <p>What this Epic delivers and why it matters to the North Star.</p>
      <h2>Execution Checklist</h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>EX-001 &middot; short task title</p></li>
        <li data-type="taskItem" data-checked="false"><p>EX-002 &middot; short task title</p></li>
      </ul>
      <h2>Acceptance Criteria <!-- #ac --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>Epic-level observable outcome 1</p></li>
        <li data-type="taskItem" data-checked="false"><p>All child EX tasks verified and accepted</p></li>
      </ul>
      <h2>Functional Requirements <!-- #fr --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>FR-1: Phase-level system behavior</p></li>
      </ul>
      <h2>Non-Functional Requirements <!-- #nfr --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>NFR-1: Phase-level performance or reliability target</p></li>
      </ul>

  - id: EX-001
    type: execution
    title: "EX-001 · short title"
    statusGroup: "Execution"
    priority: HIGH | MEDIUM | LOW
    tags: [my-feature, sdd, phase-1]
    initiative: my-feature
    parentEpic: EP-001
    depends_on: []
    spec_id: SPEC-{DOMAIN}-EX-001     # assigned by Ari at publish time
    context_refs:                      # optional — carried into front matter block
      - type: legacy_code
        ref: src/path/to/old/file.py
        note: Prior implementation reference
    legacyImpact: none | additive | breaking
    rollbackSafe: safe | manual
    userApproved: yes | no
    content: |
      <pre><code class="language-yaml">
      spec_id: SPEC-{DOMAIN}-EX-001
      title: EX-001 short title
      version: 1.0.0
      status: ACTIVE
      column: execution
      epic_ref: EP-001
      north_star_ref: NS-001
      validation_ref: VA-001
      context_refs: []
      superseded_by: null
      created: YYYY-MM-DD
      updated: YYYY-MM-DD
      author: your-handle
      </code></pre>
      <h2>Acceptance Criteria <!-- #ac --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>Observable criterion 1</p></li>
        <li data-type="taskItem" data-checked="false"><p>Observable criterion 2</p></li>
        <li data-type="taskItem" data-checked="false"><p>Test written and green</p></li>
        <li data-type="taskItem" data-checked="false"><p>Screenshot captured</p></li>
      </ul>
      <h2>Functional Requirements <!-- #fr --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>FR-1: Describe what the system must do (observable behavior)</p></li>
        <li data-type="taskItem" data-checked="false"><p>FR-2: Input/output contract or API behavior</p></li>
      </ul>
      <h2>Non-Functional Requirements <!-- #nfr --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>NFR-1: Performance target (latency, throughput, memory bound)</p></li>
        <li data-type="taskItem" data-checked="false"><p>NFR-2: Reliability or error-handling constraint</p></li>
      </ul>
      <h2>Technical Design <!-- #td --></h2>
      <h3>Implementation Scope <!-- #td-scope --></h3>
      <p>Files to touch + what to do in each.</p>

  - id: VA-001
    type: validation
    title: "VA-001 · Validate EX-001 short title"
    statusGroup: "Validation"
    priority: HIGH
    tags: [my-feature, sdd, validation]
    parentExecution: EX-001
    parentEpic: EP-001
    parentNorthStar: NS-001
    content: |
      <pre><code class="language-yaml">
      spec_id: SPEC-{DOMAIN}-VA-001
      title: Validate EX-001 short title
      version: 1.0.0
      status: ACTIVE
      column: validation
      execution_ref: EX-001
      epic_ref: EP-001
      north_star_ref: NS-001
      created: YYYY-MM-DD
      updated: YYYY-MM-DD
      author: your-handle
      </code></pre>
      <h2>Validation Scope <!-- #vs --></h2>
      <p>Verifies: <strong>EX-001 &middot; short title</strong> — all acceptance criteria, functional requirements, and non-functional requirements.</p>
      <h2>Acceptance Criteria <!-- #ac --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>Observable criterion 1 (mirrored from EX-001 AC)</p></li>
        <li data-type="taskItem" data-checked="false"><p>Observable criterion 2</p></li>
        <li data-type="taskItem" data-checked="false"><p>Test suite green with evidence attached</p></li>
      </ul>
      <h2>Functional Requirements <!-- #fr --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>FR-1: System behavior verified (mirrored from EX-001 FR)</p></li>
        <li data-type="taskItem" data-checked="false"><p>FR-2: Input/output contract verified</p></li>
      </ul>
      <h2>Non-Functional Requirements <!-- #nfr --></h2>
      <ul data-type="taskList">
        <li data-type="taskItem" data-checked="false"><p>NFR-1: Performance target met — measured value attached as evidence</p></li>
        <li data-type="taskItem" data-checked="false"><p>NFR-2: Reliability constraint verified</p></li>
      </ul>
      <h2>Evidence <!-- #ev --></h2>
      <p>Attach: test output, metric readings, screenshots. Do not check any item above without referencing specific evidence here.</p>
```

---

## North Star Artifact Requirements
→ *Referenced by: Step 9 (gate), tasks.yaml Shape, Hierarchical Validation Chain*

Every North Star task MUST contain four sections **before it is considered publishable**. These are not optional — they are the mechanism that makes all-dai-sdd traceable from user prompt → spec → code.

### Required sections (enforced at Step 9 gate)

| Section | What goes here | Why |
|---|---|---|
| **Origin Prompts** | Verbatim user messages, with ISO dates. Copy-paste — no paraphrase. | Paraphrase breaks the chain. The exact words reveal intent that summaries discard. |
| **Codebase Context** | Schema field names + types, service method signatures, file:line refs. Paste actual code. | The implementation is constrained by what already exists. Every assumption about existing code must be verifiable here. |
| **Architecture Constraints** | What must NOT break. Which existing patterns to follow (billing, email, routing, etc.). | Guards against silent rewrites of working systems. |
| **Vision** | One paragraph outcome from the user's perspective. | The "why" that all child work traces back to. |
| **Success Criteria** | Observable pass/fail outcomes (no DB access needed to verify). | Needed by Validation gate to approve Epic completion. |
| **North Star Checklist** | One `<ul data-type="taskList">` item per Epic. | Drives the auto-tick propagation when Epics complete. |

### Enforcement rule

Step 9 (publish tasks) must scan every `type: north-star` task and verify the presence of all six section headings (`<h3>Origin Prompts</h3>`, `<h3>Codebase Context</h3>`, `<h3>Architecture Constraints</h3>`, `<h3>Vision</h3>`, `<h3>North Star Checklist</h3>`, `<h3>Success Criteria</h3>`) before posting. If any heading is missing, output:

```
🚫 GATE [9/14] BLOCKED — NS-001 missing required sections: [Origin Prompts, Codebase Context]
Required before continuing: Add the missing sections to the North Star content in tasks.yaml
```

### Enforcement rule — during Execution

When an Execution task reveals new codebase context (a schema field that didn't exist in the spec, an architecture constraint that wasn't captured), the developer MUST:

1. PATCH the parent Epic content to add the new context
2. PATCH the North Star's Codebase Context or Architecture Constraints section

This is the self-healing contract. Discovering new facts and silently coding around them is the primary failure mode that destroys traceability.

### What "Codebase Context" includes

- **Schema fields**: `prisma/schema.prisma:LINE — ModelName` with the actual field definitions
- **Service signatures**: `src/server/services/foo.service.ts:LINE — async methodName(params): ReturnType`
- **Billing patterns**: exact `chargeCapacityWithWaterfall` call shape, including which `userId` and `datasphereId` to pass
- **Routing patterns**: endpoint paths, webhook formats, auth header patterns
- **Email patterns**: address format (e.g. `reply+{token}@reply.domain`), SendGrid webhook shape
- **What must NOT break**: existing models or endpoints that share the same DB tables

### Artifact attachments (images, files, search results)

The Dataspheres AI task API supports file attachments and image uploads on comments, not on task content directly. To attach research artifacts (screenshots, search results, design mockups):

1. Upload via `POST /api/media/upload` with `Authorization: Bearer $KEY`
2. Post a comment on the North Star with `screenshots: [<url1>, <url2>]`
3. Reference the comment in the Codebase Context section: `<!-- see attached screenshots in comments -->`

---

## CLAUDE.md Integration
→ *Referenced by: Step 14*

When `install.sh --all` installs skills into a project, the project's `CLAUDE.md` should reference this skill and the column lifecycle. Ari reads the CLAUDE.md on session start — if the column names aren't there, Ari won't know to use the SDD structure.

Template addition for project CLAUDE.md:
```markdown
## Active Initiatives (SDD)

Tracked in Dataspheres AI via all-dai-sdd skill.
Five-column lifecycle: North Stars → Epics → Execution → Validation → Done.
Dashboard: $DATASPHERES_PUBLIC_URL/pages/<uri>/<dashboard-slug>
Planner: $DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>
```

---

## Next Steps Page Template

When all tasks for an initiative are Done (100% completion), generate a close-out "Next Steps & UAT" page on the datasphere. This is published via `POST /api/v1/dataspheres/<uri>/pages` with `isInternal: true` and uses the full platform feature set.

**Structural blocks (in order):**

1. **Hero banner** — dark gradient with gold CTAs linking to planner + tracker
2. **plannerWidget progress-summary** — live progress ring so the page is always current
3. **Epic cards** — one styled card per Epic, Done chip + monospace ID + planner deep-link
4. **UAT sections** — colored callout boxes per subsystem (green/blue/purple/pink)
5. **Loose ends** — amber left-border warning callouts for any known gaps
6. **CTA cards** — side-by-side action cards using `class="not-prose"` to opt out of Tailwind prose
7. **Attribution block** — links to `ari-dai-skills` repo + dataspheres.ai platform
8. **`<div data-type="doc-footer">`** — platform animated multilingual footer (always last)

**Key rules:**
- Use HTML entities — no raw Unicode in JS template literals (see Encoding Safety section)
- `class="not-prose"` opts a div out of Tailwind typography overrides
- `data-type="plannerWidget"` requires `data-datasphere-id` (DB ID, not URI) and `data-plan-mode-id`
- `data-type="doc-footer"` renders the platform footer — always include last
- Page reader URL: `$DATASPHERES_PUBLIC_URL/pages/<uri>/<slug>` — NEVER `/app/<uri>/docs/<slug>`

**Attribution block HTML** (always include at the bottom of every initiative page):

```html
<div class="not-prose" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;text-align:center;margin-bottom:24px;">
  <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.12em;">Powered by</p>
  <div style="display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap;margin-bottom:8px;">
    <a href="https://github.com/geekdreamzz/ari-dai-skills" style="font-size:13px;font-weight:600;color:#0f172a;text-decoration:none;">&#9881; ari-dai-skills</a>
    <span style="color:#cbd5e1;">&#183;</span>
    <a href="https://dataspheres.ai" style="font-size:13px;font-weight:600;color:#a67c00;text-decoration:none;">&#10022; dataspheres.ai</a>
  </div>
  <p style="margin:0;font-size:11px;color:#94a3b8;">Spec-driven development tracked end-to-end in Dataspheres AI</p>
</div>
```

**Planner widget (progress summary):**

```html
<div data-type="plannerWidget"
     data-widget-type="progress-summary"
     data-datasphere-id="<dsId>"
     data-plan-mode-id="<planModeId>"
     data-refresh-interval="60"></div>
```

**Epic card template:**

```html
<div style="border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:14px;background:#f8fafc;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
    <span style="background:#dcfce7;color:#16a34a;font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.05em;">&#10003; Done</span>
    <span style="font-size:12px;font-family:monospace;color:#94a3b8;">E-001</span>
    <a href="$DATASPHERES_PUBLIC_URL/app/<uri>/planner?mode=<planModeId>" style="margin-left:auto;font-size:11px;color:#64748b;text-decoration:none;" title="Open in planner">&#8599;</a>
  </div>
  <h3 style="margin:0 0 8px;font-size:16px;font-weight:700;color:#0f172a;">Epic Title</h3>
  <p style="margin:0;color:#475569;font-size:13px;line-height:1.65;">Epic summary.</p>
</div>
```

**UAT section template:**

```html
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 24px;margin-bottom:16px;">
  <h3 style="margin:0 0 14px;font-size:14px;font-weight:700;color:#1e293b;">&#9989;&nbsp; Subsystem UAT</h3>
  <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.8;">
    <li>Criterion 1</li>
    <li>Criterion 2</li>
  </ul>
</div>
```

**Loose ends (amber warning) template:**

```html
<div style="border-left:4px solid #f59e0b;background:#fffbeb;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:12px;">
  <strong style="font-size:13px;color:#92400e;">Known gap: title</strong>
  <p style="margin:6px 0 0;font-size:13px;color:#78350f;">Description of the gap and where to track it.</p>
</div>
```

---

## Spec Traceability Protocol
→ *Referenced by: Steps 9, 11, Drift Prevention Gate Checks*

Every spec task carries a front matter block and section anchors. Together they form the contract that enables bidirectional tracing between specs, code, and context.

**This is not optional.** A spec task without a front matter block cannot be traced. A task in the Execution column without an Implementation Files section cannot appear in the `trace-graph` Artifacts tier. Both are gate failures — a task that reaches Validation without front matter and impl files MUST be patched before the Validation gate can pass.

### Enforcement — Automated Gate Check

Run this check after step 9 and before every Validation gate transition:

```python
import re

def check_spec_tracing(task: dict) -> list[str]:
    """Return list of violation strings. Empty list = pass."""
    violations = []
    content = task.get("content", "") or ""
    title = task.get("title", "")
    prefix = title.split(":")[0].strip()

    if "spec_id: SPEC-" not in content:
        violations.append(f"MISSING front matter (spec_id: SPEC-...)")

    if prefix.startswith("EX-") and "Implementation Files" not in content:
        violations.append("MISSING Implementation Files section")

    if "<!-- #" not in content:
        violations.append("MISSING heading anchors (<!-- #slug -->)")

    if prefix.startswith("EX-") or prefix.startswith("VA-"):
        if "epic_ref:" not in content:
            violations.append("MISSING epic_ref in front matter")
        if "north_star_ref:" not in content:
            violations.append("MISSING north_star_ref in front matter")

    return violations

# Block Validation transition if any violations
for task in execution_tasks:
    v = check_spec_tracing(task)
    if v:
        raise GateError(f"[GATE BLOCKED] {task['title']} — tracing violations: {v}")
```

**Repair command** — if a task is missing front matter (e.g., created before this rule was enforced), PATCH it:

```python
# Prepend front matter to existing content
front_matter = build_front_matter(task)   # uses _fm() helper from sdd_publish.py
impl_section  = build_impl_files(task)    # uses _impl() helper
task_content  = front_matter + impl_section + existing_content
client.patch(f"/api/v2/dataspheres/{ds_id}/tasks/{task_id}", json={"content": task_content})
```

The `patch_task_tracing.py` script in `workspaces/<initiative>/specs/` is the reference implementation for retroactively adding front matter to all tasks.

### Spec ID Format

`SPEC-{DOMAIN}-{NNN}`

- `DOMAIN` — 3-6 char uppercase slug for the feature area (`AUTH`, `NOTIF`, `PLAN`, `DATA`)
- `NNN` — 3-digit integer, unique per domain per datasphere, never reused
- Examples: `SPEC-AUTH-001`, `SPEC-NOTIF-003`, `SPEC-PLAN-012`

IDs are **immutable** — once assigned, the ID persists even if the spec is deprecated or superseded. Deprecated specs stay as permanent records with `status: DEPRECATED`.

### Front Matter Block

Embed this at the very top of every spec task's `content` field as a code block:

```html
<pre><code class="language-yaml">
spec_id: SPEC-AUTH-001
title: JWT Authentication Service
spec_type: api-contract
version: 1.0.0
status: ACTIVE
column: execution
epic_ref: SPEC-AUTH
north_star_ref: NS-002
context_refs:
  - type: decision
    ref: ADR-003
    note: Chose JWT over sessions for stateless scaling
  - type: external_standard
    ref: RFC 7519
    note: JWT spec this implements
  - type: legacy_code
    ref: src/auth/session_auth.py
    note: Prior implementation being replaced
superseded_by: null
created: 2025-01-15
updated: 2025-03-20
author: facelessaicoder
tags: [auth, security, backend]
</code></pre>
```

**Required fields:** `spec_id`, `title`, `status`, `column`, `spec_type`

**Status lifecycle:** `DRAFT → ACTIVE → DEPRECATED → SUPERSEDED`

Skipping `DEPRECATED` before removing a spec is a protocol violation. `superseded_by` must be non-null when status is `SUPERSEDED`.

**`spec_type` values:** `data-schema` | `api-contract` | `algorithm` | `data-flow` | `user-journey` | `architecture` | `component` | `integration` | `acceptance-criteria` | `test-plan`

**`context_refs` types:** `decision` | `constraint` | `external_standard` | `research` | `legacy_code`

### Per-Spec Trace View

Every spec task has a trace view showing the lineage for *this spec only*: what context informed it, what code implements it, what result covers it. Planner tasks are used for all kinds of work — this view is conditional and only appears on tasks whose content contains a `spec_id:` YAML block.

#### How it works today (Tiptap embed — workaround)

Ari adds a Mermaid block inside the task's `content` field as a regular Tiptap node. It lives in the editable body, so it can be accidentally deleted and Ari must PATCH the task every time a new trace is added. This is a stopgap — it works but is fragile.

```html
<h2>Trace View <!-- #trace --></h2>
<div data-type="mermaid" data-source="graph LR
  CTX1[CTX-PROMPT-001\nUser Brief]
  CTX2[CTX-CODE-001\nsession_auth.py]
  SPEC[SPEC-AUTH-001\nJWT Auth]
  CODE1[jwt.py::generate_jwt]
  CODE2[service.py::AuthService]
  RESULT[RESULT-AUTH-001\nBuild Report]
  CTX1 -->|informs| SPEC
  CTX2 -->|informs| SPEC
  SPEC -->|implements| CODE1
  SPEC -->|implements| CODE2
  RESULT -->|summarizes| SPEC"></div>
```

#### Platform request — conditional panel in the task modal

The correct implementation is a **read-only panel rendered outside the Tiptap editor** in the task detail modal. Not part of the editable content. Condition: task `content` contains a YAML block with a `spec_id:` key.

When the condition is true, the task modal renders a collapsible "Spec Trace" section (above or below the content editor) showing:

- **Metadata strip:** `spec_id` pill · `spec_type` badge · `status` badge (DRAFT / ACTIVE / DEPRECATED) · `version` · `column`
- **Mini trace graph:** CTX nodes → this SPEC → CODE nodes → RESULT nodes. Each node is clickable — CTX/RESULT nodes navigate to the spec page, CODE nodes copy the file path or open in the linked repo.
- **Live data source:** reads the initiative's Traces dataset (created in step 11), filtered on `from_ref = spec_id OR to_ref = spec_id`. Auto-refreshes on modal open.

This panel is **invisible on non-SDD tasks** — the condition is only true when `spec_id:` is present. No impact on normal planner use. No editable content to accidentally delete. The trace view stays current without Ari having to PATCH the task.

**The key distinction:** the Tiptap content is the spec. The trace panel is metadata *about* the spec. They should live in separate layers of the modal, not mixed in the same editable body.

---

### Section-Level Anchors

Every H2 and H3 in a spec task gets an explicit anchor comment. These are the stable citation targets for code annotations:

```html
<h2>Acceptance Criteria <!-- #ac --></h2>
<h2>Technical Design <!-- #td --></h2>
<h3>Token Generation Algorithm <!-- #td-token-gen --></h3>
<h3>API Contract <!-- #td-api --></h3>
```

Reference format: `SPEC-AUTH-001#td-api`

**Anchors are stable** — if you rename the heading text, keep the `<!-- #anchor -->` comment. Code annotations point to anchors, not heading text.

---

## Spec Type Taxonomy and Templates
→ *Referenced by: Steps 9, 10, Spec Traceability Protocol*

`spec_type` determines the canonical section structure of a spec task. Ari uses the template for the declared type when creating or scaffolding a spec. Each type also maps to a `Spec Type` CodeFamily value, making specs filterable in the planner by type.

### Full Spec Taxonomy

There are four tiers of specs. Context and Result specs are **pages** (in folders), not planner tasks — they are reference material and output receipts, not work items. Execution specs (in the planner) cite Context specs; Result specs are generated after execution closes.

```
[Context Pages]  →  [Execution Tasks]  →  [Code/Artifacts]  →  [Result Pages]
CTX-*                SPEC-*                (code, pages,          RESULT-*
                                            datasets, images)
```

#### Context Specs (`CTX-*`) — Pages in "Context" folder

| spec_type | ID format | What it captures |
|---|---|---|
| `ctx-prompt` | `CTX-PROMPT-NNN` | Original user request, brief, voice memo transcription |
| `ctx-code` | `CTX-CODE-NNN` | Existing code snippet with filepath + function/class name |
| `ctx-search` | `CTX-SEARCH-NNN` | Research thread output, web search results, competitive analysis |
| `ctx-doc` | `CTX-DOC-NNN` | External/internal documentation, RFC, standard, guide |
| `ctx-legacy` | `CTX-LEGACY-NNN` | Prior implementation being replaced or heavily referenced |

#### Execution Specs (`SPEC-*`) — Planner tasks

| spec_type | Typical Column | What it describes |
|---|---|---|
| `data-schema` | Execution | Database tables, field types, constraints, indexes, migrations |
| `api-contract` | Execution | Endpoints, request/response shapes, auth, error codes |
| `algorithm` | Execution | Pseudocode, step-by-step logic, complexity, edge cases |
| `data-flow` | Execution | How data moves through the system (Mermaid flowchart/sequence) |
| `user-journey` | Execution | User-facing screen flows, happy + sad paths, transitions |
| `architecture` | Execution | Service boundaries, component topology, deployment diagram |
| `component` | Execution | UI component: props, states, interactions, variants |
| `integration` | Execution | Third-party service: auth, webhooks, rate limits, error handling |
| `acceptance-criteria` | Validation | Observable pass/fail criteria, test assertions |
| `test-plan` | Validation | Test scenarios, edge cases, performance bounds, manual QA steps |

#### Result Specs (`RESULT-*`) — Pages in "Build Reports" folder

| spec_type | ID format | What it captures |
|---|---|---|
| `result` | `RESULT-{DOMAIN}-NNN` | Post-execution report: artifacts built, code snippets, test results, trace summary |

---

### Template: `data-schema`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: data-schema
...
</code></pre>

<h2>Schema Definition <!-- #schema --></h2>
<pre><code class="language-sql">
CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
</code></pre>

<h2>Field Reference <!-- #fields --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Field</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Type</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Constraints</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Notes</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>id</p></td>
      <td class="tiptap-table-cell"><p>TEXT</p></td>
      <td class="tiptap-table-cell"><p>PRIMARY KEY</p></td>
      <td class="tiptap-table-cell"><p>cuid2 generated</p></td>
    </tr>
  </tbody>
</table>

<h2>Indexes <!-- #indexes --></h2>
<pre><code class="language-sql">CREATE INDEX idx_users_email ON users(email);</code></pre>

<h2>Migration Notes <!-- #migration --></h2>
<p>How to apply, rollback, and backfill.</p>
```

---

### Template: `api-contract`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: api-contract
...
</code></pre>

<h2>Endpoints <!-- #endpoints --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Method</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Path</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Auth</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Notes</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>POST</p></td>
      <td class="tiptap-table-cell"><p>/api/auth/login</p></td>
      <td class="tiptap-table-cell"><p>none</p></td>
      <td class="tiptap-table-cell"><p>Returns access + refresh tokens</p></td>
    </tr>
  </tbody>
</table>

<h2>Request Schema <!-- #request --></h2>
<pre><code class="language-typescript">
interface LoginRequest {
  email: string;
  password: string;
}
</code></pre>

<h2>Response Schema <!-- #response --></h2>
<pre><code class="language-typescript">
interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
</code></pre>

<h2>Error Codes <!-- #errors --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Code</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Status</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Meaning</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>AUTH_001</p></td>
      <td class="tiptap-table-cell"><p>401</p></td>
      <td class="tiptap-table-cell"><p>Invalid credentials</p></td>
    </tr>
  </tbody>
</table>
```

---

### Template: `algorithm`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: algorithm
...
</code></pre>

<h2>Problem Statement <!-- #problem --></h2>
<p>What this algorithm solves and why a custom implementation is needed.</p>

<h2>Pseudocode <!-- #pseudocode --></h2>
<pre><code class="language-python">
def score_item(item, user_context):
    base = item.engagement_score
    if item.datasphere in user_context.admin_spheres:
        base *= 1.8
    freshness = exp(-elapsed_hours / (lookback_hours / 3))
    return base * freshness + 0.1 * freshness
</code></pre>

<h2>Complexity <!-- #complexity --></h2>
<p>Time: O(n log n) — sort step dominates. Space: O(n).</p>

<h2>Edge Cases <!-- #edge-cases --></h2>
<ul>
  <li>Empty pool: return empty list, do not extend lookback</li>
  <li>All items platform DS: apply 0.1x penalty before scoring</li>
</ul>
```

---

### Template: `data-flow`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: data-flow
...
</code></pre>

<h2>Flow Overview <!-- #flow --></h2>
<p>One sentence: what data, from where, to where, and why.</p>

<h2>Sequence Diagram <!-- #sequence --></h2>
<div data-type="mermaid" data-source="sequenceDiagram
  User->>API: POST /auth/login
  API->>DB: SELECT user WHERE email=?
  DB-->>API: user record
  API->>API: verify password hash
  API->>API: generate JWT
  API-->>User: { accessToken, refreshToken }"></div>

<h2>Data Transformations <!-- #transforms --></h2>
<p>Each step where data shape changes — input format, output format, validation applied.</p>

<h2>Error Paths <!-- #errors --></h2>
<p>What happens at each failure point — propagation, fallback, user-visible effect.</p>
```

---

### Template: `user-journey`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: user-journey
...
</code></pre>

<h2>User Goal <!-- #goal --></h2>
<p>What the user is trying to accomplish. One sentence.</p>

<h2>Happy Path <!-- #happy-path --></h2>
<div data-type="mermaid" data-source="flowchart TD
  A[Land on /login] --> B[Enter email + password]
  B --> C{Valid?}
  C -- Yes --> D[Redirect to dashboard]
  C -- No --> E[Show inline error]
  E --> B"></div>

<h2>Sad Paths <!-- #sad-paths --></h2>
<ul>
  <li>Wrong password: inline error, no redirect, no lockout on first attempt</li>
  <li>Account locked: show locked message with support link</li>
  <li>Network error: show retry toast, do not clear form</li>
</ul>

<h2>Screen Inventory <!-- #screens --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Screen</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Route</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>New / Existing</strong></p></td>
    </tr>
  </tbody>
</table>
```

---

### Template: `architecture`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: architecture
...
</code></pre>

<h2>Component Diagram <!-- #components --></h2>
<div data-type="mermaid" data-source="graph TD
  Client --> API_Gateway
  API_Gateway --> Auth_Service
  API_Gateway --> Data_Service
  Auth_Service --> PostgreSQL
  Data_Service --> PostgreSQL
  Data_Service --> Redis"></div>

<h2>Service Boundaries <!-- #boundaries --></h2>
<p>What each service owns, what it does NOT own, and the contract at each boundary.</p>

<h2>Data Stores <!-- #data-stores --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Store</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Type</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Owns</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Access pattern</strong></p></td>
    </tr>
  </tbody>
</table>

<h2>Non-Functional Requirements <!-- #nfr --></h2>
<ul>
  <li>Latency: p99 login &lt; 300ms</li>
  <li>Availability: 99.9% uptime</li>
</ul>
```

---

### Template: `integration`

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-NNN
spec_type: integration
...
</code></pre>

<h2>Service Overview <!-- #service --></h2>
<p>What the third-party service does and why we integrate with it.</p>

<h2>Auth and Credentials <!-- #auth --></h2>
<p>Auth method (API key / OAuth / webhook secret). Where credentials are stored. Rotation policy.</p>

<h2>Endpoints Used <!-- #endpoints --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Endpoint</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Purpose</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Rate limit</strong></p></td>
    </tr>
  </tbody>
</table>

<h2>Webhook Contract <!-- #webhooks --></h2>
<p>Events we receive, payload shape, signature verification method.</p>

<h2>Error Handling and Retry <!-- #errors --></h2>
<p>Which errors are retryable, retry policy, dead letter handling, alerting threshold.</p>
```

---

### Template: `acceptance-criteria` (Validation column)

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-VAL-NNN
spec_type: acceptance-criteria
column: validation
validates_ref: SPEC-{DOMAIN}-NNN
...
</code></pre>

<h2>Acceptance Criteria <!-- #ac --></h2>
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false"><p>Criterion 1 — observable, pass/fail</p></li>
  <li data-type="taskItem" data-checked="false"><p>Criterion 2</p></li>
</ul>

<h2>Out of Scope <!-- #oos --></h2>
<p>What this spec does NOT validate. Reduces scope creep in QA.</p>
```

---

### Template: `test-plan` (Validation column)

```html
<pre><code class="language-yaml">
spec_id: SPEC-{DOMAIN}-TP-NNN
spec_type: test-plan
column: validation
validates_ref: SPEC-{DOMAIN}-NNN
...
</code></pre>

<h2>Test Scenarios <!-- #scenarios --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Scenario</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Input</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Expected</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Type</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>Valid login</p></td>
      <td class="tiptap-table-cell"><p>correct email + password</p></td>
      <td class="tiptap-table-cell"><p>200 + tokens</p></td>
      <td class="tiptap-table-cell"><p>integration</p></td>
    </tr>
  </tbody>
</table>

<h2>Edge Cases <!-- #edge-cases --></h2>
<ul>
  <li>Concurrent login from two devices</li>
  <li>Token refresh during active request</li>
</ul>

<h2>Performance Bounds <!-- #perf --></h2>
<p>e.g. login p99 under 300ms under 100rps load</p>
```

---

### Images in Context and Result Specs

Images are first-class content in context and result specs. Napkin drawings, wireframes, app screenshots, whiteboard photos, UI mockups — all of these belong embedded in the spec page, not in a separate folder or skipped.

**Ari's image protocol when creating any context or result spec:**

1. If the user pastes, attaches, or mentions an image → embed it immediately. Never skip.
2. If the user provides a local file path → `upload_file(path)` first, then embed the returned URL.
3. If the image is already a hosted HTTPS URL → embed directly.
4. If the context involves UI work, flows, or physical sketches → **proactively ask**: "Do you have any screenshots or sketches to include?"

**Embedding pattern (same as pages):**
```html
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="https://cdn.dataspheres.ai/uploads/sketch-001.png" alt="Napkin sketch — auth flow" />
  <figcaption>Napkin sketch from kickoff — JWT flow overview</figcaption>
</figure>
```

For multiple images, embed them in sequence under a `## Visual References` section. Each gets a caption explaining what it shows and why it's relevant to the spec.

---

### Template: `ctx-prompt`

Context specs are created as **pages** in the datasphere (folder: "Context"), not as planner tasks. Ari creates them automatically when the user shares a prompt, research thread, code snippet, or doc as input to an execution spec.

```html
<pre><code class="language-yaml">
spec_id: CTX-PROMPT-001
spec_type: ctx-prompt
title: User Brief — Auth System
status: ACTIVE
created: 2025-01-14
author: facelessaicoder
cited_by: [SPEC-AUTH-001, SPEC-AUTH-002]
</code></pre>

<h2>Original Request <!-- #request --></h2>
<p>Verbatim or lightly cleaned user prompt / voice memo transcription. Preserved exactly — this is the authoritative record of what was asked.</p>

<blockquote><p>"Build a JWT-based auth system. Users log in with email + password. Tokens expire in 15 minutes. Refresh tokens rotate on use. Must work with our current Redis setup."</p></blockquote>

<h2>Visual References <!-- #images --></h2>
<p>Napkin drawings, whiteboard photos, wireframes, or annotated screenshots shared alongside the brief.</p>
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="{uploaded-url}" alt="Napkin sketch — initial auth flow concept" />
  <figcaption>Sketch from kickoff: shows the intended token flow from login to refresh</figcaption>
</figure>

<h2>Key Intent <!-- #intent --></h2>
<ul>
  <li>15-minute access token expiry</li>
  <li>Rotating refresh tokens</li>
  <li>Redis-compatible (existing cluster, no new infra)</li>
</ul>

<h2>Open Questions at Time of Writing <!-- #questions --></h2>
<ul>
  <li>Single-device or multi-device sessions?</li>
  <li>Account lockout policy?</li>
</ul>
```

---

### Template: `ctx-code`

```html
<pre><code class="language-yaml">
spec_id: CTX-CODE-001
spec_type: ctx-code
title: Existing SessionAuth Implementation
status: ACTIVE
created: 2025-01-14
filepath: src/auth/session_auth.py
cited_by: [SPEC-AUTH-001]
</code></pre>

<h2>Source Location <!-- #source --></h2>
<p>File: <code>src/auth/session_auth.py</code></p>
<p>Symbols: <code>SessionAuth</code>, <code>create_session</code>, <code>validate_session</code></p>

<h2>Relevant Snippet <!-- #snippet --></h2>
<pre><code class="language-python">
class SessionAuth:
    def create_session(self, user_id: str) -> str:
        token = secrets.token_hex(32)
        self.redis.setex(f"session:{token}", 3600, user_id)
        return token

    def validate_session(self, token: str) -> str | None:
        return self.redis.get(f"session:{token}")
</code></pre>

<h2>Why Referenced <!-- #why --></h2>
<p>This implementation is being replaced by JWT. The Redis key pattern and expiry logic should be preserved in the new implementation.</p>

<h2>What to Carry Forward <!-- #carry-forward --></h2>
<ul>
  <li>Redis key pattern: <code>session:{token}</code> → adapt to <code>refresh:{token}</code></li>
  <li>TTL handling: keep the same Redis SETEX pattern</li>
</ul>

<h2>Visual References <!-- #images --></h2>
<p>Screenshots of the code in context, IDE views, or annotated diffs. Upload with upload_file() if local.</p>
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="{uploaded-url}" alt="Screenshot: SessionAuth class in IDE" />
  <figcaption>SessionAuth as it exists today — annotated to show the Redis key pattern</figcaption>
</figure>
```

---

### Template: `ctx-search`

```html
<pre><code class="language-yaml">
spec_id: CTX-SEARCH-001
spec_type: ctx-search
title: OAuth 2.0 and JWT Research
status: ACTIVE
created: 2025-01-13
research_thread_id: thread_abc123
cited_by: [SPEC-AUTH-001]
</code></pre>

<h2>Research Query <!-- #query --></h2>
<p>JWT vs session tokens for stateless auth at scale — tradeoffs, refresh token rotation best practices, Redis storage patterns</p>

<h2>Key Findings <!-- #findings --></h2>
<ul>
  <li>JWT: stateless verification, no DB lookup on every request, but revocation requires blocklist</li>
  <li>Refresh token rotation (RFC 6819): each use issues a new refresh token, invalidates old — detects replay attacks</li>
  <li>15-minute access token is industry standard (Google, GitHub use 1 hour; shorter is safer for our use case)</li>
</ul>

<h2>Sources <!-- #sources --></h2>
<ul>
  <li><a href="https://datatracker.ietf.org/doc/html/rfc7519">RFC 7519 — JSON Web Token</a></li>
  <li><a href="https://datatracker.ietf.org/doc/html/rfc6819">RFC 6819 — OAuth 2.0 Threat Model</a></li>
</ul>
```

---

### Template: `ctx-doc`

```html
<pre><code class="language-yaml">
spec_id: CTX-DOC-001
spec_type: ctx-doc
title: SendGrid Inbound Parse API
status: ACTIVE
source_url: https://docs.sendgrid.com/for-developers/parsing-email/inbound-email
created: 2025-02-01
cited_by: [SPEC-NOTIF-003]
</code></pre>

<h2>Document Summary <!-- #summary --></h2>
<p>SendGrid Inbound Parse receives email, parses headers + body, and POSTs JSON to a configured webhook URL. Requires MX record on receiving subdomain.</p>

<h2>Key Constraints <!-- #constraints --></h2>
<ul>
  <li>Webhook must respond 200 within 20 seconds or SendGrid retries</li>
  <li>Attachments sent as multipart form data, max 30MB total</li>
  <li>Envelope JSON contains original To/From before any forwarding</li>
</ul>

<h2>Relevant Sections <!-- #sections --></h2>
<p>Section 3: MX record configuration. Section 7: Webhook payload schema. Section 12: Spam and phishing filtering.</p>
```

---

### Template: `result`

Result specs are **pages** in the "Build Reports" folder. Ari generates them automatically when a task (or batch of tasks) moves to Done. They are the authoritative post-execution record.

```html
<pre><code class="language-yaml">
spec_id: RESULT-AUTH-001
spec_type: result
title: Auth System Build Report
status: FINAL
execution_refs: [SPEC-AUTH-001, SPEC-AUTH-002]
context_refs: [CTX-PROMPT-001, CTX-CODE-001, CTX-SEARCH-001]
created: 2025-03-22
built_by: Ari (claude-sonnet-4-6)
</code></pre>

<h2>What Was Built <!-- #overview --></h2>
<p>One paragraph: the feature, what was implemented, what was not implemented (explicit scope).</p>

<h2>Artifacts Created <!-- #artifacts --></h2>
<table class="tiptap-table">
  <tbody>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p><strong>Type</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Ref</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Description</strong></p></td>
      <td class="tiptap-table-cell"><p><strong>Spec</strong></p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>function</p></td>
      <td class="tiptap-table-cell"><p>src/auth/jwt.py::generate_jwt</p></td>
      <td class="tiptap-table-cell"><p>Generates HMAC-SHA256 JWT with configurable expiry</p></td>
      <td class="tiptap-table-cell"><p>SPEC-AUTH-001#td-token-gen</p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>function</p></td>
      <td class="tiptap-table-cell"><p>src/auth/jwt.py::refresh_token</p></td>
      <td class="tiptap-table-cell"><p>Rotating refresh token with Redis invalidation</p></td>
      <td class="tiptap-table-cell"><p>SPEC-AUTH-001#td-refresh</p></td>
    </tr>
    <tr class="tiptap-table-row">
      <td class="tiptap-table-cell"><p>schema</p></td>
      <td class="tiptap-table-cell"><p>migrations/0042_refresh_tokens.sql</p></td>
      <td class="tiptap-table-cell"><p>refresh_tokens table with user_id FK and expiry</p></td>
      <td class="tiptap-table-cell"><p>SPEC-AUTH-DS-001#schema</p></td>
    </tr>
  </tbody>
</table>

<h2>Key Code Snippets <!-- #snippets --></h2>
<pre><code class="language-python">
# src/auth/jwt.py — core token generation
def generate_jwt(user_id: str, expires_in: int = 900) -> str:
    payload = {"sub": user_id, "exp": time.time() + expires_in, "iat": time.time()}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")
</code></pre>

<h2>Test Results <!-- #tests --></h2>
<ul>
  <li>Unit tests: 12 passing, 0 failing</li>
  <li>Integration tests: 4 passing</li>
  <li>Coverage: 94% on src/auth/jwt.py</li>
</ul>

<h2>Screenshots <!-- #screenshots --></h2>
<p>Visual evidence of the built feature — running UI, test output, terminal output, before/after comparisons. Upload with upload_file() if local.</p>
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="{uploaded-url}" alt="Login flow — working in staging" />
  <figcaption>Login endpoint returning tokens in staging — matches SPEC-AUTH-001#td-api response schema</figcaption>
</figure>
<figure data-image-figure data-alignment="center" data-size="full">
  <img src="{uploaded-url}" alt="Test suite passing" />
  <figcaption>All 16 auth tests green — npx jest src/auth 2025-03-22</figcaption>
</figure>

<h2>Deviations from Spec <!-- #deviations --></h2>
<p>Any spec sections not implemented, scope changes made during execution, or decisions that differ from the original spec. If none: "None — implemented as specced."</p>

<h2>Context That Shaped This Build <!-- #context-influence --></h2>
<ul>
  <li><strong>CTX-PROMPT-001</strong> — Original brief drove the 15-minute expiry and Redis requirement</li>
  <li><strong>CTX-CODE-001</strong> — Redis key pattern from SessionAuth preserved in the refresh token implementation</li>
  <li><strong>CTX-SEARCH-001</strong> — RFC 6819 rotation pattern adopted verbatim</li>
</ul>
```

---

### Tagging for Discoverability

When Ari publishes a spec task (step 9 / 10), it applies the following CodeApplications in addition to the base initiative tags:

| CodeFamily | Value | Source |
|---|---|---|
| `Spec Type` | task `spec_type` value | Parsed from front matter |
| `Spec Domain` | DOMAIN from `spec_id` | Parsed from spec ID prefix |
| `Legacy Impact` | from `tasks.yaml` | As before |
| `Rollback Safe` | from `tasks.yaml` | As before |
| `User Approved` | from `tasks.yaml` | As before |
| `Tags` | initiative slug + `sdd` + spec_type | Enables planner filter by type |

This means in the planner you can filter by `Spec Type = api-contract` to see only contract specs, or `Spec Domain = AUTH` to see only auth-domain work — without touching the initiative tag filter.

---

## Code Trace Annotations
→ *Referenced by: Drift Prevention Gate Checks*

Annotations are one-line comments pointing from implementation to spec. They carry a pointer only — never spec content. The spec is the source of truth.

### Format

```
# spec: SPEC-{DOMAIN}-{NNN}             (whole module or class)
# spec: SPEC-{DOMAIN}-{NNN}#{anchor}    (specific section)
```

### Language Examples

**Python — function and class:**
```python
# spec: SPEC-AUTH-001#td-token-gen
def generate_jwt(user_id: str, expires_in: int = 900) -> str:
    ...

# spec: SPEC-AUTH-001
class AuthService:
    ...
```

**TypeScript:**
```typescript
// spec: SPEC-AUTH-001#td-api
export async function authenticateUser(email: string, password: string): Promise<AuthResult> {
    ...
}
```

**Test files — trace to the validation spec, not the execution spec:**
```python
# spec: SPEC-AUTH-VAL-001#ac-token-expiry
def test_token_expires_after_15_minutes():
    ...
```

**Git commit footer:**
```
feat(auth): implement JWT token generation

spec: SPEC-AUTH-001#td-token-gen
closes: TASK-127
```

### What NOT to Annotate

- Utility helpers with no direct spec correspondence
- Boilerplate, config templates, third-party wrappers
- Code where the spec relationship is obvious from file path and name

Annotate where a future reader would ask "why was this written this way?" or "which spec drove this decision?"

**Context annotation** — when code was directly shaped by an existing codebase reference:

```python
# ctx: CTX-CODE-001  (informs the approach taken here)
def generate_jwt(user_id: str, expires_in: int = 900) -> str:
    ...
```

### Per-symbol annotations — trace graph enrichment

The planner trace graph reads files via the `/api/v2/code-trace` endpoint, which extracts the file-level JSDoc header AND per-function annotations. To make a specific exported function or class traceable to a requirement, add a `@satisfies` comment immediately before it:

**Inline comment style:**
```typescript
// @satisfies R-001 — free-tier gate
export async function checkFreeGate(...): Promise<...> {
```

**JSDoc block style:**
```typescript
/**
 * @satisfies R-002
 * @sdd_req R-002
 */
export function chargeCapacity(...) {
```

The trace graph displays `@satisfies R-XXX` as clickable requirement tags on each function row, with expandable code previews and line-range links. `lineStart`, `lineEnd`, and `snippet` are extracted automatically — you don't write them.

**Rule:** every exported function that satisfies a requirement listed in the parent Epic's acceptance checklist SHOULD have at least a `// @satisfies R-XXX` comment. This creates the full chain: North Star → Epic → Execution task → implementation file → specific function.

---

## Trace Taxonomy

Four tiers, directed edges. These are the only valid trace types.

### Tier 1: Context Specs (`CTX-*`) — pages, reference material

| Type | ID prefix | Entity |
|---|---|---|
| `ctx-prompt` | `CTX-PROMPT-` | Original user request, brief, voice memo |
| `ctx-code` | `CTX-CODE-` | Existing code snippet with filepath + symbol |
| `ctx-search` | `CTX-SEARCH-` | Research thread, web search results |
| `ctx-doc` | `CTX-DOC-` | External/internal doc, RFC, standard |
| `ctx-legacy` | `CTX-LEGACY-` | Prior implementation being replaced |

### Tier 2: Execution Specs (`SPEC-*`) — planner tasks

| Type | Column |
|---|---|
| `north-star` | North Stars |
| `epic` | Epics |
| `execution` | Execution |
| `validation` | Validation |

### Tier 3: Code and Artifacts — generated outputs

| Type | Description |
|---|---|
| `function` | Single function or method |
| `class` | Class or service |
| `module` | File or module |
| `test` | Test function or test class |
| `schema` | Database migration, API schema, type definition |
| `config` | Configuration file implementing a spec constraint |
| `artifact-page` | Dataspheres page created during execution |
| `artifact-dataset` | Dataset created or populated during execution |
| `artifact-image` | AI-generated image produced during execution |
| `artifact-sequence` | Automation sequence created during execution |

### Tier 4: Result Specs (`RESULT-*`) — pages, output receipts

| Type | Entity |
|---|---|
| `result` | Post-execution report: artifacts, code snippets, test results, trace summary |

### Relationship Types (Directed Edges)

| Relationship | Direction | Meaning |
|---|---|---|
| `informs` | CTX → SPEC | This context spec shaped this execution spec |
| `implements` | CODE → SPEC | This code directly implements this spec section |
| `informed_by` | CODE → CTX | This code was shaped by this context (existing code, prior art) |
| `satisfies` | CODE/test → SPEC/validation | This test satisfies this acceptance criterion |
| `derived_from` | SPEC → CTX | This spec exists because of this constraint or decision |
| `supersedes` | SPEC → SPEC | This spec replaces that spec |
| `refines` | SPEC/execution → SPEC/epic | This execution spec elaborates on that epic |
| `validates` | SPEC/validation → SPEC/execution | This validation spec tests that execution spec |
| `depends_on` | SPEC → SPEC | This spec requires that spec to be Active first |
| `summarizes` | RESULT → SPEC/execution | This result report covers what this spec built |
| `includes_artifact` | RESULT → CODE/ARTIFACT | This result report references this output |

---

## TRACES.yml — Trace Appendix
→ *Referenced by: Step 11, Drift Prevention Gate Checks*

`TRACES.yml` lives at the root of the project spec directory alongside `tasks.yaml`. It is machine-readable. Ari generates and maintains it — do not edit by hand.

```yaml
# TRACES.yml — generated by Ari, do not edit manually
# initiative: my-feature
# last_updated: 2025-03-21T09:00:00Z

traces:
  # Context → Spec
  - id: TR-001
    from: { tier: context, type: ctx-prompt, ref: CTX-PROMPT-001 }
    to:   { tier: spec,    ref: SPEC-AUTH-001 }
    relationship: informs
    created: 2025-01-14
    status: active

  - id: TR-002
    from: { tier: context, type: ctx-code, ref: "CTX-CODE-001 (src/auth/session_auth.py::SessionAuth)" }
    to:   { tier: spec,    ref: SPEC-AUTH-001 }
    relationship: informs
    created: 2025-01-14
    status: active

  # Spec → Code
  - id: TR-003
    from: { tier: code, type: function, ref: src/auth/jwt.py::generate_jwt }
    to:   { tier: spec, ref: SPEC-AUTH-001#td-token-gen }
    relationship: implements
    created: 2025-03-20
    verified: 2025-03-21
    status: active

  - id: TR-004
    from: { tier: code, type: function, ref: src/auth/jwt.py::generate_jwt }
    to:   { tier: context, type: ctx-code, ref: CTX-CODE-001 }
    relationship: informed_by
    created: 2025-03-20
    status: active

  # Test → Validation spec
  - id: TR-005
    from: { tier: code, type: test, ref: "tests/test_auth.py::test_token_expires_after_15_minutes" }
    to:   { tier: spec, ref: SPEC-AUTH-VAL-001#ac-token-expiry }
    relationship: satisfies
    created: 2025-03-21
    verified: 2025-03-21
    status: active

  # Result → Execution spec + artifacts
  - id: TR-006
    from: { tier: result, ref: RESULT-AUTH-001 }
    to:   { tier: spec,   ref: SPEC-AUTH-001 }
    relationship: summarizes
    created: 2025-03-22
    status: active

  - id: TR-007
    from: { tier: result, ref: RESULT-AUTH-001 }
    to:   { tier: code,   type: function, ref: src/auth/jwt.py::generate_jwt }
    relationship: includes_artifact
    created: 2025-03-22
    status: active
```

### When Ari Updates TRACES.yml

- **Context spec created:** adds CTX→SPEC `informs` traces to every execution spec in `context_refs`
- **Task published (step 9):** adds SPEC→CTX `informs` and SPEC→CTX `derived_from` traces from each task's `context_refs`
- **Code reviewed (user pastes file or commit):** adds CODE→SPEC `implements` and CODE→CTX `informed_by` traces from `# spec:` and `# ctx:` annotations
- **Spec version bumped:** marks all `implements` traces to that spec as `status: needs_review`
- **Spec moved to DEPRECATED:** marks all traces pointing to that spec as `status: orphaned`
- **Result spec generated:** adds RESULT→SPEC `summarizes` and RESULT→CODE `includes_artifact` traces
- **Any trace update:** regenerates the Mermaid trace graph in the dashboard page (see Trace Health Dashboard)

---

## Drift Prevention Gate Checks
→ *Referenced by: Task Done Workflow*

Ari runs these checks at lifecycle transitions before proceeding. Failing a check outputs a BLOCKED gate — same format as the publish protocol.

### Gate: Execution → Validation

1. **Implementation coverage** — every section anchor (`#td-*`) in the execution spec has at least one `implements` trace in TRACES.yml
2. **No orphan annotations** — all `# spec:` annotations in code resolve to a known ACTIVE spec ID
3. **No DRAFT specs** — all execution specs for this initiative are `status: ACTIVE`

Failure output:
```
🚫 DRIFT GATE BLOCKED — SPEC-AUTH-001#td-token-gen has no implements trace
   Required: add # spec: SPEC-AUTH-001#td-token-gen to the implementing function,
             then update TRACES.yml with a new TR entry (relationship: implements)
```

### Gate: Validation → Done

1. **Test coverage** — every acceptance criterion anchor (`#ac-*`) in the validation spec has a `satisfies` trace
2. **All tests passing** — Ari asks for test output or CI link; does not self-certify
3. **No stale traces** — no `status: needs_review` entries in TRACES.yml for this spec's traces

### Ongoing Drift Alerts

Triggered automatically when:

- A spec's `version` increments → flag all `implements` traces pointing to it: "Spec updated — verify these traces are still accurate before Validation gate"
- A spec moves to `DEPRECATED` → flag all pointing traces as orphaned; prompt to update code annotations or reclassify the trace
- A `CODE/test` trace exists for a spec section but no `CODE/function` trace for the same section → "Spec has test coverage but no implementation trace — possible dead test or missing annotation"

---

## Ralph Loop Protocol — Autonomous Validation Iteration
→ *Referenced by: Column Architecture (gate-fail), Entry Points (LOOP mode), Task Done Workflow*

The Ralph loop is the enforcement mechanism that prevents SDD from stalling at a failed validation. When any VA task fails its acceptance gate, the system does not wait for human input — it diagnoses, applies the best known fix, re-measures, and loops until the gate passes or a hard blocker is hit.

**Core invariant: a failing VA task is never left as "noted failed." The loop always continues.**

---

### Loop iteration structure

Each iteration follows this exact sequence — no step may be skipped:

1. **Run** — Execute the validation task's measurement or test
2. **Gate check** — Call `sdd-conductor validate` with the measured metric (see Conductor Call below). The conductor posts the board comment, creates the next iteration task, and exits 0 (pass) or 1 (continue).
3. **Exit 0 (pass)** → conductor has already marked VA Done, propagated checklist, posted completion comment. Exit loop.
4. **Exit 1 (fail)** → conductor has posted iteration comment and created the next EX iteration task on the board. Diagnose root cause, apply best known fix, loop.
5. **Hard blocker check** — Does any condition below apply? If yes → post BLOCKED comment, set task BLOCKED, exit loop; do not apply a fix.

**Conductor call (mandatory — replaces manual curl iteration comment):**

```bash
node /path/to/dai-skills/skills/sdd-conductor/sdd-conductor.mjs validate <vaTaskId> \
  --metric <measured_value> \
  --threshold <gate_threshold> \
  --iteration <N>

# Examples:
node sdd-conductor.mjs validate task_abc123 --metric 85 --threshold 100 --iteration 1
node sdd-conductor.mjs validate task_abc123 --metric 100 --threshold 100 --iteration 2
```

Exit 0 → VA is Done on the board, loop ends.
Exit 1 → iteration comment posted, next refinement EX task created, continue.

**After exit 1:** post a diagnosis supplement comment using `progress` before touching any code:

```bash
node sdd-conductor.mjs progress "Iteration N diagnosis: <root cause> | Fix: <exact change>"
```

---

### Iteration comment format

Every failed iteration MUST post this comment to the VA task before touching anything for the next iteration:

```
[all-dai-sdd-system-message]

**Ralph loop — iteration N / MAX_N**
**Result:** <metric> = <value> (gate: ≥<threshold>, North Star: ≥<ns_threshold>)
**Gap:** <value - threshold> below gate

**Diagnosis:**
<Root cause — specific, not generic. "Coverage too low (9x)" not "pipeline issue".>

**Fix applied for next iteration:**
<Exact change — parameter name, old value → new value, or approach change.>

**Expected impact:**
<Why this specific change should move the metric toward the gate.>

**Next iteration starts immediately.**
```

For drive scripts (compute-heavy tasks): post this comment via the Dataspheres API inside the loop script — don't rely on the agent to post it after the fact.

---

### Hard blocker criteria

Only these conditions exit the loop with a BLOCKED status. Everything else continues:

| Condition | Definition |
|---|---|
| **Fundamental data constraint** | Input data cannot meet the threshold regardless of algorithm (e.g., coverage < 5x with no additional reads available) |
| **Architectural mismatch** | The tool or approach is wrong for the data type at a fundamental level (e.g., GATK HaplotypeCaller on bisulfite-converted reads — produces 0 valid SNPs regardless of parameters) |
| **Missing dependency — no alternative** | Required tool is not installed, cannot be installed in this environment, and no equivalent alternative exists |
| **Max iterations reached** | `MAX_ITERS` exhausted (default: 8). Log best result, post final summary. |

**Not hard blockers:** "results are poor", "it might not work", "it's taking a long time", "uncertain which fix is best." These are reasons to iterate, not reasons to stop.

### Iteration task lifecycle — EX-rwN and VA-rwN

When the conductor creates a refinement EX task (e.g. `EX-003-rw2 · <title> — iteration 2`) after a VA failure:

1. **EX-rwN is a full Execution task.** It appears in the Execution column and is picked up by `findNextIncomplete` before its parent VA task. Claude must execute it fully: read the Implementation Files, apply the fix, verify the output.
2. **EX-rwN does NOT get its own VA task.** The original VA task (e.g. VA-003) re-validates the EX-rwN fix. After advancing EX-rwN to Done, the loop returns to VA-003 in the next `--next` call.
3. **VA-003 stays open until it passes.** The loop advances VA-003 only when the EX-rwN fix makes all AC criteria pass. If EX-rw2 fails, the conductor creates EX-003-rw3, and the cycle repeats.
4. **Title convention:** `EX-NNN-rwN · <original title> — iteration N`. The `-rwN` suffix is what `sddKey()` strips when matching `VA-NNN` to its parent EX — do not use other suffixes.
5. **MAX_ITERS is shared.** The iteration count in the VA comment header tracks all rw cycles. When iteration N hits MAX_ITERS, the VA is BLOCKED regardless of which EX-rwN task was most recent.

On hard blocker, post this comment and stop:

```
[all-dai-sdd-system-message]

**Ralph loop — BLOCKED after iteration N**
**Best result achieved:** <metric> = <value> (gate: ≥<threshold>, delta: <gap>)
**Hard blocker:** <specific condition from the table above>
**What must change before loop can resume:** <exact requirement>
**Downstream blocked:** <task IDs that cannot advance until this is resolved>
```

---

### Gate vs North Star

The loop distinguishes two levels — passing the gate does NOT stop the loop:

| Level | Threshold | Behavior on pass |
|---|---|---|
| **Gate** | Minimum acceptable (e.g., F1 ≥ 0.95) | Close VA task → Done, continue iterating toward North Star |
| **North Star** | Exceeds published benchmark (e.g., F1 > 0.97) | Close VA task → Done, post celebration comment, exit loop |

The loop runs past gate pass because SDD's goal is not minimum compliance — it is to surpass the benchmark. Close the task when the gate passes (the board reflects reality), but keep running until North Star is hit or MAX_ITERS is reached.

---

### Drive script pattern — compute-heavy validation (>30 min/iteration)

When a VA task involves long-running compute (genome alignment, model training, large-scale simulation), the Ralph loop must run outside the agent context as a detached drive script. The agent context would time out; the script does not.

**When to use a drive script:**
- Single iteration takes >30 minutes of wall-clock time
- Requires compute that must run in a specific environment (WSL, GPU node, HPC)
- Multiple strategies need to be tried in parallel or sequence

**Drive script requirements:**

```bash
#!/usr/bin/env bash
# drive_<va-task-id>.sh — Ralph loop driver
# Must implement all of these:

MAX_ITERS=8          # hard cap — matches VA task spec
GATE=0.95            # gate threshold — must match VA task acceptance criteria
NORTH_STAR=0.97      # stretch target — must match VA task North Star criterion

# 1. Wait for upstream prerequisites (e.g., alignment output)
# 2. Run preprocessing once (e.g., dedup) — skip if already done
# 3. Ralph loop:
while [ "$iter" -lt "$MAX_ITERS" ]; do
    # Run measurement
    # Check gate → if pass: call close_<va-task-id>.py, exit 0
    # Check North Star → if hit: call close_<va-task-id>.py with NS flag, exit 0
    # Post iteration comment via Dataspheres API
    # Diagnose failure
    # Hard blocker check → if hit: post BLOCKED comment, exit 2
    # Apply fix
done
# Max iterations: log best result, post final summary, exit 3

# Exit codes: 0 = gate passed, 2 = hard blocker, 3 = max iterations
```

**Launch with setsid for full process detachment (WSL/Linux):**
```bash
(setsid bash specs/drive_<va-task-id>.sh \
  >> drive_<va-task-id>.log 2>&1 < /dev/null &)
sleep 2
pgrep -af "drive_<va-task-id>"   # verify it's running
```

**Agent behavior while drive script runs:**
- **Immediately after launching:** call `ScheduleWakeup(delaySeconds=270, reason="checking drive script progress for <va-task-id>")`. Without this, a session timeout silently kills monitoring. Re-schedule at the end of every check-in so the chain is unbroken.
- Check-in interval: 270s while the script is actively producing output; 1200s if waiting for a long compute step with no new log lines expected yet
- On each check-in: read log tail (`Get-Content drive_<id>.log -Tail 40`), check for gate pass / North Star / BLOCKER
- On gate pass or North Star: confirm VA task was closed on the board, report to user, cancel the next ScheduleWakeup
- On BLOCKER: diagnose immediately — apply a fix if possible, relaunch the drive script, re-schedule ScheduleWakeup
- Never report "waiting for the script to finish" as a completed action — keep iterating

**`close_<va-task-id>.py` requirements (called by drive script on gate pass):**
- Parse validation output (e.g., vcfeval summary.txt, test output JSON)
- Post completion comment to VA task with results table
- Move VA task to Done group (set `statusGroupId` + `status: DONE`)
- Propagate checklist tick to parent Epic

---

### Strategy grid pattern — multi-parameter search

When the fix space involves multiple discrete parameter combinations (GQ filters, learning rates, threshold grids), the Ralph loop should try them in parallel within a single iteration rather than one per iteration:

```bash
# Try N strategies simultaneously within one iteration
strategies=("s1:param1=A" "s2:param1=B" "s3:param1=C")
for entry in "${strategies[@]}"; do
    # build output for this strategy
    # run measurement
    # track best result
done
# After all strategies: check best against gate
# Next iteration: adjust the grid based on which strategy performed best
```

This expands the search space per iteration and reaches the gate faster than single-parameter sweeps.

---

## Trace Health Dashboard
→ *Referenced by: Step 11, Dashboard Page Template*

The trace health section in the initiative dashboard uses the platform's dataset + data card infrastructure. It requires the two trace datasets created in step 11.

### Dataset Schemas

**Traces dataset (`<initiative>-traces`):**

| Column | Type | Values |
|---|---|---|
| `trace_id` | text | TR-001, TR-002, ... |
| `from_ref` | text | CTX-PROMPT-001, src/auth/jwt.py::generate_jwt, RESULT-AUTH-001 |
| `from_tier` | select | context, spec, code, result |
| `to_ref` | text | SPEC-AUTH-001#td-token-gen, CTX-CODE-001 |
| `to_tier` | select | context, spec, code, result |
| `relationship` | select | informs, implements, informed_by, satisfies, derived_from, supersedes, refines, validates, depends_on, summarizes, includes_artifact |
| `status` | select | active, orphaned, needs_review |
| `created` | date | |
| `verified` | date | |

**Spec Health dataset (`<initiative>-spec-health`):**

| Column | Type | Notes |
|---|---|---|
| `spec_id` | text | SPEC-AUTH-001, CTX-PROMPT-001, RESULT-AUTH-001 |
| `title` | text | |
| `tier` | select | context, execution, result |
| `spec_type` | select | all spec_type values |
| `spec_status` | select | DRAFT, ACTIVE, DEPRECATED, SUPERSEDED, FINAL |
| `informs_count` | number | count of informs traces (for context specs) |
| `impl_traces` | number | count of implements traces (for execution specs) |
| `test_traces` | number | count of satisfies traces |
| `orphan_count` | number | count of orphaned traces |
| `needs_review_count` | number | |
| `last_verified` | date | |

### Data Cards to Create (Step 11)

```python
# Trace health by status — donut showing active/orphaned/needs_review split
create_data_card(dataset_id="<traces-id>", name="Trace Health", chart_type="donut", group_by="status")

# Implementation coverage per column — bar per execution spec column
create_data_card(dataset_id="<spec-health-id>", name="Spec Coverage by Column",
                 chart_type="bar", x_axis="spec_type", y_axis="impl_traces")

# Drift signals — any spec with orphan_count > 0
create_data_card(dataset_id="<spec-health-id>", name="Drift Signals",
                 chart_type="bar", x_axis="spec_id", y_axis="orphan_count")
```

Capture the three card IDs for substitution into the dashboard template.

### Initiative-Wide Trace Map (Dashboard)

The initiative-wide view uses a **left-to-right swimlane** format — four named subgraphs (Context / Specs / Code / Results) with edges crossing lanes. This makes the CTX→SPEC→CODE→RESULT flow read naturally left to right and stays legible up to ~40 nodes. Ari generates it from TRACES.yml and PATCHes the dashboard page whenever the trace graph changes.

```
graph LR
  subgraph CTX ["Context"]
    CTX_P1["CTX-PROMPT-001\nUser Brief"]
    CTX_C1["CTX-CODE-001\nsession_auth.py"]
    CTX_S1["CTX-SEARCH-001\nOAuth Research"]
  end

  subgraph SPECS ["Execution Specs"]
    SPEC1["SPEC-AUTH-001\nJWT Auth\n(api-contract)"]
    SPEC2["SPEC-AUTH-DS-001\nTokens Schema\n(data-schema)"]
  end

  subgraph CODE ["Code & Artifacts"]
    C1["jwt.py\n::generate_jwt"]
    C2["service.py\n::AuthService"]
    C3["migrations/0042"]
  end

  subgraph RESULTS ["Results"]
    R1["RESULT-AUTH-001\nAuth Build Report"]
  end

  CTX_P1 --> SPEC1
  CTX_C1 --> SPEC1
  CTX_S1 --> SPEC2
  SPEC1 --> C1
  SPEC1 --> C2
  SPEC2 --> C3
  R1 --> SPEC1
  R1 --> SPEC2
```

The swimlane makes the coverage gaps visible immediately: a Spec column node with no incoming CTX edges means the spec has no context citation. A Spec node with no outgoing CODE edges is unimplemented.

The graph lives in the dashboard page under "Trace Map". Ari regenerates and PATCHes it on each TRACES.yml update. For the **platform `trace-map` widget**, this swimlane layout (four fixed lanes, edges between) is the right format to implement — not force-directed, which loses the tier structure above ~20 nodes.

### Platform Requests

**What works today (no platform changes):**
- Per-spec Mermaid block inside task Tiptap content (PATCHed by Ari — fragile stopgap)
- Initiative-wide swimlane Mermaid graph in dashboard page (PATCHed by Ari)
- Dataset table embeds for the full trace appendix and Spec Health Index
- Data cards for coverage and drift metrics

**Platform enhancements — all shipped ✅:**

| Priority | Feature | Status | Notes |
|---|---|---|---|
| **1** | `SpecTraceCard` — conditional panel in task modal | ✅ Shipped | `src/client/components/planner/SpecTraceCard.tsx` — auto-triggers when task content has YAML with `spec_id:`. Collapsible panel outside TipTap. Discovers Traces dataset by name, filters on `from_ref`/`to_ref = spec_id`. |
| **2** | `data-widget-type="trace-map"` | ✅ Shipped | Tiered column SVG (CTX → SPEC → CODE → RESULT) in `PlannerWidgetRenderer`. Clickable nodes — spec nodes navigate, code nodes copy path. Requires `data-dataset-id`. |
| **3** | `data-widget-type="trace-health"` | ✅ Shipped | Matrix table of spec_type × status counts. Requires `data-dataset-id`. |
| **4** | `data-widget-type="drift-alerts"` | ✅ Shipped | Card list of rows with drift/stale/orphan status. Requires `data-dataset-id`. |
| **5** | Planner: `SPEC-*` / `CTX-*` / `RESULT-*` tag deep links | ✅ Shipped | `TaskCard.tsx` — tags matching `/^(SPEC\|CTX\|RESULT)-/i` render as clickable links to `/app/:uri/docs/:tag`. |

---

## Enforcement Hook Hardening

The SDD enforcement hook (`.claude/hooks/sdd-enforce.js`) blocks code edits when SDD mode is active but no task is in-progress. The naive implementation only checked `state.active && !state.activeTaskId`, which left a bypass hole: setting `active: false` directly in `sdd-active.json` via Bash silently disables enforcement without any planner visibility.

### Two Transparent Bypass Paths

Only these two paths are accepted — both leave a visible trail:

1. **Task-in-progress bypass** — mark a genuine task as in-progress with `sdd_task_start`. The planner shows the task as active and the activity feed records the start comment.

2. **`/sdd hotfix <reason>` escape hatch** — for urgent fixes that have no corresponding SDD task. This writes `hotfixReason` into `sdd-active.json` AND posts a comment to the active plan mode so the bypass is visible to stakeholders.

### `/sdd hotfix <reason>` Command

**To enter hotfix mode:**

```bash
# 1. Write hotfix state to sdd-active.json
node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('.claude/sdd-active.json', 'utf8'));
fs.writeFileSync('.claude/sdd-active.json', JSON.stringify({
  ...state,
  active: false,
  hotfixReason: '<reason>'
}, null, 2));
console.log('Hotfix mode enabled:', '<reason>');
"

# 2. Post a comment on the active plan mode so the bypass is visible
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/plan-modes/<planModeId>/comments" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content":"[all-dai-sdd-system-message] ⚠️ HOTFIX BYPASS — <reason>. Files modified outside SDD lifecycle."}'
```

**To exit hotfix mode (`/sdd hotfix done`):**

```bash
node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('.claude/sdd-active.json', 'utf8'));
const { hotfixReason, ...rest } = state;
fs.writeFileSync('.claude/sdd-active.json', JSON.stringify({
  ...rest,
  active: true,
  hotfixReason: null
}, null, 2));
console.log('Hotfix mode cleared — SDD enforcement re-enabled');
"
```

### Hardened Hook Pattern

The hardened hook treats `active: false` without `hotfixReason` as a corrupt/bypassed state and blocks it — same as if `active: true` with no task. Only the two transparent paths above are allowed through.

```js
// .claude/hooks/sdd-enforce.js — hardened pattern
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

// Normal inactive state — enforcement off
if (!state.active && !state.hotfixReason) return { block: false };

// Hotfix in progress — allow but warn so the developer sees it
if (!state.active && state.hotfixReason) {
  process.stderr.write('\u26a0\ufe0f SDD HOTFIX MODE: ' + state.hotfixReason + '\n');
  return { block: false };
}

// active:true but no task claimed — block
if (state.active && !state.activeTaskId) {
  return {
    block: true,
    reason: 'SDD enforcement: active initiative \'' + state.initiative + '\' has no task in-progress. \n' +
            'Run sdd_task_start(<taskId>, ...) to claim a task, or /sdd hotfix <reason> for urgent fixes.'
  };
}

// Task in progress — allow
return { block: false };
```

**Key rules:**
- `active: false` alone (no `hotfixReason`) = corrupt/bypassed state → **block**
- `active: false` + `hotfixReason` = legitimate hotfix → **allow + stderr warning**
- `active: true` + `activeTaskId` = task in-progress → **allow**
- `active: true` + no `activeTaskId` = SDD active but no task claimed → **block**

---

## Known API Gotchas

Collected from production pipeline failures. Each one costs real time when hit cold.

### Task comment payload: `"content"` not `"body"`

**Endpoint:** `POST /api/v2/dataspheres/<dsId>/tasks/<taskId>/comments`

The comment payload must use `"content"` as the field name. Using `"body"` returns HTTP 400 with `{"error":"Comment content is required"}` — silently on every call if you don't surface the status code.

```python
# WRONG — returns 400 every time
payload = {"body": "<h3>Gate: PASS</h3><p>...</p>"}

# CORRECT
payload = {"content": "<h3>Gate: PASS</h3><p>...</p>"}

# With screenshot attachments
payload = {
    "content": "<h3>Gate: PASS</h3><p>...</p>",
    "screenshots": ["https://comfy.dataspheres.ai/vb006/studio/scene/outputs/img_123.png"],
}
```

This applies to all comment endpoints: task comments, plan-mode comments, page comments. The field is always `"content"`.

### Spec field regex — one field per line

When embedding hidden metadata in task content using a regex scanner (`re.search(rf"{field}:\s*(.+)", content)`), the field value must be **alone on its line**. Anything after the value (including HTML like `-->`) gets captured into the match group.

```html
<!-- WRONG — regex captures "cmpq0bycw1bl4pb4wohzvtyn5 -->" -->
<!-- research_ref: cmpq0bycw1bl4pb4wohzvtyn5 -->

<!-- CORRECT — hidden div, one field per line -->
<div style="display:none">
research_ref: cmpq0bycw1bl4pb4wohzvtyn5
north_star_ref: cmpq0csg11blmpb4w0dkfq1tt
</div>
```

### `datasphereId` vs datasphere `uri`

The v2 task API (`/api/v2/dataspheres/<dsId>/tasks`) takes the **database ID** (e.g. `cmpev5pvc0fewo54wjkh90fh4`), not the human-readable URI (e.g. `dai-desktop`). The v1 page API uses the URI. Getting these backwards gives a 404 with no helpful message.

---

## Gate Briefing Pattern — Multi-Session Pipelines

For long-running generation pipelines (image sequences, video frames, batch transcoding), each Claude session should leave **gate briefings** embedded in the next pending task so the following session has full context without re-reading board state.

### The Problem

Long pipelines span dozens of sessions. Each session must:
1. Know which frame/item to generate
2. Know the exact generation command and parameters
3. Know the previous artifact URL for visual comparison
4. Know the gate acceptance criteria

Without embedded briefings, each new session has to reconstruct this from scratch — slow and error-prone.

### The Pattern

After completing any gate, post a `<!-- #gate-brief -->` section to the **next pending Execution task's content**:

```python
def build_briefing(frame_num, task_id, prev_filename):
    return (
        f"<h3>Gate Briefing <!-- #gate-brief --> (auto-generated)</h3>"
        f"<p><strong>This task is queued for generation + gate review.</strong></p>"
        f"<table>"
        f"<tr><td><strong>Frame</strong></td><td>{frame_num:03d}/048</td></tr>"
        f"<tr><td><strong>Task ID</strong></td><td><code>{task_id}</code></td></tr>"
        f"<tr><td><strong>Generator</strong></td><td>"
        f"<code>python gen_pipeline.py --frame {frame_num}</code></td></tr>"
        f"<tr><td><strong>Prompt</strong></td><td>{build_prompt(frame_num)}</td></tr>"
        f"<tr><td><strong>Prev frame</strong></td><td>"
        f"<a href='{prev_url}'>Frame {frame_num - 1:03d}</a></td></tr>"
        f"</table>"
        f"<h4>Gate Protocol</h4>"
        f"<ol>"
        f"<li>Generate: run gen_pipeline.py, wait for FRAME_READY line</li>"
        f"<li>Read the output image at the URL in FRAME_READY</li>"
        f"<li>Read previous frame image for visual comparison</li>"
        f"<li>Score on: character/scene consistency, motion continuity, no hallucinations</li>"
        f"<li>PASS (score ≥80): gate_pass(frame_num, task_id, filename, score)</li>"
        f"<li>FAIL (score &lt;80): gate_fail(frame_num, task_id, filename, score, reason)</li>"
        f"</ol>"
    )

# Update or append to the pending task
existing = task["content"]
marker = "<!-- #gate-brief -->"
if marker in existing:
    existing = re.sub(
        r"<h3>Gate Briefing <!-- #gate-brief -->.*?(?=<h[123]|$)",
        briefing + "\n", existing, flags=re.DOTALL
    )
else:
    existing += "\n" + briefing

api("PATCH", f"/api/v2/dataspheres/{DS_ID}/tasks/{task_id}", {"content": existing})
```

### When to Run

Run the briefing updater:
- After completing any gate (PASS or FAIL)
- At session end if frames are still pending
- After any param change that affects upcoming frames (guidance, IPA weight, etc.)

### The Next Session

The next session reads the pending task's Gate Briefing section and executes exactly what it says — no board archaeology required.

```python
# Next session: fetch the task and read the briefing
task = api("GET", f"/api/v2/dataspheres/{DS_ID}/tasks/{task_id}")["task"]
briefing_match = re.search(r"<!-- #gate-brief -->.*?(?=<h[123]|$)", task["content"], re.DOTALL)
if briefing_match:
    # Parse frame, command, prev URL from the HTML table
    ...
```

### Reference Implementation

`post_gate_briefings.py` in the samurai-flipbook project demonstrates this pattern for a 48-frame animation pipeline. It auto-discovers Done task artifacts for previous-frame URLs and posts structured briefings to all pending Execution tasks in one pass.

---

## Task State Protocol — sdd-conductor Gate State

`sdd-conductor.mjs` v1.2+ embeds a hidden `<div data-gate-state>` block in every task description. This block is the authoritative cross-session state — it survives context resets, browser refreshes, and tool restarts. Any session can read the current gate status without polling `.sdd-state.json` or reconstructing history from comments.

### Format

```html
<div data-gate-state style='display:none'>
gate_status: IN_PROGRESS
started_at: 2026-05-28T21:35:00Z
spec_id: EX-003
</div><!-- /gate-state -->
```

The div is always hidden and always at the end of the task content. The conductor writes it atomically — a PATCH that updates `statusGroupId` also updates `content` in the same call, so the board state and the embedded state never diverge.

### Gate Status Values

| `gate_status` | Meaning | Written by |
|---|---|---|
| `PENDING` | Task exists, waiting for execution to start | `complete` on previous task (via `injectNextBriefing`) |
| `IN_PROGRESS` | `start` was called, execution underway | `cmdStart` |
| `IN_VALIDATION` | Gate checks passed, moving through Validation column | `cmdComplete` (atomic) |
| `PASS` | Completed, in Done column | `cmdComplete` / `cmdRecover` |

### Lifecycle Sequence

```
PENDING → (start) → IN_PROGRESS → (complete, gate checks pass) → IN_VALIDATION → PASS
```

The transition from `IN_VALIDATION` → `PASS` happens in a single `cmdComplete` call — Execution tasks atomically route through the Validation column before landing in Done. This ensures the 6-column lifecycle is always traversed in order, and the trace graph has no gaps.

### Cross-Session Recovery

When a session crashes mid-gate, the task is stuck with an intermediate `gate_status`. Three recovery commands handle this:

**`node sdd-conductor.mjs resume`**
Scans the board for tasks in anomalous states:
- Execution column with `gate_status: IN_PROGRESS` (crashed mid-complete)
- Validation column with `gate_status` not `PASS` (stuck in pass-through)

Prints the exact `recover` command for each stuck task.

**`node sdd-conductor.mjs brief`**
Re-injects session briefings into all pending Execution tasks. Use this when starting a new session on a stalled pipeline — each pending task will have the previous-task context embedded in its description.

**`node sdd-conductor.mjs recover <taskId>`**
Forces a stuck task to Done: writes `gate_status: PASS`, patches `statusGroupId` to the Done column, posts a recovery comment, and calls `injectNextBriefing` to prime the next task.

### Session Briefing Injection

After every `complete` or `recover`, the conductor finds the next pending Execution task and injects a `<div data-gate-brief>` block into its description. This block contains:

- Which task was just completed (with timestamp)
- This task's spec ID and title
- The exact CLI commands to run next

The briefing is always replaced (never duplicated) — the conductor removes the old `<!-- /gate-brief -->` block before writing a new one.

This means any Claude session resuming work can read the active task's description and immediately know:
1. What was completed before
2. What to do now
3. The exact commands to run

No board archaeology. No re-reading SKILL.md from scratch. The context is in the ticket.

### Why Validation Column Cannot Be Skipped

The 6-column SDD lifecycle is `Research → North Stars → Epics → Execution → Validation → Done`. Every task must appear in every column — not just the final one. Before v1.2, `cmdComplete` patched directly to Done, leaving the Validation column empty and breaking the trace graph.

In v1.2+, `cmdComplete` atomically:
1. Patches `statusGroupId` to `validationGroupId` + writes `gate_status: IN_VALIDATION`
2. Immediately patches `statusGroupId` to `doneGroupId` + writes `gate_status: PASS`

Both writes happen in the same `cmdComplete` call. The task is visible in Validation for the duration of the API round-trip — long enough for the trace graph to record it, short enough that no human action is needed.

If `validationGroupId` is null (old `init` pre-v1.2), the conductor falls back to the direct Done path. Re-run `node sdd-conductor.mjs init` to pick up the Validation group ID.