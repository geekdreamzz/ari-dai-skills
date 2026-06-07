---
name: seo
description: SEO audit and optimization skill for Dataspheres AI. Crawls prod as Googlebot, checks meta tags, SSR/dynamic titles, og:image, robots.txt, sitemap, structured data, and page speed signals. Use when the user asks to check SEO, fix crawlability, or optimize for search engines.
argument-hint: "audit|fix|both"
---

Run a full SEO audit ($ARGUMENTS) against https://dataspheres.ai. Cover all sections below, then produce a prioritized fix list.

---

## 1. Crawlability

```bash
# robots.txt
curl -s "https://dataspheres.ai/robots.txt"

# sitemap — must be accessible to crawlers (NOT blocked by robots.txt Disallow)
curl -sL "https://dataspheres.ai/sitemap.xml" | head -c 2000
curl -sL "https://dataspheres.ai/api/sitemap.xml" | head -c 2000

# Check if sitemap URL is blocked by robots.txt
# KNOWN ISSUE: robots.txt has `Disallow: /api/` but sitemap is at /api/sitemap.xml — MUST FIX
```

**Known issue**: `robots.txt` disallows `/api/` which blocks `sitemap.xml`. Fix: move sitemap to `/sitemap.xml` (non-api path) OR add `Allow: /api/sitemap.xml` above the `Disallow: /api/` rule.

---

## 2. SSR / Dynamic Meta Tags

The app is a React SPA. The Express server (`src/server/index.ts`) handles SSR meta tag injection for known public routes.

```bash
# Homepage
curl -s -A "Googlebot/2.1 (+http://www.google.com/bot.html)" "https://dataspheres.ai/" \
  | grep -E "<title>|og:title|og:description|og:image|description"

# Public datasphere page — title MUST be dynamic (e.g. "Sports Intelligence - DATASPHERES AI")
curl -s -A "Googlebot/2.1" "https://dataspheres.ai/ds/sports-intelligence" \
  | grep -o "<title>[^<]*</title>"

# Public post page
curl -s -A "Googlebot/2.1" "https://dataspheres.ai/ds/dataspheres-ai" \
  | grep -o "<title>[^<]*</title>"
```

**Known issue**: ALL pages currently return the same generic title/description — the SSR injection in `src/server/index.ts` is not populating dynamic titles for `/ds/*` routes. Googlebot sees no unique content per page.

**Fix location**: `src/server/index.ts` — the `getSsrMeta()` function (or equivalent) needs to:
1. Match `/ds/:uri` → query DB for datasphere name/description/image → inject as `og:title`, `og:description`, `og:image`, `<title>`
2. Match `/ds/:uri/post/:postId` → inject post title + preview

---

## 3. Open Graph & Twitter Cards

```bash
curl -s -A "Googlebot/2.1" "https://dataspheres.ai/" | grep -E "og:|twitter:"

# Verify og:image URL actually resolves
OG_IMAGE=$(curl -s "https://dataspheres.ai/" | grep -o 'og:image" content="[^"]*"' | cut -d'"' -f3)
echo "og:image: $OG_IMAGE"
curl -s -o /dev/null -w "%{http_code}" "$OG_IMAGE"
```

**Check**: og:image path consistency — homepage uses `/images/og-image.png` but SSR pages use `/og-image.png` (missing `/images/` prefix — broken).

---

## 4. Sitemap Content

```bash
curl -sL "https://dataspheres.ai/api/sitemap.xml"
```

Check:
- Contains public datasphere URLs (`/ds/*`)
- Contains public post URLs
- `lastmod` dates are present
- No private dataspheres included
- Total URL count is reasonable

---

## 5. Structured Data (JSON-LD)

```bash
curl -s -A "Googlebot/2.1" "https://dataspheres.ai/" | grep -A 20 'application/ld+json'
```

Check for: Organization schema, WebSite schema with SearchAction, BreadcrumbList on inner pages.

---

## 6. Technical SEO Signals

```bash
# Canonical tag
curl -s "https://dataspheres.ai/" | grep "canonical"

# HTTPS redirect (http → https)
curl -s -o /dev/null -w "%{http_code}" "http://dataspheres.ai/"

# Compression
curl -sv --compressed "https://dataspheres.ai/" 2>&1 | grep -i "content-encoding"

# Response time
curl -s -o /dev/null -w "TTFB: %{time_starttransfer}s Total: %{time_total}s\n" "https://dataspheres.ai/"
```

---

## 7. Report Format

Produce a prioritized table:

| Priority | Issue | Impact | Fix |
|---|---|---|---|
| P0 | robots.txt blocks sitemap | Sitemap invisible to Google | ... |
| P0 | All pages same title/description | No page indexing | ... |
| P1 | og:image path inconsistency | Broken social previews | ... |
| P2 | No structured data | Missed rich results | ... |

Then list specific file + line changes needed for each P0/P1 fix.
