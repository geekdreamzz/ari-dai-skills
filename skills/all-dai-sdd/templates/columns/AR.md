# AR · <title> — Artifacts

> **Tier:** AR — Artifacts  
> **Parent:** VC (Validation Criteria)  
> **Purpose:** The shipped deliverable — verified code (with tracing decorators), media (with sha256), or a report (with citations). Never an empty stub.

<!-- Front matter — REQUIRED (the loop.mjs gate blocks --advance if any is missing): -->
<!--
  parent_uuid: <uuid of the parent VC item>
  type: AR
  artifact_type: <code | media | report>
  uuid: <this item's own board id — run --stamp-uuids after creating>
-->

---

## Citations

<!-- code → every cited file exists + carries the parent VC uuid in a decorator; media → file + sha256 + bytes per asset; report → ≥2 resolvable links. -->

_TODO: fill in._

<!-- Every section header above is REQUIRED and checked by verifyV2Template() in loop.mjs.
     Author from this template, run `node loop.mjs --stamp-uuids`, then `--advance`. -->

<!-- HARD RULE (AR citations): every cited code file must contain the literal VC-NNN string
     ON DISK — write decorators as `spec: TK-NNN / VC-NNN | initiative: <slug>` at the change
     site or header. Enumerate keys in full (VC-003, VC-004 — never VC-003/004). No
     TODO|TBD|FIXME|placeholder anywhere in the AR body. -->
