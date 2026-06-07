---
name: kb-context
description: Knowledge Bank and AI context window architecture for dataspheres-ai. Use when modifying how resources are stored in the KB, how content is resolved for AI context, token budget enforcement, or adding a new resource type to the KB.
argument-hint: "resolver | token-budget | analysis | kb-storage | context-builder | add-resource-type"
disable-model-invocation: false
---

# Dataspheres AI — Knowledge Bank & Context Window Reference

## The Golden Rule

**One resolver per resource type. One registry. Used everywhere.**

`src/server/v2/services/resource-content-resolver.ts` is the single source of truth for how any resource becomes text for the AI. Both KB storage and KB context building call `resourceResolver.resolve()` — never inline their own fetch logic.

---

## Architecture: ResourceContentResolver

```
IResourceResolver (interface)
  ├── DataspherePageResolver          resourceType = 'datasphere-page'
  ├── SurveyPageResolver              resourceType = 'survey'         ← all survey responses, no row cap
  ├── LinkedUrlResolver               resourceType = 'linked-url'
  ├── DatasetResolver                 resourceType = 'dataset'        ← all rows, no row cap
  ├── GeneratedMediaResolver          resourceType = 'generatedMedia' ← images & videos (visionCaption included)
  ├── DocumentResolver                resourceType = 'document'       ← PDFs, images, audio/video, spreadsheets, text
  ├── DocumentAnalysisVersionResolver resourceType = 'documentAnalysisVersion'
  ├── MermaidDiagramResolver          resourceType = 'mermaid-diagram'
  └── NewsletterIssueResolver         resourceType = 'newsletter-issue'

ResourceContentResolverRegistry (singleton)
  └── resolve(resourceType, resourceId, fallback?, opts?) → Promise<{ content, tokenCount }>

export const resourceResolver = ResourceContentResolverRegistry.getInstance();
```

**SOLID applied:**
- **S** — each resolver handles exactly one resource type
- **O** — add a new type by adding a new class; registry never changes
- **L** — all resolvers substitutable via `IResourceResolver`
- **I** — interface is minimal: one method, one property
- **D** — controller/service depend on the abstract registry, not concrete fetchers

---

## Truncation Policy (CRITICAL)

**Resolvers return FULL content by default — no hardcoded char caps.**

```
KB storage (no opts)         → full content, accurate token count
Attachment context (opts)    → caller passes opts.maxContentLength (model-aware budget)
When truncation occurs       → visible footer appended: "[Truncated at Xk chars — full content available in source]"
```

The `cap(text, limit?, label)` helper in resource-content-resolver.ts enforces this: if `limit` is undefined, it returns the full string unchanged.

**Never add hardcoded limits inside a resolver.** Content limits come from the caller.

---

## DocumentResolver — Supported File Types

All uploaded files use `resourceType = 'document'`. The resolver detects the type from `mimeType` and formats accordingly:

| mimeType | typeLabel | Content source |
|----------|-----------|----------------|
| `image/*` | Image | `caption`, `analysisResult.description`, vision labels |
| `audio/*` | Audio | `transcriptionText` with speaker segments + labels |
| `video/*` | Video | `transcriptionText` with speaker segments + labels |
| `application/pdf` | PDF Document | `extractedContent` or `chunks` |
| `application/vnd.*wordprocessingml*` | Word Document | `extractedContent` or `chunks` |
| `application/vnd.*spreadsheetml*` | Spreadsheet (Excel) | `extractedContent` or `chunks` |
| `text/csv` | Spreadsheet (CSV) | `extractedContent` or `chunks` |
| `text/*` | Text File | `extractedContent` or `chunks` |
| `application/json` | JSON File | `extractedContent` or `chunks` |

**Fields always included (when present):** `caption`, `summary`, `keyInsights`, `analysisResult`, `customMetadata`
**Transcription extras:** `speakerLabels`, `transcriptionSegments`, `speakerCount`, `translatedContent.en`
**Large files:** assembles all `DocumentChunk` records in order

---

## Adding a New Resource Type — Checklist

1. Add a class in `resource-content-resolver.ts`:
   ```typescript
   class MyNewResolver implements IResourceResolver {
     readonly resourceType = 'my-new-type'; // must match DB resourceType string
     async resolve(resourceId: string, fallback = '', opts?: ResolveOptions): Promise<ResolvedContent> {
       // fetch from prisma, format as human-readable markdown
       // use cap(text, opts?.maxContentLength, 'label') for any long text fields
       return resolved(content); // helper: { content, tokenCount: calculateTokens(content) }
     }
   }
   ```
2. Add it to the constructor array in `ResourceContentResolverRegistry`
3. Done — KB storage, KB context, and attachment context all pick it up automatically

---

## Token Budget Rules

```
KB total budget = max(model.context_window.input × 0.30, 60_000) tokens
FIFO order — items added earliest included first until budget exhausted
Token count = calculateTokens(resolvedMarkdown) via tiktoken cl100k_base
```

| Surface | Budget |
|---------|--------|
| Datasphere-wide KB | 30% of model input context (min 60k tokens) |
| Per-attachment context | 50% of context ÷ numAttachments (floor 200k chars) |
| Analysis full body | No cap at storage; `opts.maxContentLength` applied by attachment context caller |

**Token count is always from the resolved markdown, never raw JSON.**
Displayed count = actual count in context window. No drift.

---

## Data Flow: Document → KB → AI

```
AddToKnowledgeBankButton (client)  [_type='files' → resourceType='document']
  └─→ POST /api/v2/knowledge-bank { resourceType: 'document', resourceId: docId }
        └─→ KnowledgeBankController.addItem()
              └─→ resourceResolver.resolve('document', id)    ← no opts → FULL content
                    └─→ DocumentResolver
                          fetches: name, mimeType, caption, extractedContent/chunks,
                                   transcriptionText, speakerLabels, summary, analysisResult
                          formats as structured markdown
                    └─→ stored in knowledgeBankItem.fullContent + tokenCount (accurate tiktoken)
```

## Data Flow: Document → Attachment Context

```
POST /api/v2/completions { attachments: [{ resourceType: 'Document' }] }
  └─→ buildAttachmentContext()
        └─→ resourceResolver.resolve('document', id, '', { maxContentLength: MAX })
              └─→ same DocumentResolver, cap() applied to long text fields
```

---

## Files

| File | Role |
|------|------|
| `src/server/v2/services/resource-content-resolver.ts` | **Source of truth** — all resolvers + registry + `calculateTokens` + `cap()` |
| `src/server/v2/controllers/knowledge-bank.controller.ts` | KB CRUD — calls `resourceResolver.resolve()` at storage time |
| `src/server/v2/services/v2-context-builder.service.ts` | Context building — calls `resourceResolver.resolve()` in `buildKnowledgeBankContext()` and attachment context |
| `src/client/components/AddToKnowledgeBankButton.tsx` | Client KB button — maps `_type` → `resourceType` for all media types |
| `src/client/utils/prompt-addons.ts` | Client picker UI — `fetchAnalyses()` + `renderItem()` (display only, not AI format) |
| `src/server/v2/controllers/analysis-library.controller.ts` | Lists analyses for picker; filters orphaned (deleted document) analyses |

---

## resourceType → Media Library _type Mapping

| Media Library `_type` | `resourceType` sent to KB | Resolver |
|----------------------|--------------------------|---------|
| `upload` / `files` | `document` | DocumentResolver |
| `analysis` | `documentAnalysisVersion` | DocumentAnalysisVersionResolver |
| `page` | `datasphere-page` | DataspherePageResolver |
| `survey` | `survey` | SurveyPageResolver |
| `image` | `generatedMedia` | GeneratedMediaResolver |
| `video` | `generatedMedia` | GeneratedMediaResolver |
| `linkedUrl` | `linked-url` | LinkedUrlResolver |
| `dataset` | `dataset` | DatasetResolver |
| `mermaidDiagram` | `mermaid-diagram` | MermaidDiagramResolver |
| `newsletter` | `newsletter-issue` | NewsletterIssueResolver |

---

## Common Mistakes

- ❌ Adding a new resource type with an `if` block in the controller or context builder — add a resolver class
- ❌ Storing `JSON.stringify(analysisData)` as fullContent — resolver stores structured markdown
- ❌ Using `Math.ceil(text.length / 4)` — always use `calculateTokens()` from resource-content-resolver.ts
- ❌ Calling the old `resolveItemContent()` or `estimateStringTokens()` — both removed; use `resourceResolver.resolve()`
- ❌ Duplicating fetch logic across KB controller and context builder
- ❌ Hardcoding a char cap inside a resolver — use `cap(text, opts?.maxContentLength)` so storage gets full content
- ❌ Forgetting `'document'` resolver — PDFs, images, audio, video all use `resourceType = 'document'`
- ❌ Slicing arrays (themes, insights) — include all items; the token budget governor handles context size

## Analysis renderItem (client-side picker only)

Guard `analysis.document` — orphaned analyses (document deleted) can appear before server filters them:

```typescript
const doc = analysis.document;
const docName = doc
  ? (doc.displayName || doc.originalName || doc.filename)
  : (analysis.title || `Analysis v${analysis.version}`);
```

Server-side orphan filter in `analysis-library.controller.ts`:
```typescript
analyses.filter(a => a.document != null).map(...)
```
