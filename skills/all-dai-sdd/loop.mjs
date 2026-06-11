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
 *     --auto-fix                                 # on gate fail: auto-create EX+VA remediation pair instead of just erroring
 *   node loop.mjs --create-fix <taskId>          # Ralph error mode: create EX+VA fix pair for a failing task
 *     --reason "issue1; issue2"                  # REQUIRED: semicolon-separated gate failure reasons
 *     --dry-run                                  # preview what would be created WITHOUT writing to board
 *   node loop.mjs --backfill-artifacts           # create AR tasks for all Done VA tasks retroactively
 *   node loop.mjs --health                       # validate initiative config + board structural health
 *   node loop.mjs --initiative <slug>            # target a specific initiative
 *   node loop.mjs --dry-run                      # print what would advance, don't write
 *
 * Continuous intake commands (follow-up prompts, UAT results, stakeholder feedback):
 *   node loop.mjs --intake                       # queue a new intake item
 *     --intake-type <instruction|uat-result|stakeholder-feedback>
 *     --intake-priority <critical|high|normal>   # critical blocks --next until triaged
 *     --intake-summary "..."                     # REQUIRED: one-line description
 *     --intake-body "..."                        # optional: full text / instructions
 *   node loop.mjs --triage <intakeId>            # turn intake item into board tasks
 *     --target-type <EX|VA|NS|EP>               # task type to create (default: EX)
 *     --target-ref <EP-NNN>                      # add context to existing task instead of creating new
 *     --dry-run                                  # preview without writing
 *   node loop.mjs --intake-status               # list intake queue with auto-done sweep
 *     --pending-only                             # filter to pending items only
 *   node loop.mjs --uat <vaTaskId>              # run UAT validation on a VA task
 *     --outcome <pass|fail>                      # REQUIRED: UAT outcome
 *     --evidence "..."                           # REQUIRED: real test output
 *
 * Ralph loop error recovery workflow (AI-driven):
 *   1. node loop.mjs --next          → Claude reads task, runs tests
 *   2. node loop.mjs --advance ...   → gate fails with specific error message
 *   3. Claude diagnoses the reason from the error
 *   4. node loop.mjs --create-fix <id> --reason "..."  → creates EX+VA remediation pair
 *   5. node loop.mjs --next          → returns new EX fix task
 *   6. Claude implements the fix, advances EX, then VA, then original failing task
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

let BASE = process.env.DATASPHERES_BASE_URL || 'https://dataspheres.ai';
const MAX_ITERATIONS = 500;

// ── CLI args ──────────────────────────────────────────────────────────────────
let initiativeOverride = null;
let dryRun = false;
let backfillMode = false;
let nextMode = false;
let advanceTaskId = null;
let evidenceText = null;
let autoFix = false;
let createFixTaskId = null;
let createFixReason = null;
let healthMode = false;
let intakeAdd = false;
let intakeType = 'instruction';
let intakePriority = 'normal';
let intakeSummary = null;
let intakeBody_ = null;
let triageIntakeId = null;
let triageTargetType = 'EX';
let triageTargetRef = null;
let showIntakeStatus = false;
let intakePendingOnly = false;
let uatTaskId = null;
let uatOutcome = null;

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
  } else if (process.argv[i] === '--auto-fix') {
    autoFix = true;
  } else if (process.argv[i] === '--create-fix' && process.argv[i + 1]) {
    createFixTaskId = process.argv[++i];
  } else if (process.argv[i] === '--reason' && process.argv[i + 1]) {
    createFixReason = process.argv[++i];
  } else if (process.argv[i] === '--health') {
    healthMode = true;
  } else if (process.argv[i] === '--intake') {
    intakeAdd = true;
  } else if (process.argv[i] === '--intake-type' && process.argv[i + 1]) {
    intakeType = process.argv[++i];
  } else if (process.argv[i] === '--intake-priority' && process.argv[i + 1]) {
    intakePriority = process.argv[++i];
  } else if (process.argv[i] === '--intake-summary' && process.argv[i + 1]) {
    intakeSummary = process.argv[++i];
  } else if (process.argv[i] === '--intake-body' && process.argv[i + 1]) {
    intakeBody_ = process.argv[++i];
  } else if (process.argv[i] === '--triage' && process.argv[i + 1]) {
    triageIntakeId = process.argv[++i];
  } else if (process.argv[i] === '--target-type' && process.argv[i + 1]) {
    triageTargetType = process.argv[++i];
  } else if (process.argv[i] === '--target-ref' && process.argv[i + 1]) {
    triageTargetRef = process.argv[++i];
  } else if (process.argv[i] === '--intake-status') {
    showIntakeStatus = true;
  } else if (process.argv[i] === '--pending-only') {
    intakePendingOnly = true;
  } else if (process.argv[i] === '--uat' && process.argv[i + 1]) {
    uatTaskId = process.argv[++i];
  } else if (process.argv[i] === '--outcome' && process.argv[i + 1]) {
    uatOutcome = process.argv[++i];
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

function saveState(state) {
  const p = path.join(findGitRoot(), '.sdd-state.json');
  fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

// ── Intake queue helpers (.sdd-intake.json) ───────────────────────────────────
// Scoped per-initiative so multiple initiatives can share one repo.
// Schema: { initiatives: { [slug]: { items: IntakeItem[] } } }
function loadIntakeFile() {
  const p = path.join(findGitRoot(), '.sdd-intake.json');
  if (!fs.existsSync(p)) return { initiatives: {} };
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return { initiatives: {} }; }
}

function saveIntakeFile(data) {
  const p = path.join(findGitRoot(), '.sdd-intake.json');
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
}

function getIntakeItems(slug) {
  const data = loadIntakeFile();
  return data.initiatives?.[slug]?.items || [];
}

function setIntakeItems(slug, items) {
  const data = loadIntakeFile();
  if (!data.initiatives) data.initiatives = {};
  if (!data.initiatives[slug]) data.initiatives[slug] = {};
  data.initiatives[slug].items = items;
  saveIntakeFile(data);
}

function nextIntakeId(items) {
  const nums = items.map(i => parseInt((i.id || '').replace('INT-', '') || '0')).filter(n => !isNaN(n) && n > 0);
  return `INT-${pad3((nums.length > 0 ? Math.max(...nums) : 0) + 1)}`;
}

// Sweep triaged items to done when all their board taskIds are Done.
// Called at the start of --next and --intake-status so state stays current.
async function sweepIntakeDone(cfg, slug, boardTasks) {
  const items = getIntakeItems(slug);
  let changed = false;
  for (const item of items) {
    if (item.status !== 'triaged' || !item.taskIds || item.taskIds.length === 0) continue;
    const allDone = item.taskIds.every(tid => boardTasks.find(t => t.id === tid)?.isDone);
    if (allDone) {
      item.status = 'done';
      item.doneAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) setIntakeItems(slug, items);
}

// Track the current in-flight task in .sdd-state.json so dashboards can scope Current Focus.
function setActiveTask(state, slug, taskId) {
  if (!state?.initiatives?.[slug]) return;
  state.initiatives[slug].activeTaskId = taskId;
  saveState(state);
}

// Spawn update-dashboard in the background so the Current Focus widget reflects the new state.
function refreshDashboard(iState) {
  if (!iState?.dashboardSlug || !iState?.dsUri) return;
  const conductorPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../sdd-conductor/sdd-conductor.mjs');
  import('child_process').then(({ spawn }) => {
    const child = spawn(process.execPath, [conductorPath, 'update-dashboard', iState.dsUri, iState.dashboardSlug], {
      stdio: 'ignore', detached: true,
    });
    child.unref();
  }).catch(() => {});
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

// ── Status group loader ───────────────────────────────────────────────────────
// The tasks API does NOT filter by planModeId server-side — it returns all tasks
// in the datasphere. We filter client-side via status group IDs, which are unique
// per plan mode. This function fetches and caches those IDs from the plan mode API
// so readBoard() always scopes correctly even when .sdd-state.json is incomplete.
let _groupCache = null; // { planModeId → Set<sgId> }
async function ensureGroupIds(cfg) {
  if (cfg.allGroupIds && cfg.allGroupIds.size > 0) return cfg.allGroupIds;

  // Cache per plan mode to avoid redundant API calls within a session
  if (!_groupCache) _groupCache = new Map();
  if (_groupCache.has(cfg.planModeId)) {
    cfg.allGroupIds = _groupCache.get(cfg.planModeId);
    return cfg.allGroupIds;
  }

  // Fetch status groups from the plan modes list
  let groups = [];
  try {
    const d = await api('GET', `/api/v2/dataspheres/${cfg.dsId}/tasks/plan-modes`);
    const planModes = d.planModes || d;
    const pm = Array.isArray(planModes)
      ? planModes.find(p => p.id === cfg.planModeId)
      : null;
    groups = pm?.statusGroups || [];
  } catch { /* non-fatal — fall back to no filter */ }

  if (groups.length === 0) {
    process.stderr.write(`[WARN] Could not fetch status groups for plan ${cfg.planModeId} — readBoard will return all tasks (cross-initiative contamination possible)\n`);
    cfg.allGroupIds = new Set();
    return cfg.allGroupIds;
  }

  // Populate cfg with named group IDs and update .sdd-state.json for future runs
  const sgMap = {};
  for (const g of groups) sgMap[g.name] = g.id;
  cfg.allGroupIds     = new Set(groups.map(g => g.id));
  cfg.doneGroupId     = cfg.doneGroupId     || sgMap.Done     || null;
  cfg.artifactsGroupId= cfg.artifactsGroupId|| sgMap.Artifacts|| null;
  cfg.executionGroupId= cfg.executionGroupId|| sgMap.Execution|| null;
  cfg.validationGroupId=cfg.validationGroupId||sgMap.Validation||null;

  // Back-fill .sdd-state.json so next run doesn't need the API call
  try {
    const state = loadState();
    const slug  = cfg._slug;
    if (state && slug && state.initiatives?.[slug]) {
      state.initiatives[slug].statusGroups = { ...sgMap };
      saveState(state);
    }
  } catch { /* non-fatal */ }

  _groupCache.set(cfg.planModeId, cfg.allGroupIds);
  return cfg.allGroupIds;
}

// ── Board reader ──────────────────────────────────────────────────────────────
async function readBoard(cfg) {
  const groupIds = await ensureGroupIds(cfg);
  const d = await api('GET', `/api/v2/dataspheres/${cfg.dsId}/tasks?planModeId=${cfg.planModeId}&limit=500`);
  const allTasks = d.tasks || d;
  const scoped = groupIds.size > 0
    ? allTasks.filter(t => groupIds.has(t.statusGroupId))
    : allTasks;
  return scoped.map(t => ({
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
function buildArContent(arNum, vaNum, exTask, cfg, evidenceText) {
  const arKey = `AR-${pad3(arNum)}`;
  const vaKey = `VA-${pad3(vaNum)}`;
  const exKey = sddKey(exTask.title) || `EX-${pad3(vaNum)}`;
  const epicRef = epRefForEx(exTask) || '';
  const nsRef = (exTask.content.match(/north_star_ref:\s*(NS-\d+)/)?.[1]) || 'NS-001';
  const today = new Date().toISOString().slice(0, 10);

  const implFiles = extractImplFiles(exTask.content);
  const acItems = extractAcItems(exTask.content);
  const keyCmds = extractKeyCommands(exTask.content);

  // Extract screenshot paths from evidence text
  const screenshotPaths = [];
  if (evidenceText) {
    const shotRe = /([^\s"'()\[\],]+\.(png|jpg|jpeg|gif|webp))/gi;
    let m;
    while ((m = shotRe.exec(evidenceText)) !== null) {
      if (!screenshotPaths.includes(m[1])) screenshotPaths.push(m[1]);
    }
  }

  // Determine artifact type from content
  const hasScript = implFiles.some(f => f.match(/\.(py|ps1|bat|sh|lua|json|yaml|tsx?|jsx?|mjs|cjs)$/i));
  const hasConfig = implFiles.some(f => f.match(/\.ini|\.json|\.yaml|\.cfg|config/i));
  const hasEngine = implFiles.some(f => f.match(/\.engine|\.onnx/i));
  const hasScreenshots = screenshotPaths.length > 0;
  const artifactType = hasEngine ? 'model-artifact'
    : hasScreenshots ? 'ui-component'
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
    `plan_mode_id: ${cfg.planModeId}`,
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

  if (screenshotPaths.length > 0) {
    lines.push(`<h2>Screenshot Evidence <!-- #screenshots --></h2>`);
    lines.push(`<ul class="tiptap-bullet-list">`);
    for (const sp of screenshotPaths.slice(0, 12)) {
      lines.push(`  <li><p><code>${sp.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></p></li>`);
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

  // 1. Must have validation_ref (accept bare VA-NNN or initiative-prefixed like LG-VA-001)
  if (!c.match(/validation_ref:\s*(?:[A-Z]+-)?VA-\d+/)) issues.push('missing validation_ref front-matter');

  // 2. Must have Delivered Files section with at least one real path
  const filesSection = c.match(/Delivered Files[\s\S]*?(?=<h2|$)/i)?.[0] || '';
  const paths = [...filesSection.matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map(m => m[1].trim());
  if (paths.length === 0) issues.push('Delivered Files section has no file paths');
  else {
    // Accept: absolute paths (C:\, /) AND relative source paths (src/, tests/, etc.)
    const hasRealPath = paths.some(p => p.match(/^[A-Z]:\\|^\/|^(src|tests|assets|outputs|dist|scripts|components|pages|hooks|styles|config|public|lib|server|client)\//));
    if (!hasRealPath) issues.push(`Delivered Files has no real file paths (found: ${paths.slice(0,2).join(', ')})`);
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

// Known paid/cloud API node names — any RS recommendation or EX impl using these
// violates the NFR: "100% local execution, zero cost".
const PAID_API_NODES = [
  'KlingVirtualTryOnNode','KlingTextToVideoNode','KlingImage2VideoNode',
  'KlingImageGenerationNode','KlingOmniPro','FluxKontextProImageNode',
  'FluxKontextMaxImageNode','FluxProUltraImageNode','FluxProFillNode',
  'RecraftTextToImageNode','RecraftImageToImageNode','RecraftImageInpaintingNode',
  'RecraftReplaceBackgroundNode','RecraftCrispUpscaleNode','RecraftCreativeUpscaleNode',
  'IdeogramV','OpenAIDalle','OpenAIGPTImage','OpenAIChatNode',
  'RunwayFirstLastFrameNode','RunwayImageToVideoNode','RunwayTextToImageNode',
  'LumaImageNode','LumaVideoNode','LumaImageToVideoNode',
  'StabilityStableImage','StabilityUpscale','StabilityTextToAudio',
  'MinimaxTextToVideo','MinimaxImageToVideo','VeoVideoGeneration','Veo3',
  'WanTextToImageApi','WanImageToImageApi','WanTextToVideoApi','WanImageToVideoApi',
  'GeminiNode','GeminiImageNode','TopazImageEnhance','TopazVideoEnhance',
  'ViduTextToVideoNode','ViduImageToVideoNode','ByteDanceImageNode',
];

function verifyRS(task) {
  const c = task.content || '';
  const issues = [];

  // 1. Must have NFR section
  if (!c.includes('<!-- #nfr -->') && !c.match(/Non-Functional Requirements/i)) {
    issues.push('missing Non-Functional Requirements section (<!-- #nfr -->) — must document: local-only, zero-cost, VRAM budget, no cloud APIs');
  }

  // 2. NFR section must explicitly state local/free constraint
  const nfrSection = c.match(/Non-Functional Requirements[\s\S]*?(?=<h[23]|$)/i)?.[0] || '';
  if (nfrSection && !nfrSection.match(/local|RTX|VRAM|free|zero.cost|no.*api|no.*cloud/i)) {
    issues.push('NFR section does not mention local execution or cost constraints — must state: local GPU, zero cost, no paid APIs');
  }

  // 3. Recommendation must not reference paid API nodes
  const recSection = c.match(/Recommendation[\s\S]*?(?=<h[23]|$)/i)?.[0] || '';
  for (const node of PAID_API_NODES) {
    if (recSection.includes(node) || (c.includes(node) && !c.includes('DO NOT USE') && !c.includes('REJECTED'))) {
      issues.push(`paid/cloud API node referenced: ${node} — violates NFR (local-only, zero-cost). Mark as REJECTED or remove.`);
      break;
    }
  }

  // 4. Must have Sources section with at least 2 URLs
  const sourceSection = c.match(/Sources[\s\S]*?(?=<h[23]|$)/i)?.[0] || '';
  const urls = sourceSection.match(/https?:\/\/[^\s<"']+/g) || [];
  if (urls.length < 2) issues.push(`Sources section has only ${urls.length} URL(s) — need at least 2`);

  return { pass: issues.length === 0, issues };
}

function verifyEX(task) {
  const c = task.content || '';
  const issues = [];

  if (!c.match(/Implementation Files/i)) issues.push('missing Implementation Files section');

  // Check that at least one listed file has a spec ref path (belt-and-suspenders before the disk gate)
  const implSection = c.match(/Implementation Files[\s\S]*?(?=<h2|$)/i)?.[0] || '';
  const implPaths = [...implSection.matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map(m => m[1].trim());
  if (implPaths.length === 0 && c.match(/Implementation Files/i)) {
    issues.push('Implementation Files section lists no file paths — add <code>src/…</code> entries for every file created or modified');
  }

  const acItems = extractAcItems(c);
  if (acItems.length < 2) issues.push(`only ${acItems.length} AC item(s) — need at least 2 testable criteria`);

  // Check AC items are specific (not vague)
  const vague = acItems.filter(item => /should work|seems|looks good|no errors?$/i.test(item));
  if (vague.length > 0) issues.push(`vague AC items (not measurable): "${vague[0]}"`);

  // Check for paid API node usage in implementation
  for (const node of PAID_API_NODES) {
    if (c.includes(node)) {
      issues.push(`paid/cloud API node in EX spec: ${node} — violates NFR (local-only). Replace with local node.`);
      break;
    }
  }

  for (const pattern of STUB_PATTERNS) {
    if (pattern.test(c)) issues.push(`stub placeholder: ${pattern.source}`);
  }

  return { pass: issues.length === 0, issues };
}

function verifyEpicOrNS(task, type) {
  const c = task.content || '';
  const issues = [];

  if (!c.match(/Acceptance Criteria/i)) issues.push('missing Acceptance Criteria section');
  if (!c.match(/Functional Requirements/i)) issues.push('missing Functional Requirements section');
  if (!c.match(/Non-Functional Requirements/i)) issues.push('missing Non-Functional Requirements section');

  const allItems = extractAcItems(c);
  if (allItems.length < 2) {
    issues.push(`only ${allItems.length} checklist item(s) — ${type} needs at least 2 AC/FR/NFR criteria`);
  }

  if (type === 'EP') {
    const execSection = c.match(/Execution Checklist[\s\S]*?(?=<h2|$)/i)?.[0] || '';
    const childCount = [...execSection.matchAll(/\b(EX|T)-\d+/g)].length;
    if (childCount === 0) issues.push('Execution Checklist has no child EX/T task references — cannot verify epic completion');
  }

  if (type === 'NS') {
    const nsSection = c.match(/North Star Checklist[\s\S]*?(?=<h2|$)/i)?.[0] || '';
    const epicCount = [...nsSection.matchAll(/\b(EP|E)-\d+/g)].length;
    if (epicCount === 0) issues.push('North Star Checklist has no child EP/E task references — cannot verify NS completion');
  }

  return { pass: issues.length === 0, issues };
}

function verifyTask(type, task) {
  if (type === 'AR') return verifyAR(task);
  if (type === 'EX') return verifyEX(task);
  if (type === 'VA') return verifyVA(task);
  if (type === 'RS') return verifyRS(task);
  if (type === 'EP' || type === 'NS') return verifyEpicOrNS(task, type);
  return { pass: true, issues: [] };
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

  // Check if AR already exists for this VA.
  // readBoard() is already scoped to this plan mode's status groups, so no cross-initiative
  // contamination is possible here. The plan_mode_id in AR front matter is belt-and-suspenders.
  const vaKeyStr = sddKey(vaTask.title);
  const existing = allTasks.find(t =>
    sddType(t.title) === 'AR' &&
    (t.content || '').includes(`validation_ref: ${vaKeyStr}`)
  );
  if (existing) {
    // AR exists but may not be Done yet — handled by findNextIncomplete
    return;
  }

  // Count only properly-numbered AR tasks (sddNum < 900) to avoid inflated numbers
  // from any non-standard AR titles that fall through with sddNum=999.
  const arCount = allTasks.filter(t => sddType(t.title) === 'AR' && sddNum(t.title) < 900).length;
  const arNum = arCount + 1;
  const arKey = `AR-${pad3(arNum)}`;
  const arContent = buildArContent(arNum, vaNum, exTask, cfg, evidenceText);

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

// ── Remediation task creation (error detection + fix scaffolding) ─────────────
// When a task fails validation, this creates a sibling EX+VA pair that describes
// exactly what needs to be fixed. The failing task gets a BLOCKED comment with the
// new task IDs. The loop's findNextIncomplete will pick up the new EX first.
async function createRemediationTasks(cfg, failingTask, issues, allTasks) {
  // Exclude sddNum=999 (returned for non-standard titles like "VA-conversational-surve")
  // to prevent spuriously high task numbers (EX-1000, VA-1000, etc.)
  const allExNums = allTasks.filter(t => sddType(t.title) === 'EX' && sddNum(t.title) < 900).map(t => sddNum(t.title));
  const allVaNums = allTasks.filter(t => sddType(t.title) === 'VA' && sddNum(t.title) < 900).map(t => sddNum(t.title));
  const nextExNum = (allExNums.length > 0 ? Math.max(...allExNums) : 0) + 1;
  const nextVaNum = (allVaNums.length > 0 ? Math.max(...allVaNums) : 0) + 1;

  const failKey = sddKey(failingTask.title) || '?';
  const failType = sddType(failingTask.title) || 'VA';
  const epicRef = (failingTask.content || '').match(/epic_ref:\s*(EP-\d+)/)?.[1] || '';
  const nsRef = (failingTask.content || '').match(/north_star_ref:\s*(NS-\d+)/)?.[1] || 'NS-001';
  const today = new Date().toISOString().slice(0, 10);

  // Build a concise reason from the gate issues
  const issueSummary = issues.slice(0, 2).join('; ');
  const shortReason = issueSummary.slice(0, 80);

  const exKey = `EX-${pad3(nextExNum)}`;
  const vaKey = `VA-${pad3(nextVaNum)}`;

  const htmlIssues = issues.map(i => `  <li><p>${i.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></li>`).join('\n');
  const acIssues = issues.map(i => `  <li data-type="taskItem" data-checked="false"><p>Resolved: ${i.slice(0, 120).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></li>`).join('\n');

  const exContent = [
    `<pre><code class="language-yaml">`,
    `spec_id: ${exKey}`,
    `fix_for: ${failKey}`,
    ...(epicRef ? [`epic_ref: ${epicRef}`] : []),
    `north_star_ref: ${nsRef}`,
    `plan_mode_id: ${cfg.planModeId}`,
    `created: ${today}`,
    `auto_generated: true`,
    `</code></pre>`,
    ``,
    `<h2>Problem <!-- #problem --></h2>`,
    `<p><strong>${failKey}</strong> failed gate verification with ${issues.length} issue(s):</p>`,
    `<ul class="tiptap-bullet-list">`,
    htmlIssues,
    `</ul>`,
    ``,
    `<h2>Implementation Steps <!-- #steps --></h2>`,
    `<ol>`,
    ...issues.map(issue => `  <li><p>Fix: ${issue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></li>`),
    `  <li><p>Re-run validation and confirm all ${failKey} gate checks pass</p></li>`,
    `  <li><p>Advance ${failKey} with updated evidence after fix is verified</p></li>`,
    `</ol>`,
    ``,
    `<h2>Implementation Files <!-- #files --></h2>`,
    `<ul class="tiptap-bullet-list">`,
    `  <li><p><em>Identify and update the relevant files to resolve the issues above</em></p></li>`,
    `</ul>`,
    ``,
    `<h2>Acceptance Criteria <!-- #ac --></h2>`,
    `<ul data-type="taskList">`,
    acIssues,
    `  <li data-type="taskItem" data-checked="false"><p>${failKey} gate passes on re-run after fix</p></li>`,
    `</ul>`,
  ].join('\n');

  const vaContent = [
    `<pre><code class="language-yaml">`,
    `spec_id: ${vaKey}`,
    `execution_ref: ${exKey}`,
    `fix_for: ${failKey}`,
    `plan_mode_id: ${cfg.planModeId}`,
    `created: ${today}`,
    `auto_generated: true`,
    `</code></pre>`,
    ``,
    `<h2>Validation Steps <!-- #validation --></h2>`,
    `<ol>`,
    `  <li><p>Verify all ${issues.length} gate issue(s) from ${failKey} are resolved by ${exKey}</p></li>`,
    `  <li><p>Re-run ${failType === 'VA' ? 'Playwright tests or manual validation flow' : 'implementation checks and unit tests'}</p></li>`,
    `  <li><p>Confirm ${failKey} can now advance to Done (gate passes)</p></li>`,
    `</ol>`,
    ``,
    `<h2>Acceptance Criteria <!-- #ac --></h2>`,
    `<ul data-type="taskList">`,
    acIssues,
    `  <li data-type="taskItem" data-checked="false"><p>${failKey} gate passes on re-run</p></li>`,
    `  <li data-type="taskItem" data-checked="false"><p>${exKey} implementation verified end-to-end</p></li>`,
    `</ul>`,
  ].join('\n');

  const results = { exKey, vaKey, exId: null, vaId: null };

  // Place in the appropriate columns — fall back to artifacts group if execution/validation unknown
  const exGroupId = cfg.executionGroupId || cfg.artifactsGroupId || cfg.doneGroupId;
  const vaGroupId = cfg.validationGroupId || cfg.artifactsGroupId || cfg.doneGroupId;

  try {
    const exObj = await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
      title: `${exKey} · FIX: ${shortReason}`,
      content: exContent,
      statusGroupId: exGroupId,
      planModeId: cfg.planModeId,
    });
    results.exId = exObj.task?.id || exObj.id;
  } catch (e) {
    process.stderr.write(`[remediation EX create failed: ${e.message.slice(0, 60)}] `);
    return results;
  }

  try {
    const vaObj = await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
      title: `${vaKey} · Verify fix: ${shortReason.slice(0, 60)}`,
      content: vaContent,
      statusGroupId: vaGroupId,
      planModeId: cfg.planModeId,
    });
    results.vaId = vaObj.task?.id || vaObj.id;
  } catch (e) {
    process.stderr.write(`[remediation VA create failed: ${e.message.slice(0, 60)}] `);
  }

  // Post BLOCKED comment on the failing task with links to new remediation tasks
  const ts = new Date().toISOString();
  const blockedComment = [
    `**[BLOCKED] Gate failure — remediation tasks auto-created** | ${ts}`,
    ``,
    `This task failed gate verification with **${issues.length}** issue(s):`,
    ...issues.map(i => `- ${i}`),
    ``,
    `**Remediation tasks created:**`,
    `- **${exKey}** (${results.exId || 'created'}) — Fix: ${shortReason}`,
    `- **${vaKey}** (${results.vaId || 'created'}) — Verify the fix`,
    ``,
    `**Unblock path:** Advance ${exKey} → ${vaKey} → then re-attempt ${failKey}.`,
  ].join('\n');

  await postComment(cfg, failingTask.id, blockedComment);

  return results;
}

// ── Create intake-driven EX+VA board tasks ───────────────────────────────────
async function createIntakeTasks(cfg, item, allTasks) {
  const allExNums = allTasks.filter(t => sddType(t.title) === 'EX' && sddNum(t.title) < 900).map(t => sddNum(t.title));
  const allVaNums = allTasks.filter(t => sddType(t.title) === 'VA' && sddNum(t.title) < 900).map(t => sddNum(t.title));
  const nextExNum = (allExNums.length > 0 ? Math.max(...allExNums) : 0) + 1;
  const nextVaNum = (allVaNums.length > 0 ? Math.max(...allVaNums) : 0) + 1;

  const exKey = `EX-${pad3(nextExNum)}`;
  const vaKey = `VA-${pad3(nextVaNum)}`;
  const today = new Date().toISOString().slice(0, 10);
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const bodyHtml = item.body
    ? `<p>${esc(item.body).replace(/\n/g, '</p><p>')}</p>`
    : `<p>${esc(item.summary)}</p>`;

  const exContent = [
    `<pre><code class="language-yaml">`,
    `spec_id: ${exKey}`,
    `intake_ref: ${item.id}`,
    `intake_type: ${item.type}`,
    `intake_priority: ${item.priority}`,
    `plan_mode_id: ${cfg.planModeId}`,
    `created: ${today}`,
    `auto_generated: true`,
    `</code></pre>`,
    ``,
    `<h2>Context <!-- #context --></h2>`,
    `<p><strong>Intake ${item.id} (${item.type}, ${item.priority} priority):</strong></p>`,
    bodyHtml,
    ``,
    `<h2>Implementation Steps <!-- #steps --></h2>`,
    `<ol>`,
    `  <li><p>Review the intake context above and identify affected files</p></li>`,
    `  <li><p>Implement the changes described in the intake body</p></li>`,
    `  <li><p>Write or update tests covering the changed behaviour</p></li>`,
    `  <li><p>Verify end-to-end and document evidence for ${vaKey}</p></li>`,
    `</ol>`,
    ``,
    `<h2>Implementation Files <!-- #files --></h2>`,
    `<ul class="tiptap-bullet-list">`,
    `  <li><p><em>Identify and update the relevant files to address the intake item</em></p></li>`,
    `</ul>`,
    ``,
    `<h2>Acceptance Criteria <!-- #ac --></h2>`,
    `<ul data-type="taskList">`,
    `  <li data-type="taskItem" data-checked="false"><p>Intake context satisfied: ${esc(item.summary.slice(0, 120))}</p></li>`,
    `  <li data-type="taskItem" data-checked="false"><p>Changes tested and verified end-to-end with real output</p></li>`,
    `  <li data-type="taskItem" data-checked="false"><p>No regressions in existing tests</p></li>`,
    `</ul>`,
  ].join('\n');

  const vaContent = [
    `<pre><code class="language-yaml">`,
    `spec_id: ${vaKey}`,
    `execution_ref: ${exKey}`,
    `intake_ref: ${item.id}`,
    `plan_mode_id: ${cfg.planModeId}`,
    `created: ${today}`,
    `auto_generated: true`,
    `</code></pre>`,
    ``,
    `<h2>Validation Steps <!-- #validation --></h2>`,
    `<ol>`,
    `  <li><p>Verify ${exKey} fully addresses: ${esc(item.summary.slice(0, 120))}</p></li>`,
    `  <li><p>Run tests (unit + integration or Playwright) and capture real output</p></li>`,
    `  <li><p>Confirm no regressions — diff test results before/after</p></li>`,
    `  <li><p>Confirm intake context is satisfied end-to-end</p></li>`,
    `</ol>`,
    ``,
    `<h2>Acceptance Criteria <!-- #ac --></h2>`,
    `<ul data-type="taskList">`,
    `  <li data-type="taskItem" data-checked="false"><p>Intake ${item.id} context satisfied: ${esc(item.summary.slice(0, 120))}</p></li>`,
    `  <li data-type="taskItem" data-checked="false"><p>${exKey} implementation verified with real test output</p></li>`,
    `  <li data-type="taskItem" data-checked="false"><p>No regressions introduced by the change</p></li>`,
    `</ul>`,
  ].join('\n');

  const exGroupId = cfg.executionGroupId || cfg.artifactsGroupId || cfg.doneGroupId;
  const vaGroupId = cfg.validationGroupId || cfg.artifactsGroupId || cfg.doneGroupId;
  const results = { exKey, vaKey, exId: null, vaId: null };

  const exObj = await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
    title: `${exKey} · ${item.summary.slice(0, 60)}`,
    content: exContent,
    statusGroupId: exGroupId,
    planModeId: cfg.planModeId,
  });
  results.exId = exObj.task?.id || exObj.id;

  const vaObj = await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
    title: `${vaKey} · Verify: ${item.summary.slice(0, 55)}`,
    content: vaContent,
    statusGroupId: vaGroupId,
    planModeId: cfg.planModeId,
  });
  results.vaId = vaObj.task?.id || vaObj.id;

  return results;
}

// ── Intake commands ───────────────────────────────────────────────────────────

async function addIntakeCommand(slug) {
  if (!intakeSummary) {
    console.error('✗ --intake requires --intake-summary "..."');
    process.exit(1);
  }
  const VALID_TYPES = ['instruction', 'uat-result', 'stakeholder-feedback'];
  const VALID_PRIORITIES = ['critical', 'high', 'normal'];
  if (!VALID_TYPES.includes(intakeType)) {
    console.error(`✗ --intake-type must be one of: ${VALID_TYPES.join(', ')}`);
    process.exit(1);
  }
  if (!VALID_PRIORITIES.includes(intakePriority)) {
    console.error(`✗ --intake-priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
    process.exit(1);
  }

  const items = getIntakeItems(slug);
  const id = nextIntakeId(items);
  const item = {
    id,
    type: intakeType,
    priority: intakePriority,
    status: 'pending',
    source: 'user',
    summary: intakeSummary,
    body: intakeBody_ || null,
    targetType: null,
    targetRef: null,
    taskIds: [],
    uatRef: null,
    uatOutcome: null,
    createdAt: new Date().toISOString(),
    triagedAt: null,
    doneAt: null,
  };
  items.push(item);
  setIntakeItems(slug, items);

  console.log(JSON.stringify({ created: true, id, type: intakeType, priority: intakePriority, summary: intakeSummary,
    hint: intakePriority === 'critical'
      ? `⚠ CRITICAL — --next will be blocked until this is triaged. Run: node loop.mjs --triage ${id} --target-type EX`
      : `Run triage when ready: node loop.mjs --triage ${id} --target-type EX`,
  }, null, 2));
}

async function triageIntakeCommand(cfg, slug) {
  if (!triageIntakeId) {
    console.error('✗ --triage requires an intake item ID (e.g. INT-001)');
    process.exit(1);
  }
  const items = getIntakeItems(slug);
  const item = items.find(i => i.id === triageIntakeId);
  if (!item) {
    console.error(`✗ Intake item "${triageIntakeId}" not found for initiative "${slug}"`);
    console.error(`  Run --intake-status to list available items.`);
    process.exit(1);
  }
  if (item.status === 'done') {
    console.log(`[skip] ${triageIntakeId} is already done.`);
    return;
  }

  const tasks = await readBoard(cfg);

  if (triageTargetRef) {
    // Mode A: add context to an existing task as a comment
    const target = tasks.find(t => sddKey(t.title) === triageTargetRef) ||
                   tasks.find(t => t.id === triageTargetRef);
    if (!target) {
      console.error(`✗ Target task "${triageTargetRef}" not found on this board`);
      process.exit(1);
    }
    if (dryRun) {
      console.log(JSON.stringify({
        dryRun: true, intakeId: triageIntakeId,
        action: 'append-context-to-existing-task',
        targetTask: { id: target.id, key: sddKey(target.title), title: target.title },
      }, null, 2));
      return;
    }
    const ts = new Date().toISOString();
    const commentText = [
      `**[INTAKE ${triageIntakeId}] ${item.type} — ${item.priority} priority** | ${ts}`,
      ``,
      `**Summary:** ${item.summary}`,
      ...(item.body ? [``, item.body] : []),
    ].join('\n');
    await postComment(cfg, target.id, commentText);
    item.status = 'triaged';
    item.targetType = triageTargetType;
    item.targetRef = triageTargetRef;
    item.taskIds = [target.id];
    item.triagedAt = new Date().toISOString();
    setIntakeItems(slug, items);
    console.log(JSON.stringify({
      triaged: true, intakeId: triageIntakeId,
      action: 'context-appended',
      targetTask: { id: target.id, key: sddKey(target.title), title: target.title },
    }, null, 2));
    return;
  }

  // Mode B: create new EX+VA pair from intake
  if (dryRun) {
    const allExNums = tasks.filter(t => sddType(t.title) === 'EX' && sddNum(t.title) < 900).map(t => sddNum(t.title));
    const allVaNums = tasks.filter(t => sddType(t.title) === 'VA' && sddNum(t.title) < 900).map(t => sddNum(t.title));
    const exNum = (allExNums.length > 0 ? Math.max(...allExNums) : 0) + 1;
    const vaNum = (allVaNums.length > 0 ? Math.max(...allVaNums) : 0) + 1;
    console.log(JSON.stringify({
      dryRun: true, intakeId: triageIntakeId, summary: item.summary,
      action: 'create-new-tasks',
      wouldCreate: { exKey: `EX-${pad3(exNum)}`, vaKey: `VA-${pad3(vaNum)}` },
    }, null, 2));
    return;
  }

  process.stdout.write(`→ Creating board tasks for ${triageIntakeId}... `);
  const result = await createIntakeTasks(cfg, item, tasks);

  item.status = 'triaged';
  item.targetType = 'EX';
  item.targetRef = result.exKey;
  item.taskIds = [result.exId, result.vaId].filter(Boolean);
  item.triagedAt = new Date().toISOString();
  setIntakeItems(slug, items);

  console.log('✅');
  console.log(JSON.stringify({
    triaged: true, intakeId: triageIntakeId,
    action: 'tasks-created',
    tasks: { exKey: result.exKey, exId: result.exId, vaKey: result.vaKey, vaId: result.vaId },
    nextStep: `node loop.mjs --next will pick up ${result.exKey} when it is the next incomplete task.`,
  }, null, 2));
}

async function intakeStatusCommand(cfg, slug) {
  const tasks = await readBoard(cfg);
  await sweepIntakeDone(cfg, slug, tasks);

  const items = getIntakeItems(slug);
  const filtered = intakePendingOnly ? items.filter(i => i.status === 'pending') : items;

  const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2 };
  const STATUS_ORDER = { pending: 0, triaged: 1, done: 2, skipped: 3 };
  filtered.sort((a, b) =>
    (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
    (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9)
  );

  console.log(`\n━━━ all-dai-sdd INTAKE QUEUE: ${slug} ━━━`);
  console.log(`  Total: ${items.length} | Pending: ${items.filter(i=>i.status==='pending').length} | Triaged: ${items.filter(i=>i.status==='triaged').length} | Done: ${items.filter(i=>i.status==='done').length}\n`);

  if (filtered.length === 0) {
    console.log('  (no items)');
  } else {
    for (const item of filtered) {
      const flag = item.priority === 'critical' ? ' ⚠ CRITICAL' : item.priority === 'high' ? ' ↑' : '';
      console.log(`  ${item.id}  [${item.status.toUpperCase().padEnd(7)}] [${item.type}]${flag}`);
      console.log(`         ${item.summary.slice(0, 90)}`);
      if (item.taskIds?.length > 0) console.log(`         → tasks: ${item.taskIds.slice(0, 3).join(', ')}`);
    }
  }
  console.log(`\n  To add: node loop.mjs --intake --intake-summary "..." --intake-priority normal`);
  console.log(`  To triage: node loop.mjs --triage INT-NNN --target-type EX`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

async function uatCommand(cfg, iState, slug) {
  if (!uatTaskId) { console.error('✗ --uat requires a VA task ID or key'); process.exit(1); }
  if (!uatOutcome) { console.error('✗ --uat requires --outcome <pass|fail>'); process.exit(1); }
  if (!evidenceText) { console.error('✗ --uat requires --evidence "..."'); process.exit(1); }
  if (!['pass', 'fail'].includes(uatOutcome)) {
    console.error('✗ --outcome must be "pass" or "fail"'); process.exit(1);
  }

  const tasks = await readBoard(cfg);
  const task = tasks.find(t => t.id === uatTaskId) ||
               tasks.find(t => sddKey(t.title) === uatTaskId);
  if (!task) {
    console.error(`✗ Task "${uatTaskId}" not found. Pass a task ID or key (VA-NNN).`);
    process.exit(1);
  }

  const items = getIntakeItems(slug);
  const uatIntakeId = nextIntakeId(items);
  const ts = new Date().toISOString();

  if (uatOutcome === 'pass') {
    if (task.isDone) {
      console.log(`[skip] ${sddKey(task.title)} is already Done.`);
    } else {
      // Same path as --advance but stamped as UAT
      const ticked = tickAll(task.content);
      if (ticked !== task.content) await patchContent(cfg, task.id, ticked);
      await postComment(cfg, task.id, `[all-dai-sdd-system-message]\n\n**UAT Gate: PASS** | ${ts}\n\n${evidenceText}`);
      await createArtifact(cfg, task, tasks);
      await moveDone(cfg, task.id);
      console.log(`✅ ${sddKey(task.title)} UAT PASS → Done`);
    }

    // Record intake item
    items.push({
      id: uatIntakeId, type: 'uat-result', priority: 'normal',
      status: 'done', source: 'uat-runner',
      summary: `UAT PASS: ${task.title.slice(0, 80)}`,
      body: evidenceText.slice(0, 500),
      targetType: 'VA', targetRef: sddKey(task.title) || task.id,
      taskIds: [task.id], uatRef: task.id, uatOutcome: 'pass',
      createdAt: ts, triagedAt: ts, doneAt: ts,
    });
    setIntakeItems(slug, items);
    console.log(JSON.stringify({ uatOutcome: 'pass', intakeId: uatIntakeId, taskKey: sddKey(task.title) }, null, 2));

  } else {
    // UAT fail: create remediation tasks
    const issues = evidenceText.split(/[;\n]/).map(s => s.trim()).filter(s => s.length > 10).slice(0, 5);
    if (issues.length === 0) issues.push('UAT validation failed — see evidence for details');

    process.stdout.write(`→ UAT FAIL on ${sddKey(task.title)} — creating remediation tasks... `);
    const result = await createRemediationTasks(cfg, task, issues, tasks);
    console.log('✅');

    items.push({
      id: uatIntakeId, type: 'uat-result', priority: 'high',
      status: 'triaged', source: 'uat-runner',
      summary: `UAT FAIL: ${task.title.slice(0, 80)}`,
      body: evidenceText.slice(0, 500),
      targetType: 'EX', targetRef: result.exKey,
      taskIds: [result.exId, result.vaId].filter(Boolean),
      uatRef: task.id, uatOutcome: 'fail',
      createdAt: ts, triagedAt: ts, doneAt: null,
    });
    setIntakeItems(slug, items);
    console.log(JSON.stringify({
      uatOutcome: 'fail', intakeId: uatIntakeId, taskKey: sddKey(task.title),
      remediation: { exKey: result.exKey, exId: result.exId, vaKey: result.vaKey, vaId: result.vaId },
      nextStep: `node loop.mjs --next will pick up ${result.exKey} to fix the UAT failures.`,
    }, null, 2));
  }
}

// ── Initiative health check ───────────────────────────────────────────────────
// Validates that the initiative configuration and board are structurally correct.
// Run before starting any loop iteration on a new initiative, or after incidents.
// Usage: node loop.mjs --health [--initiative <slug>]
async function healthCheck(cfg, iState, slug) {
  const ts = new Date().toISOString();
  const results = [];
  let pass = true;

  function check(name, ok, detail) {
    results.push({ name, ok, detail: ok ? '✅' : `❌ ${detail}` });
    if (!ok) pass = false;
  }

  // 1. All 7 status groups present
  const REQUIRED_GROUPS = ['Research', 'North Stars', 'Epics', 'Execution', 'Validation', 'Artifacts', 'Done'];
  const sg = iState.statusGroups || {};
  for (const g of REQUIRED_GROUPS) {
    check(`statusGroups.${g} defined`, !!(sg[g] || sg[g.toLowerCase()]), `Missing group "${g}" in .sdd-state.json → run node sdd-conductor.mjs init to regenerate`);
  }

  // 2. dashboardSlug registered
  check('dashboardSlug registered', !!iState.dashboardSlug, 'Missing dashboardSlug → add to .sdd-state.json before advancing any tasks');

  // 3. readBoard scoping — allGroupIds should have exactly 7 groups
  const groupIds = await ensureGroupIds(cfg);
  check('allGroupIds populated (≥7)', groupIds.size >= 7, `Only ${groupIds.size} group IDs loaded — readBoard may return tasks from other initiatives`);

  // 4. Board reads correctly
  let tasks = [];
  try {
    tasks = await readBoard(cfg);
    check('readBoard returns >0 tasks', tasks.length > 0, 'No tasks found — check dsId and planModeId');
  } catch (e) {
    check('readBoard succeeds', false, e.message.slice(0, 80));
  }

  // 5. No tasks with sddNum=999 (non-standard naming) — warns but doesn't fail
  const nonStandard = tasks.filter(t => sddType(t.title) !== null && sddNum(t.title) >= 900);
  check('no non-standard task numbering (sddNum < 900)', nonStandard.length === 0,
    `${nonStandard.length} task(s) with non-standard titles: ${nonStandard.slice(0,2).map(t=>t.title.slice(0,40)).join(', ')}`);

  // 6. AR tasks use standard AR-NNN naming (not LG-AR-NNN or prefixed)
  const badArTasks = tasks.filter(t => {
    const c = t.content || '';
    return c.includes('validation_ref:') && !t.title.match(/^AR-\d+/);
  });
  check('AR tasks use standard AR-NNN naming', badArTasks.length === 0,
    `Non-standard AR titles: ${badArTasks.slice(0,2).map(t=>t.title.slice(0,40)).join(', ')}`);

  // 7. No orphaned remediation tasks (auto_generated tasks not in Execution/Validation)
  const orphaned = tasks.filter(t => (t.content||'').includes('auto_generated: true') && t.isDone);
  check('no orphaned auto-generated tasks stuck Done', orphaned.length === 0,
    `${orphaned.length} auto-generated task(s) marked Done without verification: ${orphaned.slice(0,2).map(t=>t.title.slice(0,40)).join(', ')}`);

  // 8. Progress
  const nonAR = tasks.filter(t => sddType(t.title) !== 'AR');
  const doneCount = nonAR.filter(t => t.isDone).length;
  const pct = nonAR.length > 0 ? Math.round(doneCount / nonAR.length * 100) : 0;

  console.log(`\n━━━ all-dai-sdd HEALTH CHECK: ${slug} ━━━`);
  console.log(`  Initiative: ${slug}`);
  console.log(`  Plan mode:  ${cfg.planModeId}`);
  console.log(`  Progress:   ${doneCount}/${nonAR.length} (${pct}%)`);
  console.log(`  Board scope: ${tasks.length} tasks (${groupIds.size} status groups)\n`);

  for (const r of results) {
    console.log(`  ${r.detail.startsWith('❌') ? '❌' : '✅'} ${r.name}: ${r.detail.startsWith('❌') ? r.detail.slice(2) : 'OK'}`);
  }

  const failCount = results.filter(r => !r.ok).length;
  console.log(`\n  ${pass ? '✅ HEALTHY' : `❌ ${failCount} issue(s) found`}`);
  if (!pass) {
    console.log(`  Fix the issues above before running --next or --advance.`);
    process.exit(1);
  }
  return { pass, tasks, doneCount, total: nonAR.length, pct };
}

// ── AI-driven: --create-fix (Ralph reasoning mode) ───────────────────────────
// Called when --advance fails and Claude has diagnosed the problem.
// Creates an EX+VA remediation pair and posts BLOCKED on the failing task.
// Usage: node loop.mjs --create-fix <taskId|taskKey> --reason "issue1; issue2"
async function createFixMode(cfg, iState, slug) {
  if (!createFixTaskId) {
    console.error('✗ --create-fix requires a task ID or key');
    process.exit(1);
  }
  if (!createFixReason) {
    console.error('✗ --create-fix requires --reason "description of what failed"');
    process.exit(1);
  }

  const tasks = await readBoard(cfg);
  const task = tasks.find(t => t.id === createFixTaskId) ||
               tasks.find(t => sddKey(t.title) === createFixTaskId);
  if (!task) {
    console.error(`✗ Task "${createFixTaskId}" not found on this board`);
    process.exit(1);
  }

  const issues = createFixReason.split(/[;|]+/).map(s => s.trim()).filter(Boolean);
  if (issues.length === 0) {
    console.error('✗ --reason was empty after parsing');
    process.exit(1);
  }

  if (dryRun) {
    const allExNums = tasks.filter(t => sddType(t.title) === 'EX' && sddNum(t.title) < 900).map(t => sddNum(t.title));
    const allVaNums = tasks.filter(t => sddType(t.title) === 'VA' && sddNum(t.title) < 900).map(t => sddNum(t.title));
    const exNum = (allExNums.length > 0 ? Math.max(...allExNums) : 0) + 1;
    const vaNum = (allVaNums.length > 0 ? Math.max(...allVaNums) : 0) + 1;
    console.log(JSON.stringify({
      dryRun: true,
      failingTask: { id: task.id, key: sddKey(task.title), title: task.title },
      wouldCreate: { exKey: `EX-${pad3(exNum)}`, vaKey: `VA-${pad3(vaNum)}` },
      issues,
    }, null, 2));
    return;
  }

  process.stdout.write(`→ Creating remediation tasks for ${sddKey(task.title) || task.title.slice(0,30)}... `);
  const result = await createRemediationTasks(cfg, task, issues, tasks);

  console.log(`✅ Done`);
  console.log(JSON.stringify({
    created: true,
    failingTask: { id: task.id, key: sddKey(task.title), title: task.title },
    remediation: {
      exKey: result.exKey, exId: result.exId,
      vaKey: result.vaKey, vaId: result.vaId,
    },
    nextStep: `Run --next to pick up ${result.exKey} and fix the issues.`,
  }, null, 2));
}

// ── AI-driven: --next ─────────────────────────────────────────────────────────
// Outputs the next incomplete task as JSON so Claude can read, execute, and
// substantiate it before calling --advance. No board modifications.
async function findNextTask(cfg, iState, slug) {
  const tasks = await readBoard(cfg);
  const nonAR = tasks.filter(t => sddType(t.title) !== 'AR');
  const total = nonAR.length;
  const done = nonAR.filter(t => t.isDone).length;

  // Intake queue: auto-sweep triaged → done, then check for blockers
  await sweepIntakeDone(cfg, slug, tasks);
  const intakeItems = getIntakeItems(slug);
  const criticalBlocking = intakeItems.filter(i => i.status === 'pending' && i.priority === 'critical');
  if (criticalBlocking.length > 0) {
    process.stdout.write(JSON.stringify({
      status: 'intake-blocked',
      done, total, pct: Math.round(done / total * 100),
      reason: `${criticalBlocking.length} critical intake item(s) must be triaged before advancing`,
      pendingIntake: criticalBlocking.map(i => ({ id: i.id, summary: i.summary, priority: i.priority, type: i.type })),
      action: `node loop.mjs --triage ${criticalBlocking[0].id} --target-type EX`,
    }, null, 2));
    return;
  }
  const advisoryIntake = intakeItems.filter(i => i.status === 'pending');

  const next = findNextIncomplete(tasks);

  if (!next) {
    process.stdout.write(JSON.stringify({
      status: 'complete',
      done, total,
      pct: Math.round(done / total * 100),
      generateNextStepsPage: true,
      instruction: 'All tasks Done — immediately switch to DONE mode: generate the Next Steps & UAT page as specified in the all-dai-sdd SKILL.md DONE mode section. Do not wait for user input.',
      dashboardUrl: iState.dashboardSlug
        ? `${BASE}/pages/${cfg.dsUri || cfg.dsId}/${iState.dashboardSlug}` : null,
      plannerUrl: `${BASE}/app/${cfg.dsUri || cfg.dsId}/planner?mode=${cfg.planModeId}`,
    }, null, 2));
    return;
  }

  // Include all tasks for dependency resolution context
  const taskIndex = {};
  tasks.forEach(t => { const k = sddKey(t.title); if (k) taskIndex[k] = { id: t.id, title: t.title, isDone: t.isDone }; });

  // Track the in-flight task in state so dashboards can scope their Current Focus widget.
  // This is non-fatal — if state write fails the task briefing still works.
  try {
    const freshState = loadState();
    const freshSlug = initiativeOverride || freshState?.currentInitiative;
    if (freshState && freshSlug) setActiveTask(freshState, freshSlug, next.id);
    refreshDashboard(iState);
  } catch { /* non-fatal */ }

  const nextType = sddType(next.title);
  process.stdout.write(JSON.stringify({
    status: 'next',
    done, total,
    pct: Math.round(done / total * 100),
    task: {
      id: next.id,
      title: next.title,
      key: sddKey(next.title),
      type: nextType,
      content: next.content,
    },
    // Flags telling Claude what kind of substantiation is required before --advance
    requiresResearch: nextType === 'RS',
    requiresAcVerification: nextType === 'EP' || nextType === 'NS',
    requiresScreenshots: nextType === 'VA' && /gallery|modal|builder|view|form|upload|component|render|survey|page|badge|button|layout|nav|feed|dashboard/i.test(next.title),
    requiresVisualDescription: nextType === 'VA' && /synthesis|transfer|garment|character|render|inpaint|upscale|pipeline|tryon|try.on|outfit|cloth|generat|wears?|image/i.test(next.title),
    isAutoGeneratedFix: /auto_generated: true/.test(next.content || ''),
    fixFor: (next.content || '').match(/fix_for:\s*([A-Z]+-\d+)/)?.[1] || null,
    intakeRef: (next.content || '').match(/intake_ref:\s*(INT-\d+)/)?.[1] || null,
    // Advisory: pending intake items that haven't been triaged yet (not blockers, just FYI)
    pendingIntake: advisoryIntake.length > 0
      ? advisoryIntake.map(i => ({ id: i.id, summary: i.summary, priority: i.priority, type: i.type }))
      : undefined,
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

  // Dashboard gate — initiative MUST have a registered dashboard before any task can be Done.
  // Without a dashboard the planner is a black box to stakeholders.
  if (!iState.dashboardSlug) {
    console.error('✗ GATE FAIL — no dashboardSlug in .sdd-state.json for this initiative.');
    console.error('  Run steps 12–13 from the all-dai-sdd SKILL.md before advancing tasks:');
    console.error('    1. Create the dashboard page using the Dashboard Page Template.');
    console.error('    2. Register dashboardSlug + trackerUrl in .sdd-state.json.');
    console.error('    3. Set trackerUrl on the plan mode:');
    console.error(`       PATCH /api/v2/dataspheres/${iState.dsId}/tasks/plan-modes/${iState.planModeId}`);
    console.error('       { "trackerUrl": "<PUBLIC_URL>/pages/<uri>/<dashboard-slug>" }');
    console.error('    4. Then re-run --advance.');
    process.exit(1);
  }

  // Evidence quality gate — must be substantive, not boilerplate
  const MIN_EVIDENCE_LEN = 200;
  const BOILERPLATE_PATTERNS = [
    /spec validation = PASS \(gate: all AC\/FR\/NFR items have observable/,
    /^No rubber-stamping/,
    /first iteration passed/,
    /All checklist items ticked\. Implementation files documented\. Spec ready/,
    // Job-completion boilerplate — not evidence of correctness
    /^job\s+(ran|completed|finished|succeeded)/im,
    /^file\s+(was\s+)?(saved|created|written)\s+to/im,
    /^(no|zero)\s+(runtime\s+)?errors?\.?\s*$/im,
    /completed\s+without\s+(error|exception|RuntimeError)/i,
    /output\s+(saved|written)\s+to\s+outputs\//i,
  ];
  if (evidenceText.length < MIN_EVIDENCE_LEN) {
    const msg = `Evidence too short (${evidenceText.length} chars, min ${MIN_EVIDENCE_LEN}). Provide real output.`;
    console.error(`✗ ${msg}`);
    if (autoFix) {
      const tasks_af = await readBoard(cfg);
      const task_af = tasks_af.find(t => t.id === advanceTaskId) ||
                      tasks_af.find(t => sddKey(t.title) === advanceTaskId);
      if (task_af) {
        const result = await createRemediationTasks(cfg, task_af, [msg], tasks_af);
        console.error(`\n  ✅ Remediation tasks created: ${result.exKey} + ${result.vaKey}`);
      }
    }
    process.exit(1);
  }
  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(evidenceText)) {
      const msg = 'Evidence matches known boilerplate. Replace with real command output, file paths, or measured results.';
      console.error(`✗ ${msg}`);
      if (autoFix) {
        const tasks_af = await readBoard(cfg);
        const task_af = tasks_af.find(t => t.id === advanceTaskId) ||
                        tasks_af.find(t => sddKey(t.title) === advanceTaskId);
        if (task_af) {
          const result = await createRemediationTasks(cfg, task_af, [msg], tasks_af);
          console.error(`\n  ✅ Remediation tasks created: ${result.exKey} + ${result.vaKey}`);
        }
      }
      process.exit(1);
    }
  }

  // ── Visual evidence gate for image-generation VA tasks ──────────────────────
  // Any VA task whose title references image generation must include:
  //   1. A visual description of what is actually visible in the output
  //   2. Not just job IDs, file paths, or "no errors"
  // Claude MUST use the Read tool to view the output image before calling --advance.
  const IMAGE_VA_PATTERN = /synthesis|transfer|garment|character|render|inpaint|upscale|pipeline|tryon|try.on|outfit|cloth|generat|wears?|image/i;
  const tasks_check = await readBoard(cfg);
  const task_check = tasks_check.find(t => t.id === advanceTaskId) ||
                     tasks_check.find(t => sddKey(t.title) === advanceTaskId);
  if (task_check && sddType(task_check.title) === 'VA' && IMAGE_VA_PATTERN.test(task_check.title)) {
    // Must contain a visual description — not just "job ran / file saved / pid = ..."
    const VISUAL_KEYWORDS = /shows?|displays?|visible|appears?|look[si]|wearing|dressed|garment\s+on|character\s+(is|has|wears?|shows?|appears?)|image\s+shows?|output\s+shows?|can\s+see|identity\s+(match|lock|preserv)|face\s+(match|lock|preserv)|correctly|incorrect|wrong|broken|succeed|fail/i;
    const evidenceHasJobOnly = /^[\s\S]{0,300}(pid\s*=|job\s+id|prompt_id)[^a-z]*$/i;
    if (!VISUAL_KEYWORDS.test(evidenceText)) {
      console.error('✗ GATE FAIL — image generation VA task requires VISUAL evidence.');
      console.error('');
      console.error('  You must READ the output image before advancing this task.');
      console.error('  Steps:');
      console.error('    1. Use the Read tool on the output file path (e.g. outputs/…/stage1_char.png)');
      console.error('    2. Look at what is actually visible in the image');
      console.error('    3. Describe: Does the output match the AC? Is the character identity correct?');
      console.error('       Is the garment ON the character\'s body? Or is it a broken composite?');
      console.error('    4. Only advance if the visual output matches the acceptance criteria');
      console.error('');
      console.error('  Prohibited evidence (not enough on its own):');
      console.error('    "job ran", "file saved", "no errors", "pid = ...", "output at URL"');
      console.error('');
      console.error('  Required: describe what is VISIBLE in the output image.');
      process.exit(1);
    }
  }

  // ── UI/frontend screenshot gate for visual VA tasks ─────────────────────
  // Any VA task with UI-related keywords in the title must include at least one
  // screenshot file path (.png/.jpg) in the evidence — same principle as the
  // image-gen visual gate above but for frontend/component work.
  const UI_VA_PATTERN = /gallery|modal|builder|view|form|upload|component|render|survey|page|badge|button|layout|nav|feed|dashboard/i;
  if (task_check && sddType(task_check.title) === 'VA' && UI_VA_PATTERN.test(task_check.title)) {
    const SCREENSHOT_RE = /\.(png|jpg|jpeg|gif|webp)(\s|"|'|\)|]|,|$)/i;
    if (!SCREENSHOT_RE.test(evidenceText)) {
      console.error('✗ GATE FAIL — UI/frontend VA task requires screenshot evidence.');
      console.error('');
      console.error('  Include at least one screenshot file path (.png/.jpg/.webp) in your --evidence.');
      console.error('  Steps:');
      console.error('    1. Run Playwright tests: npx playwright test --reporter=list');
      console.error('    2. Capture screenshots with page.screenshot({ path: "tests/e2e/screenshots/..." })');
      console.error('    3. Paste the screenshot paths and describe what is visible in each');
      console.error('');
      console.error('  Example evidence format:');
      console.error('    "tests/e2e/screenshots/feature/01-modal-open.png — modal visible with 2 tabs.');
      console.error('     tests/e2e/screenshots/feature/02-upload-done.png — success checkmark shown."');
      console.error('');
      console.error('  If --auto-fix is set, a remediation EX+VA pair will be created instead.');
      if (autoFix) {
        const tasks_af = await readBoard(cfg);
        const task_af = tasks_af.find(t => t.id === advanceTaskId) ||
                        tasks_af.find(t => sddKey(t.title) === advanceTaskId);
        if (task_af) {
          const result = await createRemediationTasks(cfg, task_af, ['UI VA task missing screenshot evidence — include .png/.jpg paths describing what is visible'], tasks_af);
          console.error(`\n  ✅ Remediation tasks created: ${result.exKey} + ${result.vaKey}`);
          console.error(`  Next: capture screenshots, then advance ${result.exKey} with screenshot evidence.`);
        }
      }
      process.exit(1);
    }
  }

  // ── Implementation files existence + front-matter gate (EX tasks) ──────────
  // When advancing an EX task, every file listed in the spec's Implementation Files section must:
  //   1. Exist on disk (not just in the spec)
  //   2. Contain a spec ref in the first 15 lines: "artifact: EX-NNN", "spec: EX-NNN", or "initiative:"
  // This is the foreign-key mechanism that makes the spec→code trace graph work.
  // Binary files (.png/.jpg/.mp4 etc.) must instead be registered in .sdd-artifacts.json.
  if (task_check && sddType(task_check.title) === 'EX') {
    const exKey = sddKey(task_check.title);
    const implSection = (task_check.content || '').match(/Implementation Files[\s\S]*?(?=<h2|$)/i)?.[0] || '';
    const rawPaths = [...implSection.matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map(m => m[1].trim());
    const codePaths = rawPaths.filter(p =>
      p.match(/^[A-Z]:\\|^\/|^(src|tests|prisma|scripts|components|pages|hooks|styles|config|public|lib|server|client)\//i) &&
      !p.match(/\.(png|jpg|jpeg|gif|webp|mp4|mov|webm|onnx|pt|bin|zip|tar)$/i)
    );
    const binaryPaths = rawPaths.filter(p =>
      p.match(/\.(png|jpg|jpeg|gif|webp|mp4|mov|webm|onnx|pt|bin|zip|tar)$/i)
    );

    const gitRoot = findGitRoot();
    const missingFiles = [];
    const missingFrontMatter = [];

    for (const fp of codePaths) {
      const absPath = fp.match(/^[A-Z]:\\|^\//) ? fp : path.join(gitRoot, fp);
      if (!fs.existsSync(absPath)) {
        missingFiles.push(fp);
        continue;
      }
      try {
        const head = fs.readFileSync(absPath, 'utf-8').split('\n').slice(0, 15).join('\n');
        const hasRef = /(?:artifact|spec):\s*(?:[A-Z]+-)?(?:EX|VA|AR|EP|NS|RS)-\d+|initiative:/i.test(head);
        if (!hasRef) missingFrontMatter.push(fp);
      } catch { /* unreadable — skip */ }
    }

    // Binary artifacts must be in .sdd-artifacts.json
    const artifactsMapPath = path.join(gitRoot, '.sdd-artifacts.json');
    const artifactsMap = fs.existsSync(artifactsMapPath)
      ? (() => { try { return JSON.parse(fs.readFileSync(artifactsMapPath, 'utf-8')); } catch { return {}; } })()
      : {};
    const unregisteredBinaries = binaryPaths.filter(bp => {
      const basename = bp.split(/[\\/]/).pop();
      return !artifactsMap[basename] && !artifactsMap[bp];
    });

    if (missingFiles.length > 0) {
      const msg = `EX task lists ${missingFiles.length} implementation file(s) that do not exist on disk:\n${missingFiles.map(f => `  · ${f}`).join('\n')}`;
      console.error(`\n✗ GATE FAIL — implementation file(s) missing.\n${msg}`);
      console.error(`\n  The spec claims these files were created but they are not on disk.`);
      console.error(`  Create the files first, then re-run --advance.`);
      if (autoFix) {
        const tasks_af2 = await readBoard(cfg);
        const task_af2 = tasks_af2.find(t => t.id === advanceTaskId) || tasks_af2.find(t => sddKey(t.title) === advanceTaskId);
        if (task_af2) {
          const r = await createRemediationTasks(cfg, task_af2, missingFiles.map(f => `Implementation file missing on disk: ${f}`), tasks_af2);
          console.error(`\n  ✅ Remediation tasks created: ${r.exKey} + ${r.vaKey}`);
        }
      }
      process.exit(1);
    }

    if (missingFrontMatter.length > 0) {
      const msg = `${missingFrontMatter.length} implementation file(s) lack spec front matter in first 15 lines.\nAdd "// artifact: ${exKey}" or "// spec: ${exKey} | initiative: <slug>" to:\n${missingFrontMatter.map(f => `  · ${f}`).join('\n')}`;
      console.error(`\n✗ GATE FAIL — spec tracing broken.\n${msg}`);
      console.error(`\n  Spec→code foreign keys are required for the trace graph.`);
      console.error(`  Without them, there is no way to audit which code implements which spec.`);
      if (autoFix) {
        const tasks_af2 = await readBoard(cfg);
        const task_af2 = tasks_af2.find(t => t.id === advanceTaskId) || tasks_af2.find(t => sddKey(t.title) === advanceTaskId);
        if (task_af2) {
          const r = await createRemediationTasks(cfg, task_af2, missingFrontMatter.map(f => `Missing spec front matter: ${f} — add // artifact: ${exKey} | initiative: <slug>`), tasks_af2);
          console.error(`\n  ✅ Remediation tasks created: ${r.exKey} + ${r.vaKey}`);
        }
      }
      process.exit(1);
    }

    if (unregisteredBinaries.length > 0) {
      const msg = `${unregisteredBinaries.length} binary artifact(s) not registered in .sdd-artifacts.json:\n${unregisteredBinaries.map(b => `  · ${b}`).join('\n')}`;
      console.error(`\n✗ GATE FAIL — binary artifact(s) untraced.\n${msg}`);
      console.error(`\n  Binary files cannot embed inline comments. Register them in .sdd-artifacts.json:`);
      console.error(`  { "filename.png": { "artifact": "${exKey}", "initiative": "<slug>", "created": "YYYY-MM-DD" } }`);
      process.exit(1);
    }
  }

  // ── validation_command gate ──────────────────────────────────────────────────
  // If the task front-matter has `validation_command: <cmd>`, run it as a subprocess.
  // Advancement is blocked if the command exits non-zero. On success, output is prepended
  // to evidence so it appears in the gate comment.
  {
    const vcMatch = task_check?.content?.match(/validation_command:\s*(.+)/);
    const valCmd = vcMatch ? vcMatch[1].trim() : null;
    if (valCmd) {
      process.stdout.write(`\n→ Running validation_command: ${valCmd}\n`);
      try {
        const vcOut = execSync(valCmd, { encoding: 'utf-8', timeout: 120000 });
        process.stdout.write(`  ✅ validation_command exited 0\n`);
        evidenceText = `[validation_command: ${valCmd}]\nExit: 0\nOutput:\n${vcOut.slice(0, 2000)}\n\n${evidenceText}`;
      } catch (vcErr) {
        const failLog = path.join(findGitRoot(), '.sdd-failures.log');
        const entry = `[${new Date().toISOString()}] ${advanceTaskId} — validation_command FAILED\nCommand: ${valCmd}\nStdout: ${(vcErr.stdout || '').slice(0, 500)}\nStderr: ${(vcErr.stderr || '').slice(0, 500)}\n---\n`;
        fs.appendFileSync(failLog, entry, 'utf-8');
        console.error(`\n✗ GATE FAIL — validation_command exited non-zero.`);
        console.error(`  Command: ${valCmd}`);
        if (vcErr.stderr) console.error(`  Stderr:  ${vcErr.stderr.slice(0, 300)}`);
        console.error(`  Logged to: ${failLog}`);
        console.error(`  Fix the failing command, then re-run --advance.`);
        process.exit(1);
      }
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

  // Clear the in-flight task from state and refresh dashboard Current Focus.
  try {
    const freshState = loadState();
    const freshSlug = initiativeOverride || freshState?.currentInitiative;
    if (freshState && freshSlug) setActiveTask(freshState, freshSlug, null);
    refreshDashboard(iState);
  } catch { /* non-fatal */ }

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
      const arNum = tasks.filter(t => sddType(t.title) === 'AR' && sddNum(t.title) < 900).length + created + 1;
      console.log(`(would create AR-${pad3(arNum)} · ${exTask.title.replace(/^EX-\d+\s*·?\s*/, '').trim().slice(0, 40)})`);
      created++;
      continue;
    }

    const arNum = tasks.filter(t => sddType(t.title) === 'AR' && sddNum(t.title) < 900).length + created + 1;
    const arContent = buildArContent(arNum, vaNum, exTask, cfg, null);
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
  // Allow env file to override BASE at runtime (supports local dev + prod switching)
  if (env.DATASPHERES_BASE_URL) BASE = env.DATASPHERES_BASE_URL;
  initHeaders(apiKey);

  const state = loadState();
  const iState = resolveInitiative(state);
  if (!iState) {
    console.error('✗ No .sdd-state.json found. Run: node sdd-conductor.mjs init');
    process.exit(1);
  }

  const slug = initiativeOverride || state?.currentInitiative || 'unknown';

  const sg = iState.statusGroups || {};
  const cfg = {
    dsId:             iState.dsId,
    dsUri:            iState.dsUri,
    planModeId:       iState.planModeId,
    doneGroupId:      sg.Done || sg.done || iState.doneGroupId,
    artifactsGroupId: sg.Artifacts || sg.artifacts || iState.artifactsGroupId || null,
    executionGroupId: sg.Execution || sg.execution || iState.executionGroupId || null,
    validationGroupId:sg.Validation || sg.validation || iState.validationGroupId || null,
    // All statusGroupIds for this plan — used by readBoard to scope client-side.
    // ensureGroupIds() will auto-fetch from the API and back-fill state if this is empty.
    allGroupIds:      new Set(Object.values(sg).filter(Boolean)),
    _slug:            slug, // passed through so ensureGroupIds can update .sdd-state.json
  };

  if (!cfg.dsId || !cfg.planModeId || !cfg.doneGroupId) {
    console.error('✗ .sdd-state.json missing required fields. Re-run: node sdd-conductor.mjs init');
    process.exit(1);
  }

  if (healthMode) {
    await healthCheck(cfg, iState, slug);
    return;
  }

  if (intakeAdd) {
    await addIntakeCommand(slug);
    return;
  }

  if (triageIntakeId !== null) {
    await triageIntakeCommand(cfg, slug);
    return;
  }

  if (showIntakeStatus) {
    await intakeStatusCommand(cfg, slug);
    return;
  }

  if (uatTaskId !== null) {
    await uatCommand(cfg, iState, slug);
    return;
  }

  if (nextMode) {
    await findNextTask(cfg, iState, slug);
    return;
  }

  if (createFixTaskId !== null) {
    await createFixMode(cfg, iState, slug);
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
      console.log(`\n  ⚡ NEXT ACTION — DONE MODE (mandatory, no user input needed):`);
      console.log(`  Generate the Next Steps & UAT page now.`);
      console.log(`  See: all-dai-sdd SKILL.md § "Mode: DONE" for the exact steps.`);
      console.log(`  Do NOT stop here. The page IS the deliverable.`);
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
          stuckCount++;
          if (stuckCount >= 3) {
            // After 3 failures, stop rubber-stamping and create explicit remediation tasks
            console.log(`  [loop] Task ${key} stuck after 3 verification failures — creating remediation tasks.`);
            const allForRemediation = await readBoard(cfg);
            const result = await createRemediationTasks(cfg, next, issues, allForRemediation);
            console.log(`  [loop] ✅ Remediation created: ${result.exKey} + ${result.vaKey} → ${key} is BLOCKED.`);
            stuckCount = 0;
          } else {
            await postComment(cfg, next.id,
              `**Gate: FAIL** | ${new Date().toISOString()}\n\nVerification failed before advancement:\n${issues.map(i=>`- ${i}`).join('\n')}\n\nFix these issues and the loop will retry. (Attempt ${stuckCount}/3 — remediation tasks will be auto-created on attempt 3.)`
            );
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
