/**
 * cite-ar.mjs — PATCH a scaffolded AR task's content with citations.
 * Part of the all-dai-sdd toolkit: AR tasks scaffold with PENDING_CITATIONS;
 * the worker authors a citation HTML file and applies it with this script,
 * then runs `loop.mjs --advance <arId>` through the citation gate.
 *
 * Usage: node cite-ar.mjs <taskId> <contentFile> [dsUri]
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

const [taskId, contentFile, dsUriArg] = process.argv.slice(2);
if (!taskId || !contentFile) {
  console.error('Usage: node cite-ar.mjs <taskId> <contentFile> [dsUri]');
  process.exit(1);
}

function loadEnv() {
  const out = {};
  for (const f of [path.join(os.homedir(), '.dataspheres.env'), path.resolve('.env')]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf-8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}
const env = loadEnv();
const key = env.DATASPHERES_API_KEY || process.env.DATASPHERES_API_KEY;
const BASE = env.DATASPHERES_BASE_URL || process.env.DATASPHERES_BASE_URL || 'https://dataspheres.ai';
const dsUri = dsUriArg || 'dataspheres-ai';
const H = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const ds = await (await fetch(`${BASE}/api/v1/dataspheres/${dsUri}`, { headers: H })).json();
const dsId = ds.datasphere?.id || ds.id;
if (!dsId) { console.error('could not resolve dsId for ' + dsUri); process.exit(1); }

const content = fs.readFileSync(contentFile, 'utf-8');
const res = await fetch(`${BASE}/api/v2/dataspheres/${dsId}/tasks/${taskId}`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ content }),
});
console.log(res.status, res.ok ? 'OK' : await res.text());
