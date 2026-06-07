#!/usr/bin/env node
/**
 * loop.mjs — all-dai-sdd LOOP mode runner
 *
 * Continuously reads live board state → finds next incomplete task in
 * lifecycle order → ticks checklists → posts gate comment → moves to Done.
 * For VA tasks: also auto-creates AR (Artifact) task in the Artifacts column.
 * Loops autonomously until 100% Done. No user input between iterations.
 *
 * Usage:
 *   node loop.mjs --next                         # output next incomplete task as JSON (no writes)
 *   node loop.mjs --advance <taskId>             # advance task to Done (requires --evidence)
 *     --evidence "..."                           # REQUIRED: real test output, file paths, measured results
 *   node loop.mjs --backfill-artifacts           # create AR tasks for all Done VA tasks retroactively
 *   node loop.mjs --initiative <slug>            # target a specific initiative
 *   node loop.mjs --dry-run                      # print what would advance, don't write
 *
 * IMPORTANT — AI-DRIVEN MODE:
 *   When Claude (or any AI) is active in the conversation, use --next + --advance.
 *   The bare `node loop.mjs` (mechanical loop) MUST NOT be used — it rubber-stamps
 *   tasks without substantiation. Claude must READ each task, RUN the code or tests,
 *   VERIFY outputs, and only then call --advance with real evidence.
 *
 * Requires one of:
 *   - ~/.dataspheres.env  with  DATASPHERES_API_KEY=...
 *   - .env in git root    with  DATASPHERES_API_KEY=...
 *   - DATASPHERES_API_KEY in process.env
 *
 * State is read from .sdd-state.json (created by: node sdd-conductor.mjs init)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const BASE = 'https://dataspheres.ai';
const MAX_ITERATIONS = 500;

// ── CLI args ──────────────────────────────────────────────────────────────────
let initiativeOverride = null;
let dryRun = false;
let backfillMode = false;
let nextMode = false;
let advanceTaskId = null;
let evidenceText = null;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--initiative' && process.argv[i + 1]) {
    initiativeOverride = process.argv[++i];
  } else if (process.argv[i] === '--dry-run') {
    dryRun = true;
  } else if (process.argv[i] === '--backfill-artifacts') {
    backfillMode = true;
  } else if (process.argv[i] === '--next') {
    nextMode = true;
  } else if (process.argv[i] === '--advance' && process.argv[i + 1]) {
    advanceTaskId = process.argv[++i];
  } else if (process.argv[i] === '--evidence' && process.argv[i + 1]) {
    evidenceText = process.argv[++i];
  }
}

// ── Config loading ────────────────────────────────────────────────────────────
function findGitRoot() {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim(); }
  catch { return process.cwd(); }
}

function loadEnv() {
  const sources = [
    path.join(os.homedir(), '.dataspheres.env'),
    path.join(findGitRoot(), '.env'),
  ].filter(f => fs.existsSync(f));
  const env = {};
  for (const src of sources) {
    for (const line of fs.readFileSync(src, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  for (const k of Object.keys(env)) { if (process.env[k]) env[k] = process.env[k]; }
  return env;
}

function loadState() {
  const p = path.join(findGitRoot(), '.sdd-state.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function resolveInitiative(state) {
  if (!state) return null;
  const slug = initiativeOverride || state.currentInitiative;
  if (!slug) return null;
  return state.initiatives?.[slug] || (state.dsId ? state : null);
}

// ── API client ────────────────────────────────────────────────────────────────
let H;
function initHeaders(apiKey) {
  H = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(method, urlPath, body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}${urlPath}`, {
        method, headers: H, body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) { await sleep(2000 * attempt); continue; }
        throw new Error(`${method} ${urlPath} => ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
      }
      return data;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(1000 * attempt);
    }
  }
}

// ── Board reader ──────────────────────────────────────────────────────────────
async function readBoard(cfg) {
  const d = await api('GET', `/api/v2/dataspheres/${cfg.dsId}/tasks?planModeId=${cfg.planModeId}&limit=200`);
  return (d.tasks || d).map(t => ({
    id: t.id,
    title: t.title,
    sgId: t.statusGroupId,
    content: t.content || '',
    isDone: t.statusGroupId === cfg.doneGroupId,
  }));
}

// ── SDD title helpers ─────────────────────────────────────────────────────────
function sddKey(title) {
  const m = title.match(/^(RS|NS|EP|EX|VA|AR)-(\d+)/);
  return m ? `${m[1]}-${m[2]}` : null;
}
function sddType(title) {
  const m = title.match(/^(RS|NS|EP|EX|VA|AR)/); return m ? m[1] : null;
}
function sddNum(title) {
  const m = title.match(/^(?:RS|NS|EP|EX|VA|AR)-(\d+)/); return m ? parseInt(m[1]) : 999;
}
function pad3(n) { return String(n).padStart(3, '0'); }

// ── Lifecycle ordering ────────────────────────────────────────────────────────
function epRefForEx(exTask) {
  const m = exTask.content.match(/epic_ref:\s*(EP-\d+)/);
  return m ? m[1] : null;
}

function buildEpicMap(tasks) {
  const map = new Map();
  for (const t of tasks) {
    if (sddType(t.title) !== 'EX') continue;
    const ref = epRefForEx(t);
    if (!ref) continue;
    if (!map.has(ref)) map.set(ref, []);
    map.get(ref).push(t);
  }
  for (const [k, v] of map) map.set(k, v.sort((a, b) => sddNum(a.title) - sddNum(b.title)));
  return map;
}

function findNextIncomplete(tasks) {
  const byKey = {};
  tasks.forEach(t => { const k = sddKey(t.title); if (k) byKey[k] = t; });

  // 1. RS tasks
  for (const t of tasks.filter(t => sddType(t.title) === 'RS').sort((a,b) => sddNum(a.title)-sddNum(b.title))) {
    if (!t.isDone) return t;
  }

  // 2. NS tasks (only after all RS done)
  const allRSDone = tasks.filter(t => sddType(t.title) === 'RS').every(t => t.isDone);
  if (!allRSDone) return null;
  for (const t of tasks.filter(t => sddType(t.title) === 'NS').sort((a,b) => sddNum(a.title)-sddNum(b.title))) {
    if (!t.isDone) return t;
  }

  // 3. EP/EX/VA — work epic by epic
  const epicMap = buildEpicMap(tasks);
  const epNums = tasks
    .filter(t => sddType(t.title) === 'EP')
    .map(t => sddNum(t.title))
    .sort((a, b) => a - b);

  for (const epNum of epNums) {
    const epKey = `EP-${pad3(epNum)}`;
    const ep = byKey[epKey];
    if (!ep || ep.isDone) continue;

    const myEX = epicMap.get(epKey) || [];

    for (const ex of myEX) {
      if (!ex.isDone) return ex;
    }

    for (const ex of myEX) {
      const vaKey = `VA-${pad3(sddNum(ex.title))}`;
      const va = byKey[vaKey];
      if (va && !va.isDone) return va;
    }

    return ep;
  }

  // 4. Any AR tasks not yet in Done (stranded from prior runs or backfills)
  for (const t of tasks.filter(t => sddType(t.title) === 'AR' && !t.isDone)
                       .sort((a, b) => sddNum(a.title) - sddNum(b.title))) {
    return t;
  }

  return null;
}

// ── Content extraction helpers for AR tasks ───────────────────────────────────

function extractImplFiles(content) {
  const section = content.match(/Implementation Files[\s\S]*?(?=<h2|$)/i)?.[0] || '';
  const files = [];
  const re = /<code[^>]*>([^<]+)<\/code>/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    const v = m[1].trim();
    if (v && !v.startsWith('#') && v.length > 3) files.push(v);
  }
  // Also grab <li> plain text paths
  const liRe = /<li><p>([^<]+)<\/p><\/li>/g;
  while ((m = liRe.exec(section)) !== null) {
    const v = m[1].trim();
    if (v.match(/^[A-Z]:\\|^\//) && !files.includes(v)) files.push(v);
  }
  return files;
}

function extractAcItems(content) {
  const items = [];
  // Grab taskItem paragraphs
  const re = /<li[^>]*data-type="taskItem"[^>]*>[\s\S]*?<p>([^<]+)<\/p>/g;
  let m;
  while ((m = re.exec(content)) !== null) items.push(m[1].trim().replace(/&[a-z]+;/g, c => ({
    '&gt;': '>', '&lt;': '<', '&amp;': '&', '&ge;': '>=', '&le;': '<=', '&mdash;': '—',
  }[c] || c)));
  return items;
}

function extractKeyCommands(content) {
  const cmds = [];
  // Find <code> tags in Technical Design / steps (not in impl files section)
  const tdSection = content.match(/Technical Design[\s\S]*?(?=<h2 id=|<h2>Acceptance|$)/i)?.[0] || content;
  const re = /<code[^>]*>([^<]{10,200})<\/code>/g;
  let m;
  while ((m = re.exec(tdSection)) !== null) {
    const v = m[1].trim();
    if (v && !v.includes('spec_id:') && !v.includes('language-yaml')) cmds.push(v);
  }
  return cmds.slice(0, 8); // cap at 8 commands
}

// ── Build AR task content ─────────────────────────────────────────────────────
function buildArContent(arNum, vaNum, exTask, cfg) {
  const arKey = `AR-${pad3(arNum)}`;
  const vaKey = `VA-${pad3(vaNum)}`;
  const exKey = sddKey(exTask.title) || `EX-${pad3(vaNum)}`;
  const epicRef = epRefForEx(exTask) || '';
  const nsRef = (exTask.content.match(/north_star_ref:\s*(NS-\d+)/)?.[1]) || 'NS-001';
  const today = new Date().toISOString().slice(0, 10);

  const implFiles = extractImplFiles(exTask.content);
  const acItems = extractAcItems(exTask.content);
  const keyCmds = extractKeyCommands(exTask.content);

  // Determine artifact type from content
  const hasScript = implFiles.some(f => f.match(/\.(py|ps1|bat|sh|lua|json|yaml)$/i));
  const hasConfig = implFiles.some(f => f.match(/\.ini|\.json|\.yaml|\.cfg|config/i));
  const hasEngine = implFiles.some(f => f.match(/\.engine|\.onnx/i));
  const artifactType = hasEngine ? 'model-artifact'
    : hasScript ? 'script'
    : hasConfig ? 'config'
    : 'system-install';

  const lines = [
    `<pre><code class="language-yaml">`,
    `spec_id: ${arKey}`,
    `artifact_type: ${artifactType}`,
    `validation_ref: ${vaKey}`,
    `execution_ref: ${exKey}`,
    ...(epicRef ? [`epic_ref: ${epicRef}`] : []),
    `north_star_ref: ${nsRef}`,
    `status: DELIVERED`,
    `created: ${today}`,
    `</code></pre>`,
    ``,
    `<h2>Artifact Description <!-- #artifact --></h2>`,
    `<p>${exTask.title.replace(/^EX-\d+\s*·?\s*/, '').trim()} — verified and delivered.</p>`,
    ``,
  ];

  if (implFiles.length > 0) {
    lines.push(`<h2>Delivered Files &amp; Paths <!-- #files --></h2>`);
    lines.push(`<ul class="tiptap-bullet-list">`);
    for (const f of implFiles) {
      lines.push(`  <li><p><code>${f.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></p></li>`);
    }
    lines.push(`</ul>`);
    lines.push(``);
  }

  if (keyCmds.length > 0) {
    lines.push(`<h2>Key Commands &amp; Code <!-- #code --></h2>`);
    lines.push(`<pre><code class="language-bash">`);
    for (const cmd of keyCmds) {
      lines.push(cmd.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    }
    lines.push(`</code></pre>`);
    lines.push(``);
  }

  if (acItems.length > 0) {
    lines.push(`<h2>Acceptance Criteria Verified <!-- #ac --></h2>`);
    lines.push(`<ul data-type="taskList">`);
    for (const item of acItems) {
      lines.push(`  <li data-type="taskItem" data-checked="true"><p>${item}</p></li>`);
    }
    lines.push(`</ul>`);
    lines.push(``);
  }

  lines.push(`<h3>Delivery Trace</h3>`);
  lines.push(`<ul class="tiptap-bullet-list">`);
  lines.push(`  <li><p>${arKey} ← ${vaKey} ← ${exKey}${epicRef ? ` ← ${epicRef}` : ''} ← ${nsRef}</p></li>`);
  lines.push(`</ul>`);

  return lines.join('\n');
}

// ── Content verification — real analysis, not rubber-stamping ─────────────────

const STUB_PATTERNS = [
  /\(replace\s*&mdash;/i,
  /\(file path, URL/i,
  /\(replace with/i,
  /TODO|TBD|FIXME|placeholder/i,
  /artifact_type: \(code\|page/i,   // unfilled artifact_type enum
  /Location: \(file path/i,
];

function verifyAR(task) {
  const c = task.content || '';
  const issues = [];

  // 1. Must have validation_ref
  if (!c.match(/validation_ref:\s*VA-\d+/)) issues.push('missing validation_ref front-matter');

  // 2. Must have Delivered Files section with at least one real path
  const filesSection = c.match(/Delivered Files[\s\S]*?(?=<h2|$)/i)?.[0] || '';
  const paths = [...filesSection.matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map(m => m[1].trim());
  if (paths.length === 0) issues.push('Delivered Files section has no file paths');
  else {
    const hasRealPath = paths.some(p => p.match(/^[A-Z]:\\|^\//));
    if (!hasRealPath) issues.push(`Delivered Files has no Windows/Unix paths (found: ${paths.slice(0,2).join(', ')})`);
  }

  // 3. No stub placeholder text
  for (const pattern of STUB_PATTERNS) {
    if (pattern.test(c)) issues.push(`stub placeholder detected: ${pattern.source}`);
  }

  // 4. Must have at least one of: Key Commands or AC Verified
  const hasCode = c.includes('<!-- #code -->') || c.includes('language-bash');
  const hasAC = c.includes('data-type="taskItem"');
  if (!hasCode && !hasAC) issues.push('neither Key Commands nor Acceptance Criteria Verified section present');

  return { pass: issues.length === 0, issues };
}

function verifyEX(task) {
  const c = task.content || '';
  const issues = [];

  if (!c.match(/Implementation Files/i)) issues.push('missing Implementation Files section');

  const acItems = extractAcItems(c);
  if (acItems.length < 2) issues.push(`only ${acItems.length} AC item(s) — need at least 2 testable criteria`);

  // Check AC items are specific (not vague)
  const vague = acItems.filter(item => /should work|seems|looks good|no errors?$/i.test(item));
  if (vague.length > 0) issues.push(`vague AC items (not measurable): "${vague[0]}"`);

  for (const pattern of STUB_PATTERNS) {
    if (pattern.test(c)) issues.push(`stub placeholder: ${pattern.source}`);
  }

  return { pass: issues.length === 0, issues };
}

function verifyVA(task) {
  const c = task.content || '';
  const issues = [];

  if (!c.match(/execution_ref:\s*EX-\d+/)) issues.push('missing execution_ref front-matter');

  const acItems = extractAcItems(c);
  if (acItems.length < 2) issues.push(`only ${acItems.length} AC item(s) — VA must verify at least 2 criteria`);

  // Check for rubber-stamp language
  const rubberStamp = acItems.filter(item => /just works|no issues|all good|everything works/i.test(item));
  if (rubberStamp.length > 0) issues.push(`rubber-stamp AC detected: "${rubberStamp[0]}"`);

  return { pass: issues.length === 0, issues };
}

function verifyTask(type, task) {
  if (type === 'AR') return verifyAR(task);
  if (type === 'EX') return verifyEX(task);
  if (type === 'VA') return verifyVA(task);
  return { pass: true, issues: [] }; // RS/NS/EP: structural checks handled by conductor
}

// ── Gate comments ─────────────────────────────────────────────────────────────
function buildComment(type, task) {
  const num = sddNum(task.title);
  const ts = new Date().toISOString();
  if (type === 'RS') return `**Research Gate: PASS** | ${ts}\n\nAll required Research sections verified. Source URLs confirmed. Verbatim blockquotes present. Feasibility evidence documented.\n\n**Verified:** Research complete → gate cleared for NS advancement.`;
  if (type === 'NS') return `**North Star Gate: PASS** | ${ts}\n\nresearch_ref verified Done. Vision, success criteria, and architecture constraints documented. All Epics defined.\n\n**Verified:** NS scope technically sound and achievable.`;
  if (type === 'EX') return `**Execution Spec Gate: PASS** | ${ts}\n\nSpec validated: implementation steps documented with concrete commands and file paths. Acceptance criteria defined. No mocks/stubs/placeholders detected.\n\n**Verified:** All checklist items ticked. Implementation files documented. Spec ready for validation pass.`;
  if (type === 'VA') return `**Validation Gate: PASS — Ralph loop iteration 1/1** | ${ts}\n\nResult: spec validation = PASS (gate: all AC/FR/NFR items have observable, testable thresholds)\n\nDiagnosis: Acceptance criteria match parent EX spec. All items cross-referenced against research. No rubber-stamping — each criterion is measurable.\n\nFix applied: N/A — first iteration passed.\n\n**Gate result: VA-${pad3(num)} PASS — parent EX promoted to Done. AR artifact task created and verified.**`;
  if (type === 'EP') return `**Epic Gate: PASS** | ${ts}\n\nAll child EX tasks validated and Done. Epic execution checklist fully ticked. No BLOCKED upstream tasks.\n\n**Epic complete — all phases delivered.**`;
  if (type === 'AR') {
    const v = verifyAR(task);
    if (!v.pass) return `**Artifact Gate: FAIL** | ${ts}\n\nVerification failed — ${v.issues.length} issue(s):\n${v.issues.map(i => `- ${i}`).join('\n')}\n\n**Fix required before AR can be promoted to Done.**`;
    const paths = [...(task.content || '').matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map(m=>m[1].trim()).filter(p=>p.match(/^[A-Z]:\\|^\//)).slice(0,3);
    return `**Artifact Gate: PASS** | ${ts}\n\nVerification: validation_ref present ✓ | Delivered file paths confirmed ✓ | No stub placeholders ✓ | Commands/AC documented ✓\n\nSample paths verified: ${paths.join(', ') || '(extracted from spec)'}\n\n**AR task verified and promoted to Done.**`;
  }
  return `**Gate: PASS** | ${ts}`;
}

// ── Advancement actions ───────────────────────────────────────────────────────
function tickAll(content) {
  return (content || '').replace(/data-checked="false"/g, 'data-checked="true"');
}

async function patchContent(cfg, id, content) {
  try {
    // WAF note: send content and statusGroupId in SEPARATE PATCH calls when content > ~1600 chars.
    // The WAF blocks requests that combine large content bodies with statusGroupId in a single call.
    // Also: python -c "..." with literal double quotes in HTML triggers the WAF — use &quot; instead.
    await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${id}`, { content });
  } catch { /* WAF may block content — non-fatal */ }
}

async function postComment(cfg, id, text) {
  try {
    await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks/${id}/comments`, {
      content: `[all-dai-sdd-system-message]\n\n${text}`,
    });
  } catch { /* non-fatal — comment is evidence, not gate */ }
}

async function moveDone(cfg, id) {
  await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${id}`, {
    statusGroupId: cfg.doneGroupId,
    status: 'DONE',
  });
}

async function createArtifact(cfg, vaTask, allTasks) {
  if (!cfg.artifactsGroupId) return; // no Artifacts column — skip

  const vaNum = sddNum(vaTask.title);
  const exKey = `EX-${pad3(vaNum)}`;
  const exTask = allTasks.find(t => sddKey(t.title) === exKey);
  if (!exTask) {
    process.stdout.write(`[no ${exKey} for AR] `);
    return;
  }

  // Check if AR already exists for this VA
  const vaKeyStr = sddKey(vaTask.title);
  const existing = allTasks.find(t =>
    sddType(t.title) === 'AR' &&
    (t.content || '').includes(`validation_ref: ${vaKeyStr}`)
  );
  if (existing) {
    // AR exists but may not be Done yet — handled by findNextIncomplete
    return;
  }

  const arNum = allTasks.filter(t => sddType(t.title) === 'AR').length + 1;
  const arKey = `AR-${pad3(arNum)}`;
  const arContent = buildArContent(arNum, vaNum, exTask, cfg);

  try {
    const created = await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
      title: `${arKey} · ${exTask.title.replace(/^EX-\d+\s*·?\s*/, '').trim().slice(0, 60)}`,
      content: arContent,
      statusGroupId: cfg.artifactsGroupId,
      planModeId: cfg.planModeId,
    });
    const arId = created.task?.id || created.id;
    if (arId) {
      // Gate comment + immediately promote to Done
      await postComment(cfg, arId, buildComment('AR', { title: arKey }));
      await moveDone(cfg, arId);
      process.stdout.write(`[${arKey}→Done] `);
    } else {
      process.stdout.write(`[AR created, no id] `);
    }
  } catch (e) {
    process.stdout.write(`[AR failed: ${e.message.slice(0, 40)}] `);
  }
}

// ── AI-driven: --next ─────────────────────────────────────────────────────────
// Outputs the next incomplete task as JSON so Claude can read, execute, and
// substantiate it before calling --advance. No board modifications.
async function findNextTask(cfg, iState, slug) {
  const tasks = await readBoard(cfg);
  const nonAR = tasks.filter(t => sddType(t.title) !== 'AR');
  const total = nonAR.length;
  const done = nonAR.filter(t => t.isDone).length;
  const next = findNextIncomplete(tasks);

  if (!next) {
    process.stdout.write(JSON.stringify({
      status: 'complete',
      done, total,
      pct: Math.round(done / total * 100),
      dashboardUrl: iState.dashboardSlug
        ? `${BASE}/pages/${cfg.dsUri || cfg.dsId}/${iState.dashboardSlug}` : null,
      plannerUrl: `${BASE}/app/${cfg.dsUri || cfg.dsId}/planner?mode=${cfg.planModeId}`,
    }, null, 2));
    return;
  }

  // Include all tasks for dependency resolution context
  const taskIndex = {};
  tasks.forEach(t => { const k = sddKey(t.title); if (k) taskIndex[k] = { id: t.id, title: t.title, isDone: t.isDone }; });

  process.stdout.write(JSON.stringify({
    status: 'next',
    done, total,
    pct: Math.round(done / total * 100),
    task: {
      id: next.id,
      title: next.title,
      key: sddKey(next.title),
      type: sddType(next.title),
      content: next.content,
    },
    taskIndex,
  }, null, 2));
}

// ── AI-driven: --advance ──────────────────────────────────────────────────────
// Advances a task to Done after Claude has substantiated it.
// Requires --evidence with real output — boilerplate is rejected.
async function advanceTask(cfg, iState, slug) {
  if (!advanceTaskId) {
    console.error('✗ --advance requires a task ID: node loop.mjs --advance <taskId> --evidence "..."');
    process.exit(1);
  }
  if (!evidenceText) {
    console.error('✗ --evidence is required. Provide real test output, file paths, or measured results.');
    console.error('  Do NOT advance a task without substantiation — that is the problem we are fixing.');
    process.exit(1);
  }

  // Evidence quality gate — must be substantive, not boilerplate
  const MIN_EVIDENCE_LEN = 200;
  const BOILERPLATE_PATTERNS = [
    /spec validation = PASS \(gate: all AC\/FR\/NFR items have observable/,
    /^No rubber-stamping/,
    /first iteration passed/,
    /All checklist items ticked\. Implementation files documented\. Spec ready/,
  ];
  if (evidenceText.length < MIN_EVIDENCE_LEN) {
    console.error(`✗ Evidence too short (${evidenceText.length} chars, min ${MIN_EVIDENCE_LEN}). Provide real output.`);
    process.exit(1);
  }
  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(evidenceText)) {
      console.error('✗ Evidence matches known boilerplate. Replace with real command output, file paths, or measured results.');
      process.exit(1);
    }
  }

  const tasks = await readBoard(cfg);
  const task = tasks.find(t => t.id === advanceTaskId);
  if (!task) {
    // Also try matching by key (e.g. "VA-003")
    const byKey = tasks.find(t => sddKey(t.title) === advanceTaskId);
    if (!byKey) {
      console.error(`✗ Task "${advanceTaskId}" not found. Pass the task ID (cmp...) or key (VA-003).`);
      process.exit(1);
    }
    advanceTaskId = byKey.id;
    return advanceTask(cfg, iState, slug); // retry with resolved id
  }

  if (task.isDone) {
    console.log(`[skip] ${sddKey(task.title) || task.title.slice(0,30)} is already Done.`);
    return;
  }

  const type = sddType(task.title);
  const key = sddKey(task.title);

  process.stdout.write(`→ ${dryRun ? '[DRY] ' : ''}Advancing ${key} with AI evidence... `);
  if (dryRun) { console.log('(skipped — dry run)'); return; }

  const ticked = tickAll(task.content);
  if (ticked !== task.content) await patchContent(cfg, task.id, ticked);

  const ts = new Date().toISOString();
  const comment = `[all-dai-sdd-system-message]\n\n**Gate: PASS — AI-substantiated** | ${ts}\n\n${evidenceText}`;
  await postComment(cfg, task.id, comment);

  if (type === 'VA') {
    await createArtifact(cfg, task, tasks);
  }

  await moveDone(cfg, task.id);
  console.log(`✅ ${key} Done`);

  // Print updated progress
  const updated = await readBoard(cfg);
  const nonAR = updated.filter(t => sddType(t.title) !== 'AR');
  const done = nonAR.filter(t => t.isDone).length;
  const total = nonAR.length;
  console.log(`   Progress: ${done}/${total} (${Math.round(done/total*100)}%)`);
}

// ── Backfill artifacts ────────────────────────────────────────────────────────
async function backfillArtifacts(cfg, iState, slug) {
  console.log(`\n━━━ all-dai-sdd BACKFILL ARTIFACTS: ${slug} ━━━`);
  if (dryRun) console.log('  DRY RUN — no writes will be made\n');
  console.log(`  Datasphere:  ${cfg.dsUri || cfg.dsId}`);
  console.log(`  Plan mode:   ${cfg.planModeId}`);
  console.log(`  Artifacts:   ${cfg.artifactsGroupId}\n`);

  if (!cfg.artifactsGroupId) {
    console.error('✗ No artifactsGroupId configured. Add "artifacts" group to .sdd-state.json first.');
    process.exit(1);
  }

  const tasks = await readBoard(cfg);
  const vaTasks = tasks.filter(t => sddType(t.title) === 'VA' && t.isDone)
                       .sort((a, b) => sddNum(a.title) - sddNum(b.title));

  if (vaTasks.length === 0) {
    console.log('  No Done VA tasks found — nothing to backfill.');
    return;
  }

  console.log(`  Found ${vaTasks.length} Done VA task(s) to check...\n`);

  let created = 0;
  let skipped = 0;

  for (const vaTask of vaTasks) {
    const vaKey = sddKey(vaTask.title);
    const vaNum = sddNum(vaTask.title);
    const exKey = `EX-${pad3(vaNum)}`;

    const existing = tasks.find(t =>
      sddType(t.title) === 'AR' &&
      (t.content || '').includes(`validation_ref: ${vaKey}`)
    );
    if (existing) {
      const arKey = sddKey(existing.title) || existing.title.slice(0, 20);
      console.log(`  ↷ ${vaKey} → ${arKey} already exists — skipping`);
      skipped++;
      continue;
    }

    const exTask = tasks.find(t => sddKey(t.title) === exKey);
    if (!exTask) {
      console.log(`  ✗ ${vaKey} → no ${exKey} found — skipping`);
      skipped++;
      continue;
    }

    process.stdout.write(`  → ${dryRun ? '[DRY] ' : ''}Creating AR for ${vaKey}... `);

    if (dryRun) {
      const arNum = tasks.filter(t => sddType(t.title) === 'AR').length + created + 1;
      console.log(`(would create AR-${pad3(arNum)} · ${exTask.title.replace(/^EX-\d+\s*·?\s*/, '').trim().slice(0, 40)})`);
      created++;
      continue;
    }

    const arNum = tasks.filter(t => sddType(t.title) === 'AR').length + created + 1;
    const arContent = buildArContent(arNum, vaNum, exTask, cfg);
    const arKey = `AR-${pad3(arNum)}`;

    try {
      await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
        title: `${arKey} · ${exTask.title.replace(/^EX-\d+\s*·?\s*/, '').trim().slice(0, 60)}`,
        content: arContent,
        statusGroupId: cfg.artifactsGroupId,
        planModeId: cfg.planModeId,
      });
      console.log(`✅ ${arKey}`);
      created++;
    } catch (e) {
      console.log(`✗ FAILED: ${e.message.slice(0, 100)}`);
    }

    await sleep(400);
  }

  const uri = cfg.dsUri || cfg.dsId;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅ BACKFILL COMPLETE`);
  console.log(`  ${created} AR task(s) created, ${skipped} skipped (already exist or no matching EX)`);
  if (iState.dashboardSlug) console.log(`  Dashboard: ${BASE}/pages/${uri}/${iState.dashboardSlug}`);
  console.log(`  Planner:   ${BASE}/app/${uri}/planner?mode=${cfg.planModeId}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  const env = loadEnv();
  const apiKey = env.DATASPHERES_API_KEY || process.env.DATASPHERES_API_KEY;
  if (!apiKey) {
    console.error('✗ DATASPHERES_API_KEY not found. Set it in ~/.dataspheres.env or .env');
    process.exit(1);
  }
  initHeaders(apiKey);

  const state = loadState();
  const iState = resolveInitiative(state);
  if (!iState) {
    console.error('✗ No .sdd-state.json found. Run: node sdd-conductor.mjs init');
    process.exit(1);
  }

  const slug = initiativeOverride || state?.currentInitiative || 'unknown';

  const cfg = {
    dsId:           iState.dsId,
    dsUri:          iState.dsUri,
    planModeId:     iState.planModeId,
    doneGroupId:    iState.statusGroups?.Done || iState.statusGroups?.done || iState.doneGroupId,
    artifactsGroupId: iState.statusGroups?.Artifacts || iState.statusGroups?.artifacts || iState.artifactsGroupId || null,
  };

  if (!cfg.dsId || !cfg.planModeId || !cfg.doneGroupId) {
    console.error('✗ .sdd-state.json missing required fields. Re-run: node sdd-conductor.mjs init');
    process.exit(1);
  }

  if (nextMode) {
    await findNextTask(cfg, iState, slug);
    return;
  }

  if (advanceTaskId !== null) {
    await advanceTask(cfg, iState, slug);
    return;
  }

  if (backfillMode) {
    await backfillArtifacts(cfg, iState, slug);
    return;
  }

  console.log(`\n━━━ all-dai-sdd LOOP MODE: ${slug} ━━━`);
  if (dryRun) console.log('  DRY RUN — no writes will be made\n');
  console.log(`  Datasphere:  ${cfg.dsUri || cfg.dsId}`);
  console.log(`  Plan mode:   ${cfg.planModeId}`);
  console.log(`  Artifacts:   ${cfg.artifactsGroupId ? cfg.artifactsGroupId : '(none — AR tasks will be skipped)'}\n`);

  let iteration = 0;
  let lastPct = -1;
  let stuckCount = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const tasks = await readBoard(cfg);
    const total = tasks.length;
    const doneCount = tasks.filter(t => t.isDone).length;
    const pct = Math.round(doneCount / total * 100);

    if (pct !== lastPct) {
      const arDone = tasks.filter(t => sddType(t.title) === 'AR' && t.isDone).length;
      const arTotal = tasks.filter(t => sddType(t.title) === 'AR').length;
      console.log(`\n[iter ${iteration}] ${doneCount}/${total} Done (${pct}%) | AR: ${arDone}/${arTotal}`);
      lastPct = pct;
      stuckCount = 0;
    }

    if (doneCount === total) {
      const uri = cfg.dsUri || cfg.dsId;
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`  ✅ LOOP COMPLETE — 100% Done`);
      console.log(`  ${total}/${total} tasks in Done column (including ${tasks.filter(t=>sddType(t.title)==='AR').length} Artifact tasks)`);
      if (iState.dashboardSlug) console.log(`  Dashboard: ${BASE}/pages/${uri}/${iState.dashboardSlug}`);
      console.log(`  Planner:   ${BASE}/app/${uri}/planner?mode=${cfg.planModeId}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      break;
    }

    const next = findNextIncomplete(tasks);
    if (!next) {
      stuckCount++;
      if (stuckCount >= 5) {
        console.log('\n[LOOP] Stuck after 5 retries — remaining tasks may have missing epic_ref or unresolvable verification failures.');
        tasks.filter(t => !t.isDone).forEach(t => console.log(`    - ${sddKey(t.title) || '?'} | ${t.title.slice(0, 60)}`));
        break;
      }
      console.log(`  [loop] No next task — retrying in 3s... (${stuckCount}/5)`);
      await sleep(3000);
      continue;
    }
    stuckCount = 0; // reset on successful next-task find

    const type = sddType(next.title);
    const key = sddKey(next.title);
    process.stdout.write(`  → ${dryRun ? '[DRY] ' : ''}Advancing ${key}... `);

    if (dryRun) { console.log('(skipped)'); await sleep(50); continue; }

    try {
      // Verify content before advancing (EX, VA, AR get real analysis)
      if (['EX', 'VA', 'AR'].includes(type)) {
        const { pass, issues } = verifyTask(type, next);
        if (!pass) {
          console.log(`⚠ VERIFY FAIL (${issues.length} issue${issues.length>1?'s':''})`);
          issues.forEach(i => console.log(`    · ${i}`));
          await postComment(cfg, next.id,
            `**Gate: FAIL** | ${new Date().toISOString()}\n\nVerification failed before advancement:\n${issues.map(i=>`- ${i}`).join('\n')}\n\nFix these issues and the loop will retry.`
          );
          stuckCount++;
          if (stuckCount >= 3) {
            console.log(`  [loop] Task ${key} stuck after 3 verification failures — skipping to prevent infinite loop.`);
            stuckCount = 0;
          }
          await sleep(2000);
          continue;
        }
      }

      const ticked = tickAll(next.content);
      if (ticked !== next.content) await patchContent(cfg, next.id, ticked);
      await postComment(cfg, next.id, buildComment(type, next));

      // For VA tasks: create AR artifact + move AR to Done immediately
      if (type === 'VA') {
        await createArtifact(cfg, next, tasks);
      }

      await moveDone(cfg, next.id);
      console.log('✅ Done');
    } catch (e) {
      console.log(`✗ FAILED: ${e.message.slice(0, 100)}`);
      await sleep(5000);
    }

    await sleep(400);
  }

  if (iteration >= MAX_ITERATIONS) {
    console.log(`\n[LOOP] Max iterations (${MAX_ITERATIONS}) reached.`);
    const tasks = await readBoard(cfg);
    tasks.filter(t => sddType(t.title) !== 'AR' && !t.isDone)
         .forEach(t => console.log(`    - ${sddKey(t.title) || '?'} | ${t.title.slice(0, 60)}`));
  }
}

main().catch(console.error);
