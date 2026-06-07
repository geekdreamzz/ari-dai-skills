---
name: roi
description: ROI research and roadmap skill for Dataspheres AI. Reads the current ROI doc, does deep market research on candidate features, produces a ranked priority analysis, and writes the result back to Docusaurus. Use when the user asks to review, update, or research the product roadmap or feature priorities.
argument-hint: "research | update | show"
---

# ROI Roadmap Skill

You help the user research, prioritize, and document feature ROI for DATASPHERES AI.

## ROI Document Location

The canonical ROI document lives in Docusaurus — NOT the app:

```
/Users/bunnarithbao/ship/dataspheres-ai/docusaurus/docs/business/roi-analysis.md
```

**Never push ROI content to `/api/v1/dataspheres/.../pages`.** Always write directly to the Docusaurus file above.

The Docusaurus local preview runs at: `http://localhost:3001` (or whichever port Docusaurus uses — check with `npm run start` in the `docusaurus/` dir if needed).

---

## Workflows

### `/roi research`

Do a full market research pass on all candidate feature areas, then rewrite `roi-analysis.md` with fresh findings.

**Steps:**

1. **Read current ROI doc**
   ```
   Read: /Users/bunnarithbao/ship/dataspheres-ai/docusaurus/docs/business/roi-analysis.md
   ```

2. **Read current platform state** — understand what's already built:
   - Glob `src/client/pages/*.tsx` to see all pages
   - Grep for key feature indicators: `sequencer`, `experience`, `dataset`, `survey`, `newsletter`, `interview`

3. **Web research** — search for live market signals on each candidate:
   - Audio Overviews / NotebookLM: `"NotebookLM statistics 2025"`, `"audio overview AI market"`
   - AI Focus Groups: `"synthetic user research AI funding 2025"`, `"Aaru AI focus group"`
   - Dataset AI Analysis: `"Airtable AI 2025"`, `"data analytics market size 2026"`
   - Presentation Engine: `"Gamma app ARR 2025"`, `"Canva revenue 2025"`
   - Comic/Storyboard: `"AI comic generator market 2025"`, `"GeneraToon funding"`
   - Crypto: `"token gated community 2025"`, `"NFT loyalty program stats"`
   - Sequencer: `"AI workflow automation market 2025"`, `"Zapier revenue 2025"`

4. **Rewrite the doc** — update `roi-analysis.md` with:
   - Current date in frontmatter
   - Updated "What Has Shipped" table (check actual codebase)
   - Fresh priority rankings with market evidence
   - Recommended next sprint
   - Updated financial projections

5. **Output** — tell the user:
   > "ROI doc updated at `docusaurus/docs/business/roi-analysis.md`. View it in Docusaurus."

---

### `/roi update`

Update the ROI doc without a full research pass — use for quick edits like marking features as shipped, adjusting priorities, or adding a new candidate.

**Steps:**

1. Read current doc
2. Apply the user's requested changes
3. Update the `Last Updated` date at the top
4. Write back to `docusaurus/docs/business/roi-analysis.md`

---

### `/roi show`

Display the current priority rankings from the ROI doc as a formatted summary in the chat.

**Steps:**

1. Read `docusaurus/docs/business/roi-analysis.md`
2. Extract and display:
   - The priority table
   - The recommended next sprint
   - Financial projections
3. Note how long ago it was last updated

---

## Document Format Rules

The ROI doc is standard Markdown with Docusaurus-flavored admonitions. Follow these rules:

- **Tables**: use standard markdown pipe tables — Docusaurus renders them correctly
- **Admonitions**: use `:::info`, `:::warning`, `:::tip` for callout blocks
- **Emojis**: allowed in headings and table cells
- **No raw HTML tables**: use markdown pipe syntax, not `<table>` tags
- **Priority icons**: 🥇 CRITICAL | 🥈 HIGH | 🥉 STRATEGIC | 📊 MEDIUM | 🔑 LONG-TERM MOAT

### Markdown table example (correct format)
```markdown
| Rank | Feature | Build Complexity | Est. MRR | ROI Score | Priority |
|------|---------|-----------------|----------|-----------|----------|
| 1 | **Audio Overviews** | Low | $6K–15K | 9.8 | 🥇 CRITICAL |
```

---

## Key Research Sources

When researching, these sources have been reliable for this domain:

| Category | Good search terms |
|----------|------------------|
| Audio/Podcast AI | NotebookLM statistics, ElevenLabs market, audio overview PMF |
| Synthetic Research | Aaru funding, synthetic focus group market, CulturePulse |
| Data Analytics | Airtable Superagent, Notion AI ARR, analytics market CAGR |
| Presentation | Gamma ARR, Canva revenue, Beautiful.ai funding |
| Comic/Story | AI comic generator market Technavio, GeneraToon, character consistency LoRA |
| Crypto/Web3 | token gating stats, NFT loyalty ROI, Privy Dynamic wallet adoption |
| Automation | Zapier revenue, n8n growth, Make.com ARR, workflow automation market |

---

## What NOT to Do

- ❌ Never push ROI content to the Dataspheres app pages API (`/api/v1/dataspheres/...`)
- ❌ Never rewrite the entire doc from scratch if the user just wants a quick update — use `/roi update` for targeted edits
- ❌ Never fabricate market numbers — only cite figures from web research with source context
- ❌ Never mark a feature as "planned" if it's already live in `src/client/pages/`
- ❌ Don't use `<table>` HTML in the Docusaurus markdown file — use pipe table syntax

---

## Platform Context (Snapshot — update when major features ship)

Features confirmed LIVE as of March 2026:
- Image Generation (Imagen 3) ✅
- Video Generation (Veo 3) ✅
- Live AI Interviews (ElevenLabs) ✅
- Newsletter Automation ✅
- Surveys ✅
- Datasets (18 column types) ✅
- Experience / Presentation Engine (40+ files) ✅
- Sequencer Workflow Automation ✅
- Mermaid Diagrams ✅
- Repost / Activity Feed ✅
- Engagement Algorithm ✅
- Media Library (11 types) ✅
- Document Analysis ✅
- Web Search ✅

Features NOT yet built:
- Audio Overviews (NotebookLM-style)
- AI Focus Groups / Multi-persona research
- Dataset AI Analysis layer
- Presentation "Generate from datasphere" one-click flow
- AI Comic / Storyboard Creator
- Token gating / Wallet sign-in
- Premier Portfolios (Creator Economy monetization)
