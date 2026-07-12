# VC · <title> — Validation Criteria

> **Tier:** VC — Validation Criteria  
> **Parent:** TK (Tasks)  
> **Purpose:** THE work unit of the Ralph loop — typed acceptance criteria + the exact commands that prove them.

<!-- Front matter — REQUIRED (the loop.mjs gate blocks --advance if any is missing): -->
<!--
  parent_uuid: <uuid of the parent TK item>
  type: VC
  validation_kind: <ui | api | data | benchmark>
  uuid: <this item's own board id — run --stamp-uuids after creating>
-->

---

## Acceptance Criteria

<!-- Typed AC for this validation_kind (ui/api/data/benchmark). Each with the command that verifies it and the expected result. -->
<!-- HARD RULES (each has failed a real gate):
     - AC items must be PLAIN-TEXT <p> (no <strong>/<code> as the FIRST tag) or --check-item finds nothing.
     - validation_command_<kind>: goes ALONE on its line — newline BEFORE the closing </code></pre>.
     - Title must be ASCII (no em-dash / curly quotes / arrows) or --trace-audit flags it.
     - data-kind evidence must read persisted values back (counts, fields, "expected N got N");
       api-kind evidence must quote /api/... paths + HTTP status codes. -->

_TODO: fill in._

<!-- Every section header above is REQUIRED and checked by verifyV2Template() in loop.mjs.
     Author from this template, run `node loop.mjs --stamp-uuids`, then `--advance`. -->
