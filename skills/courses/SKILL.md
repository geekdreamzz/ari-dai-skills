---
name: courses
description: Full LMS course + quiz REST API for Dataspheres AI. Build a course (modules → lessons → graded quizzes), author quiz questions with correct answers + points, manage enrollment, track per-quiz results and the course gradebook, and issue verifiable certificates. Courses are pages-native — the student view is the course's overview page under /pages/:uri/:slug.
argument-hint: "[create course | add module/lesson | author quiz | results | enroll | gradebook | certificate]"
---

# Courses (LMS) — Complete REST Reference

A course is **pages-native**: it is a `COURSE` Page (the syllabus/overview) anchored to a root DocFolder. **Modules are child folders**, **lessons are `TUTORIAL` pages**, and a **quiz is a lesson** marked `isGradedQuiz` whose graded questions are `SurveyQuestion` rows carrying a `correctAnswer` + `points`. There is **no separate `/courses` student namespace** — learners read the course at `/pages/:uri/:courseSlug` (the folder index = overview, each lesson = a page in the pages TOC).

```
COURSE page (overview/syllabus)   →  /pages/:uri/:courseSlug
  └── Module (folder)
        └── Lesson (TUTORIAL page) →  /pages/:uri/:lessonSlug
        └── Quiz  (lesson, isGradedQuiz=true)
              └── Questions (correctAnswer + points)
```

All endpoints below are under `/api/v1/dataspheres/:uri/courses`. Identify items by id:
- `coursePageId` — the COURSE page id (from `list courses` / create).
- `moduleId` — a module folder id (from the course TOC).
- `lessonPageId` — a lesson page id; a quiz is just a lesson.
- `questionId` — a quiz question id (from **list quiz questions**).

---

## Configuration

Load from `~/.dataspheres.env` (see the `dataspheres-api` skill for the full setup):

```bash
export $(grep -v '^#' ~/.dataspheres.env | xargs)
# DATASPHERES_BASE_URL  e.g. http://localhost:5173 (dev) or https://dataspheres.ai (prod)
# DATASPHERES_API_KEY   dsk_... key (MODERATOR+ on the datasphere to author)
# DATASPHERES_DEFAULT_URI  the datasphere uri, e.g. dataspheres-ai
```

Authoring endpoints require **MODERATOR+**; learner endpoints require **PARTICIPANT**. Mutating tools carry `requiredScope: ingest:pages`.

```bash
B="$DATASPHERES_BASE_URL/api/v1/dataspheres/$DATASPHERES_DEFAULT_URI/courses"
AUTH="Authorization: Bearer $DATASPHERES_API_KEY"
JSON="Content-Type: application/json"
```

---

## 1. Build the curriculum

```bash
# Create a course (COURSE page + root folder). Defaults: status DRAFT, private.
# Visibility cascades to lessons when you later publish (see Update course).
CID=$(curl -s -X POST "$B" -H "$AUTH" -H "$JSON" -d '{
  "title": "Prompt Engineering Essentials",
  "syllabus": "<h2>Prompt Engineering Essentials</h2><p>Treat prompts as specifications.</p>",
  "status": "DRAFT", "isPubliclyVisible": false
}' | jq -r '.coursePageId')

# Add a module (section). Returns moduleId + refreshed TOC.
MID=$(curl -s -X POST "$B/$CID/modules" -H "$AUTH" -H "$JSON" \
  -d '{"title":"Foundations"}' | jq -r '.moduleId')

# Add a content lesson (TUTORIAL page). Body is TipTap HTML (embeds media/datasets/diagrams).
LID=$(curl -s -X POST "$B/$CID/modules/$MID/lessons" -H "$AUTH" -H "$JSON" \
  -d '{"title":"A prompt is a specification","content":"<h3>What you’ll learn</h3><p>…</p>"}' \
  | jq -r '.lessonPageId')

# Read the whole course TOC (syllabus + ordered modules + lessons).
curl -s "$B/$CID" -H "$AUTH" | jq '{title, status, modules: [.modules[] | {title, lessons: [.lessons[].title]}]}'

# Reorder (optional): orderedIds must be a permutation of all ids.
curl -s -X PUT "$B/$CID/modules/reorder" -H "$AUTH" -H "$JSON" -d '{"orderedIds":["mod1","mod2"]}'
curl -s -X PUT "$B/$CID/modules/$MID/lessons/reorder" -H "$AUTH" -H "$JSON" -d '{"orderedIds":["les1","les2"]}'
```

### Publish (and go public)

```bash
# Update title/syllabus/status/visibility. isPubliclyVisible CASCADES to every
# lesson — publishing a private course flips its lessons public too, so the
# pages-native student view renders end-to-end.
curl -s -X PUT "$B/$CID" -H "$AUTH" -H "$JSON" \
  -d '{"status":"PUBLISHED","isPubliclyVisible":true}'
```

---

## 2. Author a graded quiz

A quiz is a lesson with `isGradedQuiz=true`. Create the lesson, mark it a quiz with a pass mark, then add questions.

```bash
# Create the quiz lesson.
QID_LESSON=$(curl -s -X POST "$B/$CID/modules/$MID/lessons" -H "$AUTH" -H "$JSON" \
  -d '{"title":"Check your understanding","isGradedQuiz":true}' | jq -r '.lessonPageId')

# Set it as a graded quiz + pass mark (percent 0–100).
curl -s -X PUT "$B/$CID/lessons/$QID_LESSON/quiz-config" -H "$AUTH" -H "$JSON" \
  -d '{"isGradedQuiz":true,"passScore":60}'

# Add a question. correctAnswer = array of choice ids (selection) or {text}/{number} (typed).
# answerFormat: MULTIPLE_CHOICE (one), CHECKBOX (many), DROPDOWN, TEXT, NUMBER.
QUESTION_ID=$(curl -s -X POST "$B/$CID/lessons/$QID_LESSON/questions" -H "$AUTH" -H "$JSON" -d '{
  "questionText": "A prompt is best understood as a…",
  "answerFormat": "MULTIPLE_CHOICE",
  "choices": [{"id":"a","text":"specification of an acceptable answer"},
              {"id":"b","text":"casual question"}],
  "correctAnswer": ["a"],
  "points": 1
}' | jq -r '.questionId')
```

### Read / edit / delete questions (authoring view)

These three keep an authoring tool in sync with what already exists — **list returns the correct answers** (the learner-facing quiz endpoint strips them).

```bash
# List a quiz's questions WITH correct answers + points (instructor view).
curl -s "$B/$CID/lessons/$QID_LESSON/questions" -H "$AUTH" \
  | jq '{title, passScore, questions: [.questions[] | {id, questionText, answerFormats, correctAnswer, points}]}'

# Full edit of a question — text, format, choices, correct answer, points (any subset).
curl -s -X PUT "$B/$CID/questions/$QUESTION_ID" -H "$AUTH" -H "$JSON" -d '{
  "questionText": "A prompt is best understood as…",
  "answerFormat": "MULTIPLE_CHOICE",
  "choices": [{"id":"a","text":"a specification"},{"id":"b","text":"a guess"}],
  "correctAnswer": ["a"], "points": 2
}'

# Grading-only update (correct answer + points, leave text/choices alone).
curl -s -X PUT "$B/$CID/questions/$QUESTION_ID/grading" -H "$AUTH" -H "$JSON" \
  -d '{"correctAnswer":["a"],"points":2}'

# Delete a question (its learner responses cascade away).
curl -s -X DELETE "$B/$CID/questions/$QUESTION_ID" -H "$AUTH"
```

In the web UI this is the **Quiz Editor** at `/app/:uri/courses/:coursePageId/quiz/:lessonPageId` (Questions tab + Results tab).

---

## 3. Track learners

```bash
# Per-quiz results: every learner who took THIS quiz, their score + pass/fail + date,
# plus attempt count / average score / pass rate.
curl -s "$B/$CID/lessons/$QID_LESSON/results" -H "$AUTH" \
  | jq '{attempts, avgScore, passRate, passScore, results: [.results[] | {name, scorePct, passed}]}'

# Whole-course gradebook: one row per learner per quiz attempt.
curl -s "$B/$CID/gradebook" -H "$AUTH" | jq '.rows[:5]'

# Roster: every enrollment with learner, status, and progress percent.
curl -s "$B/$CID/roster" -H "$AUTH" | jq '.[] | {name, status, progressPercent}'
```

A learner submits an attempt (autograded → scored → recorded in progress + gradebook; passing the course issues a certificate):

```bash
curl -s -X POST "$B/$CID/lessons/$QID_LESSON/submit" -H "$AUTH" -H "$JSON" -d '{
  "answers": [{"questionId":"'"$QUESTION_ID"'","selectedChoices":["a"]}]
}' | jq '{scorePct, passed, courseProgress: .courseProgress.progressPercent, certificate: .certificate.serial}'
```

---

## 4. Enrollment

```bash
curl -s -X POST "$B/$CID/enroll" -H "$AUTH" -H "$JSON" -d '{}'                 # self-enroll (learner)
curl -s -X POST "$B/$CID/enrollments" -H "$AUTH" -H "$JSON" \
  -d '{"email":"learner@example.com"}'                                         # admin enroll by email/userId
curl -s -X DELETE "$B/$CID/enrollments/$USER_ID" -H "$AUTH"                    # soft-drop (keeps grades)
curl -s "$B/$CID/my-enrollment" -H "$AUTH" | jq '.enrollment'                  # caller's enrollment
```

### Progress + prerequisites

```bash
curl -s "$B/$CID/progress" -H "$AUTH" | jq '{progressPercent, status}'          # caller's full progress
curl -s -X POST "$B/$CID/lessons/$LID/complete" -H "$AUTH"                       # mark a lesson complete
# Gate a lesson behind another (locked until completed, or passed when requiresPass):
curl -s -X PUT "$B/$CID/lessons/$LID/prerequisite" -H "$AUTH" -H "$JSON" \
  -d '{"requiresLessonPageId":"'"$QID_LESSON"'","requiresPass":true}'
```

---

## 5. Certificates

```bash
curl -s "$B/$CID/my-certificate" -H "$AUTH" | jq '.certificate'                  # caller's certificate (if earned)
# Public verification (no auth) — recomputes the HMAC over the cert payload:
curl -s "$DATASPHERES_BASE_URL/api/public/courses/certificates/$VERIFY_HASH" | jq '{valid, courseTitle, learner}'
```

---

## 6. Pages-native student view (public reads)

Learners don't use a `/courses/*` route — they read the course as **pages**:

```bash
# Course overview (the COURSE page) + published TOC (modules/lessons), public:
curl -s "$DATASPHERES_BASE_URL/api/public/courses/$DATASPHERES_DEFAULT_URI/<courseSlug>" | jq '{title, modules}'
# Course-context probe used by the pages viewer: is this page a course overview/lesson?
curl -s "$DATASPHERES_BASE_URL/api/public/courses/context/$DATASPHERES_DEFAULT_URI/<anySlug>" | jq '{isCourse, context}'
# Quiz questions for a learner (correct answers stripped):
curl -s "$DATASPHERES_BASE_URL/api/public/courses/$DATASPHERES_DEFAULT_URI/quizzes/<quizLessonId>" | jq
```

Student URL: `${DATASPHERES_BASE_URL}/pages/<uri>/<courseSlug>` (overview, with enroll/progress/certificate chrome and the course TOC sidebar). Instructor: course editor `/app/<uri>/courses/<coursePageId>`, analytics `/courses/<uri>/<courseSlug>/analytics`.

---

## Endpoint quick map

| Action | Method + path (under `/api/v1/dataspheres/:uri/courses`) | Role |
|---|---|---|
| List courses | `GET /` | MODERATOR |
| Create course | `POST /` | MODERATOR |
| Get TOC | `GET /:cid` | MODERATOR |
| Update course (cascades visibility) | `PUT /:cid` | MODERATOR |
| Add module | `POST /:cid/modules` | MODERATOR |
| Add lesson | `POST /:cid/modules/:mid/lessons` | MODERATOR |
| Set quiz config | `PUT /:cid/lessons/:lid/quiz-config` | MODERATOR |
| Add question | `POST /:cid/lessons/:lid/questions` | MODERATOR |
| **List questions (with answers)** | `GET /:cid/lessons/:lid/questions` | MODERATOR |
| **Update question** | `PUT /:cid/questions/:qid` | MODERATOR |
| Set question grading | `PUT /:cid/questions/:qid/grading` | MODERATOR |
| **Delete question** | `DELETE /:cid/questions/:qid` | MODERATOR |
| Submit attempt | `POST /:cid/lessons/:lid/submit` | PARTICIPANT |
| **Per-quiz results** | `GET /:cid/lessons/:lid/results` | MODERATOR |
| Gradebook | `GET /:cid/gradebook` | MODERATOR |
| Roster | `GET /:cid/roster` | MODERATOR |
| Enroll (self / admin / drop) | `POST /:cid/enroll` · `POST /:cid/enrollments` · `DELETE /:cid/enrollments/:userId` | PARTICIPANT / MODERATOR |
| Progress · complete lesson | `GET /:cid/progress` · `POST /:cid/lessons/:lid/complete` | PARTICIPANT |
| Prerequisite | `PUT /:cid/lessons/:lid/prerequisite` | MODERATOR |
| My / public certificate | `GET /:cid/my-certificate` · `GET /api/public/courses/certificates/:hash` | PARTICIPANT / public |

> Every one of these is also an ARI tool (same id, e.g. `create_course`, `add_quiz_question`, `list_quiz_questions`, `update_quiz_question`, `delete_quiz_question`, `get_quiz_results`) — ARI invokes them directly from chat. The source of truth is `toolMeta` in `src/server/v1/routes/courses.routes.ts`.
