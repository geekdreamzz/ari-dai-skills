---
name: newsletters
description: Full newsletter lifecycle — create, configure all settings (frequency, personalization, AI model, web search, reply threading, plan mode wiring), manage subscribers, attach forms, draft and manage issues, preview personalized letters, enable private chat and email replies, and test in dev.
argument-hint: "[create | settings | subscribers | forms | drafts | replies | dev]"
---

# Newsletters — Complete Reference

Newsletters are AI-powered publications scoped to a datasphere. Every setting is configurable: schedule, personalization mode, AI model, web search, reply threading, and planner task wiring.

---

## The Personalized Newsletter Pattern

```
Subscriber fills out a survey (the "form")
        ↓
Their answers are stored as subscriber metadata
        ↓
At send time: AI reads their metadata + searches the web for timely context
        ↓
AI generates a unique piece of content written specifically for them
        ↓
They receive something that feels like it was made just for them
        ↓
Every letter includes a link to update their profile anytime
```

---

## 1. Create a Newsletter

```python
create_newsletter(
    datasphereId="...",                  # DB ID — get from list_dataspheres
    name="Love You From You",
    description="Weekly self-love letters, written just for you",
    personalizationMode="PERSONALIZED",  # NONE | TEMPLATE | PERSONALIZED
    systemInstructions="...",            # Editorial brief — see templates below
    globalContext="...",                 # Persistent facts AI reads every run
    enableWebSearch=True,
    webSearchInstructions="find 2-3 self-care practices relevant to {current_struggle}",
    aiModel="claude-sonnet-4-6",         # claude-sonnet-4-6 | claude-opus-4-7 | claude-haiku-4-5-20251001
    scheduleType="WEEKLY",               # MANUAL | DAILY | WEEKLY | BIWEEKLY | MONTHLY | CUSTOM
)
```

**HIL flow:** gather the 5 dimensions first (voice, personalization inputs, timely context, structure, subscriber journey), write `systemInstructions` in your response and show it to the user before calling.

### systemInstructions Templates by Voice Type

**First-person FROM subscriber (self-love, journaling, affirmations):**
> "You are writing a [description] in the first person, as if the subscriber is writing to themselves at their wisest and most compassionate. Use only 'I', 'me', 'my'. Never 'you' or 'your'. Draw entirely from their survey answers — every sentence should feel like it could only have been written for this specific person. [Structure]. End with [closing element]."

**Second-person TO subscriber (coaching, mentorship, accountability):**
> "You are a [role description] writing directly to the subscriber. Use warm second-person ('you', 'your'). Reference their specific answers throughout — never generic advice. [Structure]. Tone: [adjectives]."

**Third-person narrator (astrology, bedtime stories, horoscopes):**
> "You are writing a personalized [format] for the subscriber. Use their birth data / profile answers to make every insight specific to them, not just their sun sign. Incorporate web search results as current cosmic/contextual context. [Structure]."

---

## 2. Update All Newsletter Settings

Use `update_newsletter` to change any setting after creation. Show a before/after preview before calling.

```python
update_newsletter(
    newsletterId="nl_...",

    # Identity
    name="New Name",
    description="New tagline",

    # AI editorial brief
    systemInstructions="...",     # Most important — full editorial brief
    globalContext="...",          # Persistent facts: names, dates, locations

    # AI model
    aiModel="claude-opus-4-7",    # Upgrade for richer letters
    contextWindowDays=30,         # Days of datasphere activity AI looks back

    # Personalization
    personalizationMode="PERSONALIZED",   # NONE | TEMPLATE | PERSONALIZED
    contentTemplate="...",                # TEMPLATE mode only — use {{firstName}}, {{metadata.FIELD}}

    # Web search
    enableWebSearch=True,
    webSearchInstructions="find this week's {sun_sign} horoscope and planetary transits",

    # Schedule
    scheduleType="WEEKLY",        # MANUAL | DAILY | WEEKLY | BIWEEKLY | MONTHLY | CUSTOM

    # Planner task wiring
    planModeId="...",             # Board ID — ALL tasks in this board flow into AI context
    taskStatusFilter=[],          # [] = all statuses (default). ["TODO","IN_PROGRESS"] = open only

    # Reply threading
    private_thread_enabled=True,  # Enable subscriber email reply chat
    billing_mode="DATASPHERE_POOL",  # SUBSCRIBER | DATASPHERE_POOL
)
```

### Settings Reference

| Setting | Values | Effect |
|---|---|---|
| `name` | string | Display name shown in subscriber emails and the admin UI |
| `description` | string | Internal tagline — not shown to subscribers |
| `systemInstructions` | string | Full editorial brief the AI reads at generation time — the most important field |
| `globalContext` | string | Persistent facts (names, dates, locations) prepended to every AI context window |
| `personalizationMode` | `NONE` | Same content for every subscriber |
| | `TEMPLATE` | HTML with `{{firstName}}`, `{{metadata.FIELD}}` variables |
| | `PERSONALIZED` | AI generates a unique letter per subscriber using their survey answers |
| `scheduleType` | `MANUAL` | Admin triggers each issue manually |
| | `DAILY` / `WEEKLY` / `BIWEEKLY` / `MONTHLY` | Automated cadence |
| | `CUSTOM` | Custom cron |
| `aiModel` | `claude-haiku-4-5-20251001` | Fast, lightweight — good for simple updates |
| | `claude-sonnet-4-6` | Default — best balance |
| | `claude-opus-4-7` | Richest output — use for high-stakes personalized letters |
| `contextWindowDays` | number | How many days of datasphere pages/tasks the AI reads |
| `contentTemplate` | HTML string | TEMPLATE mode only — use `{{firstName}}`, `{{metadata.FIELD}}` variables |
| `enableWebSearch` | `true` / `false` | Let AI search web at generation time |
| `webSearchInstructions` | string | Search query template with `{variable}` slots — e.g. "find this week's {sun_sign} horoscope" |
| `planModeId` | board ID | Wire a planner board — all tasks become AI context (great for event calendars) |
| `taskStatusFilter` | `[]` | All tasks. `["TODO","IN_PROGRESS"]` = open only |
| `private_thread_enabled` | `true` | Issued emails include a unique reply-to per subscriber → group chat |
| `billing_mode` | `DATASPHERE_POOL` | AI reply costs come from the datasphere capacity pool |
| | `SUBSCRIBER` | Each subscriber pays from their own capacity |

**Planner wiring pattern:** Create a board (e.g. "Astrology Events"), add events as tasks with due dates, set `planModeId`. Every task in that board flows into every issue's AI context automatically — no extra steps.

---

## 3. Subscriber Management

### Add a subscriber

```python
add_newsletter_subscriber(
    newsletterId="nl_...",
    email="jane@example.com",
    name="Jane Smith",
    phoneNumber="+1...",       # optional — SMS delivery
    userId="...",              # optional — link to platform user instead of email
    invite=False,              # False = ACTIVE immediately. True = send confirmation email (PENDING)
)
```

**Two ways people subscribe:**
1. **Self-subscribe (recommended for public)** — share `/newsletters/{slug}`. Visitors see the archive and subscribe form.
2. **Manual add (this tool)** — for invited guests, beta testers, known contacts.

### List subscribers

```python
list_newsletter_subscribers(
    newsletterId="nl_...",
    status="ACTIVE",  # optional filter: ACTIVE | PENDING | UNSUBSCRIBED
)
```

Returns: `id`, `email`, `name`, `status`, `metadata`, `surveyCompletionStatus`, `createdAt`.

**Status meanings:**
- `ACTIVE` — receiving emails
- `PENDING` — invite sent, awaiting email confirmation
- `UNSUBSCRIBED` — opted out (never re-add without consent)
- `BOUNCED` — delivery failed

### Remove a subscriber

```python
remove_newsletter_subscriber(
    newsletterId="nl_...",
    subscriberId="sub_..."  # get from list_newsletter_subscribers
)
```

Hard-delete — use only when explicitly requested. For unsubscribes, the subscriber portal handles that automatically.

### Get a subscriber's profile (their personalization data)

```python
get_subscriber_profile(
    subscriberId="sub_...",
    magicToken="..."  # optional — for anonymous subscriber access via magic link
)
```

Returns: every mapped survey question + their current answers + the metadata fields used by the AI. Use this to:
- Debug why a letter read as generic ("What does she know about herself so far?")
- Find which metadata fields are missing before generation
- Show a subscriber their own profile

### Submit answers on behalf of a subscriber

```python
submit_subscriber_answers(
    subscriberId="sub_...",
    answers=[
        {"questionId": "q_...", "answerFormat": "LONG_TEXT", "textAnswer": "I'm proud of..."},
        {"questionId": "q_...", "answerFormat": "MULTIPLE_CHOICE", "selectedChoices": ["choiceId1"]},
    ]
)
```

Answer formats: `TEXT`, `LONG_TEXT`, `MULTIPLE_CHOICE`, `AUDIO` (with `audioFileUrl`), `VIDEO` (with `videoFileUrl`). Idempotent — replaying the same payload overwrites previous answers.

Always call `get_subscriber_profile` first to know which questions exist and what's missing.

### Get subscriber's issue history (journal)

```python
get_subscriber_journal(subscriberId="sub_...")
```

Returns every issue sent to this subscriber + their personalized content. Useful for showing a subscriber their letter archive.

### Bulk subscriber management (admin UI)

For CSV import/export and bulk actions, send the user to the admin page:

```
/app/{uri}/newsletters/{newsletterId}/subscribers
```

---

## 4. Forms — Create, Configure, Attach

Forms (surveys) are the personalization engine. Every answer a subscriber gives feeds into their metadata, which the AI uses to write their letter.

### Create a survey

```python
create_survey(
    title="Tell Me About You",
    datasphereUri="my-datasphere",
    surveyMode="QUESTIONNAIRE",
    surveyAccessLevel="PUBLIC",
    allowMultipleResponses=True,
    collectRespondentEmail=False,
    resultsAccessLevel="ADMIN_ONLY",
)
# → {"id": "page_...", "slug": "tell-me-about-you"}
# Save this pageId for all subsequent calls.
```

### AI-generate questions

```python
generate_survey_questions(
    pageId="page_...",
    prompt="This is a self-love newsletter. Generate 6-8 questions that give the AI enough to write a deeply personal letter. Include: first name, what they're proud of, current struggle, love language, affirmation they want to hear, preferred self-care, current energy level."
)
```

Review the generated questions, then add, edit, or reorder as needed.

### Add a question manually

```python
add_survey_question(
    pageId="page_...",
    questionText="What is your name?",
    answerFormats=["TEXT"],
    isRequired=True,
    order=0,
)
```

Answer formats:

| Format | Use for | Needs choices? |
|---|---|---|
| `TEXT` | Short text | No |
| `LONG_TEXT` | Multi-line textarea | No |
| `MULTIPLE_CHOICE` | Single select | Yes |
| `CHECKBOX` | Multi-select | Yes — `allowMultiple: true` required |
| `DROPDOWN` | Single select dropdown | Yes |
| `AUDIO_LIVE` | Record audio in browser | No |
| `AUDIO_UPLOAD` | Upload audio file | No |
| `VIDEO_LIVE` | Record video | No |
| `VIDEO_UPLOAD` | Upload video file | No |
| `IMAGE_UPLOAD` | Upload image | No |

**CRITICAL for CHECKBOX:** `allowMultiple` MUST be `true`.
**Choices format:** `{ options: ["string1", "string2"] }` — NOT objects.

### Edit a question

```python
update_survey_question(
    pageId="page_...",
    questionId="q_...",
    questionText="Updated question text",
    isRequired=False,
)
```

### Delete a question

```python
delete_survey_question(pageId="page_...", questionId="q_...")
```

### Reorder questions

```python
reorder_survey_questions(
    pageId="page_...",
    orderedIds=["q_001", "q_003", "q_002"]  # new order
)
```

### List questions

```python
list_survey_questions(pageId="page_...")
```

### View responses

```python
get_survey_responses(pageId="page_...")
```

### Analytics

```python
get_survey_analytics(pageId="page_...")
# → totalResponses, completionRate, distribution per question
```

### Export responses

```python
export_survey_responses(pageId="page_...", format="csv")  # csv | json
```

### Link a form to a newsletter

**This is the critical wiring step** — connects the survey to the newsletter's AI context and generates personalized invite codes for every subscriber.

```python
link_survey_to_newsletter(
    newsletterId="nl_...",
    surveyPageId="page_...",
    codePrefix="LOVE",   # appears in subscriber's invite URL
)
```

After this:
1. Survey appears with "In AI context" green badge in the survey editor
2. Per-subscriber personalized survey URLs are generated: `/s/{uri}/{slug}?code={code}`
3. Generation service automatically appends a "Update your profile" section + QR code to every sent letter
4. Subscribers who haven't responded get a "complete your profile" CTA instead of a personalized letter

### Wire metadata fields (survey mappings)

After linking, tell the AI which question answer → which metadata field:

```python
# Step 1 — let AI suggest all mappings at once
suggest_survey_mappings(
    newsletterId="nl_...",
    surveyPageId="page_...",
    prompt="This is a self-love newsletter. Map each question to a metadata field the letter AI can reference by name."
)
# Returns: [{questionId, metadataField, mappingType, reasoning}, ...]

# Step 2 — apply each suggested mapping
create_survey_mapping(
    newsletterId="nl_...",
    questionId="q_...",
    metadataField="current_struggle",   # snake_case — AI references this by name in letters
    mappingType="DIRECT",               # DIRECT | BOOLEAN | ARRAY_APPEND | OBJECT_MERGE | TRANSFORM
)

# Step 3 — verify
list_survey_mappings(newsletterId="nl_...")
```

**Mapping types:**
- `DIRECT` — copy answer as-is (most common)
- `BOOLEAN` — convert yes/no → true/false
- `ARRAY_APPEND` — add answer to a list (use for multi-select questions)
- `OBJECT_MERGE` — merge answer into an object
- `TRANSFORM` — apply custom rules

---

## 5. Drafting Issues (Safe — No Send)

Drafts sit in the queue with `status=DRAFT`. Nothing is sent until you explicitly call `send_newsletter_issue`.

### Create a draft (write it yourself)

```python
draft_newsletter_issue(
    newsletterId="nl_...",
    subject="Weekly Digest #3 — Leaning Into Rest",
    contentHtml="<h2>...</h2><p>...</p>",   # full email-safe HTML
    topicsCovered=["self-care", "rest", "boundaries"],
    contextSummary="Focus on rest after user mentioned burnout last week",
)
```

**Recommended flow:** Draft the issue content yourself in your response first. Show it to the user. Get edits. Then save with this tool.

**Don't call this when the user is already on an issue editor page** — use `update_newsletter_issue` instead to avoid creating a duplicate.

### Update an existing draft

```python
update_newsletter_issue(
    issueId="iss_...",
    subject="Updated subject line",
    contentHtml="...",     # APPEND or REPLACE — see below
    adminNotes="Private notes visible only to admins",
    topicsCovered=["updated", "topics"],
)
```

**Append vs replace:**
- "Add a section about X" → read current `contentHtml`, append a new `<h3>`+`<p>` block, send combined HTML
- "Rewrite the issue" → send only the new HTML
- "Change the subject" → send only `subject`, leave `contentHtml` unset

### List all issues (drafts and sent)

```python
list_newsletter_issues(newsletterId="nl_...")
# → [{id, subject, status (DRAFT|SENT), createdAt, sentAt, recipientCount}, ...]
```

### AI-generate a draft

```python
generate_newsletter_issue(
    newsletterId="nl_...",
    customPrompt="Focus on the theme of renewal and fresh starts this week",
)
# Takes 10-30 seconds. Returns subject + full contentHtml.
# For PERSONALIZED newsletters: this generates the base structure.
# Per-subscriber letters are generated at send time.
```

Always show the returned draft before asking if the user wants to send.

### Send an issue (irreversible — real emails)

**HIL gate: always show the draft and get explicit user confirmation before calling send.**

```python
send_newsletter_issue(issueId="iss_...")
# Sends to ALL ACTIVE subscribers. This is irreversible — emails are delivered immediately.
# For PERSONALIZED newsletters: one unique letter per subscriber generated at send time.
```

**Email-safe HTML subset** (only these tags render reliably across email clients):

| Tag | Use |
|---|---|
| `<h1>`, `<h2>`, `<h3>` | Headings |
| `<p>` | Paragraphs |
| `<strong>`, `<em>`, `<u>` | Bold, italic, underline |
| `<a href="...">` | Links |
| `<ul>`, `<ol>`, `<li>` | Lists |
| `<img src="..." alt="...">` | Images (use hosted URLs) |
| `<br>` | Line break |
| `<table>`, `<tr>`, `<td>` | Tables (layout, not `display: flex`) |
| `<blockquote>` | Pull quotes |

**Do not use:** `<div>`, `<script>`, `<form>`, CSS grid/flex, or inline `style` with shorthand properties.

---

## 6. Preview Personalized Letters

Before sending, always preview for a specific subscriber to verify personalization is wired:

```python
preview_personalized_newsletter(
    newsletterId="nl_...",
    subscriberId="sub_...",   # pick one who has completed the survey
    customPrompt="...",       # optional — additional context for this preview only
)
```

Returns `contentHtml` (the actual letter they would receive) and a `debug` block with `personalizationMode`, `metadataKeys`, `nameResolved`.

**If the letter reads as generic (same for everyone), check:**
- `personalizationMode` is `PERSONALIZED` on the newsletter
- The subscriber has survey responses — call `get_subscriber_profile`
- `link_survey_to_newsletter` has been run (survey shows "In AI context" badge)
- `list_survey_mappings` shows all questions mapped to metadata fields

---

## 7. Reply Threading — Private Chat and Email Replies

Enable subscriber replies and group chat directly from newsletter emails:

```python
update_newsletter(
    newsletterId="nl_...",
    private_thread_enabled=True,
    billing_mode="DATASPHERE_POOL",  # or SUBSCRIBER
)
```

**How it works:**
- Issued emails include a unique reply-to address per subscriber (unique Reply-To header)
- When a subscriber replies, it routes into a group chat thread
- Ari and other subscribers can respond in the thread
- Each reply is attributed to the correct subscriber

**Billing modes:**
- `DATASPHERE_POOL` — AI responses charged to the datasphere's community capacity pool. Any subscriber can participate regardless of tier. Requires an active paid capacity period on the datasphere.
- `SUBSCRIBER` — each subscriber is charged from their own capacity pool. Good for paid communities.

**After enabling:** "Issued emails will now include a reply footer. Subscribers reply to a unique address that routes into the group chat."

---

## 8. Verification Checklist

After full setup, verify:

- [ ] `personalizationMode` is `PERSONALIZED` on the newsletter
- [ ] `systemInstructions` is set (not empty)
- [ ] Survey shows "In AI context" green badge in the survey editor
- [ ] `list_survey_mappings` shows all questions mapped to metadata fields
- [ ] `preview_personalized_newsletter` returns a letter with `debug.metadataKeys` populated
- [ ] The preview letter reads as specific to that person, not generic
- [ ] At least one ACTIVE subscriber exists before sending

---

## 9. Dev / Local Testing

Use the local dev API key and local server for all testing before touching prod.

**Local credentials** (from `~/.dataspheres.env`):
```
DAI_LOCAL_KEY=dsk_742fd6da8c8ae88e4b1724bc8b065ddf
Local server: http://localhost:3000
```

**Test flow (PowerShell — Windows-native):**

```powershell
# 1. Point to local
$env:DATASPHERES_API_KEY = "dsk_742fd6da8c8ae88e4b1724bc8b065ddf"
$env:DATASPHERES_BASE_URL = "http://localhost:3000"

# 2. Create a test newsletter in a local datasphere
$body = @{name="Test Newsletter"; personalizationMode="PERSONALIZED"; scheduleType="MANUAL"} | ConvertTo-Json
$body | Out-File -Encoding utf8 "$env:TEMP\nl_create.json"
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/dataspheres/{dsId}/newsletters" `
  -Headers @{"Authorization"="Bearer $env:DATASPHERES_API_KEY"} `
  -ContentType "application/json" -InFile "$env:TEMP\nl_create.json"

# 3. Create test subscriber
$sub = @{email="test@example.com"; name="Test User"; invite=$false} | ConvertTo-Json
$sub | Out-File -Encoding utf8 "$env:TEMP\nl_sub.json"
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/newsletters/{nlId}/subscribers" `
  -Headers @{"Authorization"="Bearer $env:DATASPHERES_API_KEY"} `
  -ContentType "application/json" -InFile "$env:TEMP\nl_sub.json"

# 4. Preview (no email sent)
$prev = @{subscriberId="{subId}"} | ConvertTo-Json
$prev | Out-File -Encoding utf8 "$env:TEMP\nl_preview.json"
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/newsletters/{nlId}/preview" `
  -Headers @{"Authorization"="Bearer $env:DATASPHERES_API_KEY"} `
  -ContentType "application/json" -InFile "$env:TEMP\nl_preview.json"
```

**On Windows, save JSON bodies to temp files:**
```powershell
$body = @{name="Test Newsletter"; personalizationMode="PERSONALIZED"} | ConvertTo-Json
$body | Out-File -Encoding utf8 "$env:TEMP\nl_body.json"
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/dataspheres/{dsId}/newsletters" `
  -Headers @{"Authorization"="Bearer $env:DATASPHERES_API_KEY"} `
  -ContentType "application/json" `
  -InFile "$env:TEMP\nl_body.json"
```

**E2E Playwright test:**
```bash
npx playwright test tests/e2e/specs/newsletter-survey-personalized-draft-flow.spec.ts --workers=1
```

**Dev vs Prod checklist:**
- [ ] Verified full flow locally (create → subscriber → survey → link → mapping → preview) before promoting
- [ ] `preview_personalized_newsletter` tested with a real subscriber who has survey answers
- [ ] Reply threading tested with a test subscriber before enabling on prod
- [ ] `send_newsletter_issue` never called in local dev against real subscriber emails

---

## API Reference

| Tool | Method | Endpoint | Notes |
|---|---|---|---|
| `list_newsletters` | GET | `/api/v2/dataspheres/:uri/newsletters` | Uses URI (not DB ID) |
| `create_newsletter` | POST | `/api/dataspheres/:datasphereId/newsletters` | Uses DB ID |
| `update_newsletter` | PATCH | `/api/newsletters/:newsletterId` | All settings incl. reply threading |
| `draft_newsletter_issue` | POST | `/api/newsletters/:newsletterId/issues` | Creates DRAFT, no send |
| `update_newsletter_issue` | PATCH | `/api/newsletter-issues/:issueId` | Edit existing draft |
| `list_newsletter_issues` | GET | `/api/newsletters/:newsletterId/issues` | Drafts + sent |
| `generate_newsletter_issue` | POST | `/api/newsletters/:newsletterId/generate` | AI-generated draft |
| `preview_personalized_newsletter` | POST | `/api/newsletters/:newsletterId/preview` | No send — safe to call anytime |
| `send_newsletter_issue` | POST | `/newsletter-issues/:issueId/send` | **Irreversible — real emails** |
| `add_newsletter_subscriber` | POST | `/api/newsletters/:newsletterId/subscribers` | |
| `remove_newsletter_subscriber` | DELETE | `/api/newsletters/:newsletterId/subscribers/:subscriberId` | Hard-delete |
| `list_newsletter_subscribers` | GET | `/api/newsletters/:newsletterId/subscribers` | Filter by status |
| `get_subscriber_profile` | GET | `/api/newsletter-subscribers/:subscriberId/profile` | Questions + answers + metadata |
| `submit_subscriber_answers` | POST | `/api/newsletter-subscribers/:subscriberId/answers` | Idempotent |
| `get_subscriber_journal` | GET | `/api/newsletter-subscribers/:subscriberId/journal` | Issue history |
| `create_survey` | POST | `/api/surveys` | Body includes `datasphereUri` |
| `generate_survey_questions` | POST | `/api/surveys/:pageId/generate-questions` | AI writes questions |
| `add_survey_question` | POST | `/api/surveys/:pageId/questions` | |
| `update_survey_question` | PATCH | `/api/surveys/:pageId/questions/:questionId` | |
| `delete_survey_question` | DELETE | `/api/surveys/:pageId/questions/:questionId` | |
| `reorder_survey_questions` | POST | `/api/surveys/:pageId/questions/reorder` | |
| `list_survey_questions` | GET | `/api/surveys/:pageId/questions` | |
| `get_survey_responses` | GET | `/api/surveys/:pageId/responses` | |
| `get_survey_analytics` | GET | `/api/surveys/:pageId/analytics` | |
| `export_survey_responses` | GET | `/api/surveys/:pageId/export/:format` | csv or json |
| `link_survey_to_newsletter` | POST | `/api/newsletters/:newsletterId/generate-survey-codes` | Key wiring step |
| `suggest_survey_mappings` | POST | `/api/newsletters/:newsletterId/suggest-survey-mappings` | AI designs metadata fields |
| `create_survey_mapping` | POST | `/api/newsletters/:newsletterId/survey-mappings` | Apply one mapping |
| `list_survey_mappings` | GET | `/api/newsletters/:newsletterId/survey-mappings` | Verify wiring |

**Mount note:** `create_newsletter` / `update_newsletter` are at `/api/` (not `/api/v1/`). `list_newsletters` uses the datasphere URI; all other newsletter tools use the newsletter's DB ID.

---

## URL Reference

| URL | Purpose |
|---|---|
| `/newsletters/{slug}` | Public reader + subscribe page — share this everywhere |
| `/newsletters/{slug}/issues/{issueSlug}` | Individual public issue |
| `/newsletters/{slug}/thread` | Community discussion thread |
| `/newsletters/{slug}/issues/{issueSlug}/personalized` | Authenticated subscriber's personalized view |
| `/s/{uri}/{slug}?code={inviteCode}` | Subscriber's personalized survey URL (auto-included in every letter) |
| `/app/{uri}/newsletters/{id}/subscribers` | Admin subscriber management — bulk actions, CSV, survey status |
| `/app/{uri}/newsletters/{id}/issues/{issueId}/edit` | Issue editor |
| `/app/{uri}/surveys` | Survey list for a datasphere |
| `/survey/{uri}/{slug}` | Take a survey (public) |
| `/survey/{uri}/{slug}/live` | Live results view |

---

## Error Patterns

| Error | Cause | Fix |
|---|---|---|
| 400 on `create_newsletter` | Missing `name` or `datasphereId` | Both required |
| 400 on `draft_newsletter_issue` | `systemInstructions` is empty | Call `update_newsletter` to set it first |
| 403 on any newsletter write | Not ADMIN or OWNER of the datasphere | Newsletters require admin/owner role |
| 404 on subscriber tools | Wrong `subscriberId` or newsletter ID | Get IDs fresh from `list_newsletter_subscribers` |
| Preview returns generic letter | Personalization not wired | Check: `personalizationMode=PERSONALIZED`, survey linked, mappings exist, subscriber has answers |
| PENDING subscribers not receiving | Invited with `invite=true`, haven't confirmed | Resend invite or add them as ACTIVE directly |
| `private_thread_enabled` replies not routing | billing_mode mismatch or capacity exhausted | Check datasphere billing pool; switch to SUBSCRIBER mode if needed |
| CHECKBOX question only allows one select | `allowMultiple` is false | Re-create question with `allowMultiple: true` |

---

## Activity Digest (Separate System)

The **Activity Digest** is a per-user, platform-managed email — NOT a newsletter. It auto-scores activity from the user's dataspheres and sends a personalized summary.

| Feature | Newsletter | Activity Digest |
|---|---|---|
| Scope | Datasphere publication | Per-user, cross-datasphere |
| Content | Admin/AI-generated | Auto-scored from member activity |
| Schedule | Datasphere-controlled | User-controlled (daily/weekly/biweekly) |
| Recipients | DS subscribers | Individual member only |

Tools: `digest_preview`, `digest_history`, `digest_settings`.
API: `GET /api/users/me/activity-digest/preview?dataOnly=true`
