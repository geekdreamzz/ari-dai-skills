---
name: image-ecosystem
description: >
  Reference guide for working with images in dataspheres-ai. Use this before
  implementing anything that touches image storage, display, vision analysis,
  fullscreen viewing, or activity feed image cards. Prevents duplicate systems
  and enforces the existing SOLID OOP design.
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(grep *)
---

# Image Ecosystem — Dataspheres AI

Before writing ANY image-related code, read this skill. The architecture is
already built. Extend it — never duplicate it.

---

## 1. Data Models

### `GeneratedMedia` — AI-generated images/video
**Use for:** Imagen 3, Veo 3 outputs.
**Key fields:** `prompt`, `title`, `caption`, `url`, `visionCaption`, `visionCaptionAt`, `status`, `apiCost`
**File:** `prisma/schema.prisma` → `GeneratedMedia`
**Relation:** belongs to `Post` (optional), belongs to `User`

### `Document` — User-uploaded files (including images)
**Use for:** Everything a user uploads manually (PNG, JPG, PDF, audio, etc.)
**Key fields:** `displayName` (user title), `caption` (user description), `mimeType`, `storagePath`, `extractedContent`, `analysisStatus`
**File:** `prisma/schema.prisma` → `Document`
**Detect images:** `mimeType.startsWith('image/')`

**Rule:** Do NOT create a third model for images. All images are either `GeneratedMedia` or `Document`.

---

## 2. Vision / Analysis Pipeline

### For GeneratedMedia (auto-captioning for search relevance)
```
Imagen 3 completes → image-generation.service.ts fires:
  ImageVisionService.generateCaption(media.id, url)   // fire-and-forget
    → GPT-4o-mini vision, detail:'low', ~$0.002/image
    → saves visionCaption + visionCaptionAt to GeneratedMedia row
```
**File:** `src/server/services/image-vision.service.ts`

### For Document images (user-triggered analysis)
```
User clicks "Analyze" → documentAnalysisService.analyzeDocument()
  → buildImageAnalysisPrompt()    // specialized image prompt
  → GPT-5 vision, detail:'high'
  → saves analysisResult JSON (visualElements, keyThemes, sentiment) to Document
```
**OCR only:** `POST /api/documents/:id/ocr` → `documentAnalysisService.ocrExtract()`
**File:** `src/server/services/document-analysis.service.ts`

**Rule:** Do NOT call OpenAI vision API directly from a new service for Document images.
Always route through `documentAnalysisService`.

### Adding new vision analysis
1. Add a method to `documentAnalysisService` (for Documents) or `ImageVisionService` (for GeneratedMedia search relevance)
2. Reuse the existing OpenAI client setup in those services
3. Never create a third parallel vision service

---

## 3. Fullscreen Viewer

### The ONE viewer: `MediaViewerModal`
**File:** `src/client/components/MediaViewerModal.tsx`
**Props:** `open`, `onClose`, `media: MediaItem`, `mediaList?` (gallery), `onEdit?`
**Features:** keyboard nav, gallery mode, download, AI Generated badge, title/caption display

### Event system — how to open it

**From activity feed cards / pages that mount their own viewer:**
```typescript
window.dispatchEvent(new CustomEvent('open-media-viewer', {
  detail: { url, type: 'image', title, caption, prompt, isAIGenerated } satisfies MediaItem
}));
// Caught by UnifiedActivityFeed, DiscoveryFeed, UserProfilePage (local state)
```

**From AI responses / completions / pages WITHOUT a local viewer:**
```typescript
window.dispatchEvent(new CustomEvent('open-media-viewer-global', {
  detail: { url, type: 'image', title } satisfies MediaItem
}));
// Caught by the global MediaViewerModal singleton in Layout.tsx
```

**From markdown inline images (ReactMarkdown `img` override):**
Already wired — dispatches `open-media-viewer-global`.
File: `src/client/utils/markdown-components.tsx` → `img` component.

**Rule:** Never create a new lightbox, modal, or fullscreen overlay for images.
Always dispatch one of the two events above and let `MediaViewerModal` handle it.

---

## 4. Activity Feed Image Cards

| Image type | Activity type | Card component | Viewer event |
|---|---|---|---|
| AI-generated (Imagen 3) | `IMAGE_GENERATED` | `GeneratedImageCard` | `open-media-viewer` |
| Manually uploaded | `DOCUMENT_UPLOADED` + `mimeType.startsWith('image/')` | `DocumentImageCard` | `open-media-viewer` |

Both cards are in `src/client/components/UnifiedActivityFeed.tsx`.
Both dispatch `open-media-viewer` → caught by the local `MediaViewerModal` in `UnifiedActivityFeed`.

**Discuss context for image cards:**
- `GeneratedImageCard` → `type: 'image'`, includes `thumbnailUrl: media.url`, `summary: media.prompt`
- `DocumentImageCard` → `type: 'document'`, includes `summary: doc.caption + analysisSummary`

---

## 5. Web Search Images (Tavily)

Tavily returns `images: string[]` (public URLs) alongside search results.

**They are NOT stored in DB.** They flow as:
```
WebSearchService.search() → returns images[]
  → stored in Activity.metadata.images (top ~6 URLs)
  → rendered as image grid in WebSearchRenderer.tsx (has own inline modal)
  → passed as DiscussionContext.images when user clicks Discuss
  → injected into AI context by V2ContextBuilder.buildToolResultsContext()
    with render instruction: ![title](url)
```

**Rule:** Web search images stay as URLs in metadata/context — do NOT auto-save them
to GeneratedMedia or Document unless the user explicitly saves one.
If you need to save a Tavily image to the library, create a `Document` record with
`mimeType: 'image/jpeg'` and download+store the file — then it goes through the
standard Document upload flow.

**WebSearchRenderer fullscreen:** Has its own simple inline modal (`selectedImage` state).
This is intentional — it's a compact grid viewer for search results, not a media library item.
Do NOT replace it with MediaViewerModal.

---

## 6. ImageVisionService — Search Relevance Only

`src/server/services/image-vision.service.ts`

This service has ONE job: making GeneratedMedia images findable by search queries
so they can be injected into completion context windows.

| Method | Purpose |
|---|---|
| `generateCaption(mediaId, url)` | Auto-caption a GeneratedMedia image after generation |
| `findRelatedImages(datasphereId, queries, limit)` | Find library images relevant to search queries |
| `indexDatasphereImages(datasphereId)` | Retroactively caption all uncaptioned images (admin) |

**Does NOT apply to Document images.** For Document image captioning, use
`documentAnalysisService.analyzeDocument()` — which the user triggers manually.

---

## 7. Extending the Ecosystem — Checklist

When adding a new image feature, ask:

1. **Is it AI-generated or user-uploaded?** → `GeneratedMedia` or `Document`
2. **Does it need fullscreen?** → dispatch `open-media-viewer` or `open-media-viewer-global`. Never create a new modal.
3. **Does it need vision analysis?** → `ImageVisionService` (GeneratedMedia) or `documentAnalysisService` (Document). Never call OpenAI directly.
4. **Does it appear in the activity feed?** → extend `GeneratedImageCard` or `DocumentImageCard`. Never create a third card type for images.
5. **Does it need to be searchable?** → `visionCaption` for GeneratedMedia, `caption + displayName` for Document.
6. **Is it from web search?** → keep as URL in metadata, do not auto-persist.

---

## 8. Key File Reference

| Concern | File |
|---|---|
| GeneratedMedia schema | `prisma/schema.prisma` → `GeneratedMedia` |
| Document schema | `prisma/schema.prisma` → `Document` |
| Vision captions (generated) | `src/server/services/image-vision.service.ts` |
| Vision analysis (uploaded) | `src/server/services/document-analysis.service.ts` |
| Image generation + caption trigger | `src/server/services/image-generation.service.ts` |
| Fullscreen viewer component | `src/client/components/MediaViewerModal.tsx` |
| Global viewer (Layout singleton) | `src/client/components/Layout.tsx` → `open-media-viewer-global` |
| Markdown inline images | `src/client/utils/markdown-components.tsx` → `img` override |
| Activity feed image cards | `src/client/components/UnifiedActivityFeed.tsx` → `GeneratedImageCard`, `DocumentImageCard` |
| Web search image grid | `src/client/components/unified/WebSearchRenderer.tsx` |
| TipTap image extension | `src/client/components/editor/CustomImage.ts` |
| TipTap image styles | `src/client/styles/tiptap.css` |
| Context injection | `src/server/v2/services/v2-context-builder.service.ts` |
| Multimodal AI messages | `src/server/services/llm/OpenAIProvider.ts` → `userPromptParts` |
