<!-- dai-sync: skip -->
---
name: surveys
description: Design, run, and analyze surveys in Dataspheres AI — create, add/edit/delete/reorder questions, collect responses, view analytics, export data.
argument-hint: "[action] [options]"
---

# surveys — Survey Design & Response Collection

Surveys in Dataspheres AI are **page-based** — each survey is a page with a `pageId`. There is no datasphere-scoped list endpoint; surveys are accessed directly by their page ID (returned from `create_survey`).

## Core Workflows

### Create a survey

```python
create_survey(
    datasphereUri="my-datasphere",
    title="Developer Experience Survey",
    description="Help us understand how you use our tools",
    surveyMode="QUESTIONNAIRE",           # QUESTIONNAIRE | POLL
    surveyAccessLevel="PUBLIC",           # PUBLIC | MEMBERS_ONLY | PRIVATE
    allowMultipleResponses=False,
    collectRespondentEmail=False,
    resultsAccessLevel="ADMIN_ONLY",      # ADMIN_ONLY | PUBLIC
)
# → {"id": "page_abc123", "title": "...", "slug": "developer-experience-survey"}
# The "id" here is the pageId — save it for all subsequent calls.
```

### Generate questions with AI

```python
generate_survey_questions(
    pageId="page_abc123",
    prompt="This is a self-love newsletter. Generate 5 questions to personalize letters with the subscriber's name, current struggle, and a self-care practice."
)
# → creates questions automatically on the survey
```

### Add a question

```python
add_survey_question(
    pageId="page_abc123",
    questionText="What's your first name?",
    answerFormat="TEXT",
    required=True,
)
```

**Answer formats:**

| Format | Description | Needs `choices`? |
|---|---|---|
| `TEXT` | Short text | No |
| `LONG_TEXT` | Multi-line textarea | No |
| `MULTIPLE_CHOICE` | Single select | Yes |
| `CHECKBOX` | Multi-select | Yes — `allowMultiple: true` REQUIRED |
| `DROPDOWN` | Single select dropdown | Yes |
| `AUDIO_LIVE` | Record audio in browser | No |
| `AUDIO_UPLOAD` | Upload audio file | No |
| `VIDEO_UPLOAD` | Upload video file | No |
| `IMAGE_UPLOAD` | Upload image | No |

**CRITICAL for CHECKBOX:** `allowMultiple` MUST be `true`.
**Choices format:** `{ options: ["string1", "string2"] }` — NOT objects.

```python
add_survey_question(
    pageId="page_abc123",
    questionText="Which themes resonate most with you?",
    answerFormat="CHECKBOX",
    required=True,
    choices={"options": ["Gratitude", "Self-care", "Growth", "Rest"]},
    allowMultiple=True,
)
```

### Edit a question

```python
update_survey_question(
    pageId="page_abc123",
    questionId="q_...",
    questionText="Updated question text",
    required=False,
)
```

### Delete a question

```python
delete_survey_question(pageId="page_abc123", questionId="q_...")
```

### Reorder questions

```python
reorder_survey_questions(
    pageId="page_abc123",
    orderedIds=["q_001", "q_003", "q_002"]  # new order
)
```

### List questions

```python
list_survey_questions(pageId="page_abc123")
# → [{"id": "q_...", "questionText": "...", "answerFormat": "TEXT", "sortOrder": 1}, ...]
```

### Get a survey

```python
get_survey(pageId="page_abc123")
# → {"id": "...", "title": "...", "questions": [...], "responseCount": 47}
```

### View responses

```python
get_survey_responses(pageId="page_abc123")
# → [{"id": "resp_...", "answers": [{"questionId": "q_...", "value": "4"}], "submittedAt": "..."}]
```

### Analytics

```python
get_survey_analytics(pageId="page_abc123")
# → {"totalResponses": 47, "completionRate": 0.89, "questions": [{"id": "q_...", "distribution": {...}}]}
```

### Export responses

```python
export_survey_responses(pageId="page_abc123", format="csv")  # csv | json
```

## API Reference

| Tool | Method | Endpoint | Notes |
|---|---|---|---|
| `create_survey` | POST | `/api/surveys` | Body includes `datasphereUri` |
| `generate_survey_questions` | POST | `/api/surveys/:pageId/generate-questions` | AI writes questions |
| `add_survey_question` | POST | `/api/surveys/:pageId/questions` | |
| `update_survey_question` | PATCH | `/api/surveys/:pageId/questions/:questionId` | |
| `delete_survey_question` | DELETE | `/api/surveys/:pageId/questions/:questionId` | |
| `reorder_survey_questions` | POST | `/api/surveys/:pageId/questions/reorder` | |
| `list_survey_questions` | GET | `/api/surveys/:pageId/questions` | |
| `get_survey` | GET | `/api/surveys/:pageId` | |
| `get_survey_responses` | GET | `/api/surveys/:pageId/responses` | Auth required |
| `get_survey_analytics` | GET | `/api/surveys/:pageId/analytics` | Auth required |
| `export_survey_responses` | GET | `/api/surveys/:pageId/export/:format` | csv or json |

**Important:** Surveys are mounted at `/api/surveys` — not `/api/v1/dataspheres/:uri/surveys`. Save the `pageId` from `create_survey` for all subsequent calls.

## Error Patterns

| Error | Cause | Fix |
|---|---|---|
| "No active datasphere" | No datasphere set | Call `get_context()` first |
| 401 | Invalid key | Check DATASPHERES_API_KEY |
| 403 on responses | Not the survey owner | Responses require ownership |
| 404 | Survey page ID not found | Verify the `pageId` from `create_survey` |
| CHECKBOX shows only one select | `allowMultiple` not set | Re-create with `allowMultiple: true` |
