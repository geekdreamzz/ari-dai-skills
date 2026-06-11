---
name: data-viz
description: Reusable, sanitizer-safe inline data visualizations for Dataspheres pages — stat cards, lifecycle/flow strips, layered architecture diagrams. Use whenever a page, blog post, or report needs a custom diagram or stat row that is NOT live data (for live charts use datasets + data cards; for process flows from data use Mermaid). Works for manual editing, ARI tool flows, and REST API publish scripts. Guarantees the diagram survives TipTap re-serialization and never clips.
argument-hint: "stat cards | lifecycle strip | architecture diagram | <describe the diagram>"
---

# Data-Viz Skill — Inline Diagrams That Survive

Custom, on-brand diagrams embedded directly in page content. This skill exists because the obvious approaches **silently break**, and the fix is non-obvious.

---

## The two rules you must never break

Page content is stored and re-serialized through **TipTap**. That imposes two hard constraints on any diagram:

1. **Never embed a raw `<svg>` in page content.** `<svg>` is not in TipTap's node schema. It survives the first save, then gets **stripped to run-on text** on the next re-serialization (an edit, an API round-trip, ARI touching the page). Only `<img>` survives. So every diagram must be an `<img>`, not an inline `<svg>`.

2. **Wrap the SVG as a `data:image/svg+xml` URI — but make it XML-clean.** An `<img src="data:image/svg+xml;...">` is parsed as **strict XML**, which breaks on two things:
   - **Named HTML entities** (`&middot;` `&mdash;` `&ndash;` `&rarr;` `&times;` …) are invalid in XML → the whole image fails to load (broken-image icon). Use literal Unicode (`·` `—` `–` `→` `×`) or numeric refs (`&#183;`). Only `&amp; &lt; &gt; &quot; &apos;` and `&#...;` are valid.
   - **`width="100%"` on the `<svg>` root** gives the `<img>` an indeterminate intrinsic size; the browser falls back to ~300px, **mis-maps the viewBox, and clips content** (cut-off bottom rows, missing right margin). The root must carry a **fixed `width`/`height` equal to the viewBox dims** plus `preserveAspectRatio="xMidYMid meet"`. The wrapping `<img>` then scales it responsively via `style="width:100%;max-width:Npx;height:auto"`.

**Do not hand-roll this.** Use the module below — it encodes both rules. If you must author a bespoke SVG, pass it through `toFigure()` and it is made safe for you.

---

## The component module — `svg-components.mjs`

A zero-dependency ES module that emits the correct `<figure><img …></figure>` markup. Import it from REST publish scripts and ARI flows.

```js
import { statCards, flowStrip, flowStack, toFigure, PALETTE, sanitizeSvg }
  from './svg-components.mjs'; // path: .claude/skills/data-viz/svg-components.mjs
```

Every generator returns a complete `<figure>…</figure>` HTML string — drop it straight into your page `content`.

### `statCards(cards, opts)` — a row of headline numbers
```js
statCards([
  { value: '24%',  lines: ['of developers merged AI code', 'without reviewing it'], source: 'Stack Overflow, 2025' },
  { value: '1.7×', lines: ['more bugs in AI-generated code', 'vs. human-written equivalents'], source: 'Code quality studies, 2026' },
  { value: '75%',  lines: ['more logic errors than', 'human-written code'], source: 'Code quality studies, 2026' },
], { caption: 'AI code-quality, 2025–2026.' })
```
`cards[]`: `{ value, lines?: string[] (max 2), source?: string }`. `opts`: `{ alt, caption, maxWidth }`.

### `flowStrip(steps, opts)` — horizontal pipeline / lifecycle
```js
flowStrip([
  { label: 'Research', badge: 'ORIGIN GATE', note: 'must be Done first', tone: 'gold' },
  { label: 'North Stars' }, { label: 'Epics' }, { label: 'Execution' }, { label: 'Validation' },
  { label: 'Artifacts', badge: 'MANDATORY', note: 'auto-created', tone: 'gold' },
  { label: 'Done', tone: 'green' },
], { caption: 'The lifecycle.' })
```
`steps[]`: `{ label, badge?, note?, tone?: 'gold'|'green'|'default' }`. Arrows and the dark container are drawn for you with even padding on both ends.

### `flowStack(nodes, opts)` — vertical architecture / data flow
```js
flowStack([
  { title: 'Claude Code', subtitle: 'AI agent reads SKILL.md, executes tasks', tone: 'gold' },
  { title: 'sdd-conductor CLI', subtitle: '10 gate invariants · evidence validation', tone: 'blue' },
  { title: 'Dataspheres AI Board', subtitle: 'Task state · comments · gate history' },
  { title: 'Browser Dashboard', subtitle: 'Trace graph · Activity feed · live', tone: 'green' },
], { caption: 'State lives on the platform, not the editor.' })
```
`nodes[]`: `{ title, subtitle?, tone?: 'gold'|'blue'|'green'|'default' }`. `opts`: `{ alt, caption, maxWidth, boxW }`.

### `toFigure(rawSvg, opts)` — bespoke diagrams
For anything the generators don't cover (loops, branches, diamonds), author a normal `<svg viewBox="0 0 W H">…</svg>` and pass it here. It converts entities, fixes the root tag, base64-encodes, and wraps it. `opts`: `{ alt, caption, maxWidth=880, rounded=false }`.

### `PALETTE` — brand colors
`ink #002244`, `gold #a67c00`, `bgDark #001428`, `green #2d8a4e`, `blue #4488ff`, `red #cc4444`. Use these so diagrams match the platform. Numbers/accents are gold; success/done is green; container backgrounds are `bgDark`.

---

## Three ways to use it

### 1. REST API publish script (recommended for blog posts / reports)
```js
import { statCards, flowStrip } from './.claude/skills/data-viz/svg-components.mjs';
const content = `
  <h1>Title</h1>
  <p>Lead paragraph …</p>
  ${statCards([...])}
  <h2>How it works</h2>
  ${flowStrip([...])}
`;
await fetch(`${BASE}/api/v1/dataspheres/${uri}/pages/${slug}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title, content, status: 'PUBLISHED', isPubliclyVisible: true }),
});
```
**Always render-validate before publishing** (see below).

### 2. ARI tool flow
When ARI composes page HTML with `create_page` / `update_page`, it should generate diagram markup with these generators (or the templates below) rather than inline `<svg>`. The rules are identical — `<img>` data-URI, numeric entities, fixed viewBox dims.

### 3. Manual editing (copy-paste)
If you are editing a page by hand and just need the markup, copy a template from [`templates.md`](templates.md) — they are pre-built, correct `<figure><img>` blocks you fill in.

---

## Validate before you publish (non-negotiable)

A broken data-URI fails silently — it stores fine and only shows a broken-image icon in the browser. Always check `naturalWidth > 0` in a real browser before publishing, and screenshot the live page after. Minimal check:

```js
// headless: every figure's <img> must decode
const ok = await page.evaluate(uri => new Promise(r => {
  const im = new Image(); im.onload = () => r(im.naturalWidth > 0); im.onerror = () => r(false); im.src = uri;
}), dataUri);
```
`sanitizeSvg()` already throws on XML-invalid entities at build time — let it. Reference implementation of a full validate-then-publish flow: `dataspheres-ai/specs/sdd-blog-post/republish-v3.mjs`.

---

## When NOT to use this skill

| Need | Use instead |
|------|-------------|
| Live chart backed by real data (updates over time) | **Datasets + data cards** (see `rich-content` skill) |
| Process/flow generated from data, or a quick pie/bar | **Mermaid** via the `diagramming` tool |
| A photo, screenshot, or generated illustration | `generate_media_image` → inline `<img>` |
| Custom static diagram, stat row, or on-brand schematic | **This skill** |

---

## Quality checklist

- [ ] Diagram is an `<img>` data-URI, never a raw inline `<svg>`
- [ ] No named HTML entities inside the SVG (literal Unicode or `&#...;` only)
- [ ] SVG root has fixed `width`/`height` = viewBox dims (no `width="100%"`)
- [ ] Colors come from `PALETTE` (gold accents, green for done, `bgDark` containers)
- [ ] Rendered + screenshot-verified on the live page (`naturalWidth > 0`, no clipping, no horizontal overflow)
- [ ] Every diagram has a `<figcaption>` and descriptive `alt`
