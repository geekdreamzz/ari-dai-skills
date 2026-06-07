# Breadcrumb Navigation — Maintenance Guide

## Architecture Overview

Breadcrumbs are rendered by a single component:
**`src/client/components/AppBreadcrumb.tsx`**

It is mounted inside `Header.tsx` which is inside `Layout.tsx` (the authenticated shell). No context, no hook — it's a pure component driven by `useLocation()` and `useParams()`.

```
Layout.tsx
  └── Header.tsx
        └── AppBreadcrumb (datasphere, userRole, profileDatasphere)
```

---

## Segment Model

Each breadcrumb item is a `BreadcrumbSegment`:

```ts
interface BreadcrumbSegment {
  label: string;          // Display text (truncate long titles with truncate())
  path?: string;          // Route for "Go to" link — always the canonical URL
  icon?: React.ReactNode; // Small Lucide icon or avatar img
  activeColor?: string;   // Tailwind bg class when this is the LAST segment (current page)
  actions?: ActionItem[]; // Dropdown menu items
}
```

**`isLast` is computed by position** in the `breadcrumbSegments` array — the final item is the current page, styled filled/gold.

---

## How Segments Are Built (the useMemo block)

The `useMemo` builds segments in order:

```
1. Dashboard   (always first, skipped for document-with-post pages)
2. Datasphere  (when uri + datasphere are present)
3. Feature     (when on a feature sub-page: agents, docs, surveys, etc.)
4. Sub-item    (when on a specific item: completionId, postId, sessionId, etc.)
5. Profile     (special case: /app/profile/:id)
```

### Route params extracted (line ~201):
```ts
const { uri, postId, slug, sessionId, documentId, completionId } = params;
```

Add any NEW route params here whenever a new page type is added.

---

## Pattern for Adding a New Page Type

### Step 1 — Add the route param
In `AppRoot.tsx`, add the route:
```tsx
<Route path=":uri/my-feature/:myId" element={<MyPage />} />
```
The param name (`:myId`) determines how AppBreadcrumb identifies the page.

### Step 2 — Extract the param
```ts
const { uri, completionId, myId, ...existing } = params;
```

### Step 3 — (Optional) Fetch data for the label
Follow the `documentData` / `completionData` pattern:
```ts
const [myItemData, setMyItemData] = React.useState<{ title: string } | null>(null);

React.useEffect(() => {
  if (!myId || !uri) { setMyItemData(null); return; }
  // Prefer location.state first (zero cost when navigating from list page)
  const stateTitle = (location.state as any)?.myItem?.title;
  if (stateTitle) { setMyItemData({ title: stateTitle }); return; }
  // Fall back to API fetch
  fetch(`/api/my-feature/${myId}`, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.ok ? r.json() : null)
    .then(data => setMyItemData({ title: data?.title || 'My Feature' }))
    .catch(() => setMyItemData({ title: 'My Feature' }));
}, [myId, uri]);
```

### Step 4 — Add the breadcrumb segment
Inside the `useMemo`, in the correct position (after datasphere, after feature-level breadcrumb):
```ts
// ─── My Feature Item ─────────────────────────────────────────────────────
if (myId && currentPath.startsWith('my-feature/')) {
  const truncate = (s: string, n = 40) => s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
  segments.push({
    label: myItemData?.title ? truncate(myItemData.title) : 'My Feature',
    activeColor: 'bg-luxurious-gold',
    path: `/app/${uri}/my-feature/${myId}`,
    icon: <MyIcon size={16} />,
    actions: [
      {
        label: 'Copy Share Link',
        groupLabel: 'Share',
        icon: <Link2 className="mr-2 h-4 w-4" />,
        action: () => navigator.clipboard.writeText(`${window.location.origin}/app/${uri}/my-feature/${myId}`)
      },
      {
        label: 'Back to Datasphere',
        groupLabel: 'Navigate',
        separator: true,
        icon: <Activity className="mr-2 h-4 w-4" />,
        action: () => navigate(`/app/${uri}`)
      }
    ]
  });
}
```

### Step 5 — Add to useMemo deps
```ts
}, [...existing, myId, myItemData]);
```

---

## Rendering Rules (BreadcrumbItem component)

| Segment has…       | Result                                                     |
|--------------------|------------------------------------------------------------|
| `path` only        | `<Link to={path}>` — direct navigation on click           |
| `actions` only     | Dropdown menu on click                                     |
| `path` + `actions` | Dropdown with "Go to [label]" appended at bottom (when not last) |
| neither            | Static pill, no interaction                                |

**Key gotcha:** The `isLast` segment loses its link behavior. "Go to" in the dropdown only appears when `!isLast`. This is intentional (no point linking to the current page). The solution is: **always add sub-segments for sub-pages** so the parent (datasphere) is never left as `isLast`.

The datasphere segment always has an explicit "View [name]" action at the top of its dropdown, so navigation is available even in edge cases where no sub-segment is rendered.

---

## Existing Segments Quick Reference

| Route Pattern                              | Segments Rendered                        |
|--------------------------------------------|------------------------------------------|
| `/app`                                     | Dashboard                                |
| `/app/:uri`                                | Dashboard > Datasphere                   |
| `/app/:uri/agents`                         | Dashboard > Datasphere > AI Personas     |
| `/app/:uri/agents/:sessionId`              | Dashboard > Datasphere > AI Personas > [Session] |
| `/app/:uri/docs`                           | Dashboard > Datasphere > Docs            |
| `/app/:uri/pages/:slug`                     | Dashboard > Datasphere > Docs > [Page]   |
| `/app/:uri/surveys`                        | Dashboard > Datasphere > Surveys         |
| `/app/:uri/newsletters`                    | Dashboard > Datasphere > Newsletters     |
| `/app/:uri/sequences`                      | Dashboard > Datasphere > Sequences       |
| `/app/:uri/datasets`                       | Dashboard > Datasphere > Datasets        |
| `/app/:uri/library`                        | Dashboard > Datasphere > Media Library   |
| `/app/:uri/completions/:completionId`      | Dashboard > Datasphere > [Completion]    |
| `/app/:uri/:postId`                        | Dashboard > Datasphere > Research        |
| `/app/profile/:id`                         | Dashboard > Profile                      |

---

## Mobile Behavior

On mobile, the breadcrumb collapses to a single **Sheet** (bottom drawer). It shows:
- The current page name (last segment's label)
- ALL actions from ALL segments flattened into one menu

No extra work is needed — the mobile rendering is handled automatically by collecting `allActions` from all segments.

---

## Active Colors

Each segment that can be the "current page" should set `activeColor` to the feature's brand color:

| Feature       | `activeColor`               |
|---------------|-----------------------------|
| Dashboard     | `bg-slate-600`              |
| Datasphere    | `bg-dark-midnight-blue`     |
| AI Personas   | `bg-green-500`              |
| Docs/Pages    | `bg-purple-500`             |
| Surveys       | `bg-blue-500`               |
| Newsletters   | `bg-amber-600`              |
| Sequences     | `bg-cyan-600`               |
| Datasets      | `bg-emerald-600`            |
| Analyses      | `bg-orange-500`             |
| Research/Completions | `bg-luxurious-gold`   |

If `activeColor` is omitted, it falls back to `bg-luxurious-gold` (gold).

---

## Common Mistakes

1. **Forgetting to add the param to `useMemo` deps** — causes stale breadcrumb after navigation.
2. **Using `isLast` to gate important actions** — breaks navigation when the segment is current page.
3. **Not extracting the param from `useParams()`** — the `currentPath.startsWith(...)` check works but no API fetch is triggered.
4. **Fetching inside `useMemo`** — never do this. Fetch in `useEffect`, store in state, reference the state inside `useMemo`.
5. **Long titles without truncation** — always `truncate(title, 40)` for API-sourced labels.

---

## Files

| File | Role |
|------|------|
| [AppBreadcrumb.tsx](../../../src/client/components/AppBreadcrumb.tsx) | Main component — all segment logic here |
| [breadcrumb.tsx](../../../src/client/components/ui/breadcrumb.tsx) | Shadcn base primitives (rarely edited) |
| [Header.tsx](../../../src/client/components/Header.tsx) | Mounts AppBreadcrumb, passes datasphere/userRole |
| [Layout.tsx](../../../src/client/components/Layout.tsx) | Provides datasphere + userRole to Header |
| [datasphereNavigation.ts](../../../src/client/config/datasphereNavigation.ts) | Feature config (label, path, iconName, minRole) |
| [AppRoot.tsx](../../../src/client/AppRoot.tsx) | Route definitions — source of truth for param names |

---

## Session Docs

> **For Claude**: Before sharing any Docusaurus link, complete ALL THREE checks:
>
> **Check 1 — Session doc file exists**
> ```bash
> ls /Users/bunnarithbao/ship/docusaurus/docs/sessions/<session-slug>/README.md
> ```
>
> **Check 2 — Sidebar entry exists**
> ```bash
> grep "<session-slug>" /Users/bunnarithbao/ship/docusaurus/sidebars.ts
> ```
> If missing, add it at the top of the `Development Sessions` list (newest first):
> ```ts
> 'sessions/<session-slug>/README',
> ```
>
> **Check 3 — URL returns 200**
> ```bash
> curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/docs/sessions/<session-slug>
> ```
> - **200** → share the link
> - **000 / connection refused** → start Docusaurus first, then re-check:
>   ```bash
>   cd /Users/bunnarithbao/ship/docusaurus && npm start -- --port 3001
>   ```
> - **404** → sidebar entry is missing or slug is wrong — fix before sharing
>
> **Verified port: 3001** (backend occupies 3000; always start Docusaurus with `--port 3001`)

| Session | Docusaurus URL | Description |
|---------|---------------|-------------|
| 2026-03-10 Survey Settings + Breadcrumb | [http://localhost:3001/docs/sessions/2026-03-10-survey-settings-activity-feed-breadcrumb](http://localhost:3001/docs/sessions/2026-03-10-survey-settings-activity-feed-breadcrumb) | Breadcrumb completion sub-breadcrumb, datasphere nav fix, survey moderator notifications, confetti fix |
| 2026-03-10 Page Templates Vision | [http://localhost:3001/docs/sessions/2026-03-10-page-templates-vision](http://localhost:3001/docs/sessions/2026-03-10-page-templates-vision) | Page type taxonomy, template registry, AI population, page KB vs datasphere KB |
