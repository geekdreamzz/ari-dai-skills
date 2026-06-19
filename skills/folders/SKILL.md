---
name: folders
description: Folders tools for Dataspheres AI
---

# Folders

> Tool reference for this resource group, mirrored by hand from the platform live `/api/mcp/schema` schema.

Folders organize a datasphere's **pages** (docs, blog posts, courses, etc.) into a
nested tree. A page belongs to at most one folder. The fastest way to file a page is
to pass `folderName` on `create_page` / `update_page` — the platform matches an
existing folder (case-insensitive + fuzzy) or creates it on the spot. Use the tools
below when you need to manage the folder tree itself.

## Tools

### `list_folders` — Folders

Lists page folders in a datasphere with their page counts, sorted by sortOrder. Run
this first to understand the content structure and to get folder IDs before updating,
moving, or deleting.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |

Returns `{ folders: [{ id, name, sortOrder, parentId, pageCount, createdAt }] }`.

### `get_folder` — Get Folder

Gets one folder with everything inside it: its sub-folders, the pages filed under it,
and an ancestor breadcrumb. Use this to inspect or audit a folder's contents before
moving things around.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `folderId` | string | yes | Folder ID |

Returns `{ id, name, parentId, sortOrder, createdAt, breadcrumb: [{id,name}],
childFolders: [{id,name,pageCount,...}], pages: [{id,title,slug,pageType,status,isPubliclyVisible,updatedAt}] }`.

### `create_folder` — Create Folder

Creates a page folder. Omit `parentId` for a top-level folder, or pass an existing
folder's `id` to nest it. Requires MODERATOR. To put pages inside it, pass the
folder's `name` as `folderName` on `create_page` / `update_page`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `name` | string | yes | Folder name |
| `parentId` | string | no | Parent folder ID for a nested folder (omit for top-level) |
| `sortOrder` | number | no | Sort order position among siblings (ascending) |

### `update_folder` — Update Folder

Renames a folder, moves it under a different parent, or changes its sort order. Use
list_folders first to find the folder ID. Requires MODERATOR.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `folderId` | string | yes | Folder ID |
| `name` | string | no | New folder name |
| `sortOrder` | number | no | Display order (ascending) |
| `parentId` | string | no | Move under this parent folder (null moves it to top level) |

### `delete_folder` — Delete Folder

Deletes a folder. Pages and sub-folders inside it are **not** deleted — they move up
to the folder's parent (or to the top level if it had no parent). Requires ADMIN.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `folderId` | string | yes | Folder ID |

## Filing pages into folders

There is no separate "move page" tool — page placement is a property of the page,
set on `create_page` / `update_page`. Two ways to target a folder:

- **By name (root folders):** `folderName: "Getting Started"` matches a top-level
  folder by name (case-insensitive + fuzzy), creating it if missing. `folderName: ""`
  on update moves the page back to the root. Note: `folderName` only resolves
  **top-level** folders.
- **By ID (any folder, including sub-folders):** `docFolderId: "<id from get_folder/
  list_folders>"` files the page under that exact folder. This is the **only** way to
  target a sub-folder. `docFolderId: null` moves the page to the root. When both are
  given, `docFolderId` wins.

See the `pages` skill for the full `create_page` / `update_page` field reference.
