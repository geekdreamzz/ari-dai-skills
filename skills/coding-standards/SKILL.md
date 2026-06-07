---
name: coding-standards
description: Error handling protocol, validation requirements, file header standards, and LLM token budget requirements. Use when writing new services, API endpoints, LLM calls, or when unsure about error handling patterns in this project.
---

# Coding Standards — Error Handling & Validation

## Error Handling Protocol

**NEVER rescue errors without user approval.**

- DO NOT add fallback logic, optional chaining, or default values to mask errors
- DO NOT write "if missing, use alternative" patterns
- ERRORS ARE GOOD — they expose upstream problems
- Only add error handling when explicitly requested by user

```typescript
// WRONG — masks upstream error
const completion = passedCompletion || useCompletion() || {};

// CORRECT — let it fail if missing
const completion = passedCompletion; // Will error if undefined — GOOD!
```

## Strict Validation Requirements

**Core principle:** In local dev, it is INFINITELY BETTER to crash with a clear error than to generate garbage.

### Forbidden Patterns

```typescript
// NEVER DO THIS
const data = fetchData() || {};
const content = data.field || 'default';
const result = processData(content || 'fallback');

// ALWAYS DO THIS
const data = fetchData();
if (!data) {
  throw new Error('CRITICAL: fetchData() returned null/undefined. Cannot proceed.');
}
if (!data.field) {
  throw new Error(`CRITICAL: data.field is missing. Keys: ${Object.keys(data).join(', ')}`);
}
const result = processData(data.field);
```

### Validation Checklist

1. **AI Generation Inputs** — validate required data exists BEFORE calling AI APIs
2. **Database Queries** — verify expected data structure, throw if fields missing
3. **Service Layer** — validate inputs at entry, validate outputs before return
4. **API Responses** — verify structure before using, never assume
5. **Error Messages** — include: what failed, expected vs actual, file:line, remediation steps

### Error Message Template

```
CRITICAL: [COMPONENT] {description} ({count} chars).
Expected: {what should exist}. Got: {what was received}.
Location: {file}:{line}
Remediation: {specific fix steps}
DEBUG: {truncated data for diagnosis}
```

## File Header Standard

Every file must include:

```typescript
/**
 * @timestamp YYYY-MM-DDTHH:mm:ss.sssZ
 * @filepath relative/path/to/file
 * @purpose Brief description of file's responsibility
 * @maintenance_notes Key implementation details and gotchas
 * @architecture_role Model|View|Controller|Utility|Service
 * @docs_path docusaurus/docs/codebase/section-name.md#anchor-link
 * @todo_docs If no docs exist, create TODO item to document this component
 *
 * @aria_strategy How this maps to src/shared/ari-page-registry.ts.
 *   Which section/actions reference this code. What to update if API surface changes.
 *   Use "Not applicable" for internal utilities with no user-facing surface.
 *
 * @tools_meta How this maps to src/server/v2/services/assistant-tool-registry.service.ts.
 *   Which tool ID(s) reference this endpoint. Mode (direct vs guided). What ARI needs to invoke it.
 *   Use "Not applicable" for services not exposed as ARI tools.
 */
```

**ARIA + Tools Meta Registry Protocol:**
- When creating a NEW endpoint/feature: add `@aria_strategy` + `@tools_meta` to the header,
  register in `ari-page-registry.ts` (section, aliases, actions) AND `assistant-tool-registry.service.ts` (reg() call).
- When modifying an EXISTING endpoint: check if the ARIA/tool registration needs updating.
- The L0 immutable context cache (24hr TTL in `ari-l0` Postgres cache) picks up changes on next new conversation.

## LLM Token Budget — Non-Negotiable Standard

**Every LLM call on the platform MUST use `calculateTokenBudget()` and `countTokens()` from `src/server/utils/token-budget.ts`.**

No hardcoded `maxTokens` values. No guessing context sizes. The budget utility handles:
- Accurate token counting via tiktoken (cl100k_base)
- Model-aware context window limits from ModelRegistry
- Per-provider output caps (Anthropic 64K, OpenAI 16K, Google 8K)
- Safety buffer (default 2000 tokens)
- High-usage warnings at 80%+ context consumption

```typescript
// WRONG — hardcoded, no awareness of input size or model limits
const result = await aiResponseService.completion({
  modelId: 'claude-sonnet-4-6',
  systemPrompt,
  userPrompt,
  maxTokens: 16000, // ❌ arbitrary number
});

// RIGHT — budget-aware, respects model limits
import { calculateTokenBudget } from '../../utils/token-budget';

const budget = calculateTokenBudget('claude-sonnet-4-6', systemPrompt, userPrompt, 2000);
const result = await aiResponseService.completion({
  modelId: 'claude-sonnet-4-6',
  systemPrompt,
  userPrompt,
  maxTokens: budget.maxOutputTokens, // ✅ calculated from actual input + model limits
});
```

**Also use `countTokens()` for:**
- Knowledge Bank item budgeting (FIFO within token limit)
- Estimating completion costs before charging capacity
- Context window utilization logging
- Truncating large inputs to fit within limits

---

## MDX Documentation Rules

- NEVER write `<NUMBER` patterns in markdown (e.g., `<100ms`)
- ALWAYS escape: `&lt;100ms`, `&lt;500ms`
- MDX interprets `<` + alphanumeric as HTML tags, breaking Docusaurus builds

---

## Prisma Activity Model — `actorId`, not `userId`

The `Activity` table uses `actorId` (schema: `prisma/schema.prisma` line 4710). `userId` is NOT a field. Prisma silently tolerates unknown fields in some cases but will still fail if required fields are missing.

```typescript
// WRONG — userId isn't on the schema
await prisma.activity.create({
  data: { type: 'DOCUMENT_UPLOADED', userId, datasphereId, ... }
});

// RIGHT
await prisma.activity.create({
  data: {
    type: 'DOCUMENT_UPLOADED',
    actorId: userId,              // note the rename
    datasphereId,
    documentId: createdDoc.id,
    resourceType: 'Document',     // required
    resourceId: createdDoc.id,    // required — usually same as documentId
    resourceTitle: doc.originalName,
    metadata: { /* ... */ },
  }
});
```

Always include `resourceId` — it's required. For Document-typed activities it's usually the same value as `documentId`.

**Inside background loops** (async IIFE, fire-and-forget jobs), wrap `Activity.create` in its own try/catch — activity logging is non-critical, but a throw will abort the outer page iteration and leave the job stuck. See [documents.controller.ts:extractPages](../../../src/server/controllers/documents.controller.ts) for the reference pattern.

---

## Async Post-Processors & Mobile Safe-Area

Before implementing any async job or mobile modal, read these canonical docs:

- **Async processors** (OCR, vision, transcription, extraction, embedding):
  `docs/development/async-processor-architecture.md` — 5-step contract
- **Mobile safe-area** (notch / Dynamic Island / home indicator):
  `docs/development/mobile-safe-area.md` — use `pt-safe`, never inline `env()`

Both docs include an Enforcement section with red-flag patterns to reject.

---

## Tagging & Metadata — Use the Polymorphic Substrate

**Before** adding a `metadata Json?` column to any model, or building a per-feature tagging table, STOP.

The platform already has one canonical tagging + metadata system that every polymorphic resource uses (document, page, task, post, analysis, surveyResponse, documentSegment):

- `CodeFamily` — the metadata **key** (e.g. `"Tags"`, `"Legacy Impact"`)
- `ResearchCode` — an enum **value** for that key (e.g. `"breaking"`, `"additive"`, `"none"`)
- `CodeApplication` — the binding, polymorphic via `targetType` + `targetId`

Free-text per application → `CodeApplication.memo`. The shared `ResourceTagsMetadata.tsx` component already renders tags + metadata for any polymorphic resource.

**Do not:**
- Add per-model `metadata Json?` columns for new features
- Stuff structured K/V into rich-text `content` fields (TipTap prose is for humans)
- Build feature-scoped tagging tables (`TaskLabel`, `PostCategory`, etc.)

See [docs/development/shared-primitives.md § Tagging & metadata](../../../docs/development/shared-primitives.md) for the full contract and the `fromCodeFamily` / `tagPrefix` extractor syntax used by shadow datasets.
