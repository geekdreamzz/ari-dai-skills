---
name: dataspheres-api
description: Local dev skill for the Dataspheres AI Content API. Wraps /api/v1/ REST endpoints for local-to-production content workflows. Use when the user wants to push pages, generate release notes from git log, list pages, or update content in a datasphere from their local machine.
argument-hint: "push page <file.md> to <uri> | generate release-notes | list pages <uri> | update <slug> in <uri>"
---

# Dataspheres API — Local Dev Skill

You are helping the user interact with the Dataspheres AI Content API from their local machine.

## Configuration

Load from `~/.dataspheres.env`:
```bash
export $(grep -v '^#' ~/.dataspheres.env | xargs)
```

> **Note:** `source ~/.dataspheres.env` works in interactive shells but variables may not expand in single-line `source && curl` chains. Use `export $(...)` or set variables explicitly in the curl command.

**Environments:**

| Env | `DATASPHERES_BASE_URL` | `DATASPHERES_API_KEY` |
|-----|------------------------|----------------------|
| Local dev | `http://localhost:5173` | `dsk_2aaab5d44b69db5c966893974601952f` |
| Production | `https://dataspheres.ai` | *(user's production key)* |

The file `~/.dataspheres.env` is pre-configured for **local dev**. To target production, override:
```bash
DATASPHERES_BASE_URL=https://dataspheres.ai DATASPHERES_API_KEY=<prod-key> curl ...
```

Or update `~/.dataspheres.env` with the production values when deploying.

If the file is missing, create it:
```bash
cat > ~/.dataspheres.env << 'EOF'
DATASPHERES_API_KEY=dsk_371913272e93bbca01c7afc265326280
DATASPHERES_BASE_URL=http://localhost:5173
DATASPHERES_DEFAULT_URI=dataspheres-ai
EOF
```

---

## Rich Content Format (CRITICAL)

`purpose` and `content` fields are rendered as HTML via `dangerouslySetInnerHTML` in the TipTap display layer. **Always pass proper HTML — never plain text with `\n` newlines.**

**Purpose template (use for every new datasphere):**
```html
<h2>What is [Name]?</h2>
<p>One-paragraph hook — what this datasphere covers and why it matters. Use <strong>bold</strong> for key terms.</p>
<h2>What We Track</h2>
<ul>
  <li><p><strong>Topic area</strong> — specific description of what gets covered here</p></li>
  <li><p><strong>Topic area</strong> — specific description</p></li>
  <li><p><strong>Topic area</strong> — specific description</p></li>
</ul>
<h2>Who This Is For</h2>
<p>Specific audience description — roles, interests, level of depth expected.</p>
<blockquote><p>One sentence manifesto or thesis statement for the datasphere.</p></blockquote>
```

**Page content**: always use `<h2>`, `<p>`, `<ul><li>`, `<strong>`, `<blockquote>` — never raw line breaks.

**Mermaid diagrams (CRITICAL):** The TipTap display layer (`PageContentRenderer`) does NOT render markdown-style mermaid blocks (`<pre><code class="language-mermaid">`). It requires the TipTap node format:

```html
<div data-type="mermaid" data-code="ENCODED_MERMAID_CODE" class="mermaid-wrapper"><pre class="mermaid">MERMAID_CODE</pre></div>
```

- The `data-code` attribute value must be HTML-entity-encoded (use `html.escape(code, quote=True)` in Python or equivalent)
- The `<pre class="mermaid">` inner content is the raw mermaid code
- NEVER use `<pre><code class="language-mermaid">` — it will not render
- Example:
```html
<div data-type="mermaid" data-code="graph LR\n    A[Phone] --&amp;gt;|Chat| B[Claude.ai]" class="mermaid-wrapper"><pre class="mermaid">graph LR
    A[Phone] -->|Chat| B[Claude.ai]</pre></div>
```

---

## Available Workflows

### `/dataspheres-api push page <file.md> to <uri> [in folder "<folder>"]`

Push a local Markdown or HTML file as a page to a datasphere.

**Steps:**
1. Read the file content
2. Convert Markdown to HTML if `.md` extension (use `pandoc` if available, or simple regex)
3. Extract the first `# Heading` as the title (or use filename if no heading)
4. POST to `/api/v1/dataspheres/:uri/pages`

```bash
source ~/.dataspheres.env
curl -X POST "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"<extracted-title>\",
    \"content\": \"<html-content>\",
    \"folderName\": \"<folder>\",
    \"status\": \"PUBLISHED\"
  }"
```

**Notes:**
- If a page with the same slug already exists, the API upserts it (updates in place)
- Folder is auto-created if it doesn't exist, scoped to the datasphere
- slug is auto-generated from title if not provided

---

### `/dataspheres-api generate release-notes [to <uri>] [in folder "<folder>"]`

Read git commits since the last release tag, synthesize human-readable release notes, tag the release, and push to datasphere.

---

## Release Tagging Convention

Every release must be tagged in git **before** pushing to datasphere. Tags are the source of truth for what version a release notes page covers.

**Version scheme:** `vMAJOR.MINOR.PATCH`
- `MAJOR` — Breaking changes or platform-wide architectural shifts
- `MINOR` — Significant new features or UX milestones
- `PATCH` — Bug fixes, copy changes, small improvements

**Tag at the right commit** — tag the last commit of the release, not HEAD if there are unreleased commits:
```bash
# Tag a specific commit
git tag v0.4.0 <commit-sha> -m "v0.4.0 — Short description"

# Tag HEAD
git tag v0.4.0 -m "v0.4.0 — Short description"

# Push tags to remote
git push origin --tags
```

**Find delta since last tag:**
```bash
# List recent tags
git tag --sort=-creatordate | head -5

# Commits since last tag
git log <last-tag>..HEAD --oneline --no-merges --format="%h %s (%ar)"

# If no tags yet, use last N commits
git log --oneline --no-merges -40 --format="%h %s (%ad)" --date=short
```

**Release notes pages use slug pattern:** `release-notes-v{major}-{minor}-{patch}`
- Index page slug: `release-notes` (upserted each time — always shows last 3 releases)
- Individual page slug: `release-notes-v0-3-0`, `release-notes-v0-4-0`, etc.
- Folder: `Release Notes`

**Steps for each new release:**
1. `git tag vX.Y.Z <sha> -m "vX.Y.Z — Short description"`
2. `git push origin --tags`
3. Get delta: `git log <prev-tag>..<new-tag> --oneline --no-merges`
4. Synthesize into human-readable HTML (group by: New Features, Improvements, Bug Fixes)
5. Push individual page: `release-notes-vX-Y-Z`
6. Upsert index page: `release-notes` (update to include the new release at top, keep last 3)
7. Archive or remove releases older than 3 versions from the index page body

**Local API key:** If no API key exists locally, create one via:
```bash
TOKEN=$(curl -s "http://localhost:3000/api/auth/login" -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"carlos.rodriguez@aa.bb","password":"@bcd.1234$"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

curl -s -X POST "http://localhost:3000/api/v2/developers/keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"local-release-notes"}' \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('rawKey',''))"
```
Save the returned key to `~/.dataspheres.env` as `DATASPHERES_API_KEY`.

---

**Steps:**
1. Find delta commits since last tag
2. Group and synthesize into structured human-readable release notes
3. Tag the release in git, push tag
4. Push individual release page + upsert index page

```bash
# Read git log since last tag
LAST_TAG=$(git tag --sort=-creatordate | head -1)
git log ${LAST_TAG}..HEAD --oneline --no-merges --format="%h %s (%ar)"

# Then synthesize and push (Claude handles the AI synthesis step)
```

**Output format for release notes:**
```html
<h1>vX.Y.Z — Release Name</h1>
<p><strong>Released Month DD, YYYY</strong></p>
<p>One-line summary of the release theme.</p>
<h2>✨ New Features</h2>
<ul>
  <li><strong>Feature name</strong> — plain English description of what it does and why it matters.</li>
</ul>
<h2>🔧 Improvements</h2>
<ul>
  <li>Description of improvement.</li>
</ul>
<h2>🐛 Bug Fixes</h2>
<ul>
  <li>What was broken and how it was fixed.</li>
</ul>
```

**Push the release notes:**
```bash
source ~/.dataspheres.env
curl -X POST "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Release Notes — $(date '+%Y-%m-%d')\",
    \"content\": \"<html-content>\",
    \"folderName\": \"Release Notes\",
    \"status\": \"PUBLISHED\"
  }"
```

---

### `/dataspheres-api list pages <uri> [--folder "<folder>"]`

List pages in a datasphere, optionally filtered by folder.

```bash
source ~/.dataspheres.env
URI=${1:-$DATASPHERES_DEFAULT_URI}
FOLDER=${2:-""}

if [ -n "$FOLDER" ]; then
  curl "$DATASPHERES_BASE_URL/api/v1/dataspheres/$URI/pages?folder=$FOLDER&limit=50" \
    -H "Authorization: Bearer $DATASPHERES_API_KEY" | jq '.pages[] | {slug, title, status, folder: .docFolder.name}'
else
  curl "$DATASPHERES_BASE_URL/api/v1/dataspheres/$URI/pages?limit=50" \
    -H "Authorization: Bearer $DATASPHERES_API_KEY" | jq '.pages[] | {slug, title, status}'
fi
```

---

### `/dataspheres-api update <slug> in <uri>`

Update an existing page by slug. Accepted fields:

| Field | Type | Notes |
|-------|------|-------|
| `title` | string | Page title |
| `content` | string | HTML content |
| `status` | `PUBLISHED` \| `DRAFT` \| `ARCHIVED` | |
| `folderName` | string \| `""` | Move to folder (empty string = root) |
| `metaDescription` | string | SEO description |
| `isPubliclyVisible` | boolean | `true` = accessible without login at `/pages/:uri/:slug` |
| `customBylineName` | string \| `null` | Override author name shown on the page (e.g. datasphere name) |
| `customBylineAvatar` | string \| `null` | Override author avatar URL (e.g. datasphere profile image URL) |
| `sortOrder` | number | Controls display order within a folder (ascending). Pages list sorted by `sortOrder ASC`, then `updatedAt DESC`. |
| `visualConfig` | object \| `null` | Ambient overlay effects (see below) |

**Making a page public:** set `status: "PUBLISHED"` + `isPubliclyVisible: true`. Both are required — status controls whether the page is live, isPubliclyVisible controls whether non-members can access it.

**Datasphere byline example** (attribute content to the datasphere, not a person):
```bash
curl -X PUT "$DATASPHERES_BASE_URL/api/v1/dataspheres/$URI/pages/$SLUG" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "customBylineName": "Longevity Intel",
    "customBylineAvatar": "https://dataspheres.ai/uploads/longevity-intel-avatar.jpg"
  }'
```

Pass `null` to either field to revert to the author's real name/avatar.

**`visualConfig` shape — floating emojis example:**
```json
{
  "overlays": [
    {
      "id": "unique-id",
      "type": "floating",
      "config": {
        "emojis": ["🚀", "✨", "🎉"],
        "count": 12,
        "direction": "up",
        "speed": 1
      }
    }
  ]
}
```

Other supported `type` values: `confetti`, `ribbon`, `border`. Pass `visualConfig: null` to clear effects.

```bash
curl -X PUT "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/pages/$SLUG" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "title": "<new-title>",
    "content": "<new-html-content>",
    "status": "PUBLISHED",
    "isPubliclyVisible": true,
    "visualConfig": {"overlays":[{"id":"fx1","type":"floating","config":{"emojis":["🚀"],"count":10,"direction":"up","speed":1}}]}
  }'
```

---

### `/dataspheres-api list dataspheres`

List all dataspheres your API key has access to.

```bash
source ~/.dataspheres.env
curl "$DATASPHERES_BASE_URL/api/v1/dataspheres" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  | python3 -m json.tool
```

---

### `/dataspheres-api create datasphere`

Create a new datasphere. URI is auto-slugged from name if not provided. Creator is set as OWNER.

```bash
source ~/.dataspheres.env
curl -X POST "$DATASPHERES_BASE_URL/api/v1/dataspheres" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Datasphere Name",
    "uri": "optional-custom-uri",
    "description": "Short tagline shown in cards and previews.",
    "purpose": "<h2>What is [Name]?</h2><p>Hook paragraph with <strong>bold</strong> key terms.</p><h2>What We Track</h2><ul><li><p><strong>Topic</strong> — description</p></li></ul><h2>Who This Is For</h2><p>Audience description.</p><blockquote><p>One-sentence manifesto.</p></blockquote>",
    "status": "PUBLIC",
    "topicTags": ["tag1", "tag2"]
  }'
```

**Fields:**
| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Display name |
| `uri` | No | Auto-slugged from name if omitted |
| `description` | No | Plain text tagline for cards |
| `purpose` | No | **HTML** — rendered in TipTap display. Use template above. |
| `status` | No | `PUBLIC` \| `PRIVATE` \| `READ_ONLY` (default: `PRIVATE`) |
| `topicTags` | No | String array for discoverability |

---

### `/dataspheres-api update datasphere <uri>`

Update an existing datasphere. Only provide fields you want to change. Requires MODERATOR+ role.

```bash
source ~/.dataspheres.env
curl -X PUT "$DATASPHERES_BASE_URL/api/v1/dataspheres/<uri>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Updated Name",
    "description": "Updated tagline.",
    "purpose": "<h2>...</h2><p>Rich HTML content</p>",
    "status": "PUBLIC",
    "topicTags": ["tag1", "tag2"],
    "aboutExpandedByDefault": true,
    "systemInstructions": "AI persona and behavior instructions for this datasphere."
  }'
```

**Fields:**
| Field | Notes |
|---|---|
| `name` | Display name |
| `description` | Plain text tagline |
| `purpose` | **HTML** — use the rich content template |
| `status` | `PUBLIC` \| `PRIVATE` \| `READ_ONLY` |
| `topicTags` | String array — replaces existing tags |
| `aboutExpandedByDefault` | `true` = purpose section auto-expands on datasphere page (default on create: `true`) |
| `systemInstructions` | AI system prompt for this datasphere's conversations |

---

### `/dataspheres-api create sequencer in <uri>`

Create a scheduled web search sequencer. Template: `trigger → batch-web-search`.

```bash
source ~/.dataspheres.env
curl -X POST "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/sequencers" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Weekly Fintech News",
    "query": "fintech startup funding 2026",
    "schedule": { "frequency": "weekly", "day": "monday", "time": "09:00", "timezone": "America/New_York" },
    "maxResults": 10,
    "runNow": true
  }'
```

**Fields:**
| Field | Required | Notes |
|---|---|---|
| `name` | Yes | Display name for the sequencer |
| `query` | Yes | The search query to run on schedule |
| `schedule.frequency` | Yes | `hourly` \| `daily` \| `weekly` \| `monthly` |
| `schedule.time` | No | `HH:MM` format, default `09:00` |
| `schedule.day` | No | Day of week for weekly: `monday`–`sunday` |
| `schedule.timezone` | No | IANA timezone string, default `UTC` |
| `maxResults` | No | Results per run, default `10` |
| `runNow` | No | `true` = fire an immediate execution right now (in addition to the schedule) |

---

### `/dataspheres-api list sequencers in <uri>`

```bash
source ~/.dataspheres.env
curl "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/sequencers" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  | python3 -m json.tool
```

---

### `/dataspheres-api get sequencer <id> in <uri>`

```bash
source ~/.dataspheres.env
curl "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/sequencers/<sequencer-id>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  | python3 -m json.tool
```

---

### `/dataspheres-api update sequencer <id> in <uri>`

Pause, resume, set to manual, or update the query:

```bash
source ~/.dataspheres.env

# Pause
curl -X PATCH "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/sequencers/<id>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "PAUSED"}'

# Resume
curl -X PATCH "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/sequencers/<id>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "ACTIVE"}'

# Set to manual trigger (won't run on schedule until set back to SCHEDULE)
curl -X PATCH "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/sequencers/<id>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"triggerType": "MANUAL"}'

# Update the search query
curl -X PATCH "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/sequencers/<id>" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "AI regulation news 2026"}'
```

**Updatable fields:** `status` (ACTIVE|PAUSED|ARCHIVED), `triggerType` (SCHEDULE|MANUAL), `name`, `query`

---

### `/dataspheres-api run sequencer <id> in <uri>`

Trigger an immediate execution (fire-and-forget, returns 202):

```bash
source ~/.dataspheres.env
curl -X POST "$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/sequencers/<id>/run" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  | python3 -m json.tool
```

---

### `/dataspheres-api edit newsletter issue <issueId> in <uri>`

Edit the content of an existing newsletter issue. Accepts a `dsk_` API key (unlike the
in-app editor, which is JWT-only), so ARI and ari-dai-skills can both use it. Only the
fields you send are changed; status transitions (approve/send) are NOT handled here.

```bash
NL="<newsletterId>"; ISSUE="<issueId>"; URI="<datasphere-uri>"

# Discover ids if you don't have them
curl -s "$DAI_BASE/api/v1/dataspheres/$URI/newsletters" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '.newsletters[] | {id, name}'
curl -s "$DAI_BASE/api/v1/dataspheres/$URI/newsletters/$NL/issues" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '.issues[] | {id, subject, status}'

# Read the current issue (full content)
curl -s "$DAI_BASE/api/v1/dataspheres/$URI/newsletters/$NL/issues/$ISSUE" \
  -H "Authorization: Bearer $DAI_API_KEY" | jq '{subject, status, contentHtml}'

# Edit it — send only the fields to change
curl -s -X PUT "$DAI_BASE/api/v1/dataspheres/$URI/newsletters/$NL/issues/$ISSUE" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"subject":"Updated subject","contentHtml":"<p>New body.</p>","topicsCovered":["update"]}'
```

Editable fields: `subject`, `contentHtml`, `contentText`, `contentJson`, `visualConfig`,
`adminNotes`, `adminImageUrls`, `topicsCovered`, `contextSummary`, `customUri`,
`scheduledFor` (ISO date-time, or `null` to clear). Requires MODERATOR+ in the datasphere.

---

## API Reference (Quick)

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/v1/users/me` | any | Get API key owner's profile |
| POST | `/api/v1/users/profile-image/generate` | any | AI-generate user profile image |
| POST | `/api/v1/users/banner/generate` | any | AI-generate user banner image |
| GET | `/api/v1/dataspheres` | any member | List your dataspheres |
| GET | `/api/v1/dataspheres/:uri` | any member | Get full datasphere info (inc. bannerUrl) |
| POST | `/api/v1/dataspheres` | any | Create a new datasphere |
| PUT | `/api/v1/dataspheres/:uri` | MODERATOR+ | Update a datasphere |
| POST | `/api/v1/dataspheres/:uri/images/profile` | MODERATOR+ | AI-generate datasphere avatar |
| POST | `/api/v1/dataspheres/:uri/images/banner` | MODERATOR+ | AI-generate datasphere banner |
| GET | `/api/v1/dataspheres/:uri/pages` | PARTICIPANT+ | List/search pages |
| GET | `/api/v1/dataspheres/:uri/pages/:slug` | PARTICIPANT+ | Get a page |
| POST | `/api/v1/dataspheres/:uri/pages` | MODERATOR+ | Create/upsert a page |
| PUT | `/api/v1/dataspheres/:uri/pages/:slug` | MODERATOR+ | Update a page |
| GET | `/api/v1/dataspheres/:uri/folders` | PARTICIPANT+ | List doc folders (sorted) |
| PUT | `/api/v1/dataspheres/:uri/folders/:id` | MODERATOR+ | Update folder (name, sortOrder) |
| POST | `/api/v1/dataspheres/:uri/posts` | PARTICIPANT+ | Create a post |
| GET | `/api/v1/dataspheres/:uri/newsletters` | MODERATOR+ | List newsletters (+ issue counts) |
| GET | `/api/v1/dataspheres/:uri/newsletters/:newsletterId/issues` | MODERATOR+ | List issues of a newsletter |
| GET | `/api/v1/dataspheres/:uri/newsletters/:newsletterId/issues/:issueId` | MODERATOR+ | Get a newsletter issue |
| PUT | `/api/v1/dataspheres/:uri/newsletters/:newsletterId/issues/:issueId` | MODERATOR+ | Edit a newsletter issue (content only) |
| GET | `/api/v1/dataspheres/:uri/sequencers` | PARTICIPANT+ | List sequencers |
| GET | `/api/v1/dataspheres/:uri/sequencers/:id` | PARTICIPANT+ | Get sequencer + recent executions |
| POST | `/api/v1/dataspheres/:uri/sequencers` | MODERATOR+ | Create scheduled web search sequencer |
| PATCH | `/api/v1/dataspheres/:uri/sequencers/:id` | MODERATOR+ | Update status/triggerType/name/query |
| POST | `/api/v1/dataspheres/:uri/sequencers/:id/run` | MODERATOR+ | Trigger immediate execution |

**Not available via API (UI only):**
- Deleting pages or sequencers — must be done through the UI while logged in

**Auth:** `Authorization: Bearer dsk_...`
**Base URL (local):** `http://localhost:5173`
**Base URL (prod):** `https://dataspheres.ai`

**Public page URL pattern:**
- Local: `http://localhost:5173/pages/<uri>/<slug>`
- Prod: `https://dataspheres.ai/pages/<uri>/<slug>`

Example: `http://localhost:5173/pages/dataspheres-ai/release-notes`

---

## Error Handling

| Status | Meaning | Fix |
|--------|---------|-----|
| 401 | Invalid or expired key | Check `DATASPHERES_API_KEY` in `~/.dataspheres.env` |
| 403 | Not a member or wrong role | Ensure you have MODERATOR+ for write ops |
| 404 | Datasphere URI not found | Check `DATASPHERES_DEFAULT_URI` |
| 402 | Capacity exhausted | Upgrade plan at dataspheres.ai/app/settings |
| 400 | Validation error | Check input — title required, slug alphanumeric+hyphens, content max 5MB |

---

## Security Notes

- API keys are bcrypt-hashed — never stored in plaintext anywhere
- Your role is checked **live per request** against the DB — no caching
- Never commit `~/.dataspheres.env` to git — add it to `.gitignore`
- `folderName` auto-creation is scoped to the target datasphere only
