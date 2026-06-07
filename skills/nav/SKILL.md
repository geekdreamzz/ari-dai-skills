---
name: nav
description: Navigation system reference for dataspheres-ai. Use when modifying or debugging sidebar, breadcrumb, mobile nav, hover submenus, or feature links. Shows the architecture, sync rules, ordering, and change checklist.
argument-hint: "sidebar | breadcrumb | mobile | submenu | feature | icons"
disable-model-invocation: false
---

# Dataspheres AI — Navigation System Reference

## Single Source of Truth

```
src/client/config/datasphereNavigation.ts
```

Add or modify a feature here → it propagates to all nav surfaces automatically. **Never hardcode feature URLs in components.** Always use `buildFeaturePath(feature, uri)`.

---

## The Five Navigation Surfaces

| Surface | File | Filter function |
|---------|------|-----------------|
| Left Sidebar nav list | `Sidebar.tsx` | `getAccessibleSidebarFeatures(userRole)` |
| Sidebar datasphere hover submenu | `DatasphereListItem` in Sidebar.tsx | `SUBMENU_FEATURES` const (showInBreadcrumb + group=main + !absolutePath) |
| Top Breadcrumb dropdown | `AppBreadcrumb.tsx` | `getAccessibleBreadcrumbFeatures(userRole)` |
| Mobile Drawer | `mobile/MobileDrawer.tsx` | `getAccessibleSidebarFeatures(userRole)` |
| Inline Feature Nav | `InlineFeatureNav.tsx` | `getAccessibleFeatures(userRole)` |

---

## Sidebar Layout Order (top → bottom)

```
┌─────────────────────┐
│  Workspace Switcher │  ← hardcoded (border-b)
├─────────────────────┤
│  Discover           │  ← global link (hardcoded NavButton, above history)
├─────────────────────┤
│  History            │  ← hardcoded DropdownMenu (border-b)
├─────────────────────┤
│  <nav>              │
│    Research         │  ← hardcoded NavButton (always visible)
│    [Feature nav]    │  ← from getAccessibleSidebarFeatures()
│    Create button    │  ← hardcoded
│    [DS lists]       │  ← recentDataspheres, managed, member, public
│    Docs/About/etc   │  ← hardcoded bottom links
│  </nav>             │
├─────────────────────┤
│  Profile            │  ← hardcoded DropdownMenu (mt-auto)
└─────────────────────┘
```

**Discover** and **Research** are intentionally hardcoded outside the feature config render loop because they are always-visible global links not gated by datasphere membership.

---

## Feature Config Shape

```typescript
interface DatasphereFeature {
  id: string;            // e.g. 'activity', 'docs'
  label: string;         // Display name
  description: string;   // Tooltip text
  path: string;          // '' = datasphere root, 'docs' = /app/{uri}/docs
  iconName: IconName;    // Must exist in every ICON_MAP (enforced by TS)
  iconColor: string;     // Tailwind class e.g. 'text-violet-400'
  queryParams?: string;  // appended to URL e.g. 'websearch=true'
  absolutePath?: boolean;// true = path is not relative to /app/{uri}/
  openInNewTab?: boolean;
  minRole?: DatasphereRole; // undefined = visible to all roles
  showInSidebar: boolean;
  showInBreadcrumb: boolean;
  group: 'main' | 'admin' | 'action';
  order: number;         // sort order within group
  createAction?: CreateAction;
}
```

### Permission Hierarchy
```
OWNER(50) > ADMIN(40) > MODERATOR(30) > PARTICIPANT(20) > OBFUSCATED(10)
```

---

## ICON_MAP Sync — CRITICAL

When you add a new `iconName` to `ICON_NAMES[]` in `datasphereNavigation.ts`, add the Lucide import + map entry to **all four** files:

| File | Map name |
|------|----------|
| `Sidebar.tsx` | `ICON_MAP` |
| `AppBreadcrumb.tsx` | `BREADCRUMB_ICON_MAP` |
| `InlineFeatureNav.tsx` | `ICON_MAP` |
| `mobile/MobileDrawer.tsx` | `ICON_MAP` |

TypeScript enforces completeness — `Record<IconName, LucideIcon>` will error on missing keys. Run `npx tsc --noEmit` to verify.

---

## Adding a New Feature — Checklist

1. **`datasphereNavigation.ts`**: Add to `DATASPHERE_FEATURES[]`, set `showInSidebar`, `showInBreadcrumb`, `group`, `order`, `minRole`
2. If new icon: add to `ICON_NAMES[]` array at bottom of the file
3. Add icon to all 4 ICON_MAPs (import + map entry)
4. Verify: `npx tsc --noEmit`
5. Add React Router route in `AppRoot.tsx` if needed

---

## Hover Submenu (Desktop Sidebar)

Hovering a datasphere item in the sidebar list shows a right-side flyout after 250ms.

**Role-aware — matches sidebar visibility exactly.** Features are computed per-datasphere using `getAccessibleBreadcrumbFeatures(memberRole)`:

```typescript
// Inside DatasphereListItem — role is passed per list item, NOT global
const submenuFeatures = React.useMemo(
  () => getAccessibleBreadcrumbFeatures(memberRole).filter(
    // Research (ask) included — available to all roles
    // Public Pages (public-docs) excepted from absolutePath exclusion — visible to everyone
    f => f.group === 'main' && (!f.absolutePath || f.id === 'public-docs')
  ),
  [memberRole]
);
```

**Role inference** (in parent `Sidebar.tsx`):
```typescript
const dsRoleLookup = new Map<string, string>();
userDataspheres.managed.forEach(d => map.set(d.id, 'ADMIN'));
userDataspheres.member.forEach(d => map.set(d.id, 'PARTICIPANT'));
// getDsRole(ds) = dsRoleLookup.get(ds.id) || userRole || 'PARTICIPANT'
```

- `managed` list → `'ADMIN'` (sees MODERATOR+ features)
- `member` list → `'PARTICIPANT'` (sees only public features)
- `recent` / `public` lists → falls back to current `userRole` or `'PARTICIPANT'`

**Panel contents**: datasphere avatar + name + status + member count → 3-column icon grid of role-filtered features.

---

## Path Building

```typescript
import { buildFeaturePath } from '@/config/datasphereNavigation';

buildFeaturePath(feature, datasphereUri)
// → '/app/{uri}/{feature.path}?{queryParams}' (normal)
// → absolutePath with {uri} substituted (e.g. public-docs)
```

---

## Activity Feed Deep Links (per activity type)

Source: `getDeepLinkPath()` in `UnifiedActivityFeed.tsx`. Used by `TranslateButton` for `resourceUrl`.

| Activity Type | URL Pattern |
|---|---|
| PAGE_CREATED / PAGE_UPDATED | `/app/{uri}/docs/{page.slug \|\| resourceId}` |
| NEWSLETTER_SENT / ISSUE_CREATED | `/newsletters/{newsletterSlug}` |
| IMAGE_GENERATED / VIDEO_GENERATED | `/app/{uri}/completions/{postId}` |
| DOCUMENT_UPLOADED / TRANSCRIBED | `/app/{uri}/documents/{documentId}` |
| DOCUMENT_ANALYZED | `/app/{uri}/documents/{documentId}/analysis` |
| TASK_* | `/app/{uri}/planner?taskId={taskId}` |
| SURVEY_CREATED | `/survey/{resourceId}` |
| SEQUENCE_EXECUTED | `/app/{uri}/sequences/{seqId}/executions/{execId}` |
| POST_CREATED / REPLY_CREATED | `/app/{uri}/completions/{postId}` |
| MERMAID_DIAGRAM_* | `null` (modal only) |
| LINKED_URL_* | `/app/{uri}/library?tab=urls&linkedUrlId={resourceId}` |

For `TranslateButton` resource IDs:
- POST type → use `item.postId` (NOT `item.resourceId`)
- PAGE type → use `item.resourceId`

---

## Feature Visibility Matrix

| Feature | Sidebar | Breadcrumb | Hover Submenu | Min Role |
|---------|---------|------------|---------------|----------|
| Home (activity) | ✅ | ❌ | ✅ | — |
| Research (ask) | ✅ hardcoded | ✅ | ✅ (always) | — |
| Discover | ✅ hardcoded | ❌ | ❌ | — |
| Chat | ✅ | ✅ | ✅ | — |
| Docs (Manage Pages) | ✅ | ✅ | ✅ | MODERATOR |
| Public Pages | ✅ | ✅ | ✅ (absolutePath exception) | — |
| Media Library | ✅ | ✅ | ✅ | MODERATOR |
| Newsletters | ✅ | ✅ | ✅ | ADMIN |
| Tasks (Planner) | ✅ | ✅ | ✅ | MODERATOR |
| Sequencer | ✅ | ✅ | ✅ | MODERATOR |
| Surveys | ✅ | ✅ | ✅ | MODERATOR |
| Analyses | ✅ | ✅ | ✅ | MODERATOR |
| Datasets | ✅ | ✅ | ✅ | MODERATOR |
| Tags & Metadata | ✅ | ✅ | ✅ | MODERATOR |
| AI Personas | ✅ | ✅ | ✅ | MODERATOR |
| About (info) | ❌ | ✅ | ❌ | — |
| Moderation | ✅ | ✅ | ❌ (admin group) | MODERATOR |
| Settings | ✅ | ✅ | ❌ (admin group) | OWNER |

---

## Common Mistakes

- ❌ Hardcoding feature URLs — always use `buildFeaturePath()`
- ❌ Adding to `ICON_NAMES` but forgetting all 4 ICON_MAP files
- ❌ Using `item.resourceId` as Post ID for completions links — use `item.postId`
- ❌ Forgetting that `path: ''` (Home/Activity) gives `/app/{uri}/` — React Router handles trailing slash
- ❌ Adding a feature with `showInSidebar: false` and wondering why it doesn't appear
