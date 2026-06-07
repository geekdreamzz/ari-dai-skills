---
name: faceless
description: Manage Faceless AI marketing dataspheres - seed content, create completions, manage newsletters, surveys, and datasets across all public-facing dataspheres. Use when the user wants to create content, seed a datasphere, manage marketing DSes, or work on any Faceless AI datasphere.
argument-hint: "seed <ds-uri> | list | create <topic> | content <ds-uri> | status"
---

# Faceless AI - Marketing Datasphere Manager

You manage the Faceless AI persona's network of public dataspheres. These are marketing assets for DATASPHERES AI - each one demonstrates platform capabilities while attracting organic traffic through SEO.

## API Access

- **API Key**: stored in memory (`reference_faceless_ai_key.md`) - do NOT hardcode here
- **Base URL**: `https://dataspheres.ai`
- **Auth**: `Authorization: Bearer {key from memory}`
- **API Docs**: follows the same v1 REST patterns as `/dataspheres-api` skill

## Encoding Rules

- Never use em dashes, curly quotes, or special Unicode in curl/JSON payloads
- Always build JSON via Node.js (`JSON.stringify` + temp file + `curl -d @file`) on Windows
- Use plain hyphens, straight quotes, and ASCII only in titles

## Datasphere Network

| URI | Name | Purpose | Key Features to Showcase |
|-----|------|---------|------------------------|
| `faceless-ai` | Faceless AI | Meta DS - the persona itself, build in public | Everything |
| `ai-news` | AI News | AI products, benchmarks, LLMs | Datasets, datacards, newsletters |
| `society` | SOCIETY & POLITICS | Current events, politics | Surveys, polls, newsletters |
| `epstein-files` | Epstein Files | Document analysis showcase | Doc analysis, knowledge bank |
| `wtf-america` | WTF America | Political commentary | Completions, polls |
| `ai-research` | AI Research | Technical AI research | Completions, datasets |
| `ai-safety` | AI Safety | AI safety and alignment | Completions, surveys |
| `ai-intelligence` | Artificial Intelligence | General AI coverage | Completions, newsletters |
| `sports-intelligence` | Sports Intelligence | Sports analytics | Datasets, datacards |
| `financial-independence` | Financial Independence | Personal finance | Completions, newsletters |
| `crypto-investing` | Crypto Investing | Crypto markets | Datasets, datacards |
| `entrepreneurs` | ENTREPRENEURS | Business/startup content | Completions, surveys |
| `marketing-growth` | Marketing | Marketing strategies | Completions, newsletters |
| `micro-saas` | Micro SaaS | SaaS business building | Completions, datasets |
| `solopreneur` | Solopreneur | Solo business content | Completions, planner |
| `creator-economy` | Creator Economy | Content creator tips | Completions, newsletters |
| `build-in-public` | Build in Public | Transparent building | Completions, datasets |
| `open-source` | Open Source | OSS projects and news | Completions, datasets |
| `veterans-support-resources-hub` | Veterans Support | Veteran resources | Pages, surveys |
| `creative-minds` | CREATIVE MINDS | Art and creativity | Completions, media |
| `film-cinema` | Film & Cinema | Film analysis | Completions, surveys |
| `photography` | Photography | Photography tips | Completions, media |
| `prompt-engineering` | Prompt Engineering | AI prompt craft | Completions, datasets |
| `data-science` | Data Science | Data science content | Completions, datasets |
| `cloud-computing` | Cloud Computing | Cloud tech | Completions, datasets |

## Workflows

### `/faceless list`

List all Faceless AI dataspheres with their status and recent activity.

```bash
curl -s -H "Authorization: Bearer {API_KEY}" \
  "https://dataspheres.ai/api/v1/dataspheres?limit=50"
```

Display as a table: URI, name, status, page count.

### `/faceless seed <ds-uri>`

Seed a datasphere with fresh content. Steps:

1. Identify the DS topic and what features it should showcase
2. Web search for current/trending content related to the topic
3. Create 2-3 completions (AI-generated pages) via the completions API
4. Content should be timely, well-researched, and demonstrate platform features

**Creating a completion:**
```
POST /api/v2/dataspheres/{dsId}/completions
Body: { prompt, tools: ["web_search"], ... }
```

Note: Completions are now auto-published (status: PUBLISHED) so they immediately appear in the sitemap and Google search.

### `/faceless create <topic>`

Create a new datasphere for a topic:

```
POST /api/v1/dataspheres
Body: { name, uri, description, purpose (HTML), status: "PUBLIC", topicTags: [...] }
```

Follow the rich content format from the `/dataspheres-api` skill for the `purpose` field.

### `/faceless content <ds-uri>`

List recent content in a specific datasphere:

```bash
curl -s -H "Authorization: Bearer {API_KEY}" \
  "https://dataspheres.ai/api/v1/dataspheres/{uri}/pages?limit=20"
```

### `/faceless status`

Overview of the entire network - which DSes have recent content, which are stale, which need attention.

## Content Strategy

Each datasphere should:
- Have at least 3-5 published pages (completions) for SEO density
- Cover trending/timely topics in its niche (drives organic search traffic)
- Showcase different platform features (surveys in political DSes, datasets in data DSes, etc.)
- Link to other Faceless AI dataspheres where relevant (cross-pollination)
- Use the Faceless AI persona voice: knowledgeable, slightly mysterious, data-driven

## Priority Dataspheres (from OPS board)

These are the ones that matter most for marketing right now:
1. **Trump Tracker** (needs to be created as `trump-tracker` or use existing `society`/`wtf-america`)
2. **Epstein Files** - already exists, needs fresh content
3. **Faceless AI** - the meta DS, build-in-public content
4. **AI Tracker** - use `ai-news` or `ai-intelligence`

## What NOT to Do

- Never publish low-quality or thin content - every page should be substantive
- Never create dataspheres without a clear audience and showcase purpose
- Never use the Faceless AI key for non-marketing tasks (use bo@ key for ops/personal)
- Never expose internal business details in public datasphere content
