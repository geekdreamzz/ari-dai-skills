#!/usr/bin/env node
/**
 * sdd-screenshot-gate.mjs — visual evidence gate for SDD validation tickets.
 *
 * WHY THIS EXISTS. The existing gate checks that screenshot FILES exist and are
 * fresh. That is necessary and not sufficient — three real failures got past it
 * on this initiative alone:
 *
 *   1. A spec captured two screenshots that were BYTE-IDENTICAL. Presented as
 *      "before and after", they were the same moment twice, because the behaviour
 *      under test fires on mount. Two files existed; one piece of evidence did.
 *   2. A screenshot of a page that had not finished loading — a real PNG, fresh,
 *      on disk, showing a spinner. It proves the test ran, not that the feature works.
 *   3. Screenshots that were never attached to the ticket, so the reviewer had to
 *      go find them on someone else's filesystem.
 *
 * So this gate does four things a file-existence check cannot:
 *   - DECIDES which tickets owe screenshots (ui-kind, from the ticket's own
 *     validation_kind — not a guess from the title)
 *   - REJECTS non-evidence: duplicates by content hash, near-blank images, and
 *     files older than the freshness window
 *   - UPLOADS survivors to the datasphere media library and ATTACHES them to the
 *     ticket's comment feed, so evidence lives with the ticket forever
 *   - EMITS a manifest the agent must visually describe. Uploading a picture is
 *     not the same as having looked at it; --require-description fails the gate
 *     when a described-by note is missing.
 *
 * USAGE
 *   node scripts/sdd-screenshot-gate.mjs --initiative <slug> --ticket VC-004 \
 *        --shots tests/e2e/test-results/<dir> [--post] [--require-description "<text>"]
 *   node scripts/sdd-screenshot-gate.mjs --initiative <slug> --audit
 *
 * Exit 0 = evidence accepted. Exit 1 = gate failure with the reason.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = process.env.DATASPHERES_BASE_URL;
const KEY = process.env.DATASPHERES_API_KEY;
const DS_URI = process.env.DATASPHERES_DEFAULT_URI || 'dataspheres-ai';

/** A screenshot older than this is stale — it may predate the change under test. */
const MAX_AGE_HOURS = 24;
/** Below this, a PNG is almost certainly blank, a spinner, or an error card. */
const MIN_BYTES = 15_000;

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);

const fail = (msg, detail = []) => {
  console.error(`\n✗ SCREENSHOT GATE FAIL — ${msg}`);
  detail.forEach((d) => console.error(`  · ${d}`));
  process.exit(1);
};

const state = () => JSON.parse(fs.readFileSync('.sdd-state.json', 'utf8'));

const api = async (p, method = 'GET', body) => {
  const r = await fetch(`${BASE}${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { ok: r.ok, status: r.status, json, text };
};

/** Which tickets OWE screenshots — read from the ticket, never guessed from a title. */
function owesScreenshots(content) {
  const m = String(content || '').match(/validation_kind:\s*([a-z,\s]+)/i);
  if (!m) return false;
  return m[1].split(',').map((s) => s.trim()).includes('ui');
}

function inspect(dir) {
  if (!fs.existsSync(dir)) fail(`screenshot directory does not exist: ${dir}`);
  const files = fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f));
  if (!files.length) fail(`no screenshots in ${dir} — a ui ticket must show its work`);

  const now = Date.now();
  const seen = new Map();          // sha256 -> first filename
  const shots = [];
  const problems = [];

  for (const f of files) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    const ageH = (now - st.mtimeMs) / 3_600_000;
    const buf = fs.readFileSync(p);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');

    if (ageH > MAX_AGE_HOURS) {
      problems.push(`${f} is ${ageH.toFixed(1)}h old (>${MAX_AGE_HOURS}h) — it may predate the change under test`);
      continue;
    }
    if (st.size < MIN_BYTES) {
      problems.push(`${f} is only ${st.size} bytes — almost certainly blank, a spinner, or an error card`);
      continue;
    }
    if (seen.has(sha)) {
      // THE ONE THE OLD GATE MISSED.
      problems.push(`${f} is byte-identical to ${seen.get(sha)} — two files, one piece of evidence. `
        + 'If these are meant to be before/after, the state did not change between them.');
      continue;
    }
    seen.set(sha, f);
    shots.push({ file: f, path: p, bytes: st.size, sha, ageH: Number(ageH.toFixed(2)) });
  }

  if (!shots.length) fail('every screenshot was rejected as non-evidence', problems);
  return { shots, problems };
}

/** Upload to the datasphere media library — a local path dies with the machine. */
async function upload(p) {
  const buf = fs.readFileSync(p);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'image/png' }), path.basename(p));
  form.append('caption', `SDD visual evidence — ${path.basename(p)}`);
  const r = await fetch(`${BASE}/api/v1/dataspheres/${DS_URI}/media/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: form,
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.url ?? null;
}

async function run() {
  if (!BASE || !KEY) fail('DATASPHERES_BASE_URL / DATASPHERES_API_KEY not set');
  const slug = arg('initiative');
  if (!slug) fail('--initiative <slug> is required');
  const s = state();
  const init = s.initiatives?.[slug];
  if (!init) fail(`unknown initiative "${slug}"`);
  const dsId = init.dsId;

  // ── AUDIT: which ui tickets have no visual evidence on them yet? ────────────
  if (flag('audit')) {
    const res = await api(`/api/v2/dataspheres/${dsId}/tasks?planModeId=${init.planModeId}&limit=200`);
    const tasks = res.json?.tasks || [];
    const ui = tasks.filter((t) => owesScreenshots(t.content));
    console.log(`\nui tickets owing visual evidence: ${ui.length}`);
    for (const t of ui) {
      const c = await api(`/api/v2/dataspheres/${dsId}/tasks/${t.id}/comments`);
      const comments = c.json?.comments || [];
      const withShots = comments.filter((x) => (x.screenshots || []).length > 0);
      const total = withShots.reduce((n, x) => n + x.screenshots.length, 0);
      const mark = total > 0 ? '✓' : '✗';
      console.log(`  ${mark} ${String(t.title).slice(0, 58).padEnd(58)} ${total} image(s) on the ticket`);
    }
    process.exit(0);
  }

  // ── GATE a single ticket ────────────────────────────────────────────────────
  const ticketKey = arg('ticket');
  const dir = arg('shots');
  if (!ticketKey || !dir) fail('--ticket <KEY> and --shots <dir> are required');

  const res = await api(`/api/v2/dataspheres/${dsId}/tasks?planModeId=${init.planModeId}&limit=200`);
  const task = (res.json?.tasks || []).find((t) => String(t.title).startsWith(ticketKey));
  if (!task) fail(`ticket ${ticketKey} not found on the board`);

  if (!owesScreenshots(task.content)) {
    console.log(`${ticketKey} does not declare validation_kind ui — no visual evidence required.`);
    process.exit(0);
  }

  const { shots, problems } = inspect(dir);
  console.log(`\n${ticketKey} — ${shots.length} screenshot(s) accepted from ${dir}`);
  shots.forEach((x) => console.log(`  ✓ ${x.file}  ${x.bytes} bytes  ${x.ageH}h old  sha ${x.sha.slice(0, 12)}`));
  if (problems.length) {
    console.log('\n  rejected:');
    problems.forEach((p) => console.log(`  ✗ ${p}`));
  }

  // A ui ticket claiming before/after needs more than one DISTINCT frame.
  if (shots.length < 2 && problems.some((p) => p.includes('byte-identical'))) {
    fail('only one distinct frame survived — a before/after claim needs two different states',
      problems);
  }

  // The agent must have LOOKED. Uploading a picture is not inspecting it.
  const description = arg('require-description');
  if (flag('require-description') && (!description || description.trim().length < 60)) {
    fail('visual description missing or too thin',
      ['Pass --require-description "<what is actually visible in each frame>" (min 60 chars).',
       'A screenshot nobody described is a file, not evidence.']);
  }

  if (!flag('post')) {
    console.log('\n(dry run — pass --post to upload and attach to the ticket)');
    process.exit(0);
  }

  const urls = [];
  for (const x of shots) {
    const url = await upload(x.path);
    if (url) { urls.push(url); console.log(`  ↑ uploaded ${x.file}`); }
    else console.log(`  ! upload failed for ${x.file} (kept local)`);
  }
  if (!urls.length) fail('no screenshot uploaded — evidence would live only on this machine');

  const body = [
    '[all-dai-sdd-system-message]',
    '',
    `**Visual evidence — ${ticketKey}**`,
    '',
    ...shots.map((x) => `- \`${x.file}\` — ${x.bytes} bytes, ${x.ageH}h old, sha256 ${x.sha.slice(0, 16)}`),
    ...(problems.length ? ['', '**Rejected as non-evidence:**', ...problems.map((p) => `- ${p}`)] : []),
    ...(description ? ['', '**What is visible:**', description] : []),
  ].join('\n');

  const posted = await api(`/api/v2/dataspheres/${dsId}/tasks/${task.id}/comments`, 'POST',
    { content: body, screenshots: urls });
  if (!posted.ok) fail(`comment post failed: HTTP ${posted.status} ${posted.text.slice(0, 160)}`);

  console.log(`\n✅ ${urls.length} image(s) attached to ${ticketKey} — visible on the board and in the activity feed.`);
  console.log(`   ${init.trackerUrl || ''}`);
}

run().catch((e) => fail(e?.message || String(e)));
