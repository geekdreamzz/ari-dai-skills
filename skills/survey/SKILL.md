---
name: survey
description: Create and manage surveys via API. Creates survey pages with questions, configures settings (live results, anonymous, etc.), and seeds to any datasphere locally or in prod. Always test locally first.
argument-hint: "create <ds-uri> | list <ds-uri> | delete <ds-uri> <slug>"
---

# Survey Skill

Create, manage, and deploy surveys programmatically. **Always test locally before prod.**

## API Access

- **Local dev**: Use Prisma directly (docker compose exec)
- **Prod**: Use REST API with API key from memory (`reference_prod_api_key.md`)
- **Auth**: `Authorization: Bearer {API_KEY}`

## Encoding Rules

- No em dashes, curly quotes, or special Unicode in API payloads
- Build JSON via Node.js temp files for curl on Windows
- Use plain hyphens and straight quotes only

## Creating a Survey

### Step 1: Create the survey page

Via v1 REST API (works with API keys):
```
POST /api/v1/dataspheres/{ds-uri}/pages
Body: {
  title, slug, content (HTML description),
  pageType: "SURVEY",
  status: "PUBLISHED",
  isPubliclyVisible: true,
  allowAnonymous: true/false,
  requireAuth: true/false,
  allowMultipleResponses: true/false,
  requireConsent: true/false,
  resultsAccessLevel: "ADMIN_ONLY" | "VOTERS_ONLY" | "PUBLIC",
  metaDescription: "..."
}
```

Via Prisma (local dev):
```typescript
prisma.page.create({ data: {
  title, slug, customUri: slug, content,
  pageType: 'SURVEY', status: 'PUBLISHED',
  isActive: true, isPubliclyVisible: true,
  datasphereId, authorId, minRole: 'PARTICIPANT',
  allowAnonymous: true, requireAuth: false,
  allowMultipleResponses: false, requireConsent: false,
  resultsAccessLevel: 'VOTERS_ONLY',
}})
```

### Step 2: Create questions

Via surveys API (works with API keys after unifiedAuth):
```
POST /api/surveys/{pageId}/questions
Body: {
  questionText: "...",
  description: "...",
  order: 0,
  answerFormats: ["CHECKBOX"],  // or MULTIPLE_CHOICE, LONG_TEXT, etc.
  isRequired: true,
  allowMultiple: true,  // IMPORTANT: true for CHECKBOX multi-select
  backgroundColor: "#002244",
  backgroundType: "COLOR",
  choices: { options: ["Choice 1", "Choice 2", ...] }  // for MC/CHECKBOX/DROPDOWN
}
```

Via Prisma (local dev):
```typescript
prisma.surveyQuestion.create({ data: {
  pageId, questionText, description, order,
  answerFormats: ['CHECKBOX'],
  isRequired: true, allowMultiple: true,
  backgroundColor: '#002244', backgroundType: 'COLOR',
  choices: { options: ['Choice 1', 'Choice 2'] },
}})
```

### Answer Format Reference

| Format | Use for | Needs choices? | allowMultiple? |
|--------|---------|---------------|----------------|
| CHECKBOX | Multi-select from options | Yes (`{ options: [...] }`) | **Must be true** |
| MULTIPLE_CHOICE | Single select from options | Yes | false |
| DROPDOWN | Single select dropdown | Yes | false |
| TEXT | Short text input | No | N/A |
| LONG_TEXT | Multi-line textarea | No | N/A |
| AUDIO_LIVE | Record audio in browser | No | N/A |
| AUDIO_UPLOAD | Upload audio file | No | N/A |
| VIDEO_LIVE | Record video in browser | No | N/A |
| VIDEO_UPLOAD | Upload video file | No | N/A |
| IMAGE_UPLOAD | Upload image | No | N/A |

**CRITICAL**: For CHECKBOX questions, `allowMultiple` MUST be `true` or users can only select one option.

### Choices Format

Choices MUST be stored as `{ options: ["string1", "string2", ...] }` — NOT as objects with id/text. The frontend expects plain string arrays inside an `options` key.

### Step 3: Configure settings

Settings are on the Page model, set during create or via PUT update:

| Setting | Values | Default | Purpose |
|---------|--------|---------|---------|
| resultsAccessLevel | ADMIN_ONLY, VOTERS_ONLY, PUBLIC | ADMIN_ONLY | Who sees live results |
| allowAnonymous | true/false | false | Allow non-logged-in responses |
| requireAuth | true/false | false | Force login before survey |
| allowMultipleResponses | true/false | true | Can user submit multiple times |
| requireConsent | true/false | true | Show consent form before questions |
| collectRespondentEmail | true/false | false | Ask for email before questions |

### Survey URLs

- Take survey: `/survey/{ds-uri}/{slug}` or `/s/{ds-uri}/{slug}`
- Live results: `/survey/{ds-uri}/{slug}/live` or `/s/{ds-uri}/{slug}/live`
- Edit: `/app/{ds-uri}/surveys/{pageId}/edit`
- List: `/app/{ds-uri}/surveys`

## Workflows

### `/survey create <ds-uri>`

1. Ask what the survey is about
2. Generate questions
3. Create page + questions locally via Prisma
4. Show the local URL for testing
5. Once confirmed, replicate to prod via REST API

### `/survey list <ds-uri>`

List surveys in a datasphere:
```
GET /api/v1/dataspheres/{ds-uri}/pages?pageType=SURVEY
```

### `/survey delete <ds-uri> <slug>`

Archive (soft delete) a survey:
```
PUT /api/v1/dataspheres/{ds-uri}/pages/{slug}
Body: { status: "ARCHIVED", isActive: false }
```

For hard delete (local dev only):
```typescript
// Delete questions first, then page
await prisma.surveyQuestion.deleteMany({ where: { pageId } });
await prisma.page.delete({ where: { id: pageId } });
```

## Rules

- **ALWAYS create and test locally first** — never go straight to prod
- **ALWAYS set allowMultiple: true** for CHECKBOX questions
- **ALWAYS use choices format** `{ options: ["str1", "str2"] }` — not objects
- **ALWAYS verify** the survey shows up in the surveys list AND renders correctly before moving to prod
- **Prod deploys**: Use the v1 REST API with the prod API key from memory
