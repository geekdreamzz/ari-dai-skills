---
name: release-notes
description: Generate, list, fetch, and publish release notes via the Dataspheres AI REST API. Supports local preview (localhost) and production publish (dataspheres.ai) with separate API keys.
argument-hint: "list | fetch <slug> | preview | publish | [version e.g. v0.4.0]"
---

# Release Notes Skill

Manage release notes for DATASPHERES AI — list existing, fetch content, generate new, preview locally, and publish to production.

## Configuration

Load credentials from `~/.dataspheres.env`:
```bash
export $(grep -v '^#' ~/.dataspheres.env | xargs)
```

Required variables:

| Variable | Purpose | Example |
|----------|---------|---------|
| `DATASPHERES_API_KEY` | Local dev API key | *(loaded from `~/.dataspheres.env`)* |
| `DATASPHERES_PROD_KEY` | Production API key | *(loaded from `~/.dataspheres.env`)* |
| `DATASPHERES_BASE_URL` | Local base URL | `http://localhost:5173` |
| `DATASPHERES_DEFAULT_URI` | Target datasphere | `dataspheres-ai` |

> **Key precedence:** Always use `DATASPHERES_API_KEY` for local, `DATASPHERES_PROD_KEY` for production. The legacy `DATASPHERES_LOCAL_KEY` is deprecated — do not use it.

---

## Commands

### `/release-notes list` — List existing release notes

Fetch all release notes pages from the local or production API:

```bash
# Local
curl -s "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages?folder=Release+Notes&limit=50" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  | python3 -c "import sys,json; data=json.load(sys.stdin); [print(f'{p[\"slug\"]:35s} {p[\"title\"]:55s} {p[\"status\"]}') for p in data.get('pages',[])]"
```

```bash
# Production
curl -s "https://dataspheres.ai/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages?folder=Release+Notes&limit=50" \
  -H "Authorization: Bearer $DATASPHERES_PROD_KEY" \
  | python3 -c "import sys,json; data=json.load(sys.stdin); [print(f'{p[\"slug\"]:35s} {p[\"title\"]:55s} {p[\"status\"]}') for p in data.get('pages',[])]"
```

Output the results in a table and include preview URLs:
- Local: `http://localhost:5173/docs/dataspheres-ai/<slug>`
- Prod: `https://dataspheres.ai/docs/dataspheres-ai/<slug>`

---

### `/release-notes fetch <slug>` — Fetch a specific release note

Retrieve the full content of a release note by slug:

```bash
curl -s "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages/<slug>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
```

Display: title, status, slug, isPubliclyVisible, createdAt, and a summary of the HTML content.

---

### `/release-notes preview` or `/release-notes [version]` — Generate & preview locally

#### Step 1 — Read recent commits
```bash
cd /Users/bunnarithbao/ship/dataspheres-ai
git log --oneline --no-merges -20 --format="%h %s (%an, %ar)"
```

For more detail on the latest commit:
```bash
git show HEAD --stat --format="%B"
```

#### Step 2 — Determine next version

List existing release notes to find the current version:
```bash
curl -s "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages?folder=Release+Notes&limit=50" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  | python3 -c "import sys,json; data=json.load(sys.stdin); [print(p['slug']) for p in data.get('pages',[]) if p['slug'] != 'release-notes']"
```

Increment the patch version (e.g. `v0.3.0` → `v0.4.0`). If the user specifies a version, use that.

#### Step 3 — Generate content

Synthesise a warm, user-friendly HTML release note. **USER-FACING VALUE ONLY.**

**Content rules:**
- Only describe what users can see, click, or benefit from
- NO internal ops details (commit counts, files changed, insertions)
- NO security implementation details (auth retries, JWT handling, middleware changes)
- NO infrastructure/devops details (Docker, Prisma, CI/CD, deploy pipelines)
- NO schema/migration details
- NO developer tooling or internal skills
- Frame bug fixes as positive outcomes ("Task delete works reliably") not technical explanations
- Keep it concise — if a feature needs more than 2 sentences, it's too detailed

**Sections:**
- **What's New** — major user-facing features (bullet list with `<strong>` headings + 1-line description)
- **Fixes & Polish** — bug fixes and UX improvements described as outcomes, not technical changes
- Closing warm sentence
- `<div data-type="doc-footer" class="doc-footer-block"></div>` at the end (renders animated footer)

**NO "Under the Hood" section.** Users don't need to know internals.

HTML template:
```html
<h1>Release Notes — vX.Y.Z</h1>
<p>Short warm intro — what this release is about in one sentence.</p>
<h2>What is New</h2>
<ul><li><p><strong>Feature Name</strong> — What it does for the user.</p></li></ul>
<h2>Fixes &amp; Polish</h2>
<ul><li><p>Outcome-focused description of what got better.</p></li></ul>
<hr/>
<p>Thank you for being part of the DATASPHERES AI community.</p>
<div data-type="doc-footer" class="doc-footer-block"></div>
```

#### Step 4 — Assign sortOrder

**Determine the correct `sortOrder`** before creating the page:
- The **index page** (`release-notes`) is always `sortOrder: 0`
- **Newest version is always `sortOrder: 1`** — bump all existing version pages by +1 first
- Query existing pages and bump them:
```bash
# 1. List current pages and bump each version page's sortOrder by +1
# 2. Then create the new release with sortOrder: 1
```

#### Step 5 — Preview on local

**Creates or updates** the page on localhost (upsert by slug):
```bash
curl -s -X POST "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "title": "vX.Y.Z — Release Title",
    "slug": "release-notes-vX-Y-Z",
    "content": "<html-content>",
    "sortOrder": <next-sort-order>,
    "status": "PUBLISHED",
    "folderName": "Release Notes",
    "isPubliclyVisible": true,
    "visualConfig": {"overlays":[{"id":"rn-float","type":"floating","config":{"emojis":["🚀","✨","🎉"],"count":10,"direction":"up","speed":1}}]}
  }'
```

Preview URL: `http://localhost:5173/docs/dataspheres-ai/<slug>`

---

### `/release-notes publish` — Publish to production

**Only after the user confirms the local preview looks good.**

1. First, list local release notes to identify what to publish:
```bash
curl -s "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages?folder=Release+Notes&limit=50" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
```

2. Fetch the full content of each page to publish:
```bash
curl -s "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages/<slug>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY"
```

3. Push to production (upsert by slug — include `sortOrder` to preserve ordering):
```bash
curl -s -X POST "https://dataspheres.ai/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages" \
  -H "Authorization: Bearer $DATASPHERES_PROD_KEY" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "title": "<title-from-local>",
    "slug": "<slug-from-local>",
    "content": "<content-from-local>",
    "sortOrder": <sortOrder-from-local>,
    "status": "PUBLISHED",
    "folderName": "Release Notes",
    "isPubliclyVisible": true,
    "visualConfig": <visualConfig-from-local>
  }'
```

4. Confirm production URL: `https://dataspheres.ai/docs/dataspheres-ai/<slug>`

**Publish all or selective:** When user says "publish", ask whether to push ALL local release notes or just specific ones. Default to pushing all that exist locally but not yet on prod.

---

### `/release-notes sync` — Sync local to production

Compare local and production release notes, then push any that are missing or outdated on prod:

1. Fetch local list + prod list
2. Diff by slug — identify missing on prod or content differences
3. Show the diff to the user
4. On confirmation, push each missing/updated page to prod

---

## Key Rules

- **Always remind the user to publish to prod** — after local preview, explicitly say:
  > "Preview looks ready. Run `/release-notes publish` to push to production when you're happy with it."
- **Never auto-publish to prod** — always stop after local preview and wait for user confirmation
- **Always include the doc-footer marker** at the end of content
- **Slug format**: `release-notes-vX-Y-Z` (e.g. `release-notes-v0-3-0`) — always include the `v` prefix
- **Folder**: always `"Release Notes"`
- **visualConfig**: use release-themed emojis relevant to the features in this release
- **Tone**: warm, user-facing value only. No internal ops, security details, commit counts, or infrastructure info.
- **Prod key**: if `DATASPHERES_PROD_KEY` is empty, remind the user to set it before publishing
- **API key**: use `DATASPHERES_API_KEY` for local, `DATASPHERES_PROD_KEY` for production — never use the deprecated `DATASPHERES_LOCAL_KEY`

## Encoding Rules (CRITICAL)

**Never use special Unicode characters in curl payloads.** Windows shells mangle them into `?` or `�`.

- **No em dashes** (`—`) — use a plain hyphen (`-`) instead
- **No curly quotes** (`"` `"` `'` `'`) — use straight quotes (`"` `'`)
- **No special ellipsis** (`…`) — use three dots (`...`)
- **No non-ASCII emojis in titles** — only in HTML content body where they render correctly
- **Build JSON payloads via Node.js** (`node -e` + `JSON.stringify` + write to temp file + `curl -d @file`) instead of inline `--data-raw` with special characters. This guarantees correct UTF-8 encoding.
- **Always update the index page** (`release-notes`) when publishing a new version

## Ordering Convention (sortOrder)

The v1 pages API supports `sortOrder` (integer) on POST create, PUT update, and returns it in GET list/detail.
Pages are listed in `sortOrder ASC` order (then `updatedAt DESC` as tiebreaker).

**Release notes ordering (newest first):**

| sortOrder | Page | Purpose |
|-----------|------|---------|
| `0` | `release-notes` (index, titled "Latest") | Summary of last 3 releases — always first |
| `1` | `release-notes-v0-4-0` | Newest version |
| `2` | `release-notes-v0-3-0` | ... |
| `3` | `release-notes-v0-2-0` | ... |
| `N` | `release-notes-v0-1-0` | Oldest version = highest sortOrder |

**Rules:**
- **Index page is always `sortOrder: 0`** — it stays at the top of the list
- **New releases get `sortOrder: 1`** — then bump all existing version pages by +1 via PUT
- **Always set `sortOrder`** when creating or publishing a release note — omitting it leaves it as `null` which sorts unpredictably
- **When publishing to prod**, copy the `sortOrder` from local so both environments match
- **Update the index page** after each new release — it should summarize the last 3 versions with links

**Bumping existing pages when adding a new release:**
```bash
# For each existing version page, increment sortOrder by 1
# Then create the new release with sortOrder: 1
```

## Versioning Convention

`MAJOR.MINOR.PATCH` (always prefixed with `v`)
- PATCH: bug fixes, polish, minor features
- MINOR: significant new features or API changes
- MAJOR: breaking changes or complete rewrites
