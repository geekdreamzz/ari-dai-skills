# File Upload API Extension — Design Spec

Extends the Dataspheres planner to support file attachments on tasks, with TipTap embed components for inline display inside task content.

---

## Problem

SDD tasks currently carry evidence only as text comments (with a `screenshots` array). There is no way to:
- Attach arbitrary files (CSVs, PDFs, logs, JSON dumps) to a task
- Reference an uploaded file inline inside the task's TipTap content (e.g., embed a results table)
- Share files across tasks within the same datasphere library

---

## Required backend changes (dataspheres-ai)

### 1. Media library upload endpoint (generalize existing)

**Current:** `POST /api/media/upload` — accepts images only, returns CDN URL

**New:** Accept any file type, return a typed asset record

```
POST /api/v2/dataspheres/:dsId/library/upload
Content-Type: multipart/form-data

Fields:
  file         File         required
  label        string       optional — human label ("Test results CSV")
  taskId       string       optional — if set, auto-attaches to task

Response:
{
  "asset": {
    "id": "asset_abc123",
    "url": "https://cdn.dataspheres.ai/assets/asset_abc123/results.csv",
    "fileName": "results.csv",
    "mimeType": "text/csv",
    "size": 4096,
    "label": "Test results CSV",
    "datasphereId": "ds_xxx",
    "uploadedAt": "2026-05-23T10:00:00Z"
  }
}
```

### 2. Task file attachment endpoint

```
POST /api/v2/dataspheres/:dsId/tasks/:taskId/attachments

Body: { "assetId": "asset_abc123", "role": "evidence" | "reference" | "artifact" }

Response: { "attachment": { "id": "att_xxx", "assetId": "...", "taskId": "...", "role": "..." } }

GET /api/v2/dataspheres/:dsId/tasks/:taskId/attachments
Response: { "attachments": [...] }

DELETE /api/v2/dataspheres/:dsId/tasks/:taskId/attachments/:attachmentId
```

### 3. TipTap file embed node

Register a custom TipTap node type `fileEmbed` in the task content editor:

```html
<!-- How it appears in stored task content: -->
<div data-type="fileEmbed"
     data-asset-id="asset_abc123"
     data-file-name="results.csv"
     data-mime-type="text/csv"
     data-label="Test results CSV"
     data-url="https://cdn.dataspheres.ai/assets/asset_abc123/results.csv"></div>
```

**Rendered UI:**
- For CSV/JSON/text: inline expandable code block or table preview
- For PDF: inline PDF viewer (pdf.js)
- For images: inline image (existing ZoomableImage behavior)
- For any file: download chip with filename + size

**TipTap extension registration (frontend):**

```typescript
// src/client/components/editor/extensions/FileEmbed.ts
import { Node } from '@tiptap/core';

export const FileEmbed = Node.create({
  name: 'fileEmbed',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      assetId: {}, fileName: {}, mimeType: {}, label: {}, url: {},
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="fileEmbed"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-type': 'fileEmbed', ...HTMLAttributes }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(FileEmbedComponent);
  },
});
```

---

## sdd-conductor integration

Once the API exists, sdd-conductor gains two commands:

```bash
# Upload a file to the datasphere library and attach to active task
node sdd-conductor.mjs upload-evidence <filePath> [--label "description"] [--task <taskId>]

# Embed an uploaded file into a task's content (as TipTap fileEmbed node)
node sdd-conductor.mjs embed-file <taskId> <assetId>
```

### `upload-evidence` implementation sketch

```javascript
async function cmdUploadEvidence(filePath, extraArgs) {
  const state = requireState();
  const taskId = parseFlag(extraArgs, '--task') || state.activeTask?.taskId;
  const label = parseFlag(extraArgs, '--label') || path.basename(filePath);

  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  form.append('label', label);
  if (taskId) form.append('taskId', taskId);

  const res = await fetch(`${baseUrl}/api/v2/dataspheres/${state.dsId}/library/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const data = await res.json();
  const asset = data.asset;

  // Post a comment linking the asset
  if (taskId) {
    await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${taskId}/comments`, {
      content: `[all-dai-sdd-system-message]\n\n**Evidence uploaded:** [${label}](${asset.url})`,
    });
  }

  ok(`Uploaded: ${asset.url}`);
  info(`Asset ID: ${asset.id}`);
  info(`To embed in task content: node sdd-conductor.mjs embed-file ${taskId} ${asset.id}`);
}
```

---

## Priority order for implementation

1. `POST /api/v2/dataspheres/:dsId/library/upload` — generalize existing media endpoint
2. `GET/POST/DELETE /api/v2/dataspheres/:dsId/tasks/:taskId/attachments` — task attachment CRUD
3. `FileEmbed` TipTap node + renderer — inline display in task content
4. `sdd-conductor upload-evidence` and `embed-file` commands

---

## Impact on the trace graph

When a task has `fileEmbed` nodes in its content, the trace graph's Artifacts tier should render them as linked file nodes (alongside the code file nodes from `Implementation Files`). This makes CSV benchmarks, PDF reports, and test logs first-class trace artifacts visible in the 5-tier swimlane.
