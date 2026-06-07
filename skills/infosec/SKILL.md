---
name: infosec
description: Security audit skill for Dataspheres AI. Runs authentication, authorization, injection, and privacy tests against local or production endpoints. Use when the user asks to verify platform security, test API key auth, check for data leakage, or after any Cloudflare/auth changes.
argument-hint: "local|prod|both"
---

Run a full infosec audit against the Dataspheres AI platform ($ARGUMENTS). Cover all sections below.

---

## Target Endpoints

- **Local**: `http://localhost:3000`
- **Prod**: `https://dataspheres.ai`
- **Prod API key**: stored in `.env` as `DATASPHERES_API_KEY` (prefix `dsk_`)
- **Local test token**: extract from `tests/e2e/auth-states/carlos.json` → `origins[0].localStorage[name=token].value`

---

## 1. Authentication Tests

```bash
BASE=<target>
KEY=<dsk_ key from .env>

# No auth → must 401
curl -s -w "HTTP %{http_code}" "$BASE/api/v1/dataspheres"

# Wrong format (JWT instead of dsk_) → must 401
curl -s -w "HTTP %{http_code}" "$BASE/api/v1/dataspheres" -H "Authorization: Bearer eyJfake"

# Valid format, wrong key → must 401
curl -s -w "HTTP %{http_code}" "$BASE/api/v1/dataspheres" -H "Authorization: Bearer dsk_0000000000000000000000000000000000000000"

# Correct prefix, wrong hash → must 401
curl -s -w "HTTP %{http_code}" "$BASE/api/v1/dataspheres" -H "Authorization: Bearer dsk_${KEY:4:8}wronghash1234567890abcdef"
```

**Pass criteria**: All return 401 with error message.

---

## 2. Authorization / Cross-User Isolation

```bash
# dsk_ key on v2 JWT route → must 403
curl -s -w "HTTP %{http_code}" "$BASE/api/v2/posts" -H "Authorization: Bearer $KEY"

# Datasphere list must only return key owner's memberships
curl -s "$BASE/api/v1/dataspheres" -H "Authorization: Bearer $KEY" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('Total:', len(d['dataspheres']))
# Verify no dataspheres from other users appear (all should have a role)
no_role = [x for x in d['dataspheres'] if not x.get('role')]
print('Missing role (leakage indicator):', no_role)
"
```

**Pass criteria**: v2 returns 403; all listed dataspheres have a role (key owner is a member).

---

## 3. Unauthenticated Access to Private Resources

```bash
# Private datasphere without auth → must 401
curl -s -w "HTTP %{http_code}" "$BASE/api/v1/dataspheres/nickie-bo-cancun-wedding/pages"

# Public pages without auth → must 401 (v1 always requires key)
curl -s -w "HTTP %{http_code}" "$BASE/api/v1/dataspheres/dataspheres-ai/pages"
```

**Pass criteria**: Both return 401.

---

## 4. Injection & Path Traversal

```bash
# Path traversal → must NOT return filesystem content (expect 404 or SPA HTML)
curl -s -w "HTTP %{http_code}" "$BASE/api/v1/dataspheres/../../../etc/passwd/pages" -H "Authorization: Bearer $KEY"

# SQL injection in path param → must not crash (expect 404 or empty result)
curl -s -w "HTTP %{http_code}" "$BASE/api/v1/dataspheres/test%27%3BDROP%20TABLE%20users%3B--/pages" -H "Authorization: Bearer $KEY"
```

**Pass criteria**: No 500 errors, no filesystem content returned.

---

## 5. Cloudflare Protection Check (prod only)

```bash
# v2 without auth — should return 401 from app (Cloudflare passes through, app rejects)
curl -sv "https://dataspheres.ai/api/v2/posts" 2>&1 | grep -E "< HTTP|cf-mitigated"

# Verify WAF Skip rule is firing for /api/v1 with auth
curl -sv "https://dataspheres.ai/api/v1/dataspheres" -H "Authorization: Bearer $KEY" 2>&1 | grep "< HTTP"
```

**Pass criteria**: v1+auth → 200; no `cf-mitigated: challenge` headers on authenticated API calls.

---

## 6. Report Format

For each test, output:
```
[PASS] Test name — expected behavior confirmed
[FAIL] Test name — got: <actual> expected: <expected>
[WARN] Test name — ambiguous result, investigate
```

End with a summary table and any recommended fixes.
