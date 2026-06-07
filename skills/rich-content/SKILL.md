---
name: rich-content
description: Skill for producing high-fidelity, interactive blog posts, research reports, and intelligent reports on the Dataspheres AI platform. Drives ARI and ari-dai-skills to use the full tool suite — web search, image generation, YouTube embeds, code blocks, Mermaid diagrams, datasets, live data cards, citations, and SEO metadata — to produce publication-ready interactive pages.
argument-hint: "blog post <topic> in <datasphere-uri> | research report <topic> | intelligent report <topic> | [--public]"
---

# Rich Content Skill — Interactive Pages

You are producing a high-fidelity, interactive page on the Dataspheres AI platform. This skill orchestrates the full tool suite to create content that is visually rich, data-driven, SEO-friendly, and far beyond a plain article.

---

## Temporal Accuracy — Non-Negotiable Rules

These rules apply to every piece of content, no exceptions.

### 1. Always know today's date
Check the environment for the current date before writing a single word. Every date reference, year label, and "current" claim must reflect that date. Never write "2025" if the year is 2026. Never write "recently" without anchoring it to a specific month and year.

### 2. Web search is mandatory — not optional
Every statistic, market figure, company claim, and trend assertion MUST be verified via `web_search` before it appears in the body. Do not synthesise data from training knowledge — models have a knowledge cutoff and that cutoff is in the past. Run the search, get the result, cite the source.

### 3. YouTube videos must be recent OR explicitly contextualised
- **Preferred:** search for videos published in the last 12 months. Scan `web_search` results for YouTube URLs. Use those video IDs.
- **If embedding an older foundational video** (e.g., a 2022 seminal talk): you MUST add a bracketed note in the caption: `[Published 2022 — cited here because it remains the definitive technical reference for X; the core mechanism has not changed]`. Never embed an old video silently as if it is current.
- Never use a video ID from memory or training data. Only embed videos whose URLs appeared in a `web_search` result during this session.

### 4. Cite sources with recency signals
When referencing a report, study, or article, always name it with its publication date in the text:
- Good: `According to Goldman Sachs' AI Infrastructure Outlook (March 2026)...`
- Bad: `According to analysts...`

If the best available source is older than 18 months:
- Acknowledge it explicitly: `This figure comes from Gartner's 2024 report — the most recent available. Updated 2026 data is not yet published, but the trend direction has accelerated since then based on [recent search result].`
- Do NOT silently present stale data as current fact.

### 5. Data in datasets must reflect current year
When generating rows for datasets, the `prompt` must instruct the AI to use the current year's figures. If data is estimated or projected, say so in the dataset description. Label columns with the year (e.g., `revenue_2026_usd_billions` not `revenue_usd_billions`).

---

## Content Types

Choose the type from the user's request or infer from the topic:

| Type | Best For | Signature Elements |
|------|----------|--------------------|
| **Blog Post** | Opinions, tutorials, how-tos, announcements | Hero image, strong narrative, 1–2 embeds, citations |
| **Research Report** | Data-heavy analysis, findings, comparisons | Dataset + data cards, Mermaid diagrams, tables, citation appendix |
| **Intelligent Report** | AI-synthesised multi-source intelligence | Web search citations, multiple data cards, YouTube embeds, dataset, callout boxes |

---

## Step-by-Step Workflow

Every rich content piece follows this exact order. Do not skip steps.

### Step 1 — Research & Gather (mandatory before writing anything)

**Check today's date first.** Every piece of content is anchored to the current date — not the model's training cutoff.

Run `web_search` with targeted queries covering:
- The core topic + current year (e.g. `"AI infrastructure investment 2026"`)
- Latest statistics or data points (`"2026 report" OR "Q1 2026" OR "latest figures"`)
- Expert quotes or contrasting perspectives from the last 6 months
- For Intelligent Reports: add `site:youtube.com <topic>` to find recent relevant videos

**Minimum queries:** Blog Post = 2–3 · Research Report = 4–5 · Intelligent Report = 5–6

Save every result. Track which URL each fact comes from. Every statistic in the body must trace back to a search result from this session — not from training memory.

**YouTube sourcing:** Only use a video ID that appeared in a search result URL from this session. If no recent video is found, do not embed one. If you embed an older foundational video found via search, add the age acknowledgement in the caption (see Temporal Accuracy rules above).

**If web search finds no data newer than 18 months old:** surface this to the user before writing. Do not silently present stale data as current.

### Step 2 — Generate Hero Image

Call `generate_media_image` with a vivid, art-directed prompt. Guidelines:
- **Blog Post**: editorial photography style, real scene, specific lighting
- **Research Report**: abstract data visualization, clean infographic aesthetic, no text
- **Intelligent Report**: cinematic, wide-aspect composite, futuristic or domain-specific

```
aspectRatio: "16:9"   ← always for hero
sampleCount: 1
```

Capture the returned `mediaUrl` — this becomes the `<figure>` hero at the top of the page.

### Step 3 — Build Datasets (Research & Intelligent Reports only)

If the topic has quantitative data (rankings, comparisons, time-series, survey results):

1. Call `create_dataset` with a clear schema matching the data
2. Call `generate_dataset_rows` with `count: 10–20` and a rich `prompt` describing the data to synthesise from the web search results
3. Capture the `datasetId` for Step 4

### Step 4 — Build Data Cards (Research & Intelligent Reports only)

For each dataset created, call `create_data_card` with a plain-English prompt describing EXACTLY what the chart should show. One card per insight:

```
"Show a horizontal bar chart of the top 10 companies by market share, sorted descending"
"Show a line chart of monthly active users over 12 months with a trend annotation"
"Show a donut chart of budget allocation across 5 categories"
```

Capture each `dataCardId`.

### Step 5 — Create Mermaid Diagrams (when applicable)

Use `diagramming` for:
- Process flows → `flowchart`
- Timelines / sequences → `gantt` or `sequence`
- Relationships / data models → `er`
- Simple pie / bar charts WITHOUT a dataset → `pie` or `xychart-beta`
- System architecture → `flowchart` with subgraphs

### Step 6 — Find YouTube Videos (Intelligent Reports)

From Step 1 search results, extract YouTube URLs (`youtube.com/watch?v=VIDEO_ID`). If none found, run an explicit `web_search` for `site:youtube.com <topic>` and extract from results.

Capture: `VIDEO_ID` (the `v=` parameter value).

### Step 7 — Compose the Page HTML

Assemble the full TipTap HTML. See **HTML Reference** below.

### Step 8 — Publish

Call `create_page` (blog/research) or `create_landing_page` (public-facing):

```
title: "<compelling SEO title — 50–60 chars>"
content: "<full TipTap HTML>"
metaDescription: "<150–160 char summary — includes primary keyword>"
folderName: "<semantic folder — call list_folders first>"
status: "PUBLISHED"
isPubliclyVisible: true   ← for public content
```

### Step 9 — Post to Feed (optional)

If the datasphere has an active community, call `create_post` with a 2–3 sentence teaser linking to the page.

---

## HTML Reference — Every Element

### Hero Section

Always the first element in the page body. Use the generated image URL from Step 2.

```html
<figure style="margin:0 0 2rem 0">
  <img src="MEDIA_URL" alt="DESCRIPTIVE_ALT_TEXT" style="width:100%;border-radius:12px;display:block" />
  <figcaption style="text-align:center;font-size:0.85rem;color:#888;margin-top:0.5rem">CAPTION — source or brief description</figcaption>
</figure>
```

### Lead Paragraph

Immediately after hero. Hook sentence + 2–3 sentences establishing scope.

```html
<p><strong>HOOK SENTENCE that states the core finding or premise.</strong> Follow-up context sentence. Third sentence that scopes what the reader will learn.</p>
```

### Heading Hierarchy

Page titles come from the `title` field — never put an `<h1>` inside content. Use only `<h2>` and `<h3>`.

```html
<h2>Section Title</h2>
<p>Section body...</p>

<h3>Subsection</h3>
<p>Subsection body...</p>
```

### Callout / Key Insight Box

Use `<blockquote>` for key insights, pull quotes, and data callouts.

```html
<blockquote><p><strong>Key Insight:</strong> One punchy sentence that stands alone. Keep under 25 words.</p></blockquote>
```

### Callout Box (styled)

For "What to know", "Warning", "Tip" boxes — use a styled div inside a blockquote:

```html
<blockquote><p>💡 <strong>What This Means:</strong> Plain-English implication of the data or finding above. Write for a non-technical reader.</p></blockquote>
```

### Tables

Always include a `<caption>` for SEO and accessibility.

```html
<table>
  <caption>TABLE DESCRIPTION — what it shows and source</caption>
  <thead>
    <tr><th>Column A</th><th>Column B</th><th>Column C</th></tr>
  </thead>
  <tbody>
    <tr><td>Value</td><td>Value</td><td>Value</td></tr>
  </tbody>
</table>
```

### Bullet / Numbered Lists

```html
<!-- Unordered -->
<ul>
  <li><p><strong>Term or label</strong> — explanation or value</p></li>
  <li><p><strong>Term or label</strong> — explanation or value</p></li>
</ul>

<!-- Ordered (steps, rankings) -->
<ol>
  <li><p>First step or ranked item — detail</p></li>
  <li><p>Second step or ranked item — detail</p></li>
</ol>
```

### Code Blocks

Inline code: `<code>functionName()</code>` inside a `<p>`.

Block code (with syntax highlighting):

```html
<pre><code class="language-javascript">// JavaScript example
const result = await fetch('/api/v2/search', {
  method: 'POST',
  body: JSON.stringify({ q: 'query', types: ['page'] }),
});
const data = await result.json();
</code></pre>
```

Supported language classes: `language-javascript`, `language-typescript`, `language-python`, `language-bash`, `language-sql`, `language-json`, `language-html`, `language-css`, `language-rust`, `language-go`.

### Inline Image (within body)

For supplementary images, not the hero:

```html
<figure style="margin:1.5rem 0">
  <img src="MEDIA_URL" alt="ALT TEXT" style="width:100%;border-radius:8px;display:block" />
  <figcaption style="text-align:center;font-size:0.85rem;color:#888;margin-top:0.5rem">Caption text</figcaption>
</figure>
```

### YouTube / Video Embed

Replace `VIDEO_ID` with the 11-character YouTube ID from Step 6.

```html
<figure data-embed-figure="true" data-node-id="embed-VIDEO_ID" data-alignment="center" data-size="full" class="embed-figure">
  <div class="embed-content" data-embed-html="%3Ciframe%20width%3D%22100%25%22%20height%3D%22400%22%20src%3D%22https%3A%2F%2Fwww.youtube-nocookie.com%2Fembed%2FVIDEO_ID%22%20frameborder%3D%220%22%20allow%3D%22accelerometer%3B%20autoplay%3B%20clipboard-write%3B%20encrypted-media%3B%20gyroscope%3B%20picture-in-picture%22%20allowfullscreen%3D%22true%22%3E%3C%2Fiframe%3E">
    <iframe width="100%" height="400" src="https://www.youtube-nocookie.com/embed/VIDEO_ID" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen="true"></iframe>
  </div>
  <figcaption class="embed-caption">VIDEO TITLE — brief context for why this video is relevant</figcaption>
</figure>
```

> **Note:** `data-embed-html` must be the URL-encoded version of the iframe HTML. The raw iframe inside `embed-content` is for fallback rendering. Use `youtube-nocookie.com` for privacy-respecting embeds.

For Twitter/X, Vimeo, CodePen: same pattern, replace the iframe src with the appropriate embed URL from the platform.

### Mermaid Diagram

Use the `diagramming` tool to generate the Mermaid source, then embed it:

```html
<div data-type="mermaid" data-code="ENCODED_MERMAID_CODE" class="mermaid-wrapper"><pre class="mermaid">MERMAID_CODE_RAW</pre></div>
```

- `data-code`: HTML-entity-encode the mermaid code (escape `>` → `&gt;`, `<` → `&lt;`, `"` → `&quot;`, `&` → `&amp;`)
- Inner `<pre class="mermaid">`: raw unencoded mermaid code

**Simple data charts via Mermaid (no dataset needed):**

```
Pie chart:
pie title Market Share 2025
    "Company A" : 42
    "Company B" : 31
    "Company C" : 27

Bar chart:
xychart-beta
    title "Monthly Revenue ($M)"
    x-axis [Jan, Feb, Mar, Apr, May, Jun]
    y-axis "Revenue" 0 --> 50
    bar [12, 18, 24, 31, 38, 45]
    line [12, 18, 24, 31, 38, 45]
```

### Live Data Card (from Dataset)

Requires `dataCardId` from Step 4. Get `datasphereId` from the create_dataset result.

```html
<div data-type="dataCard" data-datacard-id="DATACARD_ID" data-dataset-id="DATASET_ID" data-datasphere-id="DATASPHERE_ID">[Data Card: CARD_NAME]</div>
```

Add a heading above it explaining what the chart shows:

```html
<h3>Revenue Growth by Quarter</h3>
<p>The chart below shows quarterly revenue across the five largest segments, based on synthesised industry data.</p>
<div data-type="dataCard" data-datacard-id="DATACARD_ID" data-dataset-id="DATASET_ID" data-datasphere-id="DATASPHERE_ID">[Data Card: Revenue by Quarter]</div>
```

### Horizontal Rule (Section Break)

Use sparingly — only between major sections in long-form content:

```html
<hr />
```

### Doc Footer

Always the last element on publication-quality pages:

```html
<div data-type="doc-footer"></div>
```

---

## Full Page Skeleton — Blog Post

```html
<!-- HERO -->
<figure style="margin:0 0 2rem 0">
  <img src="HERO_IMAGE_URL" alt="DESCRIPTIVE ALT" style="width:100%;border-radius:12px;display:block" />
  <figcaption style="text-align:center;font-size:0.85rem;color:#888;margin-top:0.5rem">CAPTION</figcaption>
</figure>

<!-- LEAD -->
<p><strong>HOOK SENTENCE.</strong> Context sentence. Scope sentence.</p>

<!-- SECTION 1 -->
<h2>First Section Title</h2>
<p>Body paragraph...</p>
<blockquote><p><strong>Key Insight:</strong> Pull quote or data callout.</p></blockquote>
<p>Continuation...</p>

<!-- SECTION 2 -->
<h2>Second Section Title</h2>
<p>Body paragraph...</p>
<ul>
  <li><p><strong>Point one</strong> — detail</p></li>
  <li><p><strong>Point two</strong> — detail</p></li>
</ul>

<!-- EMBED (optional) -->
<h3>Watch: Related Video</h3>
<figure data-embed-figure="true" data-node-id="embed-VIDEO_ID" data-alignment="center" data-size="full" class="embed-figure">
  <div class="embed-content" data-embed-html="ENCODED_IFRAME_HTML">
    <iframe width="100%" height="400" src="https://www.youtube-nocookie.com/embed/VIDEO_ID" frameborder="0" allowfullscreen="true"></iframe>
  </div>
  <figcaption class="embed-caption">VIDEO TITLE</figcaption>
</figure>

<!-- CONCLUSION -->
<h2>Conclusion</h2>
<p>Summary of findings and call to action.</p>

<!-- FOOTER -->
<div data-type="doc-footer"></div>
```

---

## Full Page Skeleton — Research Report

```html
<!-- HERO -->
<figure style="margin:0 0 2rem 0">
  <img src="HERO_IMAGE_URL" alt="ALT TEXT" style="width:100%;border-radius:12px;display:block" />
  <figcaption style="text-align:center;font-size:0.85rem;color:#888;margin-top:0.5rem">Research commissioned by [Datasphere Name] · [Year]</figcaption>
</figure>

<!-- EXECUTIVE SUMMARY -->
<h2>Executive Summary</h2>
<p><strong>KEY FINDING in one sentence.</strong> Supporting context. Scope of the report.</p>
<ul>
  <li><p><strong>Finding 1</strong> — brief</p></li>
  <li><p><strong>Finding 2</strong> — brief</p></li>
  <li><p><strong>Finding 3</strong> — brief</p></li>
</ul>

<!-- DATA SECTION -->
<h2>Data Analysis</h2>
<p>Explanatory paragraph for the chart below.</p>
<div data-type="dataCard" data-datacard-id="DC_ID_1" data-dataset-id="DS_ID" data-datasphere-id="DSP_ID">[Data Card: Primary Chart]</div>

<h3>Breakdown by Segment</h3>
<p>Context for second chart.</p>
<div data-type="dataCard" data-datacard-id="DC_ID_2" data-dataset-id="DS_ID" data-datasphere-id="DSP_ID">[Data Card: Segment Breakdown]</div>

<!-- DIAGRAM SECTION -->
<h2>Process / Architecture</h2>
<p>Explanatory text before the diagram.</p>
<div data-type="mermaid" data-code="ENCODED" class="mermaid-wrapper"><pre class="mermaid">MERMAID_RAW</pre></div>

<!-- COMPARISON TABLE -->
<h2>Comparison</h2>
<table>
  <caption>Comparison of KEY DIMENSION across ENTITIES — Source: [web search source]</caption>
  <thead><tr><th>Entity</th><th>Metric A</th><th>Metric B</th><th>Notes</th></tr></thead>
  <tbody>
    <tr><td>Row 1</td><td>Value</td><td>Value</td><td>Note</td></tr>
  </tbody>
</table>

<!-- CONCLUSION -->
<h2>Conclusions &amp; Recommendations</h2>
<p>Summary paragraph.</p>
<ol>
  <li><p><strong>Recommendation 1</strong> — rationale</p></li>
  <li><p><strong>Recommendation 2</strong> — rationale</p></li>
</ol>

<!-- FOOTER -->
<div data-type="doc-footer"></div>
```

---

## Full Page Skeleton — Intelligent Report

```html
<!-- HERO -->
<figure style="margin:0 0 2rem 0">
  <img src="HERO_IMAGE_URL" alt="ALT TEXT" style="width:100%;border-radius:12px;display:block" />
  <figcaption style="text-align:center;font-size:0.85rem;color:#888;margin-top:0.5rem">Intelligence Report · Updated [Date]</figcaption>
</figure>

<!-- SITUATION OVERVIEW -->
<h2>Situation Overview</h2>
<p><strong>HEADLINE FINDING.</strong> Paragraph establishing why this topic matters right now.</p>
<blockquote><p><strong>Signal:</strong> Key data point or quote from web search results.</p></blockquote>

<!-- PRIMARY DATA CARD -->
<h2>Key Metrics</h2>
<p>What the data shows and how it was compiled.</p>
<div data-type="dataCard" data-datacard-id="DC_ID_1" data-dataset-id="DS_ID" data-datasphere-id="DSP_ID">[Data Card: Key Metrics Overview]</div>

<!-- VIDEO EVIDENCE -->
<h2>In Their Own Words</h2>
<p>Brief context for why this video is included.</p>
<figure data-embed-figure="true" data-node-id="embed-VIDEO_ID" data-alignment="center" data-size="full" class="embed-figure">
  <div class="embed-content" data-embed-html="ENCODED_IFRAME">
    <iframe width="100%" height="400" src="https://www.youtube-nocookie.com/embed/VIDEO_ID" frameborder="0" allowfullscreen="true"></iframe>
  </div>
  <figcaption class="embed-caption">VIDEO TITLE — context</figcaption>
</figure>

<!-- TREND DIAGRAM -->
<h2>Trend Analysis</h2>
<div data-type="mermaid" data-code="ENCODED" class="mermaid-wrapper"><pre class="mermaid">MERMAID_RAW</pre></div>

<!-- IMPLICATIONS -->
<h2>Implications &amp; Outlook</h2>
<p>Forward-looking analysis.</p>
<ul>
  <li><p><strong>Short-term (0–6 months)</strong> — prediction</p></li>
  <li><p><strong>Medium-term (6–18 months)</strong> — prediction</p></li>
  <li><p><strong>Long-term (18+ months)</strong> — prediction</p></li>
</ul>

<!-- APPENDIX DATA CARD -->
<h2>Supporting Data</h2>
<div data-type="dataCard" data-datacard-id="DC_ID_2" data-dataset-id="DS_ID" data-datasphere-id="DSP_ID">[Data Card: Supporting Breakdown]</div>

<!-- FOOTER -->
<div data-type="doc-footer"></div>
```

---

## SEO Guidelines

Apply to every piece of content regardless of type.

### Title (passed to `create_page`)
- 50–60 characters
- Lead with primary keyword
- Use power words: "Complete Guide", "Analysis", "Report", "[Year]", "How", "Why"
- Never keyword-stuff — write for humans first

### Meta Description (`metaDescription` field)
- 150–160 characters exactly
- Include primary keyword in first 20 words
- End with a subtle call to action: "Learn more.", "Read the full report.", "Explore the data."

### Heading Structure
- `<h2>` — major sections (aim for 3–6 per page)
- `<h3>` — subsections within a major section
- Never skip levels — no `<h3>` without a parent `<h2>`
- Each `<h2>` should naturally contain the topic keyword or a close variant

### Image Alt Text
- Describe what's actually in the image (don't keyword-stuff)
- Include the topic naturally: "bar chart showing AI adoption rates by industry 2025"
- Never leave alt text empty

### Internal Linking
- When mentioning other pages/dataspheres in the body, link them: `<a href="/pages/URI/SLUG">anchor text</a>`
- Use descriptive anchor text — never "click here"

### Content Length Targets
- Blog Post: 800–1,500 words equivalent
- Research Report: 1,500–3,000 words + data
- Intelligent Report: 2,000–4,000 words + data + video

---

## YouTube Embed — URL Encoding Reference

When encoding the iframe HTML for `data-embed-html`, percent-encode these characters:

| Character | Encoded |
|-----------|---------|
| `<` | `%3C` |
| `>` | `%3E` |
| `"` | `%22` |
| ` ` (space) | `%20` |
| `=` | `%3D` |
| `/` | `%2F` |
| `:` | `%3A` |

Full encoded iframe for video ID `dQw4w9WgXcQ`:
```
%3Ciframe%20width%3D%22100%25%22%20height%3D%22400%22%20src%3D%22https%3A%2F%2Fwww.youtube-nocookie.com%2Fembed%2FdQw4w9WgXcQ%22%20frameborder%3D%220%22%20allow%3D%22accelerometer%3B%20autoplay%3B%20clipboard-write%3B%20encrypted-media%3B%20gyroscope%3B%20picture-in-picture%22%20allowfullscreen%3D%22true%22%3E%3C%2Fiframe%3E
```

---

## Simple SVG / Inline Charts (No Dataset)

For simple one-off charts that don't warrant a full dataset, use Mermaid instead:

```
Pie chart → pie title TITLE\n  "Label" : value
Bar chart → xychart-beta with bar/line
Timeline  → gantt
Process   → flowchart LR
```

If the user specifically needs a static SVG (for a logo, icon, or decorative element), embed it inline inside a `<figure>`:

```html
<figure style="margin:1.5rem auto;text-align:center">
  <svg width="400" height="200" viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
    <!-- SVG content here -->
  </svg>
  <figcaption style="font-size:0.85rem;color:#888;margin-top:0.5rem">Caption</figcaption>
</figure>
```

> **Note:** There is no dedicated SVG chart API endpoint. Use Mermaid via the `diagramming` tool for all data-driven inline charts. Use datasets + data cards for interactive, live charts with real data.

---

## Quality Checklist

Before calling `create_page`, verify every item:

**Temporal accuracy (check these first)**
- [ ] Today's date was confirmed before writing — all year references match it
- [ ] Every statistic has a named source with publication date in the body text
- [ ] No data point came from training memory — every fact traces to a `web_search` result from this session
- [ ] Any YouTube embed either (a) came from a search result URL in this session, or (b) has an explicit age acknowledgement in the caption
- [ ] If any source is older than 18 months, the staleness is acknowledged and explained in the text
- [ ] Dataset column names include the year (e.g. `revenue_2026_usd_billions`)

**Content structure**
- [ ] Hero image generated and URL captured
- [ ] Minimum `web_search` calls completed for content type (2–3 / 4–5 / 5–6)
- [ ] Title is 50–60 chars and leads with keyword and current year where relevant
- [ ] `metaDescription` is 150–160 chars and includes keyword
- [ ] No `<h1>` in content (title comes from the `title` field)
- [ ] All `<h3>` tags are nested under a `<h2>` parent
- [ ] Every data card has a heading + explanatory paragraph above it
- [ ] Mermaid `data-code` attribute is HTML-entity-encoded
- [ ] YouTube `data-embed-html` attribute is URL-percent-encoded
- [ ] `<div data-type="doc-footer"></div>` is the last element
- [ ] Image alt texts are descriptive and include topic keyword naturally
- [ ] `isPubliclyVisible: true` set for public content, `false` for members-only
- [ ] `folderName` resolved by calling `list_folders` first

---

## Tool Chain Summary

```
web_search (2–5 queries)
    ↓
generate_media_image (hero image)
    ↓
create_dataset + generate_dataset_rows   ← Research / Intelligent only
    ↓
create_data_card (one per insight)       ← Research / Intelligent only
    ↓
diagramming (Mermaid)                    ← when process/flow needed
    ↓
[extract YouTube IDs from search results] ← Intelligent only
    ↓
create_page / create_landing_page
    ↓
create_post (feed teaser)                ← optional
```

The output is a publication-quality, SEO-optimised, interactive page that a human editor would be proud to publish.
