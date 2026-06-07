---
name: design-principles
description: Reference guide for shared component patterns and SOLID OOP design principles used in the Dataspheres AI platform. Use when designing new features, reviewing architecture decisions, or when the user asks "how should I structure this?" or "what's the right pattern for this?"
argument-hint: "feature-or-question"
disable-model-invocation: true
---

Apply the following design principles and patterns to: $ARGUMENTS

---

## Session Doc Protocol — MANDATORY WHEN CREATING OR UPDATING SESSION DOCS

When creating or updating a session doc, ALWAYS:

1. **Ensure the Docusaurus doc server is running** on port 3030:
   ```bash
   # Check if already running:
   curl -s -o /dev/null -w "%{http_code}" http://localhost:3030 2>/dev/null
   # If not running, start it (background):
   cd /Users/bunnarithbao/ship/dataspheres-ai/docusaurus && npm run start -- --port 3030 &
   sleep 8  # wait for webpack compile
   ```

2. **Add the doc to `sidebars.ts` BEFORE verifying the URL** — Docusaurus only serves docs that are registered in the sidebar. Add the new entry at the TOP of the `Development Sessions` items array in `docusaurus/sidebars.ts`:
   ```typescript
   // ADD NEW SESSIONS HERE AT THE TOP (newest first)
   'sessions/YYYY-MM-DD-kebab-case-topic/README',
   ```
   Format: `'sessions/<folder-name>/README'` — no `.md` extension.

4. **Verify the doc URL resolves (HTTP 200)**:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://localhost:3030/docs/sessions/<slug>/"
   ```
   The slug is the folder name under `docusaurus/docs/sessions/` (e.g. `2026-03-13-inbound-api-phase2-local-skill`).

5. **Give the user the full clickable URL**:
   ```
   http://localhost:3030/docs/sessions/<slug>/
   ```
   Always present this as a link so the user can click directly to review.

6. **If the server returns 404**, the doc was just created and webpack hasn't indexed it yet — wait 3–5 seconds and retry. If still 404, check the folder name matches the Docusaurus sidebar config.

---

## UAT Protocol — MANDATORY FINAL STEP

**UAT (User Acceptance Testing) is ALWAYS the last step before any production push.**

### Rules (non-negotiable)
1. **No `git push` until UAT passes.** Code can be committed locally, but never pushed to production without the user explicitly confirming UAT is complete.
2. **Every session doc must have a `[ ] UAT REQUIRED` checkbox** as the last item in the Status section.
3. **Do not auto-push** after implementing features — always stop and ask the user to perform UAT first.
4. **UAT = user manually tests the feature in the browser**, not just "it compiles" or "no TypeScript errors".
5. When the user says "commit and push", confirm UAT status first. If UAT has not been done, commit but hold the push.

### Session doc template (Status section must end with):
```markdown
- [ ] **UAT REQUIRED** — manually test all changes in browser before pushing to prod
```

### What UAT covers (minimum):
- New UI flows work end-to-end in the browser
- No console errors on the happy path
- Edge cases mentioned in the session doc don't crash the page
- Any schema migrations ran cleanly on the target environment

---

## SOLID Principles — Dataspheres Application

### S — Single Responsibility
Each module does ONE thing:
- `engagement-queue.service.ts` — engagement score math only
- `translations.routes.ts` — cache GET/POST only
- `ActivityCardFooter` — renders the vote+comment+translate+share bar, nothing else
- `TranslateButton` — the full translate UX flow, including cache check, modal open, and login redirect

**Red flags**: A service that both fetches AND formats AND emails. A component that renders AND owns business logic AND manages global state.

### O — Open/Closed
Extend via configuration, not modification:
- `ACTIVITY_CTA_CONFIGS` — add new activity types here, not by adding `if` branches inside the feed
- `ACTIVITY_DISPLAY_MAP` — new activity types register metadata here
- `ModelRegistry` — new AI models register here, no changes to callers
- `LOCALE_META` + `UI_LOCALES` — add new locales here, all consumers update automatically
- `StageFactory`, `AnimationPresets` — registry pattern, new stages/presets added without editing existing code

**Rule**: If you add a new activity type, add it to the maps. Never add `if (item.type === 'MY_NEW_TYPE')` scattered through the feed.

### L — Liskov Substitution
Card components: any card registered in `ActivityItemCard`'s switch must:
- Accept `item: UnifiedFeedItem` and optional `onDiscuss`, `onShare`
- Render a `<Card>` with header + body + `<ActivityCardFooter>`
- Not break if optional props are undefined

**Pattern**: All activity cards follow the same contract — swapping one for another must not break the feed.

### I — Interface Segregation
- `TranslateButtonProps` only exposes what the button needs — NOT the full datasphere object
- `ActivityCardFooter` takes primitive fields (`datasphereId`, `datasphereUri`, `datasphereName`) not a full datasphere object
- API route handlers receive only what they need from `req.body` — destructure explicitly, never pass `req.body` wholesale

### D — Dependency Inversion
- Components depend on `i18n` abstractions (`useTranslation`, `getPreferredAILanguage`) not on localStorage directly
- Services depend on `prisma` client, not on a specific DB driver
- AI calls go through `openai.ts` wrapper, not raw OpenAI SDK calls in routes
- Engagement score: `recalculatePostEngagement(postId)` — callers don't know the formula

---

## Shared Component Catalog

### `ActivityCardFooter` — `src/client/components/UnifiedActivityFeed.tsx`
```tsx
<ActivityCardFooter
  item={item}
  onDiscuss={onDiscuss ? handleDiscuss : undefined}
  onShare={onShare}
  datasphereId={datasphereId}     // optional — enables TranslateButton
  datasphereUri={datasphereUri}   // optional — enables TranslateButton
  datasphereName={datasphereName} // optional — for TranslateButton label
/>
```
**Use whenever**: any activity card needs vote + comment + translate + share bar.
**Handles**: InlineVoteButtons, Comment button, conditional TranslateButton (only if locale + resource type match), Share button.

### `TranslateButton` — `src/client/components/TranslateButton.tsx`
```tsx
<TranslateButton
  resourceType={'PAGE' | 'NEWSLETTER_ISSUE' | 'POST'}
  resourceId={string}
  resourceTitle={string}
  datasphereId={string}
  datasphereUri={string}
  datasphereName={string}
  resourceSummary?: string  // first ~500 chars for AI context
/>
```
**Shows**: only when `getPreferredAILanguage()` returns non-empty (user has a non-English locale).
**Flow**: cache check → open DiscussionModal OR navigate to cached completion. Unauthenticated users saved to sessionStorage → redirected back after login.

### `LocaleSwitcher` — `src/client/components/LocaleSwitcher.tsx`
Searchable dropdown — matches on locale code, native name, and English name.
Use in any header (authenticated or public).

### `InlineVoteButtons` — renders upvote/downvote inline in card footers.

### `DiscussionModal` — `src/client/components/DiscussionModal.tsx`
Central AI research/discussion modal. Pre-fills `responseLanguage` from `getPreferredAILanguage()` and syncs via `useEffect([i18n.language])`.

### `LanguageSelector` — `src/client/components/LanguageSelector.tsx`
Dropdown for picking AI response language. Used in DiscussionModal, V2ReplyForm, TranslateButton picker.

---

## Shared Utilities

### `getPreferredAILanguage()` — `src/client/i18n/index.ts`
```typescript
import { getPreferredAILanguage } from '@/i18n';
const lang = getPreferredAILanguage(); // '' for English/unset, 'Khmer', 'French', etc.
```
Maps BCP-47 locale (`ui-locale` in localStorage) → AI language name used in prompts.
Returns `''` (Auto) for English or no locale set.

### `changeLocale(locale: UILocale)` — `src/client/i18n/index.ts`
Async — sets localStorage, loads bundle, updates i18n. Always `await` it; never assume it's synchronous.

### `SUPPORTED_LANGUAGES` — `src/client/utils/supported-languages.ts`
Array of `{ code: string, name: string }`. Use for locale→English-name mapping (e.g. `'km'` → `'Khmer'`).

---

## Registry Pattern (O/D principles)

When you add a new type, update the relevant registry:

| Registry | File | Add when |
|----------|------|----------|
| `ACTIVITY_DISPLAY_MAP` | UnifiedActivityFeed.tsx | New activity type for display |
| `ACTIVITY_CTA_CONFIGS` | UnifiedActivityFeed.tsx | New activity type with CTA button |
| `LOCALE_META` + `UI_LOCALES` | `src/client/i18n/index.ts` | New supported UI locale |
| `SUPPORTED_LANGUAGES` | `src/client/utils/supported-languages.ts` | New AI response language |
| `ModelRegistry` | `src/server/lib/model-registry.ts` | New AI model |
| `StageFactory` | `src/client/experience/stages/` | New presentation stage type |
| `AnimationPresets` | `src/client/experience/animations/` | New named animation |
| Node catalogs (×3) | SequenceCanvas, SequenceEditorPage, NodeCatalog | New sequencer node type |
| `MODAL_SIZES` | `src/client/lib/ui-tokens.ts` | New modal size variant |
| emoji set | upgrade `@emoji-mart/data` package | New emoji / updated emoji set |

**Rule**: If adding a new item requires editing more than the registry file + the feature file, the registry is incomplete. Fix the registry so additions are single-file changes.

---

## Card Architecture Contract

Every activity card component MUST:
1. Accept `item: UnifiedFeedItem` plus optional `onDiscuss`, `onShare`
2. Have a local `handleDiscuss()` that calls `onDiscuss` with a built `DiscussionContext`
3. Render `<ActivityCardFooter item={item} onDiscuss={onDiscuss ? handleDiscuss : undefined} onShare={onShare} ... />`
4. Use `rounded-none md:rounded-lg border-x-0 md:border-x` on the root `<Card>` for mobile-responsive layout
5. Register in `ActivityItemCard`'s routing switch

New card template:
```tsx
const MyNewCard: React.FC<{
  item: UnifiedFeedItem;
  datasphereUri?: string;
  datasphereId?: string;
  datasphereName?: string;
  onDiscuss?: (context: DiscussionContext) => void;
  onShare?: () => void;
}> = ({ item, datasphereUri, datasphereId, datasphereName, onDiscuss, onShare }) => {
  const handleDiscuss = () => {
    if (onDiscuss) onDiscuss({ type: 'activity', id: item.id, title: item.resourceTitle || '' });
  };
  return (
    <Card className="overflow-hidden hover:shadow-md transition-shadow rounded-none md:rounded-lg border-x-0 md:border-x">
      {/* header + body */}
      <ActivityCardFooter
        item={item}
        onDiscuss={onDiscuss ? handleDiscuss : undefined}
        onShare={onShare}
        datasphereId={datasphereId}
        datasphereUri={datasphereUri}
        datasphereName={datasphereName}
      />
    </Card>
  );
};
```

---

---

## UI Design Tokens — `src/client/lib/ui-tokens.ts`

Centralized tokens for consistent sizing. **Never hardcode modal widths — use these.**

### `MODAL_SIZES` — Dialog widths
```ts
import { MODAL_SIZES } from '@/lib/ui-tokens';

MODAL_SIZES.sm   // sm:max-w-md  — narrow confirmation / simple alert
MODAL_SIZES.md   // sm:max-w-xl  — standard form / settings
MODAL_SIZES.lg   // sm:max-w-3xl — detail view / content modals (default)
MODAL_SIZES.xl   // sm:max-w-5xl — wide media viewer / rich content
MODAL_SIZES.full // sm:max-w-7xl — full-width document / editor
```

The `sm:` prefix overrides the base `DialogContent` component's default `sm:max-w-lg`.

### `MODAL_DEFAULTS` — common base classes
```ts
MODAL_DEFAULTS.scrollable    // 'max-h-[85vh] overflow-y-auto'
MODAL_DEFAULTS.noDefaultClose // '[&>button]:hidden' — only use if adding a custom X button
```

### `CARD_LAYOUT` — activity card layout
```ts
CARD_LAYOUT.feedCard // 'overflow-hidden hover:shadow-md transition-shadow rounded-none md:rounded-lg border-x-0 md:border-x'
```

**Rule**: To change all modals of a given size platform-wide, edit `MODAL_SIZES` in `ui-tokens.ts` only.
**Rule**: Do NOT use `[&>button]:hidden` unless you add your own dismiss button — it removes Radix's default X.

---

---

## Visual Effects Editor — `src/client/components/VisualEffectsEditor.tsx`

### Purpose
Inline config editor for `visualConfig` — ambient overlays (confetti, floating, ribbon, border) on pages, newsletters, and dataspheres. Single source of truth for all overlay editing UI.

### Usage
```tsx
<VisualEffectsEditor
  value={formData.visualConfig}   // VisualConfig | null | unknown
  onChange={(v) => setFormData(prev => ({ ...prev, visualConfig: v }))}
  label="Docs Landing Visual Effects"  // optional, defaults to "Visual Effects"
/>
```
`onChange` emits `{ overlays: Overlay[] }` or `null` when all effects removed.

### OVERLAY_DEFAULTS — Centralized Defaults (export)
```typescript
import { OVERLAY_DEFAULTS } from '../components/VisualEffectsEditor';
// { confetti, floating, ribbon, border } — never hardcode these elsewhere
```

### Mandatory UX Rules
1. **All numeric controls use `LabelledSlider`**, never `<Input type="number">`. Slider shows live value in gold monospace at top-right.
2. **Defaults come from `OVERLAY_DEFAULTS`** — `newOverlay()` spreads from it. If you change a default, change it in `OVERLAY_DEFAULTS` only.
3. **Floating emojis use `EmojiPickerInput`** — the full emoji-mart picker, not a dropdown or fixed grid.
4. **Color controls**: native `<input type="color">` + hex `<span>` display. No text Input for hex editing.

### Slider ranges per field
| Field          | min | max | step | display  |
|----------------|-----|-----|------|----------|
| confetti count |  20 | 200 |   10 | `80`     |
| confetti duration | 1 | 10 |  1  | `4s`     |
| floating count |   5 |  50 |    5 | `15`     |
| floating speed |   1 |   5 |    1 | `1×`     |
| ribbon/border opacity | 10 | 100 | 10 | `80%` |

### Where to add VisualEffectsEditor
Add to any settings modal/sheet where moderators configure a resource's ambient effects:
- **Datasphere docs**: Docs Settings modal in `DocsPage.tsx`
- **Newsletter landing**: Sheet in `PublicNewsletterView.tsx`
- **Pages**: PageEditorPage side panel (when applicable)

Save pattern — split into two calls if the endpoint separates access settings from visualConfig:
```typescript
const { visualConfig, ...accessSettings } = draft;
await Promise.all([
  fetch(`/api/dataspheres/${id}/docs-settings`, { method: 'PATCH', body: JSON.stringify(accessSettings) }),
  fetch(`/api/dataspheres/${id}`, { method: 'PUT', body: JSON.stringify({ visualConfig: visualConfig || null }) }),
]);
```

---

## Anti-Patterns to Avoid

- **Duplicating footer JSX** across cards — use `ActivityCardFooter`
- **Reading localStorage directly** in components — use `getPreferredAILanguage()` or `useTranslation()`
- **Hardcoding content limits** — derive from `ModelRegistry` context window
- **Adding `if (item.type === '...')` branches** inside feed renderer — update the registry map
- **Scattering `translateResourceType` logic** across components — it lives inside `ActivityCardFooter`
- **Passing full objects when primitives suffice** — `datasphereId: string` not `datasphere: Datasphere`
- **Auto-committing** — never `git commit` or `git push` without explicit user request after UAT
- **Pushing without UAT** — UAT is the mandatory final step; push ONLY after the user confirms UAT passed (see UAT Protocol above)
