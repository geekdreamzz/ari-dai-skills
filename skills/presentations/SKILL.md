---
name: presentations
description: Author and edit presentation decks in Dataspheres AI via REST + ARI tools — whole-deck get/set plus granular slide and per-slide component CRUD for every component type. Always test locally first.
argument-hint: "[action] [options]"
---

# presentations — Decks (slides of ExperienceSpec)

A "presentation" is a **Page** with `pageType = PRESENTATION` whose `content` is a
**JSON array of slides**: `SlideWithNotes[] = [{ spec: ExperienceSpec, speakerNotes }, ...]`.
Each deck **slide** is its own ExperienceSpec — by convention a single `konva-canvas`
chapter+step holding that slide's canvas elements / overlays / effects. The whole
deck and every node in it can be read and mutated through the v1 REST API and the
matching ARI registry tools. Every write is **validated server-side** (a malformed
deck is rejected `400` and nothing is stored).

> Note: this is the standalone-presentation format the editor saves
> (`PageEditorPage` writes `content = JSON.stringify(slides)`). It is NOT the
> `experienceBlock`-in-TipTap format used for decks embedded inside regular pages.

## Data model

```
content = [ { spec: ExperienceSpec, speakerNotes }, ... ]   ← the deck (array of slides)
  slide.spec.chapters[0].steps[0]
    .visualState.canvasElements[]   ← components (10 types)
    .overlays[]                     ← overlays (9 types)
    .effects[]                      ← step effects (3 types)
```

- **Slide id** = `slide.spec.id`. Get it from the deck outline.
- **Canvas element types (10):** `text` `rect` `ellipse` `line` `arrow` `image` `chart` `video` `table` `embed`
- **Overlay types (9):** `frame` `callout` `tooltip` `title-card` `interstitial` `confetti` `floating` `ribbon` `border`
- **Effect types (3):** `css-patch` `append` `companion`

## Auth + base

`unifiedAuth` — a `dsk_` API key works everywhere (`Authorization: Bearer $DAI_API_KEY`).
Reads require **MODERATOR**; writes require **MODERATOR+** and the `ingest:pages` scope.
Paths use the datasphere **URI** and the page **id** (CUID, from the list call).

## Create a presentation page

A deck is a page whose `content` is a JSON array of slides. Seed it with one slide,
then build it up with the granular tools.

```bash
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/$URI/pages" -H "Authorization: Bearer $DAI_API_KEY" \
  -H "Content-Type: application/json" -d '{
    "title":"Q2 Roadmap","slug":"q2-roadmap","pageType":"PRESENTATION","status":"DRAFT","isPubliclyVisible":false,
    "content":"[{\"spec\":{\"id\":\"exp-slide-1\",\"title\":\"Slide 1\",\"theme\":\"default\",\"navigation\":{\"defaultMode\":\"slide\",\"allowedModes\":[\"slide\"]},\"chapters\":[{\"id\":\"ch1\",\"title\":\"Slide 1\",\"layout\":\"full-bleed\",\"weight\":\"light\",\"stage\":\"konva-canvas\",\"canvasConfig\":{\"canvasWidth\":1280,\"canvasHeight\":720,\"gridSize\":32,\"showGrid\":true,\"snapToGrid\":true,\"backgroundColor\":\"#0f172a\"},\"steps\":[{\"id\":\"st1\",\"copy\":{},\"enter\":[],\"exit\":[],\"overlays\":[],\"visualState\":{\"backgroundColor\":\"#0f172a\",\"canvasElements\":[],\"canvasConfig\":{\"canvasWidth\":1280,\"canvasHeight\":720,\"gridSize\":32,\"showGrid\":true,\"snapToGrid\":true,\"backgroundColor\":\"#0f172a\"}}}]}]},\"speakerNotes\":\"\"}]"
  }'
```

## REST API — whole-deck

| Tool | Method | Endpoint |
|------|--------|----------|
| `list_presentations` | GET | `/api/v1/dataspheres/:uri/presentations` (each row has `slideCount`) |
| `get_presentation_deck` | GET | `/api/v1/dataspheres/:uri/presentations/:pageId` |
| (outline) | GET | `/api/v1/dataspheres/:uri/presentations/:pageId/outline` |
| `set_presentation_deck` | PUT | `/api/v1/dataspheres/:uri/presentations/:pageId` (body `{slides:[...]}`) |
| `update_presentation_settings_full` | PUT | `/api/v1/dataspheres/:uri/presentations/:pageId/settings` |

`GET /:pageId` returns `{ slides, outline, _edit_url, _url }`. The **outline** gives
slide ids + per-slide component counts — get it before granular edits.

```bash
curl -s "$DAI_BASE/api/v1/dataspheres/$URI/presentations/$PID" -H "Authorization: Bearer $DAI_API_KEY" | jq '.outline'
# Settings + publishing + access
curl -s -X PUT "$DAI_BASE/api/v1/dataspheres/$URI/presentations/$PID/settings" -H "Authorization: Bearer $DAI_API_KEY" \
  -H "Content-Type: application/json" -d '{"title":"Renamed","status":"PUBLISHED","isPubliclyVisible":true,"minRole":"PARTICIPANT"}'
```

## REST API — slides

| Tool | Method | Endpoint |
|------|--------|----------|
| `add_presentation_slide` | POST | `/presentations/:pageId/slides` (body `{title?,speakerNotes?,index?}`) |
| `update_presentation_slide` | PUT | `/presentations/:pageId/slides/:slideId` (`{title?,speakerNotes?,backgroundColor?,theme?}`) |
| `delete_presentation_slide` | DELETE | `/presentations/:pageId/slides/:slideId` |
| `reorder_presentation_slides` | PUT | `/presentations/:pageId/slides/reorder` (`{orderedIds:[...]}`) |
| `set_presentation_slide_copy` | PUT | `/presentations/:pageId/slides/:slideId/copy` (`{copy:{headline,body,footnotes}}`) |

## REST API — components (every type, per slide)

| Tool | Method | Endpoint |
|------|--------|----------|
| `add_presentation_element` | POST | `/.../slides/:slideId/elements` |
| `update_presentation_element` | PUT | `/.../slides/:slideId/elements/:elementId` |
| `delete_presentation_element` | DELETE | `/.../slides/:slideId/elements/:elementId` |
| `add_presentation_overlay` | POST | `/.../slides/:slideId/overlays` |
| `update_presentation_overlay` | PUT | `/.../slides/:slideId/overlays/:overlayId` |
| `delete_presentation_overlay` | DELETE | `/.../slides/:slideId/overlays/:overlayId` |
| `add_presentation_effect` | POST | `/.../slides/:slideId/effects` |
| `delete_presentation_effect` | DELETE | `/.../slides/:slideId/effects/:index` |

Components take a **`type` + overrides** (factory defaults applied) OR a full object:

```bash
# Add a chart to a slide (defaults applied, override via props)
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/$URI/presentations/$PID/slides/$SID/elements" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" -d '{
    "elementType":"chart","x":80,"y":80,
    "props":{"chartType":"bar","title":"Revenue","data":[{"name":"Q1","value":40},{"name":"Q2","value":72}]}
  }'

# Add a confetti overlay to a slide
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/$URI/presentations/$PID/slides/$SID/overlays" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"overlayType":"confetti","config":{"count":60,"colors":["#a67c00","#002244"]}}'

# Add a css-patch effect to a slide
curl -s -X POST "$DAI_BASE/api/v1/dataspheres/$URI/presentations/$PID/slides/$SID/effects" \
  -H "Authorization: Bearer $DAI_API_KEY" -H "Content-Type: application/json" \
  -d '{"effectType":"css-patch","selector":".experience-stage","styles":{"filter":"saturate(1.3)"}}'
```

Notable props: `text` (text/fontSize/fill/align), `image` (src/alt/objectFit),
`chart` (chartType/data/colors), `table` (rows/cols/cells), `video` (src/controls/loop),
`embed` (src/sandbox). Overlay `config`: `confetti` (count/colors/gravity), `floating`
(shape/emoji/count/direction), `ribbon` (color/position), `border` (style/color/animated).

## ARI tools

Every endpoint above is also an ARI registry tool (resource `presentations`), so ARI
can author a deck conversationally: `get_presentation_deck` then `add_presentation_slide`
then `add_presentation_element` / `add_presentation_overlay` / `add_presentation_effect`,
then `update_presentation_settings_full` to publish. The three legacy tools
(`list_presentations`, `create_presentation`, `update_presentation_settings`) still exist
for listing + blob-create + metadata patch.

## Rules

- **Test locally first** (`$DAI_BASE=http://localhost:3000`) before prod.
- **Get ids from the outline** (`GET /:pageId` then `.outline`) before granular edits — slide/element ids are server-generated.
- **Writes are validated** — an unknown component type or malformed deck returns `400`; the deck is untouched.
- **A slide's canvas needs the `konva-canvas` stage** (the default for new slides). Component ops target the slide's primary chapter+step automatically.
- Integration harness: `node specs/presentation-api-coverage/api-integration-test.mjs`. Per-component screenshots: `npx playwright test specs/presentation-component-coverage.spec.ts --project=chromium`.
