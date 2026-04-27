<!-- dai-sync: skip -->
---
name: library
description: Upload and manage media in the Dataspheres AI library
argument-hint: "[action] [options]"
---

# library — Media Library

The media library stores images, documents, and other files scoped to a datasphere. Uploaded files get a public URL that can be embedded in pages, tasks, and newsletters.

## Core Workflows

### Upload a file

```python
upload_file(file_path="/path/to/screenshot.png", description="Q2 launch hero image")
# → {"url": "https://dataspheres.ai/api/media/...", "id": "med_...", "name": "screenshot.png"}
```

The returned `url` is ready to use in page content, task comments, or newsletter issues.

Supported types: images (PNG, JPG, GIF, WebP), PDFs, audio, video. Max file size depends on your plan.

### List library items

```python
list_library(limit=20)
# → [{"id": "med_...", "url": "...", "name": "...", "mimeType": "image/png", "createdAt": "..."}, ...]
```

Search by filename:

```python
list_library(search="screenshot", limit=10)
```

### Delete a media item

```python
delete_media(media_id="med_abc123")
# → None (204 No Content)
```

## API Reference

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| `upload_file` | POST | `/api/media/upload` | Multipart form upload; uses direct httpx call |
| `list_library` | GET | `/api/v1/dataspheres/:uri/media` | Requires active datasphere |
| `delete_media` | DELETE | `/api/v1/dataspheres/:uri/media/:mediaId` | Permanent — no undo |

`upload_file` does not scope to a datasphere by URI in the path — the API uses the authenticated user's account to associate the upload. However, `list_library` and `delete_media` are datasphere-scoped.

## Embedding Media in Pages

After uploading, embed with an `<img>` tag in page content:

```html
<img src="https://dataspheres.ai/api/media/abc..." alt="Q2 hero" />
```

For task comments (screenshots), pass the URL in the `screenshots` list when calling `add_comment` from the planner skill.

## Error Patterns

| Error | Cause | Fix |
|-------|-------|-----|
| FileNotFoundError | `file_path` doesn't exist | Check the path with `os.path.exists()` |
| 401 | Invalid API key | Re-run `dai login` |
| 413 | File too large | Compress the file or upgrade your plan |
| 404 on list/delete | Datasphere URI not found | Run `dai use <uri>` with a valid URI |
