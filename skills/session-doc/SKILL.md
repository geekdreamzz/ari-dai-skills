---
name: session-doc
description: Create and maintain Docusaurus session documentation. Creates a dated sub-folder with multiple MDs (README, TODO, MVC-ANALYSIS, REGRESSION-TESTING, ARCHITECTURE with mermaid diagrams), updates sidebars.ts, verifies via curl, and links the user the full URL. Use when the user says "session doc", "document this session", "create session docs", or at the start of any new implementation session.
argument-hint: [session-topic]
disable-model-invocation: true
allowed-tools:
  - Write
  - Read
  - Edit
  - Glob
  - Bash(date *)
  - Bash(ls *)
  - Bash(lsof *)
  - Bash(curl *)
  - Bash(mkdir *)
---

Run the full session documentation flow for: $ARGUMENTS

## Steps

1. Get today's date: `date '+%Y-%m-%d'`
2. Determine session topic from $ARGUMENTS (or summarize from conversation if not provided — use a concise kebab-case slug)
3. Create the session directory: `docusaurus/docs/sessions/YYYY-MM-DD-{topic}/`
4. Create ALL required files below using the templates
5. Update `docusaurus/sidebars.ts` — add new session as a **category** at the TOP of the "Development Sessions" items list (newest first)
6. Verify it works via curl and link the user the full URL

---

## Required Files

Every session folder MUST contain these files. Create them all at once during initial setup. As work progresses, update them in real-time.

### 1. README.md (Session Overview)

```markdown
---
sidebar_position: 1
---

# {Session Title}

**Date:** YYYY-MM-DD
**Status:** In Progress | Complete

## Overview

{1–3 sentences: what is being built/fixed and why it matters}

## Requirements

{Bullet list of what the user asked for — quote verbatim where possible}

## Implementation

### Files Changed

| File | Change |
|------|--------|
| `src/path/to/file.ts` | What changed and why |

### Key Decisions

{Architectural choices made during the session with reasoning. What alternatives were considered?}

### How It Works

{Technical walkthrough of the solution — data flow, key functions, integration points}

## Testing

{How to manually verify the feature works. Include exact steps, URLs, credentials if needed.}

## Related

- Session docs: `docusaurus/docs/sessions/YYYY-MM-DD-{topic}/`
```

### 2. TODO.md (Task List)

```markdown
---
sidebar_position: 2
---

# TODO — {Session Title}

**Date:** YYYY-MM-DD

## Session Tasks

- [ ] {Task 1} — `src/path/to/file.ts`
- [ ] {Task 2} — `src/path/to/file.ts`
- [ ] {Task 3} — `src/path/to/file.ts`

## Deferred / Blocked

- [ ] {Deferred task — explain why it's blocked}

## Files Modified

| File | Change |
|------|--------|
| `src/path/to/file.ts` | What changed |
```

### 3. MVC-ANALYSIS.md (MVC Approach & Scaffold)

```markdown
---
sidebar_position: 3
---

# MVC Analysis — {Session Title}

**Date:** YYYY-MM-DD

## Model Layer

{Database schema changes, new models, Prisma migrations, entity relationships}

### Schema Changes

\`\`\`sql
-- New tables or ALTER statements
\`\`\`

### Prisma Model (if applicable)

\`\`\`prisma
model NewEntity {
  id        String   @id @default(cuid())
  // ...
}
\`\`\`

## Controller / Route Layer

{Express routes, middleware chain, request/response contracts}

### New Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/...` | Bearer | What it does |

### Middleware Chain

\`\`\`
request → auth → validate → businessLogic → response
\`\`\`

## View / Frontend Layer

{React components, state management, UI flow}

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `FeatureName.tsx` | `src/components/...` | What it renders |

### State Management

{Context, hooks, or store changes}

## Scaffold Summary

{Quick reference of all files that need to be created or modified, grouped by layer}

### Files to Create
- `src/models/...`
- `src/routes/...`
- `src/components/...`

### Files to Modify
- `src/routes/index.ts` — register new routes
- `prisma/schema.prisma` — add new model
```

### 4. REGRESSION-TESTING.md (Regression Testing Checklist)

```markdown
---
sidebar_position: 4
---

# Regression Testing Checklist — {Session Title}

**Date:** YYYY-MM-DD
**Tester:** ___
**Environment:** localhost / staging / production

## Pre-Deployment Checks

- [ ] All existing Playwright tests pass
- [ ] No new TypeScript compilation errors
- [ ] No new console errors on key pages
- [ ] Database migrations run cleanly (up and down)

## New Feature Verification

- [ ] {Feature 1}: {exact steps to verify}
- [ ] {Feature 2}: {exact steps to verify}

## Existing Feature Regression

- [ ] Survey creation still works end-to-end
- [ ] Survey responses submit correctly
- [ ] Activity feed renders without errors
- [ ] Page builder loads and saves
- [ ] AI chat/completion works
- [ ] Authentication flow (login/logout)
- [ ] Datasphere CRUD operations
- [ ] File uploads still work
- [ ] Navigation and sidebar render correctly

## Edge Cases

- [ ] {Edge case 1}: {how to test}
- [ ] {Edge case 2}: {how to test}

## Performance

- [ ] No observable slowdown on page load
- [ ] API response times within acceptable range

## Sign-Off

| Role | Name | Date | Status |
|------|------|------|--------|
| Developer | | | |
| UAT | | | |
```

### 5. ARCHITECTURE.md (Mermaid Diagrams & System Design)

```markdown
---
sidebar_position: 5
---

# Architecture — {Session Title}

**Date:** YYYY-MM-DD

## System Overview

{High-level description of how this feature integrates with the existing platform}

## Data Flow

\`\`\`mermaid
sequenceDiagram
    participant Client
    participant Express
    participant Database
    participant ExternalService

    Client->>Express: POST /api/...
    Express->>Database: Query/Mutation
    Database-->>Express: Result
    Express-->>Client: JSON Response
\`\`\`

## Component Architecture

\`\`\`mermaid
graph TD
    A[User Action] --> B[React Component]
    B --> C[API Call]
    C --> D[Express Route]
    D --> E[Service Layer]
    E --> F[Database]
    E --> G[External API]
\`\`\`

## Entity Relationship

\`\`\`mermaid
erDiagram
    ENTITY_A ||--o{ ENTITY_B : has
    ENTITY_B {
        string id PK
        string name
        string foreignId FK
    }
\`\`\`

## State Machine (if applicable)

\`\`\`mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Active: publish
    Active --> Archived: archive
    Archived --> Active: restore
\`\`\`

## Integration Points

{List of external services, APIs, or modules this feature touches}

| System | Integration | Direction |
|--------|------------|-----------|
| Existing System | How it connects | inbound/outbound |
```

### 6. BUGS-AND-FIXES.md (created as needed)

```markdown
---
sidebar_position: 6
---

# Bugs & Fixes — {Session Title}

**Date:** YYYY-MM-DD

## Bug 1: {Descriptive Title}

**Symptom:** {What error message appeared, or what wrong behavior the user saw}

**Root Cause:** {WHY this happened — the underlying reason}

**Fix:**
\`\`\`typescript
// Before
const old = wrong;

// After
const fixed = correct;
\`\`\`

**File:** `src/path/to/file.ts` line {N}

**Prevention:** {Pattern to follow or avoid in the future}

---

## Common Patterns & Gotchas

- {Cross-cutting lesson learned this session}
```

---

## Sidebar Update (sidebars.ts)

Read the current `docusaurus/sidebars.ts` first to match the exact format. Add the new session as a **category** at the TOP of the "Development Sessions" items array (after the `// ADD NEW SESSIONS HERE AT THE TOP` comment):

```typescript
{
  type: 'category',
  label: 'YYYY-MM-DD: {Human Readable Topic}',
  collapsed: false,
  items: [
    'sessions/YYYY-MM-DD-{topic}/README',
    'sessions/YYYY-MM-DD-{topic}/TODO',
    'sessions/YYYY-MM-DD-{topic}/MVC-ANALYSIS',
    'sessions/YYYY-MM-DD-{topic}/REGRESSION-TESTING',
    'sessions/YYYY-MM-DD-{topic}/ARCHITECTURE',
  ],
},
```

**IMPORTANT:** Every .md file in the session folder MUST be linked in the sidebar category items. If you add BUGS-AND-FIXES.md later, add it to the sidebar too. No orphan docs.

---

## Verification (MANDATORY)

After updating sidebars.ts:

6. Detect the Docusaurus port: `lsof -i -P -n | grep LISTEN | grep node | grep -E ':(3000|3001|3002|3003|4000)' | head -5`
   Parse the port number from the output (look for `:<port>` in the TCP line).
   If nothing found, try common ports: 3000, 3001, 3002.
7. Verify the page actually loads:
   NOTE: In Docusaurus, `README.md` maps to the directory root URL (not `/README`). Use this URL:
   `curl -s -o /dev/null -w "%{http_code}" "http://localhost:{PORT}/docs/sessions/YYYY-MM-DD-{topic}/"`
   - HTTP 200 is necessary but NOT sufficient — Docusaurus returns 200 for all pages (SPA).
   - Also confirm the route is registered: check that `__plugin.json` in `.docusaurus/docusaurus-plugin-content-docs/default/` contains the topic path. Or check `.docusaurus/globalData.json`.
   - If route is registered and status is 200: output the full clickable URL (use directory path, not /README).
   - If not 200 or route missing: tell the user the doc was created but may need a Docusaurus server restart.
8. ONLY output the URL after confirming it returns 200 AND the route is registered. Never output the URL without verifying it first.
   Output format: `http://localhost:{PORT}/docs/sessions/YYYY-MM-DD-{topic}/`

---

## Progress Updates (CRITICAL)

As you make progress on the implementation during a session:

1. **Invoke the motto skill** (`/motto`) before marking any task complete
2. **Update the session docs in real-time:**
   - Check off completed tasks in `TODO.md`
   - Add files changed to `README.md` and `TODO.md`
   - Log any bugs encountered in `BUGS-AND-FIXES.md` (and add it to sidebars.ts if it's the first bug)
   - Update mermaid diagrams in `ARCHITECTURE.md` as the design evolves
   - Fill in regression test steps in `REGRESSION-TESTING.md` as features are built
3. **Session docs are living documents** — they should reflect the current state of work at all times, not just a post-session summary
