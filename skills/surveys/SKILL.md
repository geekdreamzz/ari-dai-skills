---
name: surveys
description: Design, run, and analyze surveys in Dataspheres AI
argument-hint: "[action] [options]"
---

# surveys — Survey Design & Response Collection

Surveys in Dataspheres AI are **page-based** — each survey is a page with a `pageId`. There is no datasphere-scoped list endpoint; surveys are accessed directly by their page ID (returned from `create_survey`).

## Core Workflows

### Create a survey

```python
survey = create_survey(
    title="Developer Experience Survey",
    description="Help us understand how you use our tools",
)
# → {"id": "page_abc123", "title": "Developer Experience Survey", "slug": "developer-experience-survey"}
# The "id" here is the pageId — save it for all subsequent calls.
```

The active datasphere URI is automatically attached to scope the survey.

### Add questions

```python
create_question(
    survey_id="page_abc123",
    text="How would you rate the onboarding experience?",
    question_type="rating",
    required=True,
)

create_question(
    survey_id="page_abc123",
    text="Which features do you use most?",
    question_type="multiple_choice",
    options=["Pages", "Planner", "Sequences", "Newsletters"],
)
```

Question types: `text` | `rating` | `multiple_choice` | `yes_no` | `scale`

### List questions

```python
get_questions(survey_id="page_abc123")
# → [{"id": "q_...", "text": "...", "type": "rating", "sortOrder": 1}, ...]
```

### Get a survey

```python
get_survey(survey_id="page_abc123")
# → {"id": "...", "title": "...", "questions": [...], "responseCount": 47}
```

### View responses

```python
get_responses(survey_id="page_abc123")
# → [{"id": "resp_...", "answers": [{"questionId": "q_...", "value": "4"}], "submittedAt": "..."}]
```

Requires datasphere ownership or admin access.

### Analytics

```python
get_analytics(survey_id="page_abc123")
# → {"totalResponses": 47, "completionRate": 0.89, "questions": [{"id": "q_...", "distribution": {...}}]}
```

## API Reference

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| `create_survey` | POST | `/api/surveys` | Body includes `datasphereUri` |
| `get_survey` | GET | `/api/surveys/:pageId` | |
| `create_question` | POST | `/api/surveys/:pageId/questions` | |
| `get_questions` | GET | `/api/surveys/:pageId/questions` | |
| `get_responses` | GET | `/api/surveys/:pageId/responses` | Auth required |
| `get_analytics` | GET | `/api/surveys/:pageId/analytics` | Auth required |

**Important:** Surveys are mounted at `/api/surveys` — not `/api/v1/dataspheres/:uri/surveys`. There is no datasphere-scoped list endpoint. Save the `pageId` from `create_survey` to reference the survey later.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| "No active datasphere" | No datasphere set | Run `dai use <uri>` |
| 401 | Invalid key | Re-run `dai login` |
| 403 on responses | Not the survey owner | Responses require ownership |
| 404 | Survey page ID not found | Verify the `pageId` from `create_survey` |
