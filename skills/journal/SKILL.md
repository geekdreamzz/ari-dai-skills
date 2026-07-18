---
name: journal
description: The private reflection journal and Journal Modes in Dataspheres AI — entries with guided prompts, topical mode collections, and portable per-viewer journaling templates. API-only (no MCP tool yet); call the endpoints below with the caller's bearer token.
argument-hint: "[action] [options]"
---

# journal — Private Journaling & Journal Modes

The **Journal** is a member's private reflection space at `/app/{uri}/journal`. Each datasphere has one journal page (a SURVEY page in `JOURNAL` mode, provisioned on first use). Entries are **PRIVATE by default** — visible only to the author unless they explicitly change visibility. ARI may search and summarize the **caller's OWN** entries on request; it must never surface another member's private entries.

There is no MCP tool for the journal yet — operate it via the HTTP API with the caller's bearer token.

## The journal itself — `/api/v1/dataspheres/{uri}/journal`

| Method + path | Purpose |
|---|---|
| `GET /form` | The guided prompts (SurveyQuestions) + the journal page. |
| `GET /entries?mine=true` | The caller's own entries, newest first. `?modeId={id}` returns ONLY the caller's own entries written through that mode. |
| `POST /entries` | Create an entry. Body: `{contentHtml, promptAnswers?, visibility?, entryDate?, modeId?}`. `modeId` tags which template's prompts were used (the entry still lives in the caller's own journal). |
| `GET/PUT/DELETE /entries/{id}` | Read / edit / delete — author only; others' PRIVATE entries return 404. |

## Journal Modes — organized topical collections

**Member-facing framing:** a Journal Mode is a way to **group related entries by topic** so you can keep and revisit them together (e.g. "Gratitude", "Health", "Ideas"). Author-owned: you create a mode, then add your OWN entries to it. Any datasphere member can create modes; they can only ever expose entries they authored themselves.

**Backend capability (not shown in the mode UI):** a mode can additionally be **shared as READ-ONLY context to a same-datasphere newsletter or course audience** so those entries inform future engagement. The human host **never reads raw entries** — only the owner and the AI context pipeline see the words; humans get aggregate/AI-derived context. The read wall is **authorship, not rank**: even a datasphere OWNER/ADMIN gets no bypass.

Endpoints — `/api/v2/dataspheres/{dsId}/journal-modes` (note: dsId, not uri):

| Method + path | Purpose |
|---|---|
| `POST /` `{name}` | Create a mode in the caller's own collection. |
| `GET /` | List the caller's OWN modes. |
| `DELETE /{modeId}` | Delete own mode. |
| `POST /{modeId}/entries` `{entryId}` | Add one of the caller's OWN entries to the mode (foreign entry → 403). |
| `DELETE /{modeId}/entries/{entryId}` | Remove an entry from the mode. |
| `GET /{modeId}/entries` | Read mode entries — author always; a subscriber of a granted newsletter may read; everyone else (incl. DS owner/admin) 403. |
| `POST /{modeId}/grants` `{newsletterId}` | Share the mode as read-context to a same-datasphere newsletter's audience. |
| `GET /{modeId}/grants`, `DELETE /{modeId}/grants/{grantId}` | List / revoke grants. |

## Portable Journal-Mode Templates — per-viewer private journaling

A **template** is authored by a host (newsletter/course/community) and carries its OWN prompts. Publishing it yields a single link/embed; opening that link **resolves each viewer to THEIR OWN private-datasphere journal** and drops them into it with the template's prompts. Entries live in the **viewer's own** journal (tagged by `modeId`) and stay private to them — the host never reads them, only aggregate AI context.

Endpoints — `/api/v2/dataspheres/{dsId}/journal-mode-templates`:

| Method + path | Purpose |
|---|---|
| `POST /` `{name, description?, prompts?}` | Create a template (host-DS membership). |
| `GET /`, `GET /{modeId}` | List / read templates (with ordered prompts). |
| `PATCH /{modeId}` | Update fields — **author only** (403 otherwise). |
| `PUT /{modeId}/prompts` `{prompts}` | Replace the prompt set — author only. |
| `POST /{modeId}/publish` | Publish → `{link, embedSnippet}`. Link is `/app/{uri}/journal/m/{modeId}?compose=1`. |
| `POST /{modeId}/open` | **VIEWER-facing.** Resolves the caller to their profile datasphere, ensures their journal, fetch-or-creates their per-mode state (idempotent), returns their journal + the template prompts. |
| `GET /{modeId}/entries` | The PRIVACY WALL — returns ONLY the caller's own entries for this template. No role or grant returns anyone else's. |
| `GET /{modeId}/context` | Author-gated AI-context bridge — aggregate signals (entry/participant counts, recency) with **zero raw entry text**. |
| `DELETE /{modeId}` | Delete a template — author only. |

## Privacy invariants (enforce, never violate)

- A member's journal entries live in **their own profile datasphere** and are readable only by them and the AI context pipeline. No human — host author, DS owner, DS admin, or another member — can read another member's entries.
- When summarizing or searching, operate ONLY on the caller's own entries unless a mode grant explicitly authorizes a newsletter subscriber to read that mode.
- The AI-context bridge exposes counts and derived signals, never raw entry text.

## Route map

- Journal: `/app/{uri}/journal`
- Per-mode journaling surface: `/app/{uri}/journal/m/{modeId}` (`?compose=1` opens the composer)
