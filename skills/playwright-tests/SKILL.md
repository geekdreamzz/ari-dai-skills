# playwright-tests — SDD Validation Test Runner

Playwright screenshot tests as first-class SDD validation artifacts. Every VA task that involves UI or API behavior MUST have a Playwright test that runs, captures screenshots, and posts evidence to the board via sdd-conductor.

---

## When to use this skill

Invoke automatically when:
- A VA task title contains "test", "validate", "verify", "screenshot", or "E2E"
- Any EX task has a `spec_type: user-journey` or `spec_type: acceptance-criteria`
- User asks to run or write Playwright tests

---

## Test file location

```
tests/e2e/specs/<initiative>/<task-id>.spec.ts
```

Example: `tests/e2e/specs/subscriber-journey/va-t1-001.spec.ts`

---

## Required test structure

Every SDD Playwright test MUST:

1. **Name tests after acceptance criteria** — one `test()` per criterion in the VA task
2. **Take a screenshot at the pass/fail moment** — `page.screenshot({ path: ... })`
3. **Post results to sdd-conductor** after all tests run

```typescript
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';

// Match test names to VA task acceptance criteria EXACTLY
test.describe('VA-T1-001 · Subscriber engagement model', () => {

  test('Metric >= 100 — all unit tests pass', async ({ page }) => {
    // ... test implementation
    await page.screenshot({ path: 'tests/e2e/screenshots/va-t1-001/criterion-1.png' });
    expect(result).toBeGreaterThanOrEqual(100);
  });

  test('No mocks or stubs in implementation', async () => {
    // Run mock gate
    execSync('node sdd-conductor.mjs gate no-mocks src/server/services/subscriber-engagement.service.ts');
  });

  test('API endpoint returns 200 for valid subscriber', async ({ request }) => {
    const res = await request.get('/api/v2/dataspheres/test/subscriber-context/test-subscriber');
    expect(res.status()).toBe(200);
    // Screenshot equivalent for API — log response body
  });

});

// After all tests — post results to board
test.afterAll(async () => {
  const passed = testResults.filter(r => r.status === 'passed').length;
  const failed = testResults.filter(r => r.status === 'failed').length;
  const total = testResults.length;
  const metric = Math.round(passed / total * 100);

  // Post progress to active task
  execSync(`node sdd-conductor.mjs progress "Playwright ${passed}/${total} passed (${metric}%)"`, { stdio: 'inherit' });

  // Trigger Ralph loop gate on VA task
  execSync(
    `node sdd-conductor.mjs validate ${process.env.VA_TASK_ID} --metric ${metric} --threshold 100 --iteration ${process.env.SDD_ITERATION || 1}`,
    { stdio: 'inherit' }
  );
});
```

---

## Running tests with sdd-conductor integration

```bash
# Set environment vars
export VA_TASK_ID=task_abc123
export SDD_ITERATION=1

# Run (progress-hook auto-posts results to board as tests run)
npx playwright test tests/e2e/specs/subscriber-journey/va-t1-001.spec.ts --workers=2

# If Ralph loop gate exits 1 (failed) → conductor created next iteration task
# Fix the issue, then re-run with:
export SDD_ITERATION=2
npx playwright test tests/e2e/specs/subscriber-journey/va-t1-001.spec.ts
```

---

## Screenshot upload

After a test run, upload screenshots to the task via the media upload endpoint:

```bash
# Upload all screenshots from a test run
for SHOT in tests/e2e/screenshots/**/*.png; do
  RESP=$(curl -s -X POST "$DATASPHERES_BASE_URL/api/media/upload" \
    -H "Authorization: Bearer $DATASPHERES_API_KEY" \
    -F "file=@$(realpath $SHOT)")
  URL=$(echo "$RESP" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
  echo "Uploaded: $URL"
done
```

Then include the URLs in the completion comment screenshots array:

```bash
curl -X POST "$DATASPHERES_BASE_URL/api/v2/dataspheres/<dsId>/tasks/<taskId>/comments" \
  -H "Authorization: Bearer $DATASPHERES_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"content\":\"[all-dai-sdd-system-message]\n\n**Test evidence:**\n- Playwright 3/3 passed\",\"screenshots\":[\"$URL1\",\"$URL2\"]}"
```

The `screenshots` array renders as a clickable thumbnail gallery in the activity feed widget on the dashboard.

---

## Checklist for a valid VA test

Before calling `sdd-conductor complete` on a VA task:

- [ ] One test per acceptance criterion in the VA task
- [ ] Every test takes a screenshot at the meaningful moment
- [ ] `sdd-conductor validate` was called after the test run (exit 0 = VA Done)
- [ ] Screenshots uploaded and referenced in completion comment
- [ ] Completion comment has one bullet per criterion with evidence

---

## Anti-patterns (gate failures)

| Anti-pattern | Why it fails |
|---|---|
| `test.skip()` on a failing criterion | Rubber-stamp — gate rejects |
| Hardcoded `expect(true).toBe(true)` | Mock — no real assertion |
| Screenshot taken before the interaction | Evidence is meaningless |
| `afterAll` that swallows sdd-conductor exit 1 | Silences Ralph loop |
| Tests that pass by timeout (never execute real code) | Structural mock |
