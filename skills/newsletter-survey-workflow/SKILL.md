---
name: newsletter-survey-workflow
description: Scaffold a personalized AI newsletter end-to-end — any theme, any voice. Use when the user describes a newsletter idea where each subscriber should receive unique AI-generated content based on their profile.
argument-hint: "[datasphere-uri] [brief description of the newsletter concept]"
disable-model-invocation: true
allowed-tools:
  - Bash(curl *)
  - Read
  - Glob
---

# Personalized AI Newsletter — End-to-End Scaffold

Scaffold the workflow for: $ARGUMENTS

---

## THE PATTERN (understand this before anything else)

Every personalized newsletter on this platform works the same way, regardless of theme:

```
Subscriber fills out a survey
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

**What changes between use cases is only:**
- The survey questions (what the AI needs to know)
- The voice and structure in systemInstructions
- The web search focus in webSearchInstructions
- The theme of the datasphere

---

## FIVE DIMENSIONS TO GATHER BEFORE STARTING

Ask the user. Most can be answered in one conversation turn.

### 1. VOICE — Whose voice is the letter written in?

| Voice | When to use | Example |
|-------|-------------|---------|
| First-person FROM subscriber | They write to themselves | Self-love letters, journaling prompts, affirmations, birth chart as "I am a Scorpio..." |
| Second-person TO subscriber | Coach/guide speaks to them | Wellness coaching, accountability check-ins, mentorship |
| Third-person narrator | External perspective | Personalized bedtime stories, horoscope readings, "Your week ahead..." |

### 2. PERSONALIZATION INPUTS — What does the AI need to know per subscriber?

These become the survey questions. Rule: only ask what the AI actually uses when writing. Don't over-survey.

| Theme | Key inputs to capture |
|-------|----------------------|
| Self-love | What they're proud of, current struggle, love language, affirmation they want to hear, self-care they want more of |
| Astrology | Birth date, birth time, birth city, sun/moon/rising (if known), weekly intention or question |
| Fitness | Current goal, any injuries/limitations, preferred movement style, energy level this week |
| Grief / loss | Relationship to the loss, where they are in the journey, what kind of support they need today |
| Parenting | Child's name/age, current challenge, parenting value they're focusing on |
| Career / purpose | Current role, what lights them up, what they're moving away from, one thing they want permission to do |
| Astrology + tarot | All birth data above + one card they drew or one question for the week |

### 3. TIMELY CONTEXT — What should the AI search for at send time?

This is `webSearchInstructions`. Empty = purely personal content. Filled = blends subscriber profile with current events/research.

| Theme | webSearchInstructions |
|-------|----------------------|
| Astrology | "find this week's astrological transits, current moon phase and meaning, and any major planetary events — apply specifically to {sun_sign} sun and {rising_sign} rising" |
| Self-love | "find 2-3 current self-care or self-compassion practices relevant to someone working through {current_struggle}" |
| Fitness | "find recent evidence-based tips for achieving {fitness_goal} that work within {limitations}" |
| Tarot | "find the traditional meaning of the {tarot_card} card and its interpretation for {sun_sign} this week" |
| Grief | "find a gentle, research-backed grief support practice appropriate for someone at {grief_stage}" |
| Seasonal / general | "find what is timely, in season, and culturally relevant this week that connects to {theme}" |

### 4. STRUCTURE — What does each letter look like?

Captured in `systemInstructions`. Define:
- Opening (acknowledgment, hook, or greeting)
- Body sections (2-3 max for a letter format)
- Recurring element (affirmation, ritual suggestion, question to sit with)
- Closing (warm sign-off, CTA to update profile, what to look forward to next time)
- Length (short = 200-400 words, medium = 400-700, long = 700+)

### 5. SUBSCRIBER JOURNEY — How do people join?

- Public sign-up page at `/app/{uri}/newsletters` → they subscribe → get a personalized survey link in their first letter
- Invite-only: add subscribers manually or import from a dataset
- The survey update link is included automatically in every letter — subscribers can update their profile anytime

---

## STEP-BY-STEP SCAFFOLD

All steps use ARI tools (listed below). Run them conversationally.

### Step 1 — Prerequisites
- Datasphere must exist and be PUBLIC
- Get the `datasphereId` from `GET /api/dataspheres/uri/{uri}`

### Step 2 — Create Newsletter (`create_newsletter`)
Set from the 5 dimensions:
```json
{
  "datasphereId": "...",
  "name": "...",
  "personalizationMode": "PERSONALIZED",
  "enableWebSearch": true,
  "webSearchInstructions": "...",
  "systemInstructions": "...",
  "aiModel": "claude-sonnet-4-6",
  "scheduleType": "MANUAL"
}
```

### Step 3 — Create Survey (`create_survey`)
```json
{
  "datasphereId": "...",
  "title": "...",
  "surveyMode": "QUESTIONNAIRE",
  "surveyAccessLevel": "PUBLIC",
  "allowMultipleResponses": true,
  "collectRespondentEmail": false,
  "resultsAccessLevel": "ADMIN_ONLY"
}
```

### Step 4 — Generate Questions (`generate_survey_questions`)
Write a prompt describing the newsletter and what the AI needs to know per subscriber. The server AI writes the questions. Review and adjust.

### Step 5 — Link Survey to Newsletter (`link_survey_to_newsletter`)
**This is the key wiring step.**
```json
{
  "newsletterId": "...",
  "surveyPageId": "...",
  "codePrefix": "INV"
}
```
After this: survey appears in the newsletter's AI knowledge bank. Every subscriber gets a personalized survey URL. The generation service automatically appends a QR code + "update your profile" section to every letter.

### Step 6 — Wire Metadata (`suggest_survey_mappings` → `create_survey_mapping`)
Ask the AI to suggest which question → which metadata field. Review suggestions. Apply each one. These metadata fields are what the letter AI references by name when personalizing.

### Step 7 — Add Subscribers (`add_newsletter_subscriber`)
Or direct them to the public subscribe page.

### Step 8 — Preview (`preview_personalized_newsletter`)
Call with a specific `subscriberId` who has completed the survey. Read the returned `contentHtml` — this is their actual letter. Check the `debug.metadataKeys` to confirm personalization is wired.

### Step 9 — Send (`send_newsletter_issue`)
Hard HIL gate — ARI requires explicit confirmation before sending real emails.

---

## ARI TOOLS REFERENCE

| Tool | Step | What it does |
|------|------|-------------|
| `create_newsletter` | 2 | Create with personalizationMode, systemInstructions, webSearch |
| `update_newsletter` | anytime | Change voice, structure, search focus, schedule |
| `create_survey` | 3 | Create the subscriber profile questionnaire |
| `generate_survey_questions` | 4 | AI writes questions from a description |
| `add_survey_question` | 4 | Add a single question manually |
| `list_survey_questions` | 4 | Review existing questions |
| `link_survey_to_newsletter` | 5 | **Key step** — wires survey into AI context + invite codes |
| `suggest_survey_mappings` | 6 | AI designs the metadata field mapping |
| `create_survey_mapping` | 6 | Apply one mapping |
| `list_survey_mappings` | 6 | Verify mappings |
| `add_newsletter_subscriber` | 7 | Add a subscriber |
| `list_newsletter_subscribers` | 7/9 | Check subscribers + survey completion |
| `get_survey_responses` | anytime | Analyze what subscribers have shared |
| `preview_personalized_newsletter` | 8 | Generate a sample letter for a specific subscriber |
| `list_newsletter_issues` | 9 | Check draft/sent issues |
| `draft_newsletter_issue` | 9 | Create a draft issue |
| `generate_newsletter_issue` | 9 | Sync AI generation |
| `send_newsletter_issue` | 9 | Send (requires HIL confirmation) |

---

## EXAMPLE CONFIGS

### "Love You From You" — Self-Love Letters

**Voice:** First-person FROM subscriber  
**systemInstructions excerpt:**
> Write in first person using only "I", "me", "my". Never "you" or "your". Every sentence should feel like it could only have been written for this exact person. Draw entirely from their survey answers. Weave web-searched self-care tips in as things "I am choosing for myself this week." End with one bold affirmation.

**webSearchInstructions:** `"find 2-3 current self-care practices relevant to someone working through {current_struggle}"`

**Survey questions:** first name, what they're proud of, current struggle, love language, affirmation they want to hear from themselves, self-care they want more of (MULTIPLE_CHOICE), current energy (SINGLE_CHOICE)

---

### Astrology Letters — Birth Chart + Weekly Transits

**Voice:** Third-person narrator ("Your Scorpio sun is asking you to...")  
**systemInstructions excerpt:**
> You are writing a personalized weekly astrology reading. Reference the subscriber's specific birth chart placements (sun, moon, rising) throughout — never default to generic sun-sign content. Blend their birth chart with the current week's planetary transits from web search. Structure: (1) current sky and how it touches their chart, (2) what this week is asking of them specifically, (3) one ritual or practice aligned to the energy. Close with their personalized mantra for the week.

**webSearchInstructions:** `"find this week's major astrological transits, current moon phase and sign, and any notable planetary events — describe how they interact with {sun_sign} sun, {moon_sign} moon, and {rising_sign} rising"`

**Survey questions:** birth date, birth time, birth city, sun sign (if known), moon sign (if known), rising sign (if known), one question or intention for the week (LONG_TEXT)

---

## KEY URLs

| URL | Purpose |
|-----|---------|
| `/newsletters/{slug}` | **Public reader + subscribe page** — share this to grow your list |
| `/newsletters/{slug}/issues/{issueSlug}` | Individual public issue |
| `/newsletters/{slug}/thread` | Community discussion for the newsletter |
| `/newsletters/{slug}/issues/{issueSlug}/personalized` | Authenticated subscriber's personalized view |
| `/app/{uri}/newsletters/{id}/subscribers` | Admin subscriber management (bulk actions, CSV, survey status) |
| `/app/{uri}/newsletters/{id}/issues/{issueId}/edit` | Issue editor |
| `/s/{uri}/{surveySlug}?code={inviteCode}` | Subscriber's personalized survey URL (auto-included in every letter) |

The public reader URL `/newsletters/{slug}` is the one to put everywhere — bio links, the datasphere homepage, social posts, the newsletter itself.

---

## VERIFICATION

After full setup, check:
- [ ] `personalizationMode` is `PERSONALIZED` on the newsletter
- [ ] Survey shows "In AI context" green badge in the survey editor
- [ ] `list_survey_mappings` shows all questions mapped to metadata fields
- [ ] `preview_personalized_newsletter` returns a letter with `debug.metadataKeys` populated
- [ ] The letter reads as specific to that person, not generic

Run E2E test:
```
npx playwright test tests/e2e/specs/newsletter-survey-personalized-draft-flow.spec.ts --workers=1
```
