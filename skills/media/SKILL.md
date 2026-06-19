---
name: media
description: Media tools for Dataspheres AI
---

# Media

> Tool reference for this resource group, mirrored by hand from the platform live `/api/mcp/schema` schema.

## Tools

### `delete_media` — Delete Media

Deletes soft-deletes generated media (30-day retention). Requires PARTICIPANT+ role in the datasphere. Required fields: `datasphereUri` (string); `id` (string). Show a preview of the operation and get explicit confirmation from the user before executing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `id` | string | yes | Media ID to delete |

### `list_media` — List Media

Retrieves lists generated media in a datasphere with pagination and filtering. Requires PARTICIPANT+ role in the datasphere. Required fields: `datasphereUri` (string). Optional: `type` (IMAGE|VIDEO|AUDIO), `search`, `limit` [default: 20].

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `type` | string | no | Filter by type |
| `search` | string | no | Search by title, prompt, or tags |
| `limit` | number | no | Results per page (max 100) |

### `save_search_images_to_library` — Save Search Images

Creates bulk-saves high-fidelity, highly-relevant images from a web search into the datasphere's media library. each candidate url goes through:
1. url heuristic filter (drops favicons, ads, tracking pixels, low-res icons)
2. vision caption via gpt-4o-mini (cached so repeated calls are cheap)
3. combined relevance + quality score (relevance to topic + photo-quality indicators)
4. top n persisted as media library entries with full attribution

use this when:
- you just ran web_search and the results contain images you want to keep for a research report
- the user asks to "save these images" or "add to my library"
- you're synthesizing a page and need real photographs (not stock placeholders or logos)

after saving, the returned image urls are immediately embeddable in a tiptap customimage node:
<figure data-image-figure data-alignment="center">
  <img src="{saved.url}" alt="{saved.caption}">
  <figcaption>{saved.caption} — {sourcetitle}</figcaption>
</figure>

hil: if more than 5 images pass the filter, present them all with thumbnails and ask which to keep. don't auto-save more than 6 from a single search without confirmation.

returns: { saved: [...], rejected: number, totalcandidates: number, datasphereid, datasphereuri }. Requires PARTICIPANT+ role in the datasphere. Required fields: `datasphereId` (string); `urls` (array); `topic` (string). Optional: `limit`, `minScore`, `sourceTitle`, `sourceUrl`. Show a preview of the operation and get explicit confirmation from the user before executing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereId` | string | yes | Datasphere id or URI slug |
| `urls` | array | yes | Array of image URLs from a web search |
| `topic` | string | yes | What the images should depict — used for relevance scoring |
| `limit` | number | no | Max images to save (default 6) |
| `minScore` | number | no | Min combined score 0-100 (default 60) |
| `sourceTitle` | string | no | Source page title for caption attribution |
| `sourceUrl` | string | no | Source page URL for caption attribution |

### `update_media` — Update Media

Updates updates title, caption, or tags on generated media. Requires PARTICIPANT+ role in the datasphere. Required fields: `datasphereUri` (string); `id` (string). Optional: `title`, `caption`, `tags`. Show a preview of the operation and get explicit confirmation from the user before executing.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere URI |
| `id` | string | yes | Media ID |
| `title` | string | no | New title |
| `caption` | string | no | New caption/description |
| `tags` | array | no | Updated tags |

### `list_documents` — List Documents

Lists a datasphere's uploaded library files — **any uploaded type**: PDF, Word/Excel/
PowerPoint, images, video, audio, text/CSV. (Uploaded images are stored as documents,
so they're publishable and linkable exactly like a PDF.) Each entry includes `id`,
`name`, `mimeType`, `fileSize`, `isPublic`, `fileUrl`, and `viewerPath`
(`/viewer/:uri/:id` — the public full-screen viewer). Use this to find an item id to
publish, or to gather public links to list from an index page. Resolves via the
datasphere's full scope (folder / upload activity / post), so it includes files
attached or uploaded without a folder.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere whose uploaded documents to list |

### `publish_document` — Publish / Unpublish Document

Makes a single uploaded file (PDF, Office doc, **image**, video, audio, text…)
publicly readable (or private again) via the full-screen public viewer at
`/viewer/:datasphereUri/:documentId` — no account needed, e.g. for a tenure committee.
The viewer renders the file natively: PDFs/images/video/audio inline, Word/Excel
rendered to HTML, everything else as a clean download. Per-item: it affects only the
one item you name, never the whole library. Requires MODERATOR. The response returns
the `viewerPath`; build the shareable URL as `https://dataspheres.ai{viewerPath}`. Set
`isPublic=false` to revoke (the public link then 404s).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `datasphereUri` | string | yes | Datasphere that owns the document |
| `documentId` | string | yes | Document id (from upload_media_file or list_documents) |
| `isPublic` | boolean | yes | true = readable in the public viewer; false = private |

## Making a document public and linking to it

1. `list_documents` → find the document and its `id` (and current `isPublic`).
2. `publish_document` with `isPublic: true` → the document is now live at
   `https://dataspheres.ai/viewer/<datasphereUri>/<documentId>` (the `viewerPath` in
   the response). The viewer shows the file **raw** and full-screen.
3. Link that public URL from a page (`create_page` / `update_page`) or share it
   directly. To revoke access, call `publish_document` again with `isPublic: false`.

