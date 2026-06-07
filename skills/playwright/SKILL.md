---
name: playwright
description: Run Playwright E2E tests. Use when user says "run tests", "run playwright", or "test this". Can run all tests or a specific file/pattern.
argument-hint: [optional test file or pattern]
disable-model-invocation: true
allowed-tools:
  - Bash(npx playwright test*)
  - Bash(npm run test:server*)
  - Bash(docker compose logs*)
---

Run Playwright E2E tests for dataspheres-ai.

## Server unit tests (fast — run first)
```bash
cd /Users/bunnarithbao/ship/dataspheres-ai && npm run test:server
```

## E2E tests

If $ARGUMENTS is provided, run only that file/pattern:
```bash
cd /Users/bunnarithbao/ship/dataspheres-ai && npx playwright test $ARGUMENTS --workers=2 --reporter=line
```

If no $ARGUMENTS, run the full suite:
```bash
cd /Users/bunnarithbao/ship/dataspheres-ai && npx playwright test --workers=2 --reporter=line
```

## Notes

- **Auth states**: Test users in `tests/e2e/auth-states/` — carlos=ADMIN, moderator=MOD, marcus/sofia/james=PARTICIPANT
- **Do NOT use `--workers=1` locally** — use `--workers=2` for speed
- **CI uses `--workers=1`** — only relevant in CI context

## Reporting

- List all failed tests with file paths
- For each failure: show the error message and which assertion failed
- If all pass: confirm count of passed tests
- If server tests fail: show the specific test name and error

## IMPORTANT

If any tests fail, do NOT mark the task as complete. Fix the failures or report them to the user before proceeding.
