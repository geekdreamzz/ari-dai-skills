#!/usr/bin/env node
/**
 * sdd-conductor.mjs — SDD lifecycle enforcement CLI
 *
 * Zero external dependencies — Node.js built-in fetch + fs only.
 * Every command exits 0 (pass) or 1 (gate failed) or 2 (hard error).
 * Non-zero exit is the enforcement mechanism — bash calls fail, Claude sees the error.
 *
 * Usage:
 *   node sdd-conductor.mjs init                     Bootstrap .sdd-state.json for this project/initiative
 *   node sdd-conductor.mjs switch <slug>             Switch current initiative
 *   node sdd-conductor.mjs workspace                 Cross-project view of all registered initiatives
 *   node sdd-conductor.mjs drive                     Ordered mission brief — what to do next end-to-end
 *   node loop.mjs                                    LOOP mode: read board → advance → repeat until 100% Done
 *   node sdd-conductor.mjs sync                      Mid-plan reconcile: diff tasks.yaml vs live board
 *   node sdd-conductor.mjs start <taskId>            Mark task IN_PROGRESS. Exits 1 if deps not Done.
 *   node sdd-conductor.mjs complete <taskId>         Verify checklist → comment → PATCH Done → propagate.
 *   node sdd-conductor.mjs progress <message>        Post progress milestone to active task.
 *   node sdd-conductor.mjs validate <vaTaskId>       Ralph loop gate (exit 0=pass / exit 1=next iter).
 *   node sdd-conductor.mjs collect-evidence <vaTaskId>  Auto-collect evidence (nvidia-smi, logs, configs) → upload → create/update AR task.
 *   node sdd-conductor.mjs status                    Show all initiatives + active task status.
 *   node sdd-conductor.mjs gate <name> [args...]     Verify named gate. Exits 1 if not met.
 *   node sdd-conductor.mjs trace-graph               Board-wide ref integrity: EP→NS, EX→EP, VA→EX chain.
 *   node sdd-conductor.mjs dashboard-check <dsUri> <slug>  Verify 6 required dashboard sections.
 *   node sdd-conductor.mjs update-dashboard <dsUri> <slug> Generate/refresh Current Focus hierarchy section.
 *   node sdd-conductor.mjs check-file-hook           Read stdin (Claude PostToolUse JSON), warn on mismatch.
 *   node sdd-conductor.mjs session-start             Read .sdd-state.json, reconcile with live API.
 *   node sdd-conductor.mjs audit [--fix]            Scan board for compliance drift; --fix auto-remediates.
 *   node sdd-conductor.mjs install [project-dir]     Inject hooks into project's .claude/settings.json.
 *
 * All commands accept --initiative <slug> to target a specific initiative.
 *
 * Gate names:
 *   deps-done <taskId>         All depends_on tasks are in Done
 *   research-done <rsId>       RS task is in Done column
 *   no-mocks <file>            File contains no mock/stub patterns
 *   checklist <taskId>         All acceptance checklist items are checked
 *   impl-files <taskId>        Task has Implementation Files section
 *   hierarchy <taskId>         Task has correct parent refs (epic_ref, north_star_ref, etc.)
 *   trace-graph                Board-wide RS→NS→EP→EX→VA→AR ref chain integrity
 *   content-structure <taskId> Required sections present for task type (RS/NS/EP/EX/VA/AR)
 *   checklist-format <taskId>  All taskList items wrapped in <ul data-type="taskList">
 *   title-prefix <taskId>      Task title starts with correct SDD prefix for its column
 *   tracker-link <dsUri>       trackerUrl set on plan mode + dashboard has planner link
 *   tiptap-html <file>         Page content uses Tiptap HTML (no raw markdown)
 *
 * Full cascade on validation pass: VA → EX (done) → EP (done) → NS (done) → RS (done)
 *   Each level checks its acceptance checklist before auto-promoting.
 *   Artifact stub (AR) auto-created in Artifacts column when VA passes.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.2.3';
const STATE_FILE = '.sdd-state.json';
const WORKSPACE_FILE = path.join(os.homedir(), '.sdd-workspace.json');
const CONDUCTOR_RAW_URL = 'https://raw.githubusercontent.com/geekdreamzz/ari-dai-skills/main/skills/sdd-conductor/sdd-conductor.mjs';
const SKILL_RAW_URL     = 'https://raw.githubusercontent.com/geekdreamzz/ari-dai-skills/main/skills/all-dai-sdd/SKILL.md';

// ---------------------------------------------------------------------------
// Global --initiative override (parsed before command dispatch)
// ---------------------------------------------------------------------------

let globalInitiativeOverride = null;
const _filteredArgv = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--initiative' && process.argv[i + 1]) {
    globalInitiativeOverride = process.argv[i + 1];
    i++;
  } else {
    _filteredArgv.push(process.argv[i]);
  }
}
const [command, ...args] = _filteredArgv;

// ---------------------------------------------------------------------------
// Credential + state loading
// ---------------------------------------------------------------------------

function loadEnv() {
  const envFile = path.join(os.homedir(), '.dataspheres.env');
  const localEnv = path.join(findGitRoot(), '.env');
  const sources = [envFile, localEnv].filter(f => fs.existsSync(f));
  const env = {};
  for (const src of sources) {
    for (const line of fs.readFileSync(src, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      env[k] = v;
    }
  }
  // Let process.env override file values — enables per-invocation key swap
  // e.g. `DATASPHERES_API_KEY=$BO_PROD_API_KEY node sdd-conductor.mjs ...`
  for (const k of Object.keys(env)) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return env;
}

function findGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    return process.cwd();
  }
}

function statePath() {
  return path.join(findGitRoot(), STATE_FILE);
}

// Migrate v1.0 flat state → v1.1 multi-initiative shape
function migrateState(raw) {
  if (!raw) return null;
  if (raw.initiatives) return raw; // already new shape
  // Old flat shape: dsId, dsUri, planModeId, initiative, ... at top level
  if (raw.dsId && raw.initiative) {
    const { version, ...iState } = raw;
    return {
      version: VERSION,
      currentInitiative: raw.initiative,
      initiatives: { [raw.initiative]: iState },
    };
  }
  return raw;
}

function loadState() {
  const p = statePath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return migrateState(raw);
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8');
}

function requireState() {
  const s = loadState();
  if (!s) {
    die('No .sdd-state.json found. Run: node sdd-conductor.mjs init');
  }
  return s;
}

// Returns { state, slug, iState } for the current (or overridden) initiative.
// All commands that are initiative-scoped use this instead of requireState().
function requireInitiativeState() {
  const state = requireState();
  const slug = globalInitiativeOverride || state.currentInitiative;
  if (!slug) die('No current initiative. Run: node sdd-conductor.mjs init');
  const iState = state.initiatives?.[slug];
  if (!iState) {
    const available = Object.keys(state.initiatives || {}).join(', ') || '(none)';
    die(`Initiative "${slug}" not found in .sdd-state.json.\nAvailable: ${available}\nRun: node sdd-conductor.mjs init`);
  }
  return { state, slug, iState };
}

// Save iState back into the root state and persist.
function saveInitiative(state, slug, iState) {
  state.initiatives[slug] = iState;
  saveState(state);
}

// Keep .claude/sdd-active.json in sync with conductor state.
// sdd-enforce.js (PreToolUse) reads this file; without sync it blocks on stale data.
function syncLegacyActive(fields) {
  try {
    const legacyPath = path.join(findGitRoot(), '.claude', 'sdd-active.json');
    let existing = {};
    if (fs.existsSync(legacyPath)) {
      try { existing = JSON.parse(fs.readFileSync(legacyPath, 'utf-8')); } catch {}
    }
    const merged = { ...existing, ...fields };
    // Remove undefined keys
    for (const k of Object.keys(merged)) { if (merged[k] === undefined) delete merged[k]; }
    fs.writeFileSync(legacyPath, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) {
    warn(`syncLegacyActive failed (non-fatal): ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Workspace registry (~/.sdd-workspace.json)
// ---------------------------------------------------------------------------

function registerWorkspace(projectPath) {
  let projects = [];
  if (fs.existsSync(WORKSPACE_FILE)) {
    try { projects = JSON.parse(fs.readFileSync(WORKSPACE_FILE, 'utf-8')); } catch {}
  }
  if (!Array.isArray(projects)) projects = [];
  if (!projects.includes(projectPath)) {
    projects.push(projectPath);
    fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(projects, null, 2), 'utf-8');
    info(`Registered in workspace: ${WORKSPACE_FILE}`);
  }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

function makeClient() {
  const env = loadEnv();
  const apiKey = env.DATASPHERES_API_KEY;
  const baseUrl = env.DATASPHERES_BASE_URL || 'https://dataspheres.ai';
  if (!apiKey) die('DATASPHERES_API_KEY not set. Check ~/.dataspheres.env');

  async function req(method, path, body) {
    const url = `${baseUrl}${path}`;
    const opts = {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      die(`API ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
  }

  return {
    get: (p) => req('GET', p),
    patch: (p, b) => req('PATCH', p, b),
    post: (p, b) => req('POST', p, b),
    delete: (p) => req('DELETE', p),
  };
}

// ---------------------------------------------------------------------------
// Task helpers
// ---------------------------------------------------------------------------

// The individual GET /tasks/:id endpoint returns 404; use the list endpoint and filter.
async function fetchTaskById(client, dsId, planModeId, taskId) {
  const data = await client.get(`/api/v2/dataspheres/${dsId}/tasks?planModeId=${planModeId}&limit=500`);
  const tasks = data.tasks || data || [];
  const found = tasks.find(t => t.id === taskId);
  if (!found) die(`Task not found: ${taskId} (searched plan mode ${planModeId})`);
  return found;
}

function extractImplFiles(content) {
  if (!content) return [];
  const implMatch = content.match(/Implementation Files[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i);
  if (!implMatch) return [];
  return [...implMatch[1].matchAll(/<code>(.*?)<\/code>/gi)].map(m => m[1].trim());
}

function extractDependsOn(content) {
  if (!content) return [];
  const fmMatch = content.match(/depends_on:\s*\[(.*?)\]/s);
  if (!fmMatch) return [];
  return fmMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

function extractSpecId(content) {
  const m = content?.match(/spec_id:\s*(\S+)/);
  return m ? m[1] : null;
}

function countUncheckedItems(content) {
  if (!content) return 0;
  return (content.match(/data-checked="false"/g) || []).length;
}

// Returns [{text, checked}] for every taskItem element in content
function extractChecklistItems(content) {
  if (!content) return [];
  const items = [];
  const rx = /data-checked="(true|false)"[^>]*><p>(.*?)<\/p>/g;
  let m;
  while ((m = rx.exec(content)) !== null) {
    items.push({ checked: m[1] === 'true', text: m[2].replace(/<[^>]+>/g, '').trim() });
  }
  return items;
}

// Returns checklist items within a named H2–H4 section.
// Strips HTML comment anchors (<!-- #ac -->) before matching so [^<]* works correctly.
function extractSectionChecklist(content, sectionTitle) {
  if (!content) return [];
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');
  const esc = escapeRegex(sectionTitle);
  const rx = new RegExp(`<h[2-4][^>]*>[^<]*${esc}[^<]*<\\/h[2-4]>([\\s\\S]*?)(?=<h[2-4]|$)`, 'i');
  const m = stripped.match(rx);
  return m ? extractChecklistItems(m[1]) : [];
}

// Extract a named field from the YAML front-matter block in task content
function extractFrontMatterField(content, fieldName) {
  if (!content) return null;
  const m = content.match(new RegExp(`${escapeRegex(fieldName)}:\\s*([^\\n\\r<]+)`));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : null;
}

function hasMockPatterns(content) {
  const patterns = [
    /\bmock\b/i, /\bstub\b/i, /\bMagicMock\b/, /unittest\.mock/,
    /generate_mock/i, /fake_result/i, /TODO:\s*replace/i,
    // `placeholder` as a code-intent marker (comment, function name, variable),
    // NOT as an HTML attribute (`placeholder="…"`) or as part of a larger word
    // like `setPlaceholderImage`. Requires either a leading comment marker
    // (// or /*) or whitespace and a code-intent keyword after.
    /(?:\/\/|\/\*)\s*placeholder\b/i,
    /\bplaceholder\s+(code|impl|implementation|function|content)\b/i,
  ];
  return patterns.filter(p => p.test(content)).map(p => p.toString());
}

function getColumnName(task) {
  return task.statusGroup?.name || task.column || 'unknown';
}

// Unwrap single-task GET responses: { task: {...} } → {...}
// The v2 API inconsistently returns the task wrapped in a "task" envelope.
// This is backward-compatible: if already unwrapped, task.task is undefined and we return task.
function unwrapTask(res) {
  return (res && res.task && typeof res.task === 'object' && !Array.isArray(res.task))
    ? res.task
    : res;
}

function isDone(task) {
  const col = getColumnName(task).toLowerCase();
  return col === 'done' || task.status === 'DONE';
}

// ---------------------------------------------------------------------------
// Gate state — cross-session persistence via task description hidden div
// ---------------------------------------------------------------------------

const GATE_STATE_OPEN  = "<div data-gate-state style='display:none'>";
const GATE_STATE_CLOSE = "</div><!-- /gate-state -->";

function gateStateRead(content) {
  if (!content) return {};
  const m = content.match(/<div data-gate-state[^>]*>([\s\S]*?)<\/div><!--\s*\/gate-state\s*-->/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^\s*(\w+):\s*(.+?)\s*$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

function gateStateWrite(content, fields) {
  const existing = gateStateRead(content);
  const merged   = { ...existing, ...fields };
  const lines    = Object.entries(merged).map(([k, v]) => `${k}: ${v}`).join('\n');
  const block    = `${GATE_STATE_OPEN}\n${lines}\n${GATE_STATE_CLOSE}`;
  if (content.includes(GATE_STATE_OPEN)) {
    return content.replace(/<div data-gate-state[^>]*>[\s\S]*?<\/div><!--\s*\/gate-state\s*-->/, block);
  }
  return content.trimEnd() + '\n' + block;
}

function buildBriefingBlock(specId, title, prevSpecId, prevTitle, completedAt) {
  return [
    `<div data-gate-brief style='background:#f0f4ff;border-left:4px solid #4f6ef7;padding:12px 16px;margin:8px 0;border-radius:4px;'>`,
    `<p><strong>Session Briefing</strong> — injected by sdd-conductor at ${completedAt}</p>`,
    `<p>Previous task completed: <strong>${prevSpecId || '(none)'}</strong>${prevTitle ? ` — ${prevTitle}` : ''}</p>`,
    `<p>This task: <strong>${specId}</strong>${title ? ` — ${title}` : ''}</p>`,
    `<ul class="tiptap-bullet-list">`,
    `<li><p>Review acceptance checklist below</p></li>`,
    `<li><p>Run: <code>node sdd-conductor.mjs start &lt;taskId&gt;</code></p></li>`,
    `<li><p>Implement per impl_files list</p></li>`,
    `<li><p>Post completion comment with verified criteria + evidence</p></li>`,
    `<li><p>Run: <code>node sdd-conductor.mjs complete &lt;taskId&gt;</code></p></li>`,
    `</ul>`,
    `</div><!-- /gate-brief -->`,
  ].join('\n');
}

async function injectNextBriefing(client, iState, completedSpecId, completedTitle, completedAt) {
  try {
    const all = await client.get(
      `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=200`
    );
    const candidates = (all.tasks || all || []).filter(t => {
      const col = getColumnName(t).toLowerCase();
      const gs  = gateStateRead(t.content || '');
      return col === 'execution' && gs.gate_status !== 'IN_PROGRESS' && !isDone(t);
    });
    if (candidates.length === 0) { info(`No pending Execution tasks to brief.`); return; }

    candidates.sort((a, b) => {
      const na = parseInt((extractSpecId(a.content) || '').replace(/\D+/g, '') || '0', 10);
      const nb = parseInt((extractSpecId(b.content) || '').replace(/\D+/g, '') || '0', 10);
      return na - nb;
    });

    const next       = candidates[0];
    const nextSpecId = extractSpecId(next.content) || next.title?.match(/^[A-Z]+-\d+/)?.[0] || next.id;
    const briefing   = buildBriefingBlock(nextSpecId, next.title, completedSpecId, completedTitle, completedAt);

    let content = (next.content || '').replace(/<div data-gate-brief[\s\S]*?<\/div><!-- \/gate-brief -->/g, '').trimEnd();
    content = content + '\n' + briefing;
    content = gateStateWrite(content, { gate_status: 'PENDING', briefed_at: completedAt, prev_spec_id: completedSpecId });

    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${next.id}`, { content });
    info(`Briefing injected into next task: ${nextSpecId}`);
  } catch (e) {
    warn(`injectNextBriefing failed (non-fatal): ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function die(msg) {
  console.error(`\n🚫 SDD-CONDUCTOR: ${msg}\n`);
  process.exit(2);
}

function gate(msg) {
  console.error(`\n🚫 GATE BLOCKED: ${msg}\n`);
  process.exit(1);
}

function ok(msg) {
  console.log(`\n✅ ${msg}\n`);
}

function warn(msg) {
  console.log(`\n⚠️  SDD-CONDUCTOR: ${msg}\n`);
}

function info(msg) {
  console.log(`   ${msg}`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdInit() {
  const env = loadEnv();
  const baseUrl = env.DATASPHERES_BASE_URL || 'https://dataspheres.ai';
  const apiKey = env.DATASPHERES_API_KEY;
  if (!apiKey) die('DATASPHERES_API_KEY not set. Check ~/.dataspheres.env');

  // Find tasks.yaml
  const root = findGitRoot();
  const yamlCandidates = [
    path.join(root, 'tasks.yaml'),
    ...findTasksYamls(root),
  ];
  const yamlPath = yamlCandidates.find(p => fs.existsSync(p));

  if (!yamlPath) {
    die('No tasks.yaml found. Run from a project directory that has a tasks.yaml.');
  }

  const yaml = fs.readFileSync(yamlPath, 'utf-8');
  // Multi-word values matter (e.g. `initiative: QA Test Board`). The previous
  // `(\S+)` only captured the first word, so the plan-mode lookup matched
  // nothing. Use multiline + trailing-trim, optionally quoted.
  const yamlField = (name) => yaml.match(new RegExp(`^\\s*${name}:\\s*["']?(.+?)["']?\\s*$`, 'm'));
  const uriMatch = yamlField('targetDatasphere');
  const initiativeMatch = yamlField('initiative');
  if (!uriMatch) die('tasks.yaml missing targetDatasphere field');

  const dsUri = uriMatch[1];
  const initiative = initiativeMatch ? initiativeMatch[1] : dsUri;

  console.log(`\n🔧 SDD-CONDUCTOR INIT`);
  info(`Datasphere URI: ${dsUri}`);
  info(`Initiative: ${initiative}`);
  info(`API: ${baseUrl}`);

  // Resolve dsId
  const dsRes = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!dsRes.ok) die(`Could not resolve datasphere ${dsUri}: ${dsRes.status}`);
  const dsData = await dsRes.json();
  const dsId = dsData.datasphere?.id || dsData.id;
  if (!dsId) die('Could not extract datasphere ID from API response');
  info(`Datasphere ID: ${dsId}`);

  // Find plan mode for initiative
  const pmRes = await fetch(`${baseUrl}/api/v2/dataspheres/${dsId}/tasks/plan-modes`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!pmRes.ok) die(`Could not list plan modes: ${pmRes.status}`);
  const pmData = await pmRes.json();
  const planModes = pmData.planModes || pmData || [];
  const pm = planModes.find(m =>
    m.tagFilter?.includes(initiative) ||
    m.name?.toLowerCase().includes(initiative.toLowerCase())
  );
  if (!pm) die(`No plan mode found for initiative "${initiative}". Run /all-dai-sdd to publish first.`);
  info(`Plan mode: ${pm.name} (${pm.id})`);

  // Get status groups for this plan mode
  const sgRes = await fetch(`${baseUrl}/api/v2/dataspheres/${dsId}/tasks/status-groups?planModeId=${pm.id}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!sgRes.ok) die(`Could not list status groups: ${sgRes.status}`);
  const sgData = await sgRes.json();
  const groups = sgData.statusGroups || sgData || [];

  const doneGroup       = groups.find(g => g.name?.toLowerCase() === 'done' || g.isDoneState);
  const execGroup       = groups.find(g => g.name?.toLowerCase() === 'execution');
  const validGroup      = groups.find(g => g.name?.toLowerCase() === 'validation');
  const researchGroup   = groups.find(g => g.name?.toLowerCase() === 'research');
  const artifactsGroup  = groups.find(g => /artifact/i.test(g.name || ''));
  const northStarsGroup = groups.find(g => /north.?star/i.test(g.name || ''));
  const epicsGroup      = groups.find(g => g.name?.toLowerCase() === 'epics' || g.name?.toLowerCase() === 'epic');

  if (!doneGroup) die('No "Done" status group found in plan mode');

  // Build initiative state
  const iState = {
    dsId,
    dsUri,
    planModeId: pm.id,
    initiative,
    doneGroupId:       doneGroup.id,
    executionGroupId:  execGroup?.id       || null,
    validationGroupId: validGroup?.id      || null,
    researchGroupId:   researchGroup?.id   || null,
    artifactsGroupId:  artifactsGroup?.id  || null,
    northStarsGroupId: northStarsGroup?.id || null,
    epicsGroupId:      epicsGroup?.id      || null,
    statusGroups: Object.fromEntries(groups.map(g => [g.name.toLowerCase(), g.id])),
    activeTask: null,
    lastCompleted: null,
    initializedAt: new Date().toISOString(),
  };

  // Load existing root state (if any) or create new multi-initiative root
  let rootState = loadState() || { version: VERSION, currentInitiative: null, initiatives: {} };
  if (!rootState.initiatives) rootState.initiatives = {};

  const isNew = !rootState.initiatives[initiative];
  rootState.initiatives[initiative] = iState;
  rootState.currentInitiative = initiative;
  rootState.version = VERSION;

  saveState(rootState);

  // Register this project in the global workspace
  registerWorkspace(root);

  ok(`${isNew ? 'Initialized' : 'Re-initialized'} initiative "${initiative}" in .sdd-state.json`);
  info(`Done group ID: ${doneGroup.id}`);
  info(`Execution group ID: ${execGroup?.id || 'not found'}`);

  const allInitiatives = Object.keys(rootState.initiatives);
  if (allInitiatives.length > 1) {
    info(`\nAll initiatives in this project: ${allInitiatives.join(', ')}`);
    info(`Current: ${initiative}  (switch with: node sdd-conductor.mjs switch <slug>)`);
  }
}

async function cmdSwitch(slug) {
  if (!slug) die('Usage: switch <initiative-slug>');
  const state = requireState();
  const available = Object.keys(state.initiatives || {});
  if (!state.initiatives?.[slug]) {
    die(`Initiative "${slug}" not found.\nAvailable: ${available.join(', ') || '(none)'}`);
  }
  state.currentInitiative = slug;
  saveState(state);
  const iState = state.initiatives[slug];
  ok(`Switched to initiative: ${slug}`);
  info(`Datasphere: ${iState.dsUri} (${iState.dsId})`);
  info(`Plan mode: ${iState.planModeId}`);
  if (iState.activeTask) {
    info(`Active task: ${iState.activeTask.specId} — ${iState.activeTask.title}`);
  } else {
    info(`Active task: (none)`);
  }
}

async function cmdWorkspace() {
  if (!fs.existsSync(WORKSPACE_FILE)) {
    console.log('\n📦 No workspace configured yet.\n   Run: node sdd-conductor.mjs init  in each project to register it.\n');
    return;
  }

  let projects = [];
  try { projects = JSON.parse(fs.readFileSync(WORKSPACE_FILE, 'utf-8')); } catch {
    die(`Could not read workspace file: ${WORKSPACE_FILE}`);
  }
  if (!Array.isArray(projects) || projects.length === 0) {
    console.log('\n📦 Workspace is empty.\n');
    return;
  }

  console.log(`\n📦 WORKSPACE — ${projects.length} project(s)\n`);

  let totalActive = 0;
  for (const projectPath of projects) {
    const sp = path.join(projectPath, STATE_FILE);
    if (!fs.existsSync(sp)) {
      info(`${path.basename(projectPath).padEnd(25)} (no .sdd-state.json — may need re-init)`);
      continue;
    }

    let rootState;
    try { rootState = migrateState(JSON.parse(fs.readFileSync(sp, 'utf-8'))); } catch { continue; }
    if (!rootState?.initiatives) continue;

    const projectName = path.basename(projectPath);
    const initiatives = Object.entries(rootState.initiatives);

    for (const [slug, iState] of initiatives) {
      const isCurrent = slug === rootState.currentInitiative;
      const hasActive = !!iState.activeTask;
      if (hasActive) totalActive++;

      const marker = hasActive ? '●' : '○';
      const currentMark = isCurrent ? '▶' : ' ';
      const activeInfo = hasActive
        ? `${iState.activeTask.specId} — ${iState.activeTask.title}`
        : iState.lastCompleted
          ? `last: ${iState.lastCompleted.specId}`
          : '(idle)';

      console.log(`  ${currentMark} ${marker} ${projectName.padEnd(22)} ${slug.padEnd(28)} ${activeInfo}`);
    }
  }

  console.log(`\n   ● = active task   ○ = idle   ▶ = current initiative\n`);
  if (totalActive > 0) {
    console.log(`   ${totalActive} initiative(s) have work in progress.\n`);
  }
}

// ---------------------------------------------------------------------------
// cmdAutoTemplate — infer and patch missing front-matter refs from board context.
// Called automatically during cmdStart; also available as a standalone command.
// Returns the updated content string (or null if nothing changed).
// ---------------------------------------------------------------------------
async function cmdAutoTemplate(taskId, task, client, iState) {
  const content = task.content || '';
  const titleStr = task.title || '';
  const sid = extractSpecId(content) || titleStr.match(/^[A-Z]+-\d+/)?.[0] || '';
  const isVA = /^VA-/i.test(sid) || /^V-T-/i.test(titleStr);
  const isEX = /^EX-/i.test(sid) || /^T-\d/i.test(titleStr);
  const isEP = /^EP-/i.test(sid) || /^E-\d/i.test(titleStr);
  const isNS = /^NS-/i.test(sid) || /^NS-/i.test(titleStr);

  const missingFields = [];
  if (isVA) {
    if (!extractFrontMatterField(content, 'execution_ref'))  missingFields.push('execution_ref');
    if (!extractFrontMatterField(content, 'epic_ref'))       missingFields.push('epic_ref');
    if (!extractFrontMatterField(content, 'north_star_ref')) missingFields.push('north_star_ref');
  } else if (isEX) {
    if (!extractFrontMatterField(content, 'epic_ref'))       missingFields.push('epic_ref');
    if (!extractFrontMatterField(content, 'north_star_ref')) missingFields.push('north_star_ref');
  } else if (isEP) {
    if (!extractFrontMatterField(content, 'north_star_ref')) missingFields.push('north_star_ref');
  } else if (isNS) {
    if (!extractFrontMatterField(content, 'research_ref'))   missingFields.push('research_ref');
  }

  if (missingFields.length === 0) return null;

  // Fetch full board to infer parents
  const allTasks = ((await client.get(
    `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
  )).tasks || []);

  const byTypeGroup = (prefix) => allTasks.filter(t =>
    t.title?.match(new RegExp(`^${prefix}-\\d+`, 'i')) ||
    (t.statusGroup?.name || '').toLowerCase().includes(
      prefix === 'RS' ? 'research' : prefix === 'NS' ? 'north' :
      prefix === 'EP' ? 'epic' : prefix === 'EX' ? 'execut' :
      prefix === 'VA' ? 'validat' : 'artifact'
    )
  );

  const inferred = {};
  const ambiguous = [];

  for (const field of missingFields) {
    if (field === 'execution_ref') {
      // Find EX tasks sharing the same epic_ref as this VA task
      const epicRef = extractFrontMatterField(content, 'epic_ref');
      const candidates = epicRef
        ? byTypeGroup('EX').filter(t => (extractFrontMatterField(t.content, 'epic_ref') || '').toUpperCase() === epicRef.toUpperCase())
        : byTypeGroup('EX');
      if (candidates.length === 1) {
        inferred['execution_ref'] = candidates[0].title.match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase();
      } else if (candidates.length > 1) {
        // Multiple candidates — pick the most recently completed one
        const done = candidates.filter(t => t.statusGroup?.isDoneState);
        if (done.length === 1) {
          inferred['execution_ref'] = done[0].title.match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase();
        } else {
          ambiguous.push(`execution_ref: ${candidates.length} EX tasks in EP${epicRef ? ` (epic_ref: ${epicRef})` : ''} — cannot auto-infer`);
        }
      }
    } else if (field === 'epic_ref') {
      const epTasks = byTypeGroup('EP');
      if (epTasks.length === 1) {
        inferred['epic_ref'] = epTasks[0].title.match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase();
      } else if (epTasks.length > 1) {
        // Check which EP's checklist references this task
        const taskPid = sid.toUpperCase();
        const owner = epTasks.find(ep => (ep.content || '').includes(taskPid));
        if (owner) {
          inferred['epic_ref'] = owner.title.match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase();
        } else {
          ambiguous.push(`epic_ref: ${epTasks.length} EP tasks — add to an epic's checklist first`);
        }
      }
    } else if (field === 'north_star_ref') {
      // Inherit from parent epic if already known
      const epicRefVal = inferred['epic_ref'] || extractFrontMatterField(content, 'epic_ref');
      if (epicRefVal) {
        const ep = allTasks.find(t => (t.title?.match(/^([A-Z]+-\d+)/i)?.[1] || '').toUpperCase() === epicRefVal.toUpperCase());
        const nsFromEp = ep ? extractFrontMatterField(ep.content, 'north_star_ref') : null;
        if (nsFromEp) { inferred['north_star_ref'] = nsFromEp.toUpperCase(); continue; }
      }
      const nsTasks = byTypeGroup('NS');
      if (nsTasks.length === 1) {
        inferred['north_star_ref'] = nsTasks[0].title.match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase();
      } else if (nsTasks.length > 1) {
        ambiguous.push(`north_star_ref: ${nsTasks.length} NS tasks — cannot auto-infer`);
      }
    } else if (field === 'research_ref') {
      const rsTasks = byTypeGroup('RS');
      if (rsTasks.length === 1) {
        inferred['research_ref'] = rsTasks[0].title.match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase();
      } else if (rsTasks.length > 1) {
        ambiguous.push(`research_ref: ${rsTasks.length} RS tasks — cannot auto-infer`);
      }
    }
  }

  if (ambiguous.length > 0) {
    warn(`Auto-template: cannot infer these refs (ambiguous — add manually):\n${ambiguous.map(a => `  ⚠ ${a}`).join('\n')}`);
  }

  if (Object.keys(inferred).length === 0) return null;

  // Patch the YAML front-matter code block — insert missing fields before `tags:` or at end of block
  let updatedContent = content;
  for (const [field, value] of Object.entries(inferred)) {
    if (!value) continue;
    const insertLine = `${field}: ${value}`;
    if (updatedContent.includes('tags:')) {
      updatedContent = updatedContent.replace(/(tags:)/, `${insertLine}\n$1`);
    } else if (/<\/code><\/pre>/.test(updatedContent)) {
      updatedContent = updatedContent.replace(/<\/code><\/pre>/, `${insertLine}\n</code></pre>`);
    } else {
      warn(`Auto-template: cannot find YAML block in ${sid} — skipping ${field}`);
      continue;
    }
    info(`Auto-template: wired ${field}: ${value} into ${sid}`);
  }

  if (updatedContent === content) return null;

  await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`, { content: updatedContent });
  info(`Auto-template: front-matter patched via API ✓`);
  return updatedContent;
}

async function cmdStart(taskId) {
  if (!taskId) die('Usage: start <taskId>');
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  // Warn if another task is already active
  if (iState.activeTask) {
    warn(`Another task is already active in "${slug}": ${iState.activeTask.specId || iState.activeTask.taskId}`);
    warn(`Complete it first with: node sdd-conductor.mjs complete ${iState.activeTask.taskId}`);
    warn(`Or force with --force flag to override`);
    if (!process.argv.includes('--force')) process.exit(1);
  }

  // Fetch the task
  const task = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`));
  const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || taskId;
  const implFiles = extractImplFiles(task.content);
  const dependsOn = extractDependsOn(task.content);

  console.log(`\n🔵 SDD-CONDUCTOR START  [${slug}]`);
  info(`Task: ${task.title}`);
  info(`Spec ID: ${specId}`);
  info(`Impl files: ${implFiles.length > 0 ? implFiles.join(', ') : '(none listed)'}`);
  info(`Depends on: ${dependsOn.length > 0 ? dependsOn.join(', ') : '(none)'}`);

  // Gate: verify all dependencies are Done
  if (dependsOn.length > 0) {
    info(`\nChecking dependencies...`);
    const allTasks = await client.get(
      `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=200`
    );
    const taskList = allTasks.tasks || allTasks || [];
    const taskMap = Object.fromEntries(taskList.map(t => [
      extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0], t
    ]));

    const notDone = [];
    for (const dep of dependsOn) {
      const depTask = taskMap[dep];
      if (!depTask) {
        notDone.push(`${dep} (not found)`);
      } else if (!isDone(depTask)) {
        notDone.push(`${dep} (currently: ${getColumnName(depTask)})`);
      }
    }
    if (notDone.length > 0) {
      gate(`Dependencies not Done:\n  ${notDone.join('\n  ')}\n\nComplete dependencies before starting this task.`);
    }
    info(`All ${dependsOn.length} dependencies are Done ✓`);
  }

  if (implFiles.length === 0) {
    warn(`Task has no Implementation Files section. Add one to the task content before coding.`);
  }

  // Gate: hierarchy refs — auto-template first, then pre-wire VA 1-1, then hard-gate.
  // cmdAutoTemplate infers unambiguous parent refs (epic_ref, north_star_ref, execution_ref).
  // The VA pre-wire block creates the VA stub so validation_ref can be set before the hard gate.
  {
    const autoPatched = await cmdAutoTemplate(taskId, task, client, iState);
    if (autoPatched) task.content = autoPatched;
  }

  // Pre-wire: EX tasks must have a 1-1 VA stub before work starts.
  // If no VA with execution_ref pointing here exists, auto-create one at start time
  // so the gate below on validation_ref will pass.
  {
    const sid = extractSpecId(task.content) || '';
    const isEXTask = /^EX-/i.test(sid) || /^EX-/i.test(task.title?.match(/^[A-Z]+-\d+/)?.[0] || '');
    if (isEXTask && !extractFrontMatterField(task.content, 'validation_ref') && iState.planModeId) {
      let boardForVa = [];
      try {
        boardForVa = ((await client.get(
          `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
        )).tasks || []);
      } catch { /* non-fatal */ }

      const linkedVa = boardForVa.find(t => {
        const ref = extractFrontMatterField(t.content || '', 'execution_ref');
        return ref && ref.toUpperCase() === specId.toUpperCase();
      });

      const patchValidationRef = async (vaSpecId) => {
        const insertLine = `validation_ref: ${vaSpecId}`;
        let updated = task.content;
        if (updated.includes('tags:')) {
          updated = updated.replace(/(tags:)/, `${insertLine}\n$1`);
        } else if (/<\/code><\/pre>/.test(updated)) {
          updated = updated.replace(/<\/code><\/pre>/, `${insertLine}\n</code></pre>`);
        }
        if (updated !== task.content) {
          await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`, { content: updated });
          task.content = updated;
          info(`EX ${specId} patched with validation_ref: ${vaSpecId} ✓`);
        }
      };

      if (linkedVa) {
        // VA exists — backfill the forward ref on the EX task
        const vaSpecId = extractSpecId(linkedVa.content) || linkedVa.title?.match(/^[A-Z]+-\d+/)?.[0];
        if (vaSpecId) await patchValidationRef(vaSpecId);
      } else if (iState.validationGroupId) {
        // No VA exists — auto-create stub + wire both directions
        const epicRef = extractFrontMatterField(task.content, 'epic_ref') || '';
        const nsRef   = extractFrontMatterField(task.content, 'north_star_ref') || '';
        const exLabel = task.title?.replace(/^EX-\d+\s*[·•\s]+/i, '').trim() || specId;
        const vaCount = boardForVa.filter(t => /^VA-\d+/i.test(t.title || '')).length;
        const vaSpecId = `VA-${String(vaCount + 1).padStart(3, '0')}`;
        const vaContent = [
          `<pre><code class="language-yaml">`,
          `spec_id: ${vaSpecId}`,
          `execution_ref: ${specId}`,
          ...(epicRef ? [`epic_ref: ${epicRef}`] : []),
          ...(nsRef   ? [`north_star_ref: ${nsRef}`] : []),
          `status: PENDING`,
          `</code></pre>`,
          ``,
          `<h2>Validation &mdash; ${specId}</h2>`,
          `<p>Auto-created at task start (1&ndash;1 rule). Fill in real criteria before running validate.</p>`,
          `<p><strong>Validates:</strong> ${specId} &mdash; ${exLabel}</p>`,
          ``,
          `<h3>Acceptance Criteria <!-- #ac --></h3>`,
          `<ul data-type="taskList">`,
          `  <li data-type="taskItem" data-checked="false"><p>All functional requirements in ${specId} verified against the live implementation</p></li>`,
          `  <li data-type="taskItem" data-checked="false"><p>Edge cases and error states exercised (unit + integration)</p></li>`,
          `  <li data-type="taskItem" data-checked="false"><p>No regressions in adjacent features detected</p></li>`,
          `</ul>`,
          ``,
          `<h3>Functional Requirements <!-- #fr --></h3>`,
          `<ul data-type="taskList">`,
          `  <li data-type="taskItem" data-checked="false"><p>UI/API behaviour matches ${specId} acceptance criteria verbatim</p></li>`,
          `  <li data-type="taskItem" data-checked="false"><p>Real data, no mocks &mdash; verified via test run or manual walkthrough</p></li>`,
          `</ul>`,
          ``,
          `<h3>Non-Functional Requirements <!-- #nfr --></h3>`,
          `<ul data-type="taskList">`,
          `  <li data-type="taskItem" data-checked="false"><p>Page / API response time within acceptable range (&lt; 500ms p95)</p></li>`,
          `  <li data-type="taskItem" data-checked="false"><p>Mobile layout verified (no overflow, readable at 375px)</p></li>`,
          `</ul>`,
        ].join('\n');
        try {
          await client.post(
            `/api/v2/dataspheres/${iState.dsId}/tasks`,
            { title: `${vaSpecId} &middot; Validate ${specId}`, content: vaContent, statusGroupId: iState.validationGroupId, planModeId: iState.planModeId }
          );
          info(`VA stub ${vaSpecId} auto-created at start time (1-1 rule) ✓`);
          await patchValidationRef(vaSpecId);
        } catch (e) {
          warn(`VA stub creation failed (non-fatal): ${e.message}`);
        }
      }
    }
  }

  // Pre-gate: EP tasks require parent NS's Research task to be Done.
  // Enforces: no Epics column work without validated Research.
  {
    const sid = extractSpecId(task.content) || '';
    const isEPTask = /^EP-/i.test(sid) || /^EP-/i.test(task.title?.match(/^[A-Z]+-\d+/)?.[0] || '');
    if (isEPTask) {
      const nsRef = extractFrontMatterField(task.content, 'north_star_ref');
      if (nsRef && iState.planModeId) {
        try {
          const boardForEp = ((await client.get(
            `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
          )).tasks || []);
          const nsTask = boardForEp.find(t => {
            const s = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
            return s.toUpperCase() === nsRef.toUpperCase();
          });
          if (nsTask) {
            const rsRef = extractFrontMatterField(nsTask.content, 'research_ref');
            if (rsRef) {
              const rsTask = boardForEp.find(t => {
                const s = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
                return s.toUpperCase() === rsRef.toUpperCase();
              });
              if (rsTask && !isDone(rsTask)) {
                gate(
                  `EP task ${specId} cannot start — Research gate not cleared.\n\n` +
                  `  North Star: ${nsRef}\n` +
                  `  Research task: ${rsRef} is in [${getColumnName(rsTask)}], not Done\n\n` +
                  `  Complete ${rsRef} and move it to Done before starting Epics work.\n` +
                  `  (The Research column exists to prevent running Execution on an unvalidated approach.)`
                );
              }
              if (rsTask && isDone(rsTask)) {
                info(`Research gate: ${rsRef} is Done ✓`);
              }
            }
          }
        } catch (e) {
          warn(`Research gate check skipped (non-fatal): ${e.message}`);
        }
      }
    }
  }

  // Hard gate: hierarchy refs must all be present after auto-template + VA pre-wire above.
  {
    const titleStr = task.title || '';
    const sid = extractSpecId(task.content) || '';
    const isVA = /^V-T-/i.test(titleStr) || /^VA-/i.test(sid);
    const isEX = /^T-\d/i.test(titleStr) || /^EX-/i.test(sid);
    const isEP = /^E-\d/i.test(titleStr) || /^EP-/i.test(sid);
    const missing = [];
    if (isVA) {
      if (!extractFrontMatterField(task.content, 'execution_ref'))  missing.push('execution_ref (parent EX task)');
      if (!extractFrontMatterField(task.content, 'epic_ref'))       missing.push('epic_ref');
      if (!extractFrontMatterField(task.content, 'north_star_ref')) missing.push('north_star_ref');
    } else if (isEX) {
      if (!extractFrontMatterField(task.content, 'epic_ref'))        missing.push('epic_ref');
      if (!extractFrontMatterField(task.content, 'north_star_ref'))  missing.push('north_star_ref');
      if (!extractFrontMatterField(task.content, 'validation_ref'))  missing.push('validation_ref (child VA — auto-create failed, check validationGroupId in .sdd-state.json)');
    } else if (isEP) {
      if (!extractFrontMatterField(task.content, 'north_star_ref')) missing.push('north_star_ref');
    }
    if (missing.length > 0) {
      gate(`Hierarchy refs missing after auto-template — trace graph edges will be broken:\n${missing.map(m => `  ✗ ${m}`).join('\n')}\n\nAdd the missing fields to the task frontmatter, then re-run start.`);
    }
  }

  // Warn: content structure check (non-fatal — lets work proceed but surfaces gaps)
  {
    const col = getColumnName(task).toLowerCase();
    const tid = task.title || '';
    const content = task.content || '';
    const structMissing = [];
    const isRS = /^RS-/i.test(tid) || col.includes('research');
    const isNS = /^NS-/i.test(tid) || col.includes('north');
    const isEP = /^EP-/i.test(tid) || /^E-\d/i.test(tid) || col.includes('epic');
    const isEX = /^EX-/i.test(tid) || /^T-\d/i.test(tid) || col.includes('execut');
    const isVA = /^VA-/i.test(tid) || /^V-T-/i.test(tid) || col.includes('validat');
    const isAR = /^AR-/i.test(tid) || col.includes('artifact');
    if (isRS) {
      const anchors = ['#origin','#problem','#approach','#search-results','#codebase','#sources','#feasibility','#rec','#vc'];
      anchors.filter(a => !content.includes(a)).forEach(a => structMissing.push(`RS section ${a} missing`));
    } else if (isNS || isEP || isEX) {
      if (!/<h[2-4][^>]*>.*?Acceptance Criteria/i.test(content)) structMissing.push('Acceptance Criteria section');
      if (!/<h[2-4][^>]*>.*?Functional Requirements/i.test(content)) structMissing.push('Functional Requirements section');
      if (!/<h[2-4][^>]*>.*?Non.Functional Requirements/i.test(content)) structMissing.push('Non-Functional Requirements section');
    } else if (isVA) {
      if (!/<h[2-4][^>]*>.*?Acceptance Criteria/i.test(content)) structMissing.push('Acceptance Criteria section');
    } else if (isAR) {
      if (!extractFrontMatterField(content, 'validation_ref')) structMissing.push('validation_ref front-matter field');
    }
    if (structMissing.length > 0) {
      warn(`Content structure gaps in ${specId} (non-blocking — fix before complete):\n${structMissing.map(m => `  ⚠ ${m}`).join('\n')}\n  Run: node sdd-conductor.mjs gate content-structure ${taskId}`);
    }
  }

  // Gate: board-wide trace graph integrity (EX/VA tasks only — skip for RS/NS/EP which may have no children yet)
  {
    const titleStr = task.title || '';
    const sid = extractSpecId(task.content) || '';
    const isEXorVA = /^T-\d/i.test(titleStr) || /^V-T-/i.test(titleStr) || /^EX-/i.test(sid) || /^VA-/i.test(sid);
    if (isEXorVA) {
      info(`\nRunning trace-graph integrity gate...`);
      try {
        await cmdGateTraceGraph(iState.dsId, iState.planModeId);
      } catch (e) {
        if (e.code === 'ERR_CONDUCTOR_GATE') throw e;
        warn(`Trace graph check skipped (non-fatal): ${e.message}`);
      }
    }
  }

  // PATCH task to IN_PROGRESS + write gate state to description
  const startedAt = new Date().toISOString();
  await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`, {
    status:  'IN_PROGRESS',
    content: gateStateWrite(task.content || '', {
      gate_status: 'IN_PROGRESS',
      started_at:  startedAt,
      spec_id:     specId,
    }),
  });

  // Post start comment
  await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}/comments`, {
    content: `[all-dai-sdd-system-message]\n\n**IN PROGRESS** — Starting ${specId}. Dependencies cleared. sdd-conductor v${VERSION}.`,
  });

  // Write active task to initiative state
  iState.activeTask = {
    taskId,
    specId,
    title: task.title,
    epicTaskId: task.parentId || null,
    implFiles,
    startedAt: new Date().toISOString(),
  };
  iState.activeTaskId = taskId;
  saveInitiative(state, slug, iState);

  // Sync .claude/sdd-active.json so sdd-enforce.js (PreToolUse) sees the active task
  syncLegacyActive({ active: true, activeTaskId: taskId, specId, project: slug, initiative: slug,
    implFiles, title: task.title, startedAt, completedAt: undefined });

  ok(`Task ${specId} marked IN_PROGRESS and logged to .sdd-state.json (initiative: ${slug})`);
  info(`File guard active. Writes outside [${implFiles.slice(0,3).join(', ')}${implFiles.length>3?` …+${implFiles.length-3} more`:''}] are blocked by PreToolUse hook.`);
}

async function cmdComplete(taskId) {
  if (!taskId) die('Usage: complete <taskId>');
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  // Fetch the task
  const task = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`));
  const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || taskId;

  console.log(`\n🟢 SDD-CONDUCTOR COMPLETE  [${slug}]`);
  info(`Task: ${task.title}`);

  // Gate 1: All acceptance checklist items must be checked
  const unchecked = countUncheckedItems(task.content);
  if (unchecked > 0) {
    gate(
      `${unchecked} acceptance checklist item(s) are still unchecked.\n\n` +
      `  PATCH the task content first, replacing data-checked="false" → data-checked="true"\n` +
      `  for every verified criterion. Then re-run: node sdd-conductor.mjs complete ${taskId}`
    );
  }
  info(`Acceptance checklist: all items checked ✓`);

  // Gate 1b: checklist format — all task lists must use <ul data-type="taskList">
  {
    const bareUl = /<ul(?![^>]*data-type="taskList")[^>]*>[\s\S]{0,50}<li[^>]*data-type="taskItem"/;
    if (bareUl.test(task.content)) {
      gate(`Checklist format violation: bare <ul> wrapping taskItem elements found in ${specId}.\nFix: replace all <ul> containing taskItem children with <ul data-type="taskList">.`);
    }
  }

  // Gate 2: Completion comment must exist with [all-dai-sdd-system-message]
  const comments = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}/comments`);
  const commentList = comments.comments || comments || [];
  const completionComment = commentList.find(c =>
    c.content?.includes('[all-dai-sdd-system-message]') &&
    (c.content?.includes('Completion summary') || c.content?.includes('Verified criteria'))
  );
  if (!completionComment) {
    gate(
      `No completion comment found on task ${specId}.\n\n` +
      `  Post a completion comment:\n` +
      `    [all-dai-sdd-system-message]\n\n` +
      `    **Completion summary:** <what was built>\n` +
      `    **Verified criteria:**\n` +
      `    - <criterion 1> → <evidence: test name / screenshot / observation>\n` +
      `    - <criterion 2> → <evidence>\n\n` +
      `  Then re-run: node sdd-conductor.mjs complete ${taskId}`
    );
  }
  info(`Completion comment: found ✓`);

  // Gate 2b: Test evidence required
  const totalCheckedItems = (task.content?.match(/data-checked="true"/g) || []).length;
  const hasTestEvidence = commentList.some(c =>
    c.content?.includes('[all-dai-sdd-system-message]') &&
    (c.content?.includes('Test Run —') || c.content?.includes('✅') ||
     c.content?.includes('tests passed') || c.content?.includes('playwright') ||
     c.content?.includes('vitest'))
  );
  if (!hasTestEvidence && totalCheckedItems > 0) {
    gate(
      `No test evidence found for task ${specId}.\n\n` +
      `  Every completed task must show real test results before marking Done.\n` +
      `  Either:\n` +
      `    1. Run vitest/playwright (progress-hook auto-posts results), OR\n` +
      `    2. node sdd-conductor.mjs progress "Tests: <X>/<Y> passed — <test suite>"\n\n` +
      `  Then re-run: node sdd-conductor.mjs complete ${taskId}`
    );
  }
  if (hasTestEvidence) info(`Test evidence: found ✓`);

  // Gate 2c: Completion comment must explicitly reference each acceptance criterion
  if (completionComment && totalCheckedItems > 0) {
    const criteriaSection = completionComment.content.match(/\*\*Verified criteria:\*\*([\s\S]*?)(\n\n\*\*|\n---|\n\[|$)/);
    const bulletCount = criteriaSection
      ? (criteriaSection[1].match(/\n[-*•]\s/g) || []).length
      : 0;
    if (bulletCount < totalCheckedItems) {
      gate(
        `Completion comment has ${bulletCount} verified criterion bullet(s) but task has ${totalCheckedItems} checked item(s).\n\n` +
        `  Every acceptance criterion must be explicitly verified with evidence.\n` +
        `  Update the completion comment to include one bullet per criterion with real evidence.\n` +
        `  Then re-run: node sdd-conductor.mjs complete ${taskId}`
      );
    }
    info(`Criterion coverage: ${bulletCount}/${totalCheckedItems} verified ✓`);
  }

  // Gate 3: No mocks in impl files
  const implFiles = extractImplFiles(task.content);
  const root = findGitRoot();
  for (const f of implFiles) {
    const fPath = path.join(root, f);
    if (fs.existsSync(fPath)) {
      const content = fs.readFileSync(fPath, 'utf-8');
      const mocks = hasMockPatterns(content);
      if (mocks.length > 0) {
        gate(`Mock/stub pattern detected in ${f}:\n  Patterns: ${mocks.join(', ')}\n\nRemove mocks before marking Done.`);
      }
    }
  }
  if (implFiles.length > 0) info(`Mock scan: clean ✓`);

  // Gate 4: EX tasks require a 1-1 linked VA task — cannot complete EX without VA existing
  // Relationship model: each EX owns exactly one VA (execution_ref on VA points to this EX).
  // If no VA exists, auto-create a stub in the Validation column and block until it runs.
  const isExTask = /^EX-\d+/i.test(specId) || /^EX-/i.test(task.title?.match(/^[A-Z]+-\d+/)?.[0] || '');
  if (isExTask && iState.planModeId) {
    const allTasksForVa = ((await client.get(
      `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
    )).tasks || []);
    const linkedVa = allTasksForVa.find(t => {
      const ref = extractFrontMatterField(t.content || '', 'execution_ref');
      return ref && ref.toUpperCase() === specId.toUpperCase();
    });
    if (!linkedVa) {
      const epicRef = extractFrontMatterField(task.content, 'epic_ref') || '';
      const nsRef   = extractFrontMatterField(task.content, 'north_star_ref') || '';
      const exLabel = task.title?.replace(/^EX-\d+\s*[·•\s]+/i, '').trim() || specId;
      const vaCounter = allTasksForVa.filter(t => /^VA-\d+/i.test(t.title || '')).length + 1;
      const vaSpecId  = `VA-${String(vaCounter).padStart(3, '0')}`;
      const vaContent = [
        `<pre><code class="language-yaml">`,
        `spec_id: ${vaSpecId}`,
        `execution_ref: ${specId}`,
        ...(epicRef ? [`epic_ref: ${epicRef}`] : []),
        ...(nsRef   ? [`north_star_ref: ${nsRef}`] : []),
        `status: PENDING`,
        `</code></pre>`,
        ``,
        `<h2>Validation &mdash; ${specId}</h2>`,
        `<p>Auto-created by sdd-conductor. Every EX task requires exactly one VA (1&ndash;1 map). Fill in the real criteria before running validate.</p>`,
        `<p><strong>Validates:</strong> ${specId} &mdash; ${exLabel}</p>`,
        ``,
        `<h3>Acceptance Criteria <!-- #ac --></h3>`,
        `<ul data-type="taskList">`,
        `  <li data-type="taskItem" data-checked="false"><p>All functional requirements in ${specId} verified against the live implementation</p></li>`,
        `  <li data-type="taskItem" data-checked="false"><p>Edge cases and error states exercised (unit + integration)</p></li>`,
        `  <li data-type="taskItem" data-checked="false"><p>No regressions in adjacent features detected</p></li>`,
        `</ul>`,
        ``,
        `<h3>Functional Requirements <!-- #fr --></h3>`,
        `<ul data-type="taskList">`,
        `  <li data-type="taskItem" data-checked="false"><p>UI/API behaviour matches ${specId} acceptance criteria verbatim</p></li>`,
        `  <li data-type="taskItem" data-checked="false"><p>Real data, no mocks — verified via test run or manual walkthrough</p></li>`,
        `</ul>`,
        ``,
        `<h3>Non-Functional Requirements <!-- #nfr --></h3>`,
        `<ul data-type="taskList">`,
        `  <li data-type="taskItem" data-checked="false"><p>Page / API response time within acceptable range (&lt; 500ms p95)</p></li>`,
        `  <li data-type="taskItem" data-checked="false"><p>Mobile layout verified (no overflow, readable at 375px)</p></li>`,
        `</ul>`,
      ].join('\n');
      let newVaId = null;
      if (iState.validationGroupId) {
        try {
          const created = await client.post(
            `/api/v2/dataspheres/${iState.dsId}/tasks`,
            { title: `${vaSpecId} &middot; Validate ${specId}`, content: vaContent, statusGroupId: iState.validationGroupId, planModeId: iState.planModeId }
          );
          newVaId = created.task?.id || created.id || null;
          info(`VA stub ${vaSpecId} auto-created in Validation column (${newVaId}) ✓`);
        } catch (e) {
          warn(`Could not auto-create VA stub: ${e.message}`);
        }
      }
      gate(
        `EX task ${specId} has no linked Validation task (1&ndash;1 rule violated).\n\n` +
        (newVaId
          ? `  VA stub ${vaSpecId} has been auto-created in the Validation column (id: ${newVaId}).\n`
          : `  A VA stub must be created manually in the Validation column.\n`) +
        `\n` +
        `  Required before completing ${specId}:\n` +
        `    1. Fill in real AC/FR/NFR criteria in ${vaSpecId} specific to what ${specId} built\n` +
        `    2. Run: node sdd-conductor.mjs validate ${newVaId || '<vaTaskId>'}\n` +
        `    3. VA pass auto-promotes ${specId} to Done — do NOT call 'complete' again\n\n` +
        `  EX tasks are NEVER manually marked Done — only VA promotion does this.`
      );
    }
    info(`VA 1&ndash;1 gate: ${linkedVa.title?.match(/^VA-\d+/)?.[0] || linkedVa.id} linked ✓`);
  }

  const completedAt = new Date().toISOString();
  let currentContent = task.content || '';

  // Step 1: Move to Validation column (atomic pass-through — gate checks already passed above)
  if (iState.validationGroupId) {
    currentContent = gateStateWrite(currentContent, {
      gate_status:   'IN_VALIDATION',
      validation_at: completedAt,
      spec_id:       specId,
    });
    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`, {
      statusGroupId: iState.validationGroupId,
      content:       currentContent,
    });
    info(`Task moved to Validation column ✓`);
  }

  // Step 2: Done promotion — EX tasks are EXCLUSIVELY promoted by cmdValidate passing.
  // If the linked VA is already Done (recovery path), allow promotion here.
  // Otherwise stop at Validation column and wait for the VA run.
  if (isExTask) {
    let vaIsDone = false;
    try {
      const boardCheck = ((await client.get(
        `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
      )).tasks || []);
      const linkedVaForCheck = boardCheck.find(t => {
        const ref = extractFrontMatterField(t.content || '', 'execution_ref');
        return ref && ref.toUpperCase() === specId.toUpperCase();
      });
      if (linkedVaForCheck && isDone(linkedVaForCheck)) {
        vaIsDone = true;
        info(`VA already Done (recovery path) — promoting EX to Done ✓`);
      }
    } catch { /* non-fatal — fall through to block */ }

    if (!vaIsDone) {
      // Post a handoff comment so the developer knows what to do next
      const vaRef = extractFrontMatterField(task.content, 'validation_ref') || '<vaTaskId>';
      await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}/comments`, {
        content: [
          `[all-dai-sdd-system-message]`,
          ``,
          `**${specId} ready for Validation** | ${completedAt}`,
          ``,
          `All gates passed. Task is in the Validation column.`,
          `Done promotion happens ONLY when the linked VA passes.`,
          ``,
          `Next: run the validation gate:`,
          `\`node sdd-conductor.mjs validate ${vaRef}\``,
        ].join('\n'),
      });
      iState.activeTask = null;
      iState.activeTaskId = null;
      saveInitiative(state, slug, iState);
      syncLegacyActive({ active: false, activeTaskId: null, specId: null, completedAt,
        lastCompletedSpecId: specId, project: slug, initiative: slug, implFiles: [] });
      ok(`${specId} is now in Validation. Run: node sdd-conductor.mjs validate ${vaRef}`);
      return;
    }
  }

  currentContent = gateStateWrite(currentContent, {
    gate_status:  'PASS',
    completed_at: completedAt,
  });
  await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`, {
    statusGroupId: iState.doneGroupId,
    status:        'DONE',
    content:       currentContent,
  });
  info(`Task PATCH: status=DONE, statusGroupId=${iState.doneGroupId} ✓`);

  // Propagate to parent Epic checklist
  if (task.parentId) {
    await propagateEpicChecklist(client, iState, task.parentId, specId, task.title);
  }

  // Clear active task, save state, inject briefing into next pending task
  iState.activeTask = null;
  iState.activeTaskId = null;
  iState.lastCompleted = { taskId, specId, title: task.title, completedAt };
  saveInitiative(state, slug, iState);

  // Clear .claude/sdd-active.json so sdd-enforce.js stops blocking file edits
  syncLegacyActive({ active: false, activeTaskId: null, specId: null, completedAt,
    lastCompletedSpecId: specId, project: slug, initiative: slug, implFiles: [] });

  await injectNextBriefing(client, iState, specId, task.title, completedAt);

  ok(`${specId} marked Done via Validation. Next task briefed.`);

  // Auto-refresh the dashboard focus section so the tree reflects the completed task immediately.
  if (iState.dashboardSlug && iState.dsUri) {
    try {
      await cmdUpdateDashboard(iState.dsUri, iState.dashboardSlug);
      info(`Dashboard Current Focus refreshed ✓`);
    } catch (e) {
      warn(`Dashboard refresh skipped (non-fatal): ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// resume / brief / recover — cross-session recovery commands
// ---------------------------------------------------------------------------

async function cmdResume() {
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  console.log(`\n🔍 SDD-CONDUCTOR RESUME  [${slug}]`);

  const all   = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`);
  const tasks = all.tasks || all || [];

  const stuck = [];
  for (const t of tasks) {
    const col    = getColumnName(t).toLowerCase();
    const gs     = gateStateRead(t.content || '');
    const specId = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || t.id;
    if (col === 'validation' && gs.gate_status !== 'PASS') {
      stuck.push({ specId, taskId: t.id, col, gate: gs.gate_status || '(none)', title: t.title });
    } else if (col === 'execution' && gs.gate_status === 'IN_PROGRESS') {
      stuck.push({ specId, taskId: t.id, col, gate: gs.gate_status, title: t.title });
    }
  }

  if (stuck.length === 0) {
    ok(`No stuck tasks found. Board is clean.`);
    if (iState.activeTask) {
      info(`Active task: ${iState.activeTask.specId} — ${iState.activeTask.title}`);
      info(`  Continue:  node sdd-conductor.mjs complete ${iState.activeTask.taskId}`);
    }
    return;
  }

  warn(`Found ${stuck.length} stuck task(s):\n`);
  for (const { specId, taskId, col, gate, title } of stuck) {
    console.log(`   ${specId}  [${col}]  gate_status=${gate}`);
    console.log(`   ${title}`);
    if (col === 'validation') {
      console.log(`   → Fix:  node sdd-conductor.mjs recover ${taskId}`);
    } else {
      console.log(`   → Fix:  node sdd-conductor.mjs complete ${taskId}`);
    }
    console.log('');
  }
}

async function cmdBrief() {
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  console.log(`\n📋 SDD-CONDUCTOR BRIEF  [${slug}]`);

  const last        = iState.lastCompleted;
  const completedAt = last?.completedAt || new Date().toISOString();

  await injectNextBriefing(client, iState, last?.specId || '(none)', last?.title || '', completedAt);

  ok(`Session briefings refreshed for pending Execution tasks.`);
}

async function cmdRecover(taskId) {
  if (!taskId) die('Usage: recover <taskId>');
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  const task   = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`));
  const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || taskId;
  const col    = getColumnName(task).toLowerCase();

  console.log(`\n🔧 SDD-CONDUCTOR RECOVER  [${slug}]`);
  info(`Task: ${task.title}  (${specId})`);
  info(`Column: ${col}`);

  if (col === 'done') {
    ok(`${specId} is already Done. Nothing to recover.`);
    return;
  }

  const completedAt  = new Date().toISOString();
  const doneContent  = gateStateWrite(task.content || '', {
    gate_status:  'PASS',
    completed_at: completedAt,
    recovered_by: 'sdd-conductor recover',
    spec_id:      specId,
  });

  await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`, {
    statusGroupId: iState.doneGroupId,
    status:        'DONE',
    content:       doneContent,
  });

  await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}/comments`, {
    content: `[all-dai-sdd-system-message]\n\n**RECOVERED** — ${specId} moved to Done by sdd-conductor recover at ${completedAt}.\nRecovered from: ${col} column. Gate state set to PASS.`,
  });

  if (iState.activeTask?.taskId === taskId) iState.activeTask = null;
  iState.lastCompleted = { taskId, specId, title: task.title, completedAt };
  saveInitiative(state, slug, iState);

  await injectNextBriefing(client, iState, specId, task.title, completedAt);

  ok(`${specId} recovered to Done. Next task briefed.`);
}

// ---------------------------------------------------------------------------
// Hierarchical validation chain — VA → EX → Epic → NS → Research review
// ---------------------------------------------------------------------------

async function runNsValidation(client, iState, nsTaskId) {
  try {
    const ns = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${nsTaskId}`);
    if (!ns.content) return;
    const nsSpecId = extractSpecId(ns.content) || ns.title?.match(/^[A-Z]+-\d+/)?.[0] || nsTaskId;

    const acItems  = extractSectionChecklist(ns.content, 'Acceptance Criteria');
    const frItems  = extractSectionChecklist(ns.content, 'Functional Requirements');
    const nfrItems = extractSectionChecklist(ns.content, 'Non-Functional Requirements');
    const allItems = [
      ...acItems.map(i  => ({ ...i, section: 'AC'  })),
      ...frItems.map(i  => ({ ...i, section: 'FR'  })),
      ...nfrItems.map(i => ({ ...i, section: 'NFR' })),
    ];
    const unchecked = allItems.filter(i => !i.checked);

    if (unchecked.length > 0) {
      await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${nsTaskId}/comments`, {
        content: [
          `[all-dai-sdd-system-message]`,
          ``,
          `**North Star Validation Required** — ${nsSpecId} | ${new Date().toISOString()}`,
          ``,
          `All Epics are complete. Verify each acceptance item before closing this North Star:`,
          ``,
          ...unchecked.map(i => `- [ ] [${i.section}] ${i.text}`),
          ``,
          `For each unchecked item: verify it is accurate and actually tested — not rubber-stamped.`,
          `If an item cannot be verified: update the plan with new Epics or EX tasks, re-run /all-dai-sdd.`,
        ].join('\n'),
      });
      info(`NS ${nsSpecId}: ${unchecked.length} acceptance item(s) need verification — comment posted`);
      return;
    }

    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${nsTaskId}`, {
      statusGroupId: iState.doneGroupId,
      status: 'DONE',
    });
    const verifiedList = allItems.map(i => `- [${i.section}] ${i.text} ✓`).join('\n');
    await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${nsTaskId}/comments`, {
      content: [
        `[all-dai-sdd-system-message]`,
        ``,
        `**North Star ACHIEVED** — ${nsSpecId} | ${new Date().toISOString()}`,
        ``,
        `All Epics complete and all acceptance criteria individually verified.`,
        allItems.length > 0 ? `\n**Verified:**\n${verifiedList}` : ``,
        ``,
        `**Final step: Research Review + Summary Page**`,
        `- Review all RS tasks linked to this North Star — verify they are in Done column`,
        `- Review verbatim origin prompts against what was actually delivered`,
        `- Write the Next Steps & UAT summary page (see Dashboard Page Template in SKILL.md)`,
        `- Run /all-dai-sdd — AUDIT mode will detect all NS Done and generate the close-out page`,
      ].join('\n'),
    });
    info(`NS ${nsSpecId}: all items verified -> moved to Done`);

    // Cascade: find parent RS task via research_ref and propagate
    const rsRef = extractFrontMatterField(ns.content, 'research_ref');
    if (rsRef) {
      try {
        const allTasks = (await client.get(
          `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
        )).tasks || [];
        const rsTask = allTasks.find(t =>
          extractSpecId(t.content) === rsRef ||
          t.title?.match(/^[A-Z]+-\d+/)?.[0] === rsRef
        );
        if (rsTask) {
          await propagateResearchChecklist(client, iState, rsTask.id, nsSpecId, ns.title);
        } else {
          info(`RS task "${rsRef}" not found on board — manual Research review required`);
        }
      } catch (e) {
        warn(`Could not cascade NS → RS for ${nsSpecId}: ${e.message}`);
      }
    } else {
      info(`NS ${nsSpecId} has no research_ref — add one to enable automatic RS cascade`);
    }
  } catch (e) {
    warn(`Could not run NS validation for ${nsTaskId}: ${e.message}`);
  }
}

async function runEpicValidation(client, iState, epicTaskId) {
  try {
    const epic = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${epicTaskId}`);
    if (!epic.content) return;
    const epicSpecId = extractSpecId(epic.content) || epic.title?.match(/^[A-Z]+-\d+/)?.[0] || epicTaskId;

    const acItems  = extractSectionChecklist(epic.content, 'Acceptance Criteria');
    const frItems  = extractSectionChecklist(epic.content, 'Functional Requirements');
    const nfrItems = extractSectionChecklist(epic.content, 'Non-Functional Requirements');
    const allItems = [
      ...acItems.map(i  => ({ ...i, section: 'AC'  })),
      ...frItems.map(i  => ({ ...i, section: 'FR'  })),
      ...nfrItems.map(i => ({ ...i, section: 'NFR' })),
    ];
    const unchecked = allItems.filter(i => !i.checked);

    if (unchecked.length > 0) {
      await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${epicTaskId}/comments`, {
        content: [
          `[all-dai-sdd-system-message]`,
          ``,
          `**Epic Validation Required** — ${epicSpecId} | ${new Date().toISOString()}`,
          ``,
          `All Execution tasks are complete. Verify each acceptance item before closing this Epic:`,
          ``,
          ...unchecked.map(i => `- [ ] [${i.section}] ${i.text}`),
          ``,
          `For each unchecked item: verify it is accurate and actually tested — not rubber-stamped.`,
          `If an item cannot be verified: create a new EX task or update the plan, re-run /all-dai-sdd.`,
        ].join('\n'),
      });
      info(`Epic ${epicSpecId}: ${unchecked.length} acceptance item(s) need verification — comment posted`);
      return;
    }

    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${epicTaskId}`, {
      statusGroupId: iState.doneGroupId,
      status: 'DONE',
    });
    const verifiedList = allItems.map(i => `- [${i.section}] ${i.text} ✓`).join('\n');
    await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${epicTaskId}/comments`, {
      content: [
        `[all-dai-sdd-system-message]`,
        ``,
        `**Epic VERIFIED** — ${epicSpecId} | ${new Date().toISOString()}`,
        ``,
        `All Execution tasks complete and all acceptance criteria individually verified.`,
        allItems.length > 0 ? `\n**Verified:**\n${verifiedList}` : ``,
      ].join('\n'),
    });
    info(`Epic ${epicSpecId}: all items verified -> moved to Done`);

    if (epic.parentId) {
      await propagateNsChecklist(client, iState, epic.parentId, epicSpecId, epic.title);
    }
  } catch (e) {
    warn(`Could not run Epic validation for ${epicTaskId}: ${e.message}`);
  }
}

async function propagateEpicChecklist(client, iState, epicTaskId, doneSpecId, doneTitle) {
  try {
    const epic = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${epicTaskId}`);
    if (!epic.content) return;

    const idPrefix = doneSpecId.match(/^[A-Z]+-\d+/)?.[0] || doneSpecId;
    const updated = epic.content.replace(
      new RegExp(`(data-checked="false"><p>)(${escapeRegex(idPrefix)}[^<]*)`, 'g'),
      `data-checked="true"><p>$2`
    );

    if (updated === epic.content) {
      info(`Epic checklist: no matching item found for ${idPrefix} (may need manual tick)`);
      return;
    }

    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${epicTaskId}`, {
      content: updated,
    });
    info(`Epic checklist: ticked ${idPrefix} ✓`);

    const remaining = countUncheckedItems(updated);
    if (remaining === 0) {
      info(`Epic execution checklist fully ticked — running Epic acceptance validation`);
      await runEpicValidation(client, iState, epicTaskId);
    } else {
      info(`Epic: ${remaining} task(s) remaining`);
    }
  } catch (e) {
    warn(`Could not propagate to Epic ${epicTaskId}: ${e.message}`);
  }
}

async function propagateNsChecklist(client, iState, nsTaskId, doneEpicSpecId, doneEpicTitle) {
  try {
    const ns = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${nsTaskId}`);
    if (!ns.content) return;

    const idPrefix = doneEpicSpecId.match(/^[A-Z]+-\d+/)?.[0] || doneEpicSpecId;
    const updated = ns.content.replace(
      new RegExp(`(data-checked="false"><p>)(${escapeRegex(idPrefix)}[^<]*)`, 'g'),
      `data-checked="true"><p>$2`
    );

    if (updated === ns.content) {
      info(`NS checklist: no matching item found for ${idPrefix}`);
      return;
    }

    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${nsTaskId}`, { content: updated });
    info(`NS checklist: ticked ${idPrefix} ✓`);

    const remaining = countUncheckedItems(updated);
    if (remaining === 0) {
      info(`NS ${idPrefix}: all Epics done — running NS acceptance validation`);
      await runNsValidation(client, iState, nsTaskId);
    }
  } catch (e) {
    warn(`Could not propagate to NS ${nsTaskId}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// RS cascade — fires when all NS tasks under an RS are Done
// ---------------------------------------------------------------------------

async function runResearchValidation(client, iState, rsTaskId) {
  try {
    const rs = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${rsTaskId}`);
    if (!rs.content) return;
    const rsSpecId = extractSpecId(rs.content) || rs.title?.match(/^[A-Z]+-\d+/)?.[0] || rsTaskId;

    const acItems  = extractSectionChecklist(rs.content, 'Acceptance Criteria');
    const frItems  = extractSectionChecklist(rs.content, 'Functional Requirements');
    const nfrItems = extractSectionChecklist(rs.content, 'Non-Functional Requirements');
    const allItems = [
      ...acItems.map(i  => ({ ...i, section: 'AC'  })),
      ...frItems.map(i  => ({ ...i, section: 'FR'  })),
      ...nfrItems.map(i => ({ ...i, section: 'NFR' })),
    ];
    const unchecked = allItems.filter(i => !i.checked);

    if (unchecked.length > 0) {
      await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${rsTaskId}/comments`, {
        content: [
          `[all-dai-sdd-system-message]`,
          ``,
          `**Research Validation Required** — ${rsSpecId} | ${new Date().toISOString()}`,
          ``,
          `All North Stars under this Research task are complete. Review each acceptance item:`,
          ``,
          ...unchecked.map(i => `- [ ] [${i.section}] ${i.text}`),
          ``,
          `Review origin prompts vs what was actually delivered. Verify feasibility evidence held true.`,
          `If gaps exist: create new RS tasks for unresolved questions before closing this Research item.`,
        ].join('\n'),
      });
      info(`RS ${rsSpecId}: ${unchecked.length} acceptance item(s) need review — comment posted`);
      return;
    }

    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${rsTaskId}`, {
      statusGroupId: iState.doneGroupId,
      status: 'DONE',
    });
    await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${rsTaskId}/comments`, {
      content: [
        `[all-dai-sdd-system-message]`,
        ``,
        `**Research COMPLETE** — ${rsSpecId} | ${new Date().toISOString()}`,
        ``,
        `All North Stars complete and all research criteria verified.`,
        ``,
        `**Full delivery trace:** Research → North Stars → Epics → Execution → Validation → Artifacts`,
        `The original prompts and research objectives have been fully addressed.`,
        allItems.length > 0
          ? `\n**Verified criteria:**\n${allItems.map(i => `- [${i.section}] ${i.text} ✓`).join('\n')}`
          : '',
      ].join('\n'),
    });
    info(`RS ${rsSpecId}: all North Stars done — Research moved to Done ✓`);
  } catch (e) {
    warn(`Could not run Research validation for ${rsTaskId}: ${e.message}`);
  }
}

async function propagateResearchChecklist(client, iState, rsTaskId, doneNsSpecId, doneNsTitle) {
  try {
    const rs = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${rsTaskId}`);
    if (!rs.content) return;

    const idPrefix = doneNsSpecId.match(/^[A-Z]+-\d+/)?.[0] || doneNsSpecId;
    const updated = rs.content.replace(
      new RegExp(`(data-checked="false"><p>)(${escapeRegex(idPrefix)}[^<]*)`, 'g'),
      `data-checked="true"><p>$2`
    );

    if (updated !== rs.content) {
      await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${rsTaskId}`, { content: updated });
      info(`RS checklist: ticked ${idPrefix} ✓`);
    }

    const remaining = countUncheckedItems(updated);
    if (remaining === 0) {
      info(`RS: all North Stars done — running Research acceptance validation`);
      await runResearchValidation(client, iState, rsTaskId);
    } else {
      info(`RS: ${remaining} North Star(s) remaining`);
    }
  } catch (e) {
    warn(`Could not propagate to RS ${rsTaskId}: ${e.message}`);
  }
}

async function cmdStatus() {
  const state = loadState();
  if (!state) {
    console.log('\n📋 No .sdd-state.json — run: node sdd-conductor.mjs init\n');
    return;
  }

  const initiatives = Object.entries(state.initiatives || {});
  if (initiatives.length === 0) {
    console.log('\n📋 No initiatives found — run: node sdd-conductor.mjs init\n');
    return;
  }

  console.log(`\n📋 SDD-CONDUCTOR STATUS`);

  for (const [slug, iState] of initiatives) {
    const isCurrent = slug === state.currentInitiative;
    const marker = isCurrent ? '▶' : ' ';
    console.log(`\n  ${marker} ${slug}  [${iState.dsUri}]`);
    info(`  Plan mode: ${iState.planModeId}`);

    if (!iState.activeTask) {
      info(`  Active task: (none)`);
      if (iState.lastCompleted) {
        info(`  Last completed: ${iState.lastCompleted.specId} at ${iState.lastCompleted.completedAt}`);
      }
    } else {
      const t = iState.activeTask;
      info(`  Active task: ${t.specId} — ${t.title}`);
      info(`  Started: ${t.startedAt}`);
      info(`  Impl files: ${t.implFiles?.join(', ') || '(none)'}`);

      try {
        const client = makeClient();
        const live = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${t.taskId}`));
        info(`  Live status: ${live.status} / ${getColumnName(live)}`);
      } catch {
        info(`  Live status: (could not fetch)`);
      }
    }
  }

  if (initiatives.length > 1) {
    console.log(`\n  Switch: node sdd-conductor.mjs switch <slug>`);
    console.log(`  Cross-project: node sdd-conductor.mjs workspace`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// cmdGateTraceGraph — board-wide trace integrity gate
//
// Checks that every task's front-matter refs form a connected NS→EP→EX→VA
// chain with no orphans, broken refs, or type mismatches.
//
// Called by:
//   cmdStart     — before any EX/VA task begins
//   gate trace-graph — standalone / CI use
// ---------------------------------------------------------------------------

async function cmdGateTraceGraph(dsId, planModeId) {
  const client = makeClient();
  const allRes = await client.get(
    `/api/v2/dataspheres/${dsId}/tasks?planModeId=${planModeId}&limit=500`
  );
  const tasks = allRes.tasks || allRes || [];

  console.log(`\n🔗 SDD-CONDUCTOR GATE trace-graph`);
  info(`Checking ${tasks.length} tasks for trace continuity...`);

  // Build prefix → task lookup  (e.g. "EP-001" → task)
  // Also index by full spec_id from front-matter (e.g. "SPEC-PROF-EX-004") so that
  // cross-ref lookups work regardless of whether the ref uses the short or long form.
  const byPrefix = new Map();
  for (const t of tasks) {
    const pid = (t.title || '').match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase();
    if (pid) byPrefix.set(pid, t);
    const fmSpecId = (extractSpecId(t.content) || '').toUpperCase();
    if (fmSpecId && fmSpecId !== pid) byPrefix.set(fmSpecId, t);
  }

  function taskType(t) {
    const pid = (t.title || '').match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase() || '';
    const col = (t.statusGroup?.name || '').toLowerCase();
    if (pid.startsWith('RS') || col.includes('research')) return 'RS';
    if (pid.startsWith('NS') || col.includes('north')) return 'NS';
    if (pid.startsWith('AR') || col.includes('artifact')) return 'AR';
    if (pid.startsWith('EP') || /^E-\d/.test(pid) || col.includes('epic')) return 'EP';
    if (pid.startsWith('EX') || /^T-\d/.test(pid) || col.includes('execut')) return 'EX';
    if (pid.startsWith('VA') || /^V-T/.test(pid) || col.includes('validat')) return 'VA';
    return null;
  }

  const byType = { RS: [], NS: [], EP: [], EX: [], VA: [], AR: [] };
  for (const t of tasks) {
    const type = taskType(t);
    if (type) byType[type].push(t);
  }

  const violations = [];

  function taskPid(t) {
    return (t.title || '').match(/^([A-Z]+-\d+)/i)?.[1]?.toUpperCase() || t.id;
  }

  // ── RULE 0: NS → RS ──────────────────────────────────────────────────────
  // Every active North Star must have a research_ref pointing to a valid RS task.
  // If research_ref exists but the RS task is not on the board → broken ref (must fix).
  // If research_ref is absent → orphan NS — no research justification exists.
  for (const ns of byType.NS) {
    if (isDone(ns)) continue;
    const pid = taskPid(ns);
    const ref = (extractFrontMatterField(ns.content || '', 'research_ref') || '').toUpperCase();
    if (!ref) {
      violations.push({ task: pid, rule: 'NS-NO-RESEARCH',
        msg: `${pid}: missing research_ref — North Star has no backing Research task` });
    } else if (!byPrefix.has(ref)) {
      violations.push({ task: pid, rule: 'NS-BROKEN-RESEARCH-REF',
        msg: `${pid}: research_ref "${ref}" not found on board — create the RS task first` });
    } else if (taskType(byPrefix.get(ref)) !== 'RS') {
      violations.push({ task: pid, rule: 'NS-WRONG-RESEARCH-TYPE',
        msg: `${pid}: research_ref "${ref}" resolves to a ${taskType(byPrefix.get(ref))} task, expected RS` });
    }
  }

  // ── RULE 0.5: RS content completeness ─────────────────────────────────────
  // Each RS task must contain the 9 required research section anchors.
  // A missing anchor means that research evidence is absent and cannot be reviewed.
  const RS_REQUIRED_SECTIONS = [
    { key: '#origin',         label: 'Origin Prompts (<!-- #origin -->)' },
    { key: '#problem',        label: 'Problem Statement (<!-- #problem -->)' },
    { key: '#approach',       label: 'Approach Under Evaluation (<!-- #approach -->)' },
    { key: '#search-results', label: 'Search Results (<!-- #search-results -->)' },
    { key: '#codebase',       label: 'Codebase Context (<!-- #codebase -->)' },
    { key: '#sources',        label: 'Sources (<!-- #sources -->)' },
    { key: '#feasibility',    label: 'Feasibility Evidence (<!-- #feasibility -->)' },
    { key: '#rec',            label: 'Recommendation (<!-- #rec -->)' },
    { key: '#vc',             label: 'Validation Criteria (<!-- #vc -->)' },
  ];
  for (const rs of byType.RS) {
    if (isDone(rs)) continue;
    const pid = taskPid(rs);
    const content = rs.content || '';
    const missingSecs = RS_REQUIRED_SECTIONS.filter(s => !content.includes(s.key));
    if (missingSecs.length > 3) {
      violations.push({ task: pid, rule: 'RS-INCOMPLETE',
        msg: `${pid}: missing ${missingSecs.length}/9 required research sections:\n${missingSecs.map(s => `      - ${s.label}`).join('\n')}` });
    }
  }

  // ── RULE 1: EP → NS ──────────────────────────────────────────────────────
  for (const ep of byType.EP) {
    const pid = taskPid(ep);
    const ref = (extractFrontMatterField(ep.content || '', 'north_star_ref') || '').toUpperCase();
    if (!ref) {
      violations.push({ task: pid, rule: 'EP-ORPHAN',
        msg: `${pid}: missing north_star_ref — EP has no parent NS in trace graph` });
    } else if (!byPrefix.has(ref)) {
      violations.push({ task: pid, rule: 'EP-BROKEN-REF',
        msg: `${pid}: north_star_ref "${ref}" not found on board` });
    } else if (taskType(byPrefix.get(ref)) !== 'NS') {
      violations.push({ task: pid, rule: 'EP-WRONG-TYPE',
        msg: `${pid}: north_star_ref "${ref}" resolves to a ${taskType(byPrefix.get(ref))} task, expected NS` });
    }
  }

  // ── RULE 2: EX → EP ──────────────────────────────────────────────────────
  for (const ex of byType.EX) {
    const pid = taskPid(ex);
    const ref = (extractFrontMatterField(ex.content || '', 'epic_ref') || '').toUpperCase();
    if (!ref) {
      violations.push({ task: pid, rule: 'EX-ORPHAN',
        msg: `${pid}: missing epic_ref — EX has no parent EP in trace graph` });
    } else if (!byPrefix.has(ref)) {
      violations.push({ task: pid, rule: 'EX-BROKEN-REF',
        msg: `${pid}: epic_ref "${ref}" not found on board` });
    } else if (taskType(byPrefix.get(ref)) !== 'EP') {
      violations.push({ task: pid, rule: 'EX-WRONG-TYPE',
        msg: `${pid}: epic_ref "${ref}" resolves to a ${taskType(byPrefix.get(ref))} task, expected EP` });
    }
  }

  // ── RULE 3: VA → EX ──────────────────────────────────────────────────────
  for (const va of byType.VA) {
    const pid = taskPid(va);
    const ref = (extractFrontMatterField(va.content || '', 'execution_ref') || '').toUpperCase();
    if (!ref) {
      violations.push({ task: pid, rule: 'VA-ORPHAN',
        msg: `${pid}: missing execution_ref — VA has no parent EX in trace graph` });
    } else if (!byPrefix.has(ref)) {
      violations.push({ task: pid, rule: 'VA-BROKEN-REF',
        msg: `${pid}: execution_ref "${ref}" not found on board` });
    } else if (taskType(byPrefix.get(ref)) !== 'EX') {
      violations.push({ task: pid, rule: 'VA-WRONG-TYPE',
        msg: `${pid}: execution_ref "${ref}" resolves to a ${taskType(byPrefix.get(ref))} task, expected EX` });
    }
  }

  // ── RULE 4: NS completeness — each active NS must have ≥1 EP child ───────
  for (const ns of byType.NS) {
    if (isDone(ns)) continue;
    const pid = taskPid(ns);
    const hasEpic = byType.EP.some(ep =>
      (extractFrontMatterField(ep.content || '', 'north_star_ref') || '').toUpperCase() === pid
    );
    if (!hasEpic) {
      violations.push({ task: pid, rule: 'NS-NO-EPICS',
        msg: `${pid}: no EP tasks reference this NS — trace graph shows isolated North Star` });
    }
  }

  // ── RULE 5: EP completeness — each active EP must have ≥1 EX child ───────
  for (const ep of byType.EP) {
    if (isDone(ep)) continue;
    const pid = taskPid(ep);
    const hasEx = byType.EX.some(ex =>
      (extractFrontMatterField(ex.content || '', 'epic_ref') || '').toUpperCase() === pid
    );
    if (!hasEx) {
      violations.push({ task: pid, rule: 'EP-NO-EXECUTION',
        msg: `${pid}: no EX tasks reference this EP — Epic has no execution children` });
    }
  }

  // ── RULE 6: EX completeness — each active EX must have ≥1 VA child ───────
  for (const ex of byType.EX) {
    if (isDone(ex)) continue;
    const pid = taskPid(ex);
    const hasVa = byType.VA.some(va =>
      (extractFrontMatterField(va.content || '', 'execution_ref') || '').toUpperCase() === pid
    );
    if (!hasVa) {
      violations.push({ task: pid, rule: 'EX-NO-VALIDATION',
        msg: `${pid}: no VA task references this EX — execution task has no validation child` });
    }
  }

  // ── RULE 6.5: EX 1-1 VA — each active EX must have exactly ONE VA ──────────
  // Multiple VA tasks for the same EX violates the 1-1 mapping and creates validation ambiguity.
  for (const ex of byType.EX) {
    if (isDone(ex)) continue;
    const pid = taskPid(ex);
    const vaChildren = byType.VA.filter(va =>
      (extractFrontMatterField(va.content || '', 'execution_ref') || '').toUpperCase() === pid
    );
    if (vaChildren.length > 1) {
      violations.push({ task: pid, rule: 'EX-MULTIPLE-VA',
        msg: `${pid}: has ${vaChildren.length} VA tasks (${vaChildren.map(v => taskPid(v)).join(', ')}) — 1-1 rule violated; exactly one VA per EX is required` });
    }
  }

  // ── RULE 6.7: EX validation_ref forward pointer must match the actual VA ───
  // If an EX has validation_ref: VA-NNN, that VA must have execution_ref: <this EX>.
  // A mismatch means the bidirectional link is broken.
  for (const ex of byType.EX) {
    const pid = taskPid(ex);
    const valRef = (extractFrontMatterField(ex.content || '', 'validation_ref') || '').toUpperCase();
    if (!valRef) continue;
    const vaTask = byPrefix.get(valRef);
    if (!vaTask) continue;
    const execRef = (extractFrontMatterField(vaTask.content || '', 'execution_ref') || '').toUpperCase();
    // Normalize: the VA might use either short form ("EX-004") or full spec_id form ("SPEC-PROF-EX-004").
    // Resolve execRef to a short-form pid using byPrefix before comparing.
    const resolvedTask = byPrefix.get(execRef);
    const resolvedPid  = resolvedTask ? taskPid(resolvedTask) : execRef;
    if (resolvedPid !== pid) {
      violations.push({ task: pid, rule: 'EX-VA-BIDIRECTIONAL-MISMATCH',
        msg: `${pid}: validation_ref points to ${valRef} but ${valRef}.execution_ref = "${execRef}" (expected "${pid}") — bidirectional 1-1 link broken` });
    }
  }

  // ── RULE 0.7: EP cannot be active while parent NS's RS task is not Done ────
  // Enforces the Research gate: no Epics work on an approach that hasn't been validated.
  for (const ep of byType.EP) {
    if (isDone(ep)) continue;
    const pid = taskPid(ep);
    const nsRef = (extractFrontMatterField(ep.content || '', 'north_star_ref') || '').toUpperCase();
    if (!nsRef) continue;
    const nsTask = byPrefix.get(nsRef);
    if (!nsTask) continue;
    const rsRef = (extractFrontMatterField(nsTask.content || '', 'research_ref') || '').toUpperCase();
    if (!rsRef) continue;
    const rsTask = byPrefix.get(rsRef);
    if (rsTask && !isDone(rsTask)) {
      violations.push({ task: pid, rule: 'EP-RS-NOT-DONE',
        msg: `${pid} is active but ${nsRef}.research_ref ${rsRef} is not Done (currently: ${getColumnName(rsTask)}) — Research must complete before Epics work begins` });
    }
  }

  // ── RULE 7: VA completeness — each Done VA should have ≥1 AR artifact trace ─
  // This is a WARNING-only rule (added to violations but reported separately).
  // AR tasks get created after VA passes — they must link back via validation_ref.
  const arWarnings = [];
  for (const va of byType.VA) {
    if (!isDone(va)) continue;
    const pid = taskPid(va);
    const hasArtifact = byType.AR.some(ar =>
      (extractFrontMatterField(ar.content || '', 'validation_ref') || '').toUpperCase() === pid
    );
    if (!hasArtifact) {
      arWarnings.push(`${pid}: no AR task references this validated VA — create an Artifact task with validation_ref: ${pid}`);
    }
  }
  if (arWarnings.length > 0) {
    warn(`Artifact trace gaps (${arWarnings.length} validated VA tasks without AR records):\n${arWarnings.map(w => `  ⚠ ${w}`).join('\n')}`);
  }

  // ── RULE 8: AR → VA ────────────────────────────────────────────────────────
  for (const ar of byType.AR) {
    const pid = taskPid(ar);
    const ref = (extractFrontMatterField(ar.content || '', 'validation_ref') || '').toUpperCase();
    if (!ref) {
      violations.push({ task: pid, rule: 'AR-ORPHAN',
        msg: `${pid}: missing validation_ref — Artifact has no parent VA in trace graph` });
    } else if (!byPrefix.has(ref)) {
      violations.push({ task: pid, rule: 'AR-BROKEN-REF',
        msg: `${pid}: validation_ref "${ref}" not found on board` });
    } else if (taskType(byPrefix.get(ref)) !== 'VA') {
      violations.push({ task: pid, rule: 'AR-WRONG-TYPE',
        msg: `${pid}: validation_ref "${ref}" resolves to a ${taskType(byPrefix.get(ref))} task, expected VA` });
    }
  }

  // ── RULE 9: NS completeness check — must have ≥1 RS backing ──────────────
  // (checked via RULE 0 above — if NS exists with no research_ref it's already a violation)
  // RS completeness: each active RS must have ≥1 NS child
  for (const rs of byType.RS) {
    if (isDone(rs)) continue;
    const pid = taskPid(rs);
    const hasNs = byType.NS.some(ns =>
      (extractFrontMatterField(ns.content || '', 'research_ref') || '').toUpperCase() === pid
    );
    if (!hasNs) {
      violations.push({ task: pid, rule: 'RS-NO-NORTH-STARS',
        msg: `${pid}: no NS tasks reference this RS — Research task has no North Star children` });
    }
  }

  // ── USER-EXTENSIBLE: add additional trace rules here ─────────────────────
  // Each rule pushes to violations[] with { task, rule, msg }
  // Gate exits 1 if violations.length > 0

  if (violations.length === 0) {
    ok(`GATE trace-graph: chain intact — ${byType.RS.length} RS → ${byType.NS.length} NS → ${byType.EP.length} EP → ${byType.EX.length} EX → ${byType.VA.length} VA → ${byType.AR.length} AR ✓`);
    return { ok: true, violations: [] };
  }

  // Group by rule for readability
  const byRule = {};
  for (const v of violations) {
    (byRule[v.rule] = byRule[v.rule] || []).push(v.msg);
  }
  const report = Object.entries(byRule)
    .map(([rule, msgs]) => `  [${rule}]\n${msgs.map(m => `    ✗ ${m}`).join('\n')}`)
    .join('\n');

  gate(
    `Trace graph broken — ${violations.length} violation(s):\n\n${report}\n\n` +
    `Fix: update front-matter refs (epic_ref / north_star_ref / execution_ref) in the affected tasks\n` +
    `     so every task links to its correct parent in the NS → EP → EX → VA chain.`
  );
}

async function cmdGate(name, arg) {
  if (!name) die('Usage: gate <name> [arg]');
  const { iState } = requireInitiativeState();
  const client = makeClient();

  switch (name) {
    case 'deps-done': {
      if (!arg) die('Usage: gate deps-done <taskId>');
      const task = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`);
      const dependsOn = extractDependsOn(task.content);
      if (dependsOn.length === 0) {
        ok(`GATE deps-done: no dependencies declared`);
        return;
      }
      const allTasks = await client.get(
        `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=200`
      );
      const taskList = allTasks.tasks || allTasks || [];
      const taskMap = Object.fromEntries(taskList.map(t => [
        extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0], t
      ]));
      const notDone = dependsOn.filter(dep => {
        const dt = taskMap[dep];
        return !dt || !isDone(dt);
      });
      if (notDone.length > 0) gate(`Dependencies not Done: ${notDone.join(', ')}`);
      ok(`GATE deps-done: all ${dependsOn.length} dependencies Done`);
      break;
    }
    case 'research-done': {
      if (!arg) die('Usage: gate research-done <rsTaskId>');
      const task = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`);
      if (!isDone(task)) gate(`Research task ${arg} is not Done (currently: ${getColumnName(task)})`);
      ok(`GATE research-done: ${arg} is Done`);
      break;
    }
    case 'no-mocks': {
      if (!arg) die('Usage: gate no-mocks <filePath>');
      const fPath = path.isAbsolute(arg) ? arg : path.join(findGitRoot(), arg);
      if (!fs.existsSync(fPath)) die(`File not found: ${fPath}`);
      const content = fs.readFileSync(fPath, 'utf-8');
      const mocks = hasMockPatterns(content);
      if (mocks.length > 0) gate(`Mock/stub patterns in ${arg}: ${mocks.join(', ')}`);
      ok(`GATE no-mocks: ${arg} is clean`);
      break;
    }
    case 'checklist': {
      if (!arg) die('Usage: gate checklist <taskId>');
      const task = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`);
      const unchecked = countUncheckedItems(task.content);
      if (unchecked > 0) gate(`${unchecked} unchecked items remain in task ${arg}`);
      ok(`GATE checklist: all items checked`);
      break;
    }
    case 'impl-files': {
      if (!arg) die('Usage: gate impl-files <taskId>');
      const task = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`);
      const files = extractImplFiles(task.content);
      if (files.length === 0) gate(`Task ${arg} has no Implementation Files section`);
      ok(`GATE impl-files: ${files.length} file(s) listed`);
      break;
    }
    case 'hierarchy': {
      // Verify that front-matter parent refs are set for the correct task type.
      // VA needs execution_ref + epic_ref + north_star_ref.
      // EX needs epic_ref + north_star_ref.
      // Epic needs north_star_ref.
      if (!arg) die('Usage: gate hierarchy <taskId>');
      const task = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`));
      const content = task.content || '';
      const titleStr = task.title || '';
      const specId = extractSpecId(content) || titleStr.match(/^[A-Z]+-\d+/)?.[0] || arg;

      const isVA  = /^VA-/i.test(specId) || /^V-T-/i.test(titleStr);
      const isEX  = /^EX-/i.test(specId) || /^T-\d/i.test(titleStr);
      const isEP  = /^EP-/i.test(specId) || /^E-\d/i.test(titleStr);

      const warnings = [];
      if (isVA) {
        if (!extractFrontMatterField(content, 'execution_ref'))  warnings.push('VA task missing execution_ref (must point to parent EX task)');
        if (!extractFrontMatterField(content, 'epic_ref'))       warnings.push('VA task missing epic_ref');
        if (!extractFrontMatterField(content, 'north_star_ref')) warnings.push('VA task missing north_star_ref');
      } else if (isEX) {
        if (!extractFrontMatterField(content, 'epic_ref'))        warnings.push('EX task missing epic_ref');
        if (!extractFrontMatterField(content, 'north_star_ref'))  warnings.push('EX task missing north_star_ref');
        if (!extractFrontMatterField(content, 'validation_ref'))  warnings.push('EX task missing validation_ref (must point to child VA ticket)');
      } else if (isEP) {
        if (!extractFrontMatterField(content, 'north_star_ref')) warnings.push('Epic missing north_star_ref');
      }

      if (warnings.length > 0) {
        gate(`Hierarchy check failed for ${specId}:\n${warnings.map(w => `  ✗ ${w}`).join('\n')}`);
      }
      ok(`GATE hierarchy: ${specId} has correct parent refs`);
      break;
    }
    case 'trace-graph': {
      // Board-wide ref integrity gate — runs against all tasks, no taskId arg needed
      await cmdGateTraceGraph(iState.dsId, iState.planModeId);
      break;
    }
    case 'checklist-format': {
      // Rule 2 from SKILL.md Trace Graph Linking: all checklists must use <ul data-type="taskList">
      // A bare <ul> wrapping <li data-type="taskItem"> breaks findChecklistRefs() edge detection.
      if (!arg) die('Usage: gate checklist-format <taskId>');
      const task = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`));
      const content = task.content || '';
      const bareUl = /<ul(?![^>]*data-type="taskList")[^>]*>[\s\S]{0,50}<li[^>]*data-type="taskItem"/;
      if (bareUl.test(content)) {
        gate(`Checklist format violation in task ${arg}: <ul> without data-type="taskList" wraps taskItem elements.\nFix: replace all <ul> containing taskItem children with <ul data-type="taskList">.`);
      }
      ok(`GATE checklist-format: all task list items correctly wrapped`);
      break;
    }
    case 'title-prefix': {
      // Rule 1 from SKILL.md Trace Graph Linking: titles must start with the SDD prefix for their column.
      // extractSddId() only recognises RS-/NS-/E-/T-/V-T- — any other prefix = no graph edges.
      if (!arg) die('Usage: gate title-prefix <taskId>');
      const task = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`));
      const title  = task.title || '';
      // Column comes from the API statusGroup, not frontmatter — normalize spaces to hyphens
      const column = getColumnName(task).toLowerCase().replace(/\s+/g, '-');
      const prefixRules = {
        'research':    { re: /^RS-\d/, label: 'RS-NNN ·' },
        'north-stars': { re: /^NS-\d/, label: 'NS-NNN ·' },
        'epics':       { re: /^E-\d/,  label: 'E-NNN ·'  },
        'execution':   { re: /^T-\d/,  label: 'T-NNN ·'  },
        'validation':  { re: /^V-T-\d/,label: 'V-T-NNN ·'},
      };
      const rule = prefixRules[column];
      if (rule && !rule.re.test(title)) {
        gate(`Title prefix mismatch for task ${arg}:\n  column="${column}" requires "${rule.label}" format\n  got: "${title}"\nRename the task to start with the correct SDD prefix.`);
      }
      if (!rule && column && column !== 'unknown' && column !== 'done') warn(`Unknown column "${column}" — cannot validate prefix`);
      ok(`GATE title-prefix: "${title.slice(0, 50)}" matches column "${column}"`);
      break;
    }
    case 'tracker-link': {
      // Step 13 (SKILL.md): trackerUrl must be set on the plan mode + dashboard must have planner link.
      if (!arg) die('Usage: gate tracker-link <dsUri>');
      const { iState: ist } = requireInitiativeState();
      const env = loadEnv();
      const bUrl = env.DATASPHERES_BASE_URL || 'https://dataspheres.ai';
      const aKey = env.DATASPHERES_API_KEY;
      const fails = [];
      // Check 1: trackerUrl on plan mode
      try {
        const pmRes = await fetch(`${bUrl}/api/v2/dataspheres/${ist.dsId}/tasks/plan-modes/${ist.planModeId}`,
          { headers: { Authorization: `Bearer ${aKey}` } });
        if (pmRes.ok) {
          const pmData = await pmRes.json();
          const tUrl = pmData.planMode?.trackerUrl || pmData.trackerUrl || '';
          if (!tUrl) fails.push(`trackerUrl not set on plan mode (Step 13A) — PATCH plan-mode ${ist.planModeId} with {trackerUrl:"<PUBLIC_URL>/pages/${arg}/<dashboard-slug>"}`);
          else info(`  ✓ trackerUrl: ${tUrl}`);
        }
      } catch { fails.push('Could not fetch plan mode — check dsId + planModeId in .sdd-state.json'); }
      // Check 2: dashboard page has planner deep link
      const slug = ist.dashboardSlug;
      if (slug) {
        try {
          const pgRes = await fetch(`${bUrl}/api/v1/dataspheres/${arg}/pages/${slug}`,
            { headers: { Authorization: `Bearer ${aKey}` } });
          if (pgRes.ok) {
            const pgData = await pgRes.json();
            const pgContent = pgData.page?.content || pgData.content || '';
            if (!/href="[^"]*\/app\/[^"]*\/planner/.test(pgContent))
              fails.push(`Dashboard "${slug}" missing planner deep link (Step 13B) — add <a href="<PUBLIC_URL>/app/${arg}/planner?mode=${ist.planModeId}">Open in Planner</a>`);
            else info(`  ✓ dashboard has planner link`);
          }
        } catch { /* non-fatal */ }
      } else {
        fails.push('dashboardSlug not in .sdd-state.json — run dashboard-check first');
      }
      if (fails.length > 0) gate(`Tracker link check failed:\n${fails.map(f => `  ✗ ${f}`).join('\n')}`);
      ok(`GATE tracker-link: trackerUrl set + dashboard planner link present`);
      break;
    }
    case 'content-structure': {
      // Gate: each task type must have the required structural sections.
      // RS → 9 research anchors; NS/EP/EX → AC + FR + NFR; VA → AC + Artifacts; AR → validation_ref
      if (!arg) die('Usage: gate content-structure <taskId>');
      const task = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`));
      const content = task.content || '';
      const title = task.title || '';
      const sid = extractSpecId(content) || title.match(/^[A-Z]+-\d+/)?.[0] || arg;
      const col = getColumnName(task).toLowerCase();

      // Classify task type
      const isRS = /^RS-/i.test(title) || col.includes('research');
      const isNS = /^NS-/i.test(title) || col.includes('north');
      const isEP = /^EP-/i.test(title) || /^E-\d/i.test(title) || col.includes('epic');
      const isEX = /^EX-/i.test(title) || /^T-\d/i.test(title) || col.includes('execut');
      const isVA = /^VA-/i.test(title) || /^V-T-/i.test(title) || col.includes('validat');
      const isAR = /^AR-/i.test(title) || col.includes('artifact');

      const missing = [];

      if (isRS) {
        const anchors = [
          { key: '#origin',         label: '<!-- #origin --> (Origin Prompts with verbatim user quotes)' },
          { key: '#problem',        label: '<!-- #problem --> (Problem Statement)' },
          { key: '#approach',       label: '<!-- #approach --> (Approach Under Evaluation)' },
          { key: '#search-results', label: '<!-- #search-results --> (Verbatim search result excerpts)' },
          { key: '#codebase',       label: '<!-- #codebase --> (Existing code snippets/paths)' },
          { key: '#sources',        label: '<!-- #sources --> (≥2 URLs or DOIs)' },
          { key: '#feasibility',    label: '<!-- #feasibility --> (Feasibility Evidence)' },
          { key: '#rec',            label: '<!-- #rec --> (Recommendation)' },
          { key: '#vc',             label: '<!-- #vc --> (Validation Criteria)' },
        ];
        for (const a of anchors) {
          if (!content.includes(a.key)) missing.push(a.label);
        }
        // Check origin prompts: must have a blockquote
        if (content.includes('#origin') && !/<blockquote/i.test(content))
          missing.push('Origin Prompts section must contain a <blockquote> with verbatim user text');
        // Check sources: must have ≥2 links
        const linkCount = (content.match(/href="http/gi) || []).length;
        if (linkCount < 2) missing.push(`Sources section must have ≥2 external URLs (found ${linkCount})`);
      } else if (isNS || isEP || isEX) {
        if (!/<h[2-4][^>]*>.*?Acceptance Criteria/i.test(content))
          missing.push('Acceptance Criteria section (h2/h3/h4)');
        if (!/<h[2-4][^>]*>.*?Functional Requirements/i.test(content))
          missing.push('Functional Requirements section (h2/h3/h4)');
        if (!/<h[2-4][^>]*>.*?Non.Functional Requirements/i.test(content))
          missing.push('Non-Functional Requirements section (h2/h3/h4)');
        if (isEP || isEX) {
          if (!/<h[2-4][^>]*>.*?Implementation/i.test(content))
            missing.push('Implementation Files/Scope section (h2/h3/h4)');
        }
        if (isEX) {
          if (!/<h[2-4][^>]*>.*?Validation Criteria/i.test(content))
            missing.push('Validation Criteria section (h2/h3/h4) — links to the VA ticket');
        }
        if (isNS) {
          if (!extractFrontMatterField(content, 'research_ref'))
            missing.push('research_ref front-matter field (links this NS to its parent RS task)');
        }
        if (isEP) {
          if (!extractFrontMatterField(content, 'north_star_ref'))
            missing.push('north_star_ref front-matter field');
        }
        if (isEX) {
          if (!extractFrontMatterField(content, 'epic_ref'))       missing.push('epic_ref front-matter field');
          if (!extractFrontMatterField(content, 'north_star_ref')) missing.push('north_star_ref front-matter field');
          if (!extractFrontMatterField(content, 'validation_ref')) missing.push('validation_ref front-matter field (links to child VA ticket)');
        }
      } else if (isVA) {
        if (!/<h[2-4][^>]*>.*?Acceptance Criteria/i.test(content))
          missing.push('Acceptance Criteria section');
        if (!/<h[2-4][^>]*>.*?(Validation Criteria|Test Plan)/i.test(content))
          missing.push('Validation Criteria / Test Plan section');
        if (!extractFrontMatterField(content, 'execution_ref'))  missing.push('execution_ref front-matter field');
        if (!extractFrontMatterField(content, 'epic_ref'))       missing.push('epic_ref front-matter field');
        if (!extractFrontMatterField(content, 'north_star_ref')) missing.push('north_star_ref front-matter field');
      } else if (isAR) {
        if (!extractFrontMatterField(content, 'validation_ref'))
          missing.push('validation_ref front-matter field (links to parent VA task)');
        if (!/<h[2-4][^>]*>.*?(Artifact|Output)/i.test(content))
          missing.push('Artifact Description section (what was produced, type, path/URL)');
      } else {
        warn(`Unknown task type for ${sid} — cannot validate content structure`);
        ok(`GATE content-structure: skipped (unknown task type "${col}")`);
        break;
      }

      if (missing.length > 0) {
        gate(
          `Content structure missing for ${sid} (${col}):\n${missing.map(m => `  ✗ ${m}`).join('\n')}\n\n` +
          `Add all required sections before starting this task. See /all-dai-sdd SKILL.md for templates.`
        );
      }
      ok(`GATE content-structure: ${sid} has all required sections for ${col} task type ✓`);
      break;
    }
    case 'tiptap-html': {
      // Gate: page content file must use Tiptap HTML — no raw markdown.
      // Any page published to Dataspheres must pass this before create_page / update_page.
      // Covers all skills (pages, newsletters, SDD dashboards) — not just all-dai-sdd.
      if (!arg) die('Usage: gate tiptap-html <filePath>');
      const fPath = path.isAbsolute(arg) ? arg : path.join(findGitRoot(), arg);
      if (!fs.existsSync(fPath)) die(`File not found: ${fPath}`);
      const html = fs.readFileSync(fPath, 'utf-8');

      const violations = [];

      // 1. No markdown headings
      if (/^#{1,6}\s/m.test(html))
        violations.push('Markdown headings (##) found — use <h1>/<h2>/<h3> instead');

      // 2. No markdown bold/italic
      if (/\*\*[^*\n]+\*\*/.test(html))
        violations.push('Markdown bold (**text**) found — use <strong>text</strong>');
      if (/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/.test(html))
        violations.push('Markdown italic (*text*) found — use <em>text</em>');

      // 3. No fenced code blocks
      if (/^```/m.test(html))
        violations.push('Markdown fenced code blocks (```) found — use <pre><code>...</code></pre> or <div data-type="mermaid"> for diagrams');

      // 4. No markdown image syntax
      if (/!\[[^\]]*\]\([^)]+\)/.test(html))
        violations.push('Markdown image syntax (![alt](url)) found — use <figure data-image-figure ...><img src="..." alt="..."><figcaption>...</figcaption></figure>');

      // 5. Mermaid must use data-type block, not code fence
      if (/```mermaid/.test(html))
        violations.push('Mermaid code fence (```mermaid) found — use <div data-type="mermaid" data-source="..."></div>');

      // 6. <ul> must carry tiptap-bullet-list class (allow data-type="taskList" from SDD tasks)
      const bareUls = (html.match(/<ul(?![^>]*(?:class="tiptap-bullet-list"|data-type="taskList"))[^>]*>/g) || []);
      if (bareUls.length > 0)
        violations.push(`${bareUls.length} plain <ul> without class="tiptap-bullet-list" — add the class (see skills/pages/SKILL.md)`);

      // 7. <ol> must carry tiptap-ordered-list class
      const bareOls = (html.match(/<ol(?![^>]*class="tiptap-ordered-list")[^>]*>/g) || []);
      if (bareOls.length > 0)
        violations.push(`${bareOls.length} plain <ol> without class="tiptap-ordered-list" — add the class`);

      // 8. <li> items must wrap content in <p>
      if (/<li>(?!\s*<(?:p|ul|ol))/.test(html))
        violations.push('<li> without <p> wrapper — list items must be <li><p>...</p></li>');

      // 9. Tables must use tiptap-table classes
      if (/<table(?![^>]*class="tiptap-table")[^>]*>/.test(html))
        violations.push('Table without class="tiptap-table" — use tiptap-table, tiptap-table-row, tiptap-table-cell, tiptap-table-header classes');

      // 10. Links must use tiptap-link class
      if (/<a\s(?![^>]*class="tiptap-link")[^>]*href=/.test(html))
        violations.push('<a href> without class="tiptap-link" — add class="tiptap-link" target="_blank" rel="noopener"');

      // 11. Page must have at least one <h1> title
      if (!/<h1[^>]*>/.test(html))
        violations.push('No <h1> found — page must have exactly one <h1> as the title');

      if (violations.length > 0) {
        gate(
          `Tiptap HTML gate FAILED for ${path.basename(arg)}:\n` +
          violations.map(v => `  ✗ ${v}`).join('\n') +
          `\n\nAll pages published to Dataspheres must use Tiptap HTML.\nSee skills/pages/SKILL.md for the full node catalogue.`
        );
      }
      ok(`GATE tiptap-html: ${path.basename(arg)} passes all Tiptap format checks (${html.length} chars)`);
      break;
    }
    case 'evidence-quality': {
      // Gate: the last [all-dai-sdd-system-message] comment on a task must contain
      // real substantiation — not the mechanical loop's boilerplate.
      // This enforces that Claude actually ran something before advancing.
      if (!arg) die('Usage: gate evidence-quality <taskId>');
      const task = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`));
      const sid = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || arg;

      // Fetch comments
      let comments = [];
      try {
        const cr = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}/comments?limit=20`);
        comments = cr.comments || cr || [];
      } catch { /* non-fatal */ }

      const sysComments = comments
        .filter(c => (c.content || '').includes('[all-dai-sdd-system-message]'))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      if (sysComments.length === 0) {
        gate(
          `${sid}: no [all-dai-sdd-system-message] gate comment found.\n` +
          `Claude must post substantiation before advancing a task.\n` +
          `Use: node loop.mjs --advance ${arg} --evidence "..."`
        );
      }

      const last = sysComments[0].content || '';

      // Reject known boilerplate from the mechanical loop
      const BOILERPLATE = [
        /spec validation = PASS \(gate: all AC\/FR\/NFR items have observable, testable thresholds\)/,
        /No rubber-stamping — each criterion is measurable/,
        /first iteration passed/,
        /All checklist items ticked\. Implementation files documented\. Spec ready for validation pass/,
        /Vision, success criteria, and architecture constraints documented\. All Epics defined/,
        /Research complete → gate cleared for NS advancement/,
      ];
      for (const pattern of BOILERPLATE) {
        if (pattern.test(last)) {
          gate(
            `${sid}: gate comment is mechanical boilerplate — task was not substantiated by an AI.\n\n` +
            `The comment matches a known rubber-stamp pattern:\n  "${last.slice(0, 120)}..."\n\n` +
            `Required: re-run with real evidence (command output, file paths, measured results).\n` +
            `Use: node loop.mjs --advance ${arg} --evidence "[EXECUTED] ... [OUTPUT] ... [VERDICT] ..."`
          );
        }
      }

      // Require minimum substance
      const MIN_LEN = 200;
      const evidenceBody = last.replace('[all-dai-sdd-system-message]', '').trim();
      if (evidenceBody.length < MIN_LEN) {
        gate(
          `${sid}: gate comment too short (${evidenceBody.length} chars, min ${MIN_LEN}).\n` +
          `Post real evidence — command output, file confirmation, or measured test results.`
        );
      }

      ok(`GATE evidence-quality: ${sid} has substantive gate comment (${evidenceBody.length} chars, non-boilerplate) ✓`);
      break;
    }
    default:
      die(`Unknown gate: ${name}. Valid: deps-done, research-done, no-mocks, checklist, impl-files, hierarchy, trace-graph, content-structure, checklist-format, title-prefix, tracker-link, tiptap-html, evidence-quality`);
  }
}

async function cmdCheckFileHook() {
  let raw = '';
  try {
    if (process.stdin.isTTY) return;
    for await (const chunk of process.stdin) raw += chunk;
    if (!raw.trim()) return;
  } catch {
    return;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  const toolName = input.tool_name || '';
  const filePath = input.tool_input?.file_path || input.tool_input?.path || '';

  if (!filePath) return;
  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) return;

  const skip = /\.(json|yaml|yml|md|lock|env|toml|txt|log|tsbuildinfo)$|node_modules|\.claude|\.git/;
  if (skip.test(filePath)) return;

  const state = loadState();
  // For hooks: find the initiative with an active task (could be any, not just current)
  const activeEntry = Object.entries(state?.initiatives || {}).find(([, s]) => s.activeTask);
  const iState = activeEntry?.[1] || state?.initiatives?.[state?.currentInitiative];

  if (!iState?.activeTask) {
    warn(
      `No active SDD task. Before writing code, run:\n` +
      `  node sdd-conductor.mjs start <taskId>\n\n` +
      `  This ensures the tracker stays in sync and your work is traced.`
    );
    return;
  }

  const { specId, implFiles, title } = iState.activeTask;
  if (!implFiles || implFiles.length === 0) return;

  const gitRoot = findGitRoot();
  const relPath = path.relative(gitRoot, path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath));
  const normalized = relPath.replace(/\\/g, '/');

  const isListed = implFiles.some(f => {
    const nf = f.replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized === nf || normalized.endsWith(nf) || nf.endsWith(normalized);
  });

  if (!isListed) {
    warn(
      `File not listed in active task's Implementation Files.\n\n` +
      `  Active task: ${specId} — ${title}\n` +
      `  File being written: ${normalized}\n` +
      `  Declared impl files: ${implFiles.join(', ')}\n\n` +
      `  Either:\n` +
      `    1. Add "${normalized}" to the task's Implementation Files section and PATCH the task, OR\n` +
      `    2. Verify you're working on the right task (run: node sdd-conductor.mjs status)`
    );
  }
}

async function cmdProgressHook() {
  let raw = '';
  try {
    if (process.stdin.isTTY) return;
    for await (const chunk of process.stdin) raw += chunk;
    if (!raw.trim()) return;
  } catch { return; }

  let input;
  try { input = JSON.parse(raw); } catch { return; }

  if (input.tool_name !== 'Bash') return;

  const cmd = input.tool_input?.command || '';
  const output = input.tool_response?.output || input.tool_response?.stdout || '';
  if (!output) return;

  const isTestRun = /vitest|playwright|pytest|jest\s|npm run test|tsc\s+--noEmit/.test(cmd);
  if (!isTestRun) return;

  const state = loadState();
  // Find initiative with active task (hooks don't know which initiative is "current")
  const activeEntry = Object.entries(state?.initiatives || {}).find(([, s]) => s.activeTask);
  if (!activeEntry) return;
  const [, iState] = activeEntry;

  const result = extractTestResult(cmd, output);
  if (!result) return;

  try {
    const client = makeClient();
    const lines = [
      `[all-dai-sdd-system-message]`,
      ``,
      `**Test Run — ${result.runner}** | ${new Date().toISOString()}`,
      ``,
      result.summary,
    ];
    if (result.passed !== null) lines.push(`- Passed: ${result.passed}`);
    if (result.failed !== null && result.failed > 0) lines.push(`- Failed: ${result.failed}`);
    if (result.errors) lines.push(`\n**Errors:**\n\`\`\`\n${result.errors.slice(0, 500)}\n\`\`\``);

    await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${iState.activeTask.taskId}/comments`, {
      content: lines.join('\n'),
    });
  } catch {
    // never block on hook failure
  }
}

function extractTestResult(cmd, output) {
  if (/vitest/.test(cmd) || /vitest/.test(output)) {
    const passedMatch = output.match(/(\d+)\s+(?:tests?\s+)?passed/i);
    const failedMatch = output.match(/(\d+)\s+(?:tests?\s+)?failed/i);
    const passed = passedMatch ? parseInt(passedMatch[1]) : null;
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
    if (passed === null && failed === 0) return null;
    return {
      runner: 'vitest',
      summary: failed === 0 ? `✅ All ${passed} tests passed` : `❌ ${failed} failed / ${passed || 0} passed`,
      passed, failed,
      errors: failed > 0 ? extractFirstError(output) : null,
    };
  }
  if (/playwright/.test(cmd)) {
    const passedMatch = output.match(/(\d+)\s+passed/);
    const failedMatch = output.match(/(\d+)\s+failed/);
    const passed = passedMatch ? parseInt(passedMatch[1]) : null;
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0;
    if (passed === null && failed === 0) return null;
    return {
      runner: 'playwright',
      summary: failed === 0 ? `✅ All ${passed} tests passed` : `❌ ${failed} failed / ${passed || 0} passed`,
      passed, failed,
      errors: failed > 0 ? extractFirstError(output) : null,
    };
  }
  if (/pytest/.test(cmd)) {
    const m = output.match(/(\d+)\s+passed(?:,\s+(\d+)\s+(?:failed|error))?/);
    if (!m) return null;
    const passed = parseInt(m[1]);
    const failed = m[2] ? parseInt(m[2]) : 0;
    return {
      runner: 'pytest',
      summary: failed === 0 ? `✅ ${passed} passed` : `❌ ${failed} failed / ${passed} passed`,
      passed, failed,
      errors: failed > 0 ? extractFirstError(output) : null,
    };
  }
  if (/tsc/.test(cmd)) {
    const errorMatch = output.match(/Found (\d+) error/);
    const count = errorMatch ? parseInt(errorMatch[1]) : (/error TS/.test(output) ? 1 : 0);
    return {
      runner: 'tsc',
      summary: count === 0 ? `✅ TypeScript: no errors` : `❌ TypeScript: ${count} error(s)`,
      passed: count === 0 ? 1 : 0, failed: count,
      errors: count > 0 ? extractFirstError(output) : null,
    };
  }
  return null;
}

function extractFirstError(output) {
  const lines = output.split('\n').filter(l => /error|FAIL|✕|×/i.test(l));
  return lines.slice(0, 5).join('\n').slice(0, 300) || null;
}

async function cmdProgress(message) {
  if (!message) die('Usage: progress <message>');
  const { iState } = requireInitiativeState();
  if (!iState.activeTask) die('No active task. Run: node sdd-conductor.mjs start <taskId>');
  const client = makeClient();

  await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${iState.activeTask.taskId}/comments`, {
    content: `[all-dai-sdd-system-message]\n\n**Progress:** ${message}\n\n_${new Date().toISOString()}_`,
  });

  ok(`Progress posted to task ${iState.activeTask.specId}`);
}

// ---------------------------------------------------------------------------
// takeAndUploadScreenshot — Playwright screenshot helper for validation comments.
// Runs sdd-screenshot.cjs, uploads the PNG to /api/media/upload, returns URL.
// All errors are non-fatal — returns null so validation still proceeds.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// autoCollectEvidence — run shell commands and read files to collect real
// artifact evidence for evidence-requiring VA checklist items.
//
// Returns { collected, humanRequired, arContent, arSpecId, isComplete }
//   collected      — array of { item, type, content, filename, url }
//   humanRequired  — array of { item, reason } for items needing live capture
//   arContent      — full Tiptap HTML for the AR task
//   arSpecId       — spec_id of the AR task (existing or new)
//   isComplete     — true when all items were auto-collected
// ---------------------------------------------------------------------------
async function autoCollectEvidence(vaTask, evidenceItems, allTasks, client, iState, specId) {
  const collected = [];
  const humanRequired = [];

  for (const item of evidenceItems) {
    const text = item.text;

    // VRAM / GPU memory → nvidia-smi
    if (/nvidia.?smi|vram|gpu.?memory|memory\.used/i.test(text)) {
      try {
        const output = execSync(
          'nvidia-smi --query-gpu=name,memory.used,memory.free,memory.total,temperature.gpu,utilization.gpu --format=csv',
          { encoding: 'utf8', stdio: 'pipe', timeout: 10000 }
        ).trim();
        info(`nvidia-smi collected (${output.split('\n').length} lines)`);
        collected.push({ item, type: 'nvidia-smi', content: output, filename: `nvidia-smi-${specId}.txt` });
        continue;
      } catch (e) {
        humanRequired.push({ item, reason: `nvidia-smi failed: ${e.message.split('\n')[0]}` });
        continue;
      }
    }

    // FPS / frame rate → look for log files
    if (/fps|frame.?rate|throughput/i.test(text) && !/screenshot|recording/i.test(text)) {
      const fpsLogDirs = [
        'C:\\FasterLivePortrait\\results',
        'C:\\FasterLivePortrait\\logs',
        path.join(os.homedir(), 'AppData', 'Local', 'FasterLivePortrait'),
        path.join(findGitRoot(), 'results'),
        path.join(findGitRoot(), 'logs'),
      ];
      let fpsData = null;
      for (const dir of fpsLogDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
          const files = fs.readdirSync(dir)
            .filter(f => /\.(txt|log|csv)$/i.test(f))
            .sort().reverse();
          for (const fname of files.slice(0, 3)) {
            const content = fs.readFileSync(path.join(dir, fname), 'utf8');
            if (/fps|frame/i.test(content)) {
              fpsData = { file: fname, content: content.slice(0, 3000) };
              break;
            }
          }
        } catch {}
        if (fpsData) break;
      }
      if (fpsData) {
        info(`FPS log collected: ${fpsData.file}`);
        collected.push({ item, type: 'fps-log', content: fpsData.content, filename: fpsData.file });
      } else {
        humanRequired.push({ item, reason: 'No FPS log found in expected paths — requires live session' });
      }
      continue;
    }

    // Config / YAML file items
    if (/config|yaml|\.cfg|\.ini|predict_type|trt_infer/i.test(text)) {
      const configPaths = [
        'C:\\FasterLivePortrait\\configs\\trt_infer.yaml',
        'C:\\FasterLivePortrait\\configs\\onnx_infer.yaml',
        path.join(findGitRoot(), 'configs', 'trt_infer.yaml'),
      ];
      let configData = null;
      for (const cp of configPaths) {
        if (fs.existsSync(cp)) {
          configData = { file: cp, content: fs.readFileSync(cp, 'utf8') };
          break;
        }
      }
      if (configData) {
        info(`Config file collected: ${path.basename(configData.file)}`);
        collected.push({ item, type: 'config-file', content: configData.content, filename: path.basename(configData.file) });
      } else {
        humanRequired.push({ item, reason: 'Config file not found at expected paths' });
      }
      continue;
    }

    // Anything requiring live GUI / recording → human-required
    if (/screenshot|screen recording|recording|obs|visual confirmation|gui|spout|camera|microphone|voice/i.test(text)) {
      humanRequired.push({ item, reason: 'Live session capture required — cannot auto-collect GUI screenshots/recordings' });
      continue;
    }

    // Default: cannot auto-collect
    humanRequired.push({ item, reason: 'Evidence type not auto-collectible — manual verification required' });
  }

  // Upload collected evidence as text files
  const env = loadEnv();
  const baseUrl = env.DATASPHERES_BASE_URL || 'https://dataspheres.ai';
  const apiKey  = env.DATASPHERES_API_KEY;

  for (const entry of collected) {
    try {
      const blob = new Blob([Buffer.from(entry.content, 'utf8')], { type: 'text/plain' });
      const formData = new FormData();
      formData.append('file', blob, entry.filename || `sdd-evidence-${specId}-${entry.type}.txt`);
      const uploadRes = await fetch(`${baseUrl}/api/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });
      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        entry.url = uploadData.url;
        info(`Uploaded evidence: ${uploadData.url}`);
      } else {
        const errText = await uploadRes.text().catch(() => '');
        warn(`Upload ${uploadRes.status} for ${entry.type} — AR has inline code block only. ${errText.slice(0, 120)}`);
      }
    } catch (e) {
      warn(`Upload failed for ${entry.type}: ${e.message.split('\n')[0]} — AR has inline code block only`);
    }
  }

  // Determine AR task spec_id
  const arCounter = allTasks.filter(t => /^AR-\d+/i.test(t.title || '')).length + 1;
  const existingArForSpec = allTasks.find(t => {
    const ref = (extractFrontMatterField(t.content || '', 'validation_ref') || '').toUpperCase();
    return ref === specId.toUpperCase() && /^AR-/i.test(t.title || '');
  });
  const arSpecId = existingArForSpec
    ? (extractSpecId(existingArForSpec.content) || existingArForSpec.title?.match(/^AR-\d+/)?.[0] || `AR-${String(arCounter).padStart(3, '0')}`)
    : `AR-${String(arCounter).padStart(3, '0')}`;

  const arExRef   = extractFrontMatterField(vaTask.content, 'execution_ref')  || '';
  const arEpicRef = extractFrontMatterField(vaTask.content, 'epic_ref')       || '';
  const arNsRef   = extractFrontMatterField(vaTask.content, 'north_star_ref') || '';
  const isComplete = humanRequired.length === 0 && (collected.length > 0 || evidenceItems.length === 0);

  const contentParts = [
    `<pre><code class="language-yaml">`,
    `spec_id: ${arSpecId}`,
    `validation_ref: ${specId}`,
    ...(arExRef   ? [`execution_ref: ${arExRef}`]   : []),
    ...(arEpicRef ? [`epic_ref: ${arEpicRef}`]       : []),
    ...(arNsRef   ? [`north_star_ref: ${arNsRef}`]   : []),
    `artifact_type: evidence`,
    `status: ${isComplete ? 'COMPLETE' : 'PARTIAL'}`,
    `collected_at: ${new Date().toISOString()}`,
    `</code></pre>`,
    ``,
    `<h2>Evidence Artifacts <!-- #artifact --></h2>`,
    `<p>Auto-collected by sdd-conductor. ${collected.length} of ${evidenceItems.length} items auto-collected.</p>`,
  ];

  for (const { item, type, content, url } of collected) {
    contentParts.push(``, `<h3>[${item.section}] ${escapeHtml(item.text.substring(0, 100))}</h3>`);
    if (url) contentParts.push(`<p>File: <a href="${url}">${escapeHtml(url)}</a></p>`);
    contentParts.push(`<pre><code class="language-text">${escapeHtml(content.slice(0, 3000))}</code></pre>`);
  }

  if (humanRequired.length > 0) {
    contentParts.push(
      ``,
      `<h3>Requires Live Session (${humanRequired.length} items)</h3>`,
      `<ul class="tiptap-bullet-list">`,
      ...humanRequired.map(({ item, reason }) =>
        `<li><p>[${item.section}] ${escapeHtml(item.text.substring(0, 100))} &mdash; <em>${escapeHtml(reason)}</em></p></li>`
      ),
      `</ul>`,
    );
  }

  return { collected, humanRequired, arContent: contentParts.join('\n'), arSpecId, isComplete };
}

async function takeAndUploadScreenshot(pageUrl, specId, env) {
  const baseUrl = env.DATASPHERES_BASE_URL || 'https://dataspheres.ai';
  const apiKey  = env.DATASPHERES_API_KEY;
  const gitRoot = findGitRoot();
  const helperScript = path.join(gitRoot, 'scripts', 'sdd-screenshot.cjs');

  // Check that the helper script exists
  if (!fs.existsSync(helperScript)) {
    warn(`Screenshot helper not found at ${helperScript} — skipping visual proof`);
    return null;
  }

  const tmpPath = path.join(os.tmpdir(), `sdd-screenshot-${specId}-${Date.now()}.png`);

  try {
    const { execSync } = await import('node:child_process');
    const fullUrl = pageUrl.startsWith('http') ? pageUrl : `${baseUrl.replace('3000', '5173')}${pageUrl}`;
    info(`Taking screenshot of ${fullUrl} …`);
    execSync(`node "${helperScript}" "${fullUrl}" "${tmpPath}"`, { stdio: 'pipe', timeout: 40000 });
  } catch (e) {
    warn(`Playwright screenshot failed: ${e.message.split('\n')[0]} — skipping visual proof`);
    return null;
  }

  if (!fs.existsSync(tmpPath)) {
    warn(`Screenshot file not found after capture — skipping upload`);
    return null;
  }

  // Upload via multipart FormData
  try {
    const fileBuffer = fs.readFileSync(tmpPath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', blob, `sdd-proof-${specId}.png`);
    const uploadRes = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!uploadRes.ok) {
      warn(`Screenshot upload failed (${uploadRes.status}) — skipping visual proof`);
      return null;
    }
    const uploadData = await uploadRes.json();
    const imgUrl = uploadData.url;
    if (!imgUrl) { warn(`No URL in upload response — skipping`); return null; }
    info(`Screenshot uploaded ✓ — ${imgUrl}`);
    fs.unlinkSync(tmpPath); // clean up temp file
    return imgUrl;
  } catch (e) {
    warn(`Screenshot upload error: ${e.message} — skipping visual proof`);
    return null;
  }
}

// Infer a screenshot URL from VA task context (execution_ref → impl files → page URL)
function inferScreenshotUrl(task, allTasks) {
  const execRef = extractFrontMatterField(task.content, 'execution_ref');
  if (!execRef) return null;
  const exTask = allTasks.find(t =>
    (extractSpecId(t.content) || '').toUpperCase() === execRef.toUpperCase()
  );
  if (!exTask) return null;

  const title = (exTask.title || '').toLowerCase();
  // Map known impl patterns to page URLs
  if (title.includes('visitorlding') || title.includes('visitor')) return '/app/dataspheres-ai';
  if (title.includes('galaxybanner') || title.includes('profile') || title.includes('datasphere')) return '/app/dataspheres-ai';
  if (title.includes('sticky') || title.includes('tab')) return '/app/dataspheres-ai';
  if (title.includes('newsletter')) return '/app/dataspheres-ai/newsletters';
  if (title.includes('page')) return '/app/dataspheres-ai/pages';
  return '/app/dataspheres-ai';
}

async function cmdValidate(vaTaskId, extraArgs) {
  if (!vaTaskId) die('Usage: validate <vaTaskId> [--metric <n> --threshold <n> --iteration <n>]');
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  const flags = {};
  for (let i = 0; i < extraArgs.length; i++) {
    if (extraArgs[i].startsWith('--') && extraArgs[i + 1] !== undefined) {
      flags[extraArgs[i].slice(2)] = extraArgs[i + 1];
      i++;
    }
  }

  const metric = flags.metric !== undefined ? parseFloat(flags.metric) : null;
  const threshold = flags.threshold !== undefined ? parseFloat(flags.threshold) : 100;
  const iteration = flags.iteration !== undefined ? parseInt(flags.iteration) : 1;

  console.log(`\n🔁 SDD-CONDUCTOR VALIDATE  [${slug}]`);
  info(`VA task: ${vaTaskId}`);
  if (metric !== null) info(`Metric: ${metric} / threshold: ${threshold} (iteration ${iteration})`);

  const task = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${vaTaskId}`));
  const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || vaTaskId;

  // Gate: VA hierarchy refs must be present before validating
  {
    const vaTitle = task.title || '';
    const vaSid   = extractSpecId(task.content) || '';
    if (/^V-T-/i.test(vaTitle) || /^VA-/i.test(vaSid)) {
      const hMissing = [];
      if (!extractFrontMatterField(task.content, 'execution_ref'))  hMissing.push('execution_ref (parent EX task)');
      if (!extractFrontMatterField(task.content, 'epic_ref'))       hMissing.push('epic_ref');
      if (!extractFrontMatterField(task.content, 'north_star_ref')) hMissing.push('north_star_ref');
      if (hMissing.length > 0)
        gate(`VA hierarchy refs missing — fix frontmatter before validating:\n${hMissing.map(m => `  ✗ ${m}`).join('\n')}`);
    }
  }
  // Gate: checklist format on VA task
  {
    const bareUl = /<ul(?![^>]*data-type="taskList")[^>]*>[\s\S]{0,50}<li[^>]*data-type="taskItem"/;
    if (bareUl.test(task.content))
      gate(`VA task ${specId} has bare <ul> wrapping taskItems — fix to <ul data-type="taskList"> before validating.`);
  }

  const passed = metric === null || metric >= threshold;

  if (passed) {
    info(`Metric ${metric} >= threshold ${threshold} — PASSED`);

    // Anti-rubber-stamp: extract each requirement category and gate on unchecked items.
    // The AI must verify every item individually before calling validate — not auto-tick.
    const acItems  = extractSectionChecklist(task.content, 'Acceptance Criteria');
    const frItems  = extractSectionChecklist(task.content, 'Functional Requirements');
    const nfrItems = extractSectionChecklist(task.content, 'Non-Functional Requirements');
    const allItems = [
      ...acItems.map(i  => ({ ...i, section: 'AC'  })),
      ...frItems.map(i  => ({ ...i, section: 'FR'  })),
      ...nfrItems.map(i => ({ ...i, section: 'NFR' })),
    ];
    const unchecked = allItems.filter(i => !i.checked);
    // Legacy: if task uses no section headings, fall back to raw count
    const legacyUnchecked = allItems.length === 0 ? countUncheckedItems(task.content) : 0;

    if (unchecked.length > 0 || legacyUnchecked > 0) {
      const details = unchecked.length > 0
        ? unchecked.map(i => `  [${i.section}] ${i.text}`).join('\n')
        : `  ${legacyUnchecked} checklist item(s) unchecked`;
      gate(
        `${unchecked.length || legacyUnchecked} item(s) not yet verified — do not rubber-stamp.\n\n` +
        `Review each item against actual evidence, then check it in the task:\n\n` +
        details +
        `\n\nFor each unchecked item:\n` +
        `  1. Verify it is accurate and actually tested (metric passing is not sufficient for FR/NFR)\n` +
        `  2. PATCH the task: data-checked="false" -> data-checked="true" ONLY when genuinely verified\n` +
        `  3. If an item cannot be verified: update the plan — add new EX tasks, re-run /all-dai-sdd\n` +
        `  4. Re-run: node sdd-conductor.mjs validate ${vaTaskId} [flags]`
      );
    }

    // Gate: parent EX task's Acceptance Criteria must also be fully checked before VA can close.
    // The sub-checklist items on the EX task represent what was built — they must be ticked to prove
    // the implementation is complete, not just that the metric passed.
    {
      const exRef = extractFrontMatterField(task.content, 'execution_ref');
      if (exRef) {
        try {
          const exTaskList = (await client.get(
            `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
          )).tasks || [];
          const exTaskForCheck = exTaskList.find(t =>
            extractSpecId(t.content) === exRef ||
            t.title?.match(/^[A-Z]+-\d+/)?.[0] === exRef
          );
          if (exTaskForCheck) {
            const exAcItems = extractSectionChecklist(exTaskForCheck.content, 'Acceptance Criteria');
            const exUnchecked = exAcItems.filter(i => !i.checked);
            if (exUnchecked.length > 0) {
              gate(
                `EX task ${exRef} has ${exUnchecked.length} unchecked Acceptance Criteria item(s).\n` +
                `The VA gate cannot close until the parent EX task checklist is also verified:\n\n` +
                exUnchecked.map(i => `  - ${i.text}`).join('\n') +
                `\n\nFor each item:\n` +
                `  1. Verify it is genuinely implemented and tested\n` +
                `  2. PATCH the EX task: data-checked="false" → data-checked="true"\n` +
                `  3. Re-run: node sdd-conductor.mjs validate ${vaTaskId} [flags]`
              );
            }
            info(`EX task ${exRef} checklist: all ${exAcItems.length} item(s) checked ✓`);
          }
        } catch { /* non-fatal if EX task lookup fails */ }
      }
    }

    // Fetch all plan tasks once — used by evidence gate, screenshot inference, and AR gate
    const allTasksForAr = ((await client.get(
      `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
    )).tasks || []);

    // -------------------------------------------------------------------------
    // EVIDENCE GATE — auto-collect before blocking.
    //
    // Checked items whose text contains evidence keywords (screenshot, nvidia-smi,
    // FPS, recording, etc.) trigger auto-collection first:
    //   1. Run nvidia-smi for VRAM items.
    //   2. Scan log dirs for FPS/benchmark output.
    //   3. Read config files for config items.
    //   4. Upload all collected output via /api/media/upload.
    //   5. Create/update AR task with real <pre><code> blocks + file URLs.
    //   6. Mark AR Done if all items were auto-collected.
    //   7. Gate only if genuinely uncollectable (live recordings, GUI screenshots).
    //
    // A real artifact = an HTTPS file URL OR a <pre><code> block ≥50 chars.
    // Writing a number in prose ("VRAM: 2587 MiB") does NOT count.
    // -------------------------------------------------------------------------
    {
      const EVIDENCE_KEYWORDS = [
        /screenshot/i, /screen recording/i, /recording attached/i,
        /nvidia.?smi/i, /gpu.?z/i, /fps counter/i, /fps.*readout/i,
        /attached as evidence/i, /evidence attached/i, /visual confirmation/i,
        /output attached/i,
      ];
      function itemNeedsArtifact(text) {
        return EVIDENCE_KEYWORDS.some(rx => rx.test(text));
      }
      // Real artifact = hosted file URL OR terminal output in a <pre><code> block (≥50 chars)
      const ARTIFACT_URL_RX  = /https?:\/\/\S+\.(png|jpg|jpeg|gif|mp4|webm|pdf|zip|csv|txt|log)|https?:\/\/\S+\/media\/\S+|<img\s[^>]*src="https?:/i;
      const ARTIFACT_CODE_RX = /<pre><code[^>]*>[\s\S]{50,}<\/code><\/pre>/i;
      function hasArtifact(content) {
        return ARTIFACT_URL_RX.test(content || '') || ARTIFACT_CODE_RX.test(content || '');
      }

      const evidenceItems = allItems.filter(i => i.checked && itemNeedsArtifact(i.text));

      if (evidenceItems.length > 0) {
        // Auto-collect before blocking — never block without attempting
        info(`Evidence gate: ${evidenceItems.length} item(s) require artifacts — auto-collecting…`);
        const { collected, humanRequired, arContent, arSpecId, isComplete } =
          await autoCollectEvidence(task, evidenceItems, allTasksForAr, client, iState, specId);

        // Find or create AR task
        const existingArTask = allTasksForAr.find(t => {
          const ref = (extractFrontMatterField(t.content || '', 'validation_ref') || '').toUpperCase();
          return ref === specId.toUpperCase() && /^AR-/i.test(t.title || '');
        });

        let arTask = existingArTask;
        if (existingArTask) {
          await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${existingArTask.id}`, {
            content: arContent,
            ...(isComplete ? { statusGroupId: iState.doneGroupId } : {}),
          });
          arTask = { ...existingArTask, content: arContent };
          info(`AR task updated: ${arSpecId} (${isComplete ? 'Done — all evidence collected' : 'partial'})`);
        } else {
          const arDestGroupId = isComplete ? iState.doneGroupId : (iState.artifactsGroupId || iState.doneGroupId);
          try {
            const newAr = await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks`, {
              title: `${arSpecId} · Evidence for ${specId}`,
              content: arContent,
              statusGroupId: arDestGroupId,
              planModeId: iState.planModeId,
            });
            arTask = { ...(newAr.task || newAr), content: arContent, title: `${arSpecId} · Evidence for ${specId}` };
            info(`AR task created: ${arSpecId} (${isComplete ? 'Done' : 'partial'})`);
          } catch (e) {
            warn(`AR task creation failed (non-fatal): ${e.message}`);
          }
        }

        // Gate: human-required items still remain
        if (humanRequired.length > 0) {
          gate(
            `EVIDENCE GATE: ${humanRequired.length} item(s) require live session capture.\n\n` +
            (collected.length > 0 ? `Auto-collected ${collected.length} item(s) ✓\n\n` : '') +
            `Still needed (live session required):\n` +
            humanRequired.map(({ item, reason }) =>
              `  ✗ [${item.section}] ${item.text.substring(0, 80)}\n      → ${reason}`
            ).join('\n') +
            `\n\nAR task: ${arSpecId} · Evidence for ${specId}\n` +
            `Action: run Launch_Studio_Workflow.py, capture recordings/screenshots,\n` +
            `        upload files and add URLs to the AR task, mark it Done.\n` +
            `Re-run: node sdd-conductor.mjs validate ${vaTaskId} [flags]`
          );
        }

        // Gate: AR task must have artifact content
        if (!arTask || !hasArtifact(arTask.content)) {
          gate(
            `EVIDENCE GATE: AR task "${arSpecId}" has no artifact content after auto-collection.\n` +
            `Re-run: node sdd-conductor.mjs collect-evidence ${vaTaskId}\n` +
            `Then: node sdd-conductor.mjs validate ${vaTaskId} [flags]`
          );
        }

        info(`Evidence gate: AR task "${arSpecId}" has artifact content ✓`);
      }
    }

    // Post detailed verification comment — lists every item as audit trail
    const commentLines = [
      `[all-dai-sdd-system-message]`,
      ``,
      `**Validation PASSED** — ${specId} | ${new Date().toISOString()}`,
      ``,
    ];
    if (metric !== null) commentLines.push(`**Metric:** ${metric} / threshold: ${threshold} ✓`);
    if (iteration > 1) commentLines.push(`**Completed on iteration:** ${iteration}`);
    commentLines.push(``, `**Verified criteria (individually checked — not rubber-stamped):**`);
    if (allItems.length > 0) {
      for (const sec of ['AC', 'FR', 'NFR']) {
        const secItems = allItems.filter(i => i.section === sec);
        if (secItems.length === 0) continue;
        const label = sec === 'AC' ? 'Acceptance Criteria' : sec === 'FR' ? 'Functional Requirements' : 'Non-Functional Requirements';
        commentLines.push(``, `_${label}:_`);
        for (const item of secItems) commentLines.push(`- ${item.text} ✓`);
      }
    } else {
      commentLines.push(`- All acceptance checklist items verified ✓`);
    }

    // Take Playwright screenshot as visual proof (non-fatal if unavailable)
    {
      const env = loadEnv();
      const pageUrl = inferScreenshotUrl(task, allTasksForAr.length ? allTasksForAr : []);
      if (pageUrl) {
        const screenshotUrl = await takeAndUploadScreenshot(pageUrl, specId, env);
        if (screenshotUrl) {
          commentLines.push(``);
          commentLines.push(`**Visual Proof:**`);
          commentLines.push(`<img src="${screenshotUrl}" alt="Validation screenshot — ${specId}" style="max-width:100%;border-radius:8px;margin-top:8px;" />`);
        }
      }
    }

    await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${vaTaskId}/comments`, {
      content: commentLines.join('\n'),
    });
    info(`Verification comment posted ✓`);

    // -------------------------------------------------------------------------
    // HARD GATE (runs BEFORE VA is marked Done): AR (Artifact) task must exist
    // or be auto-created first.  Falls back to doneGroupId when no dedicated
    // Artifacts column is configured so boards without one still enforce it.
    // allTasksForAr is also reused for execTask resolution below.
    // -------------------------------------------------------------------------
    const arDestGroupId = iState.artifactsGroupId || iState.doneGroupId;
    const existingAr = allTasksForAr.find(t =>
      /^AR-/i.test(t.title || '') &&
      (extractFrontMatterField(t.content || '', 'validation_ref') || '').toUpperCase() === specId.toUpperCase()
    );
    if (existingAr) {
      info(`AR task already exists for ${specId}: ${existingAr.title} ✓`);
    } else {
      const arEpicRef = extractFrontMatterField(task.content, 'epic_ref')       || '';
      const arNsRef   = extractFrontMatterField(task.content, 'north_star_ref') || '';
      const arExRef   = extractFrontMatterField(task.content, 'execution_ref')  || '';
      const arCounter = allTasksForAr.filter(t => /^AR-\d+/i.test(t.title || '')).length + 1;
      const arSpecId  = `AR-${String(arCounter).padStart(3, '0')}`;
      const arContent = [
        `<pre><code class="language-yaml">`,
        `spec_id: ${arSpecId}`,
        `validation_ref: ${specId}`,
        ...(arExRef   ? [`execution_ref: ${arExRef}`]   : []),
        ...(arEpicRef ? [`epic_ref: ${arEpicRef}`]       : []),
        ...(arNsRef   ? [`north_star_ref: ${arNsRef}`]   : []),
        `artifact_type: (code|page|dataset|image|video|presentation|other)`,
        `status: PENDING`,
        `</code></pre>`,
        ``,
        `<h2>Artifact Description <!-- #artifact --></h2>`,
        `<p>Produced by: ${specId} validation pass.</p>`,
        `<p><strong>Artifact type:</strong> (replace &mdash; code / page / dataset / image / video / presentation / other)</p>`,
        `<p><strong>Location:</strong> (file path, URL, or datasphere page slug)</p>`,
        ``,
        `<h3>Trace</h3>`,
        `<ul class="tiptap-bullet-list">`,
        ...(arNsRef   ? [`<li><p>North Star: ${arNsRef}</p></li>`]   : []),
        ...(arEpicRef ? [`<li><p>Epic: ${arEpicRef}</p></li>`]         : []),
        ...(arExRef   ? [`<li><p>Execution: ${arExRef}</p></li>`]     : []),
        `<li><p>Validated by: ${specId}</p></li>`,
        `</ul>`,
      ].join('\n');
      try {
        await client.post(
          `/api/v2/dataspheres/${iState.dsId}/tasks`,
          {
            title: `${arSpecId} &middot; Artifacts for ${specId}`,
            content: arContent,
            statusGroupId: arDestGroupId,
            planModeId: iState.planModeId,
          }
        );
        const destLabel = iState.artifactsGroupId ? 'Artifacts' : 'Done';
        info(`Artifact task ${arSpecId} created in ${destLabel} column ✓`);
      } catch (e) {
        gate([
          `VA ${specId} cannot be marked Done &mdash; Artifact task auto-creation failed: ${e.message}`,
          ``,
          `Create an AR task manually with front-matter:`,
          `  validation_ref: ${specId}`,
          `  execution_ref: ${arExRef || '(EX spec_id)'}`,
          ``,
          `Then re-run: node sdd-conductor.mjs validate ${vaTaskId}`,
        ].join('\n'));
      }
    }
    // AR gate passed — now safe to mark VA Done.
    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${vaTaskId}`, {
      statusGroupId: iState.doneGroupId,
      status: 'DONE',
    });
    info(`Task PATCH: status=DONE ✓`);

    // Resolve parent EX task: prefer execution_ref front-matter over parentId.
    // Reuses allTasksForAr (fetched above) — avoids a second API round-trip.
    const execRef = extractFrontMatterField(task.content, 'execution_ref');
    let execTask = allTasksForAr.find(t =>
      execRef && (
        extractSpecId(t.content) === execRef ||
        t.title?.match(/^[A-Z]+-\d+/)?.[0] === execRef
      )
    ) || null;

    if (!execTask && task.parentId) {
      try {
        const parent = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${task.parentId}`);
        const parentCol = getColumnName(parent).toLowerCase();
        if (parentCol === 'execution' || parent.title?.match(/^(T-\d|EX-)/i)) {
          execTask = parent;
        }
      } catch { /* ignore */ }
    }

    if (execTask) {
      const execSpecId = extractSpecId(execTask.content) || execTask.title?.match(/^[A-Z]+-\d+/)?.[0];
      if (!isDone(execTask)) {
        await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${execTask.id}`, {
          statusGroupId: iState.doneGroupId,
          status: 'DONE',
        });
        info(`EX task ${execSpecId} moved to Done (VA validated) ✓`);
      }
      if (execTask.parentId) {
        await propagateEpicChecklist(client, iState, execTask.parentId, execSpecId, execTask.title);
      }
    } else if (task.parentId) {
      await propagateEpicChecklist(client, iState, task.parentId, specId, task.title);
    }

    iState.activeTask = null;
    iState.lastCompleted = { taskId: vaTaskId, specId, title: task.title, completedAt: new Date().toISOString() };
    saveInitiative(state, slug, iState);

    ok(`${specId} validated and moved to Done. Hierarchical chain triggered (VA → EX → Epic → NS → RS). Artifact stub created.`);
    process.exit(0);

  } else {
    const delta = (threshold - metric).toFixed(2);
    const nextIter = iteration + 1;
    info(`Metric ${metric} < threshold ${threshold} (delta: -${delta}) — FAILED`);

    if (iState.activeTask && iState.activeTask.taskId !== vaTaskId) {
      try {
        await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${iState.activeTask.taskId}/comments`, {
          content: [
            `[all-dai-sdd-system-message]`,
            ``,
            `**Validation failed on ${specId}** — iteration ${iteration}. Refinement task will be created.`,
            `Metric: ${metric} / threshold: ${threshold} (delta: -${delta})`,
          ].join('\n'),
        });
      } catch { /* non-fatal */ }
    }
    iState.activeTask = null;
    saveInitiative(state, slug, iState);

    // Fetch all board tasks for counter derivation + EP lookup + VA linking
    let allBoardTasks = [];
    try {
      allBoardTasks = ((await client.get(
        `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
      )).tasks || []);
    } catch { /* non-fatal — counters fall back to 0 */ }

    // Parse failed requirements from this VA for specific remediation content
    const vaAcItems  = extractSectionChecklist(task.content, 'Acceptance Criteria');
    const vaFrItems  = extractSectionChecklist(task.content, 'Functional Requirements');
    const vaNfrItems = extractSectionChecklist(task.content, 'Non-Functional Requirements');
    const failedAc   = vaAcItems.filter(i  => !i.checked);
    const failedFr   = vaFrItems.filter(i  => !i.checked);
    const failedNfr  = vaNfrItems.filter(i => !i.checked);
    const totalFailed = failedAc.length + failedFr.length + failedNfr.length;

    // Derive parent refs from VA front-matter
    const parentEpicRef      = extractFrontMatterField(task.content, 'epic_ref') || '';
    const parentNorthStarRef = extractFrontMatterField(task.content, 'north_star_ref') || '';
    const origExRef          = extractFrontMatterField(task.content, 'execution_ref') || '';

    // Post enhanced failure comment to VA task including failed items
    const failedItemLines = [];
    if (failedAc.length)  failedItemLines.push(``, `_Acceptance Criteria:_`, ...failedAc.map(i  => `- ${i.text}`));
    if (failedFr.length)  failedItemLines.push(``, `_Functional:_`,          ...failedFr.map(i  => `- ${i.text}`));
    if (failedNfr.length) failedItemLines.push(``, `_Non-Functional:_`,      ...failedNfr.map(i => `- ${i.text}`));

    await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${vaTaskId}/comments`, {
      content: [
        `[all-dai-sdd-system-message]`,
        ``,
        `**Validation FAILED &mdash; Iteration ${iteration}** | ${new Date().toISOString()}`,
        ``,
        ...(metric !== null ? [`- Metric: ${metric} / threshold: ${threshold} (delta: -${delta})`] : []),
        ...(totalFailed > 0 ? [`- ${totalFailed} requirement(s) unverified:`, ...failedItemLines] : []),
        ``,
        `**Remediation:** new EX + VA tasks auto-created in Execution / Validation columns.`,
      ].join('\n'),
    });
    info(`Failure comment posted ✓`);

    if (iState.executionGroupId) {
      // Derive new EX specId — count existing EX- prefixed tasks
      const exCount    = allBoardTasks.filter(t => /^EX-\d+/i.test(t.title || '')).length;
      const newExSpecId = `EX-${String(exCount + 1).padStart(3, '0')}`;
      const baseLabel  = task.title
        .replace(/\s*\(iteration \d+\)$/, '')
        .replace(/^VA-\d+\s*[·•\s]+/i, '').trim();
      const newExTitle = `${newExSpecId} &middot; ${baseLabel} (remediation ${nextIter})`;

      const implFiles   = extractImplFiles(task.content);
      const implSection = implFiles.length > 0
        ? `<h3>Implementation Files <!-- #impl --></h3>\n<ul>\n${implFiles.map(f => `  <li><code>${f}</code></li>`).join('\n')}\n</ul>\n\n`
        : '';

      // Build failed-requirement AC items per category
      const buildAcList = (items, label) => items.length === 0 ? [] : [
        `<p><strong>${label}:</strong></p>`,
        `<ul data-type="taskList">`,
        ...items.map(i => `  <li data-type="taskItem" data-checked="false"><p>${i.text}</p></li>`),
        `</ul>`,
      ];

      const newExContent = [
        `<pre><code class="language-yaml">`,
        `spec_id: ${newExSpecId}`,
        `spec_type: remediation`,
        `status: ACTIVE`,
        `column: execution`,
        `remediation_iteration: ${nextIter}`,
        `parent_va: ${vaTaskId}`,
        ...(origExRef          ? [`remediation_for: ${origExRef}`]         : []),
        ...(parentEpicRef      ? [`epic_ref: ${parentEpicRef}`]            : []),
        ...(parentNorthStarRef ? [`north_star_ref: ${parentNorthStarRef}`] : []),
        `</code></pre>`,
        ``,
        implSection,
        `<h2>Context <!-- #ctx --></h2>`,
        `<p>Remediation task &mdash; iteration ${nextIter}. ${specId} failed validation.</p>`,
        `<ul>`,
        ...(metric !== null ? [`<li>Metric: ${metric} / threshold: ${threshold} (delta: -${delta})</li>`] : []),
        ...(totalFailed > 0 ? [`<li>${totalFailed} requirement(s) unverified &mdash; listed below under Failed Requirements</li>`] : []),
        `</ul>`,
        ``,
        `<h2>Acceptance Criteria <!-- #ac --></h2>`,
        `<ul data-type="taskList">`,
        ...(metric !== null ? [`  <li data-type="taskItem" data-checked="false"><p>Metric &gt;= ${threshold}</p></li>`] : []),
        `  <li data-type="taskItem" data-checked="false"><p>All failing requirements from ${specId} remediated (see below)</p></li>`,
        `  <li data-type="taskItem" data-checked="false"><p>All existing tests pass &mdash; no regressions</p></li>`,
        `  <li data-type="taskItem" data-checked="false"><p>No mocks or stubs introduced</p></li>`,
        `</ul>`,
        ...(totalFailed > 0 ? [
          ``,
          `<h3>Failed Requirements from ${specId} <!-- #failed-reqs --></h3>`,
          ...buildAcList(failedAc,  'Acceptance Criteria'),
          ...buildAcList(failedFr,  'Functional Requirements'),
          ...buildAcList(failedNfr, 'Non-Functional Requirements'),
        ] : []),
      ].join('\n');

      const createdEx = await client.post(
        `/api/v2/dataspheres/${iState.dsId}/tasks`,
        {
          title: newExTitle,
          statusGroupId: iState.executionGroupId,
          content: newExContent,
          parentId: task.parentId || null,
          planModeId: iState.planModeId,
        }
      );
      const newExId = createdEx.task?.id || createdEx.id || null;
      info(`Remediation EX task ${newExSpecId} created (${newExId || 'unknown'}) ✓`);

      // Auto-create VA stub for the new EX task — 1-1 rule enforced at creation time
      let newVaSpecId = null;
      if (iState.validationGroupId) {
        try {
          const vaCount = allBoardTasks.filter(t => /^VA-\d+/i.test(t.title || '')).length;
          newVaSpecId   = `VA-${String(vaCount + 1).padStart(3, '0')}`;
          const newVaContent = [
            `<pre><code class="language-yaml">`,
            `spec_id: ${newVaSpecId}`,
            `execution_ref: ${newExSpecId}`,
            ...(parentEpicRef      ? [`epic_ref: ${parentEpicRef}`]            : []),
            ...(parentNorthStarRef ? [`north_star_ref: ${parentNorthStarRef}`] : []),
            `remediation_for_va: ${specId}`,
            `status: PENDING`,
            `</code></pre>`,
            ``,
            `<h2>Validation &mdash; ${newExSpecId}</h2>`,
            `<p>Auto-created remediation VA. Verifies all failed requirements from ${specId} are now met.</p>`,
            ``,
            `<h3>Acceptance Criteria <!-- #ac --></h3>`,
            `<ul data-type="taskList">`,
            ...(metric !== null ? [`  <li data-type="taskItem" data-checked="false"><p>Metric &gt;= ${threshold}</p></li>`] : []),
            `  <li data-type="taskItem" data-checked="false"><p>All previously-failed requirements from ${specId} now verified</p></li>`,
            `  <li data-type="taskItem" data-checked="false"><p>No regressions in requirements that passed in prior iteration</p></li>`,
            `</ul>`,
            ...(totalFailed > 0 ? [
              ``,
              `<h3>Previously Failed (from ${specId}) <!-- #prev-failed --></h3>`,
              ...buildAcList(failedAc,  'Acceptance Criteria'),
              ...buildAcList(failedFr,  'Functional Requirements'),
              ...buildAcList(failedNfr, 'Non-Functional Requirements'),
            ] : []),
          ].join('\n');
          await client.post(
            `/api/v2/dataspheres/${iState.dsId}/tasks`,
            {
              title: `${newVaSpecId} &middot; Validate ${newExSpecId} (remediation)`,
              content: newVaContent,
              statusGroupId: iState.validationGroupId,
              planModeId: iState.planModeId,
            }
          );
          info(`VA stub ${newVaSpecId} auto-created for ${newExSpecId} (1-1 rule) ✓`);
        } catch (e) {
          warn(`VA stub creation skipped (non-fatal): ${e.message}`);
        }
      }

      // Post remediation summary to parent EP task — plan was updated, EP needs to know
      if (parentEpicRef) {
        try {
          const epTask = allBoardTasks.find(t => {
            const sid = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
            return sid.toUpperCase() === parentEpicRef.toUpperCase();
          });
          if (epTask) {
            await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${epTask.id}/comments`, {
              content: [
                `[all-dai-sdd-system-message]`,
                ``,
                `**Plan Remediation &mdash; ${specId} failed validation (iteration ${iteration})**`,
                ``,
                ...(metric !== null ? [`- Metric: ${metric} / threshold: ${threshold} (delta: -${delta})`] : []),
                ...(totalFailed > 0 ? [`- ${totalFailed} requirement(s) unverified in ${specId}`] : []),
                ``,
                `**Auto-remediation applied to this Epic (${parentEpicRef}):**`,
                `- New EX task: ${newExSpecId}${newExId ? ` (id: ${newExId})` : ''} &mdash; contains specific failed requirements`,
                ...(newVaSpecId ? [`- New VA stub: ${newVaSpecId} linked to ${newExSpecId} (1&ndash;1 enforced)`] : []),
                ``,
                `**Next step:** implement ${newExSpecId}, then run:`,
                `\`node sdd-conductor.mjs validate <${newVaSpecId || 'new-va-id'}>\``,
              ].join('\n'),
            });
            info(`Remediation comment posted to epic ${parentEpicRef} ✓`);
          }
        } catch (e) {
          warn(`EP remediation comment skipped (non-fatal): ${e.message}`);
        }
      }
    } else {
      warn(`executionGroupId not set — run 'init' again or set manually to enable auto-iteration`);
    }

    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// cmdCollectEvidence — standalone evidence collection for a VA task.
// Runs auto-collection (nvidia-smi, log files, config reads, uploads),
// creates/updates the AR task with real content, marks Done if complete.
// Exits 1 if any items still require live session capture.
// ---------------------------------------------------------------------------
async function cmdCollectEvidence(vaTaskId) {
  if (!vaTaskId) die('Usage: collect-evidence <vaTaskId>');
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  console.log(`\n🔍 SDD-CONDUCTOR COLLECT-EVIDENCE  [${slug}]`);
  info(`VA task: ${vaTaskId}`);

  const task = await fetchTaskById(client, iState.dsId, iState.planModeId, vaTaskId);
  const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || vaTaskId;

  const allTasks = ((await client.get(
    `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
  )).tasks || []);

  const acItems  = extractSectionChecklist(task.content, 'Acceptance Criteria');
  const frItems  = extractSectionChecklist(task.content, 'Functional Requirements');
  const nfrItems = extractSectionChecklist(task.content, 'Non-Functional Requirements');
  const allItems = [
    ...acItems.map(i  => ({ ...i, section: 'AC'  })),
    ...frItems.map(i  => ({ ...i, section: 'FR'  })),
    ...nfrItems.map(i => ({ ...i, section: 'NFR' })),
  ];

  // Collect evidence-requiring items (checked AND unchecked — pre-tick the ones we can prove)
  const EVIDENCE_KEYWORDS = [
    /screenshot/i, /screen recording/i, /recording attached/i,
    /nvidia.?smi/i, /gpu.?z/i, /fps counter/i, /fps.*readout/i,
    /attached as evidence/i, /evidence attached/i, /visual confirmation/i,
    /output attached/i, /vram/i, /fps/i, /frame.?rate/i,
  ];
  const evidenceItems = allItems.filter(i => EVIDENCE_KEYWORDS.some(rx => rx.test(i.text)));

  if (evidenceItems.length === 0) {
    info(`No evidence-requiring items found in ${specId} — nothing to collect`);
    process.exit(0);
  }

  info(`${evidenceItems.length} evidence-requiring item(s) found (checked + unchecked)`);

  const { collected, humanRequired, arContent, arSpecId, isComplete } =
    await autoCollectEvidence(task, evidenceItems, allTasks, client, iState, specId);

  // Find or create AR task
  const existingAr = allTasks.find(t => {
    const ref = (extractFrontMatterField(t.content || '', 'validation_ref') || '').toUpperCase();
    return ref === specId.toUpperCase() && /^AR-/i.test(t.title || '');
  });

  const arDestGroupId = isComplete ? iState.doneGroupId : (iState.artifactsGroupId || iState.doneGroupId);

  if (existingAr) {
    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${existingAr.id}`, {
      content: arContent,
      ...(isComplete ? { statusGroupId: iState.doneGroupId } : {}),
    });
    info(`AR task updated: ${arSpecId} (${isComplete ? 'marked Done' : 'partial evidence added'})`);
  } else {
    await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks`, {
      title: `${arSpecId} · Evidence for ${specId}`,
      content: arContent,
      statusGroupId: arDestGroupId,
      planModeId: iState.planModeId,
    });
    info(`AR task created: ${arSpecId} (${isComplete ? 'Done' : 'partial'})`);
  }

  console.log(`\n📋 EVIDENCE COLLECTION SUMMARY for ${specId}`);
  if (collected.length > 0) {
    console.log(`\n  ✅ Auto-collected (${collected.length}):`);
    for (const { item, type, url } of collected) {
      info(`    [${item.section}] ${item.text.substring(0, 60)} → ${type}${url ? ` (${url})` : ''}`);
    }
  }
  if (humanRequired.length > 0) {
    console.log(`\n  ⚠️  Requires live session (${humanRequired.length}):`);
    for (const { item, reason } of humanRequired) {
      info(`    [${item.section}] ${item.text.substring(0, 60)}`);
      info(`       → ${reason}`);
    }
    console.log(`\n  AR task: ${arSpecId} (PARTIAL — live session needed to complete)`);
    console.log(`  Run Launch_Studio_Workflow.py → capture recordings → upload → mark AR Done`);
    console.log(`  Then: node sdd-conductor.mjs validate ${vaTaskId}`);
    process.exit(1);
  } else {
    ok(`All evidence auto-collected. AR task ${arSpecId} is Done.\nRe-run: node sdd-conductor.mjs validate ${vaTaskId}`);
  }
}

async function cmdDashboardCheck(dsUri, pageSlug) {
  if (!dsUri || !pageSlug) die('Usage: dashboard-check <dsUri> <page-slug>');
  const env = loadEnv();
  const baseUrl = env.DATASPHERES_BASE_URL || 'https://dataspheres.ai';
  const apiKey = env.DATASPHERES_API_KEY;
  if (!apiKey) die('DATASPHERES_API_KEY not set');

  console.log(`\n🔍 SDD-CONDUCTOR DASHBOARD-CHECK`);
  info(`Datasphere: ${dsUri}`);
  info(`Page: ${pageSlug}`);

  const res = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}/pages/${pageSlug}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) die(`Could not fetch page ${pageSlug}: ${res.status}`);
  const data = await res.json();
  let content = data.page?.content || data.content || '';

  // Widget format per SKILL.md Step 12 template — all require data-type="plannerWidget"
  // + data-datasphere-id + data-datasphere-uri + data-plan-mode-id
  const REQUIRED = [
    { label: 'trace-graph widget',        pattern: /data-widget-type="trace-graph"/ },
    { label: 'task-activity-feed widget', pattern: /data-widget-type="task-activity-feed"/ },
    { label: 'plannerWidget node',        pattern: /data-type="plannerWidget"/ },
    { label: 'H1 title',                  pattern: /<h1[^>]*>/ },
  ];
  const OPTIONAL = [
    { label: 'doc-footer element', pattern: /data-type="doc-footer"/ },
  ];

  const missing = REQUIRED.filter(r => !r.pattern.test(content)).map(r => r.label);

  if (missing.length > 0) {
    gate(
      `Dashboard page "${pageSlug}" is missing required sections:\n\n` +
      missing.map(m => `  ✗ ${m}`).join('\n') +
      `\n\nFix: ensure all required sections are present per SKILL.md Step 12 template.`
    );
  }

  // Gate: detect malformed case where <!-- #focus --> is embedded inside an <h2> tag.
  // This causes a broken heading in the rendered page and creates an orphaned tag.
  {
    const malformedH2 = content.match(/<h2[^>]*>[^<]*<!--\s*#focus\s*-->/i);
    if (malformedH2) {
      gate(
        `Malformed Current Focus block detected: <!-- #focus --> is embedded inside an <h2> tag.\n\n` +
        `  This breaks the heading and leaves an orphaned tag in the rendered page.\n` +
        `  Fix: run \`node sdd-conductor.mjs update-dashboard ${dsUri} ${pageSlug}\``
      );
    }
  }

  // Gate: the <!-- #focus --> block must exist AND contain a focus-tree plannerWidget.
  // progress-summary belongs in Section 2 (Initiative Summary) only.
  {
    const focusMatch = content.match(/<!--\s*#focus\s*-->([\s\S]*?)<!--\s*\/focus\s*-->/);
    if (!focusMatch) {
      gate(
        `Current Focus section is missing its <!-- #focus -->...<!-- /focus --> markers.\n\n` +
        `  Fix: run \`node sdd-conductor.mjs update-dashboard ${dsUri} ${pageSlug}\``
      );
    }
    const focusBlock = focusMatch[1];
    const hasWidget = /data-widget-type="focus-tree"/.test(focusBlock);
    if (!hasWidget) {
      const preview = focusBlock.replace(/<[^>]*>/g, '').trim().slice(0, 120).replace(/\n+/g, ' ');
      gate(
        `Current Focus section (#focus block) must contain a focus-tree plannerWidget (not progress-summary).\n\n` +
        `  Found: "${preview || '(empty)'}"\n\n` +
        `  Fix: run \`node sdd-conductor.mjs update-dashboard ${dsUri} ${pageSlug}\``
      );
    }
    info(`Current Focus block: focus-tree widget present ✓`);
  }

  OPTIONAL.filter(r => !r.pattern.test(content)).forEach(r =>
    warn(`Optional section absent (API may strip it): ${r.label}`)
  );

  if (/style="[^"]*"/.test(content)) {
    warn(`Dashboard has inline style= attributes — these should be removed (native widgets only)`);
  }

  // Template drift: canonical order per SKILL.md Step 12 is Trace Graph BEFORE Live Activity.
  // If the page has them swapped, fix it.
  const feedPos = content.indexOf('data-widget-type="task-activity-feed"');
  const graphPos = content.indexOf('data-widget-type="trace-graph"');
  if (feedPos !== -1 && graphPos !== -1 && feedPos < graphPos) {
    warn(`Template drift detected: Live Activity appears before Trace Graph. Canonical order is Trace Graph first. Fixing...`);

    // Swap: move trace-graph section before task-activity-feed section
    const fixedContent = content.replace(
      /(<h2[^>]*>(?:Live\s+Activity|activity.?feed)[^<]*<\/h2>\s*<div[^>]*data-widget-type="task-activity-feed"[^>]*><\/div>)([\s\S]*?)(<h2[^>]*>(?:Trace\s+Graph|trace.?graph)[^<]*<\/h2>\s*<div[^>]*data-widget-type="trace-graph"[^>]*><\/div>)/i,
      '$3$2$1'
    );

    if (fixedContent !== content) {
      const putRes = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}/pages/${pageSlug}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: fixedContent }),
      });
      if (putRes.ok) {
        ok(`Template drift fixed: Live Activity now appears before Trace Graph (HTTP ${putRes.status})`);
        content = fixedContent;
      } else {
        warn(`Could not auto-fix template drift (PUT returned ${putRes.status}) — fix manually`);
      }
    } else {
      warn(`Could not auto-fix template drift — sections not in expected markup structure. Fix manually.`);
    }
  }

  ok(`GATE dashboard-check: all required sections present`);
  REQUIRED.forEach(r => info(`  ✓ ${r.label}`));

  // Step 13 gate: trackerUrl must be set on the plan mode (SKILL.md Step 13A)
  {
    const st = loadState();
    const ist = st?.initiatives?.[st?.currentInitiative] || Object.values(st?.initiatives || {})[0];
    if (ist?.planModeId && ist?.dsId) {
      try {
        const pmRes = await fetch(`${baseUrl}/api/v2/dataspheres/${ist.dsId}/tasks/plan-modes/${ist.planModeId}`,
          { headers: { Authorization: `Bearer ${apiKey}` } });
        if (pmRes.ok) {
          const pmData = await pmRes.json();
          const tUrl = pmData.planMode?.trackerUrl || pmData.trackerUrl || '';
          if (!tUrl) warn(`Step 13A: trackerUrl not set on plan mode — run: node sdd-conductor.mjs gate tracker-link ${dsUri}`);
          else info(`  ✓ trackerUrl: ${tUrl}`);
        }
      } catch { /* non-fatal */ }
    }
  }

  // Persist dashboard slug in state so sync can re-check automatically
  const stateForSave = loadState();
  if (stateForSave) {
    const slugForSave = stateForSave.currentInitiative;
    if (slugForSave && stateForSave.initiatives?.[slugForSave]) {
      stateForSave.initiatives[slugForSave].dashboardSlug = pageSlug;
      stateForSave.initiatives[slugForSave].dsUri = dsUri;
      saveState(stateForSave);
      info(`Dashboard slug "${pageSlug}" saved to state — future syncs will auto-check`);
    }
  }
}

// ---------------------------------------------------------------------------
// cmdUpdateDashboard — generate/refresh the "Current Focus" hierarchy section
// ---------------------------------------------------------------------------

async function cmdUpdateDashboard(dsUri, pageSlug) {
  if (!dsUri || !pageSlug) die('Usage: update-dashboard <dsUri> <page-slug>');
  const env = loadEnv();
  const baseUrl = env.DATASPHERES_BASE_URL || 'https://dataspheres.ai';
  const apiKey = env.DATASPHERES_API_KEY;
  if (!apiKey) die('DATASPHERES_API_KEY not set');

  console.log(`\n📊 SDD-CONDUCTOR UPDATE-DASHBOARD`);
  info(`Datasphere: ${dsUri}`);

  // Resolve dsId from URI
  const dsRes = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!dsRes.ok) die(`Could not fetch datasphere ${dsUri}: ${dsRes.status}`);
  const dsData = await dsRes.json();
  const dsId = dsData.datasphere?.id || dsData.id;
  if (!dsId) die('Could not resolve dsId');

  // Load state for planModeId
  const state = loadState();
  const iState = state?.initiatives?.[state?.currentInitiative] || Object.values(state?.initiatives || {})[0];
  const planModeId = iState?.planModeId;
  if (!planModeId) die('planModeId not found in .sdd-state.json — run init first');

  // Fetch all tasks
  const tRes = await fetch(`${baseUrl}/api/v2/dataspheres/${dsId}/tasks?planModeId=${planModeId}&limit=500`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!tRes.ok) die(`Could not fetch tasks: ${tRes.status}`);
  const tData = await tRes.json();
  const tasks = tData.tasks || tData || [];

  // Classify tasks by column name; exclude BLOCKED and DONE
  const colName = t => (t.statusGroup?.name || '').toLowerCase();
  const isActive = t =>
    ['execution', 'north stars', 'epics', 'validation'].includes(colName(t)) &&
    t.status !== 'DONE' && t.status !== 'BLOCKED';

  const active = tasks.filter(isActive);
  const byId   = Object.fromEntries(tasks.map(t => [t.id, t]));
  const ns     = active.filter(t => colName(t) === 'north stars');
  const ep     = active.filter(t => colName(t) === 'epics');
  const ex     = active.filter(t => colName(t) === 'execution');
  const va     = active.filter(t => colName(t) === 'validation');

  const activeTaskState = iState?.activeTask;

  // Build parent-aware hierarchy via parentId first, epic_ref/north_star_ref front matter as fallback
  const rows = [];
  const shortTitle = t => (t.title || '').replace(/^[A-Z]+-[A-Z0-9-]+\s*[·\-]\s*/i, '').slice(0, 70);
  const specId = t => extractFrontMatterField(t.content, 'spec_id') || t.title?.match(/^([A-Z]+-[A-Z0-9-]+)/)?.[1] || '—';

  // Extract short ref token from a spec_id or front matter value, e.g. "EP-001" from "SPEC-CRISPR-EP001"
  const shortRef = s => s?.replace(/^SPEC-[A-Z]+-/i, '').replace(/-?0+/, '-0').replace(/-(\d+)$/, m => m) || s || '';

  // Link EX→Epic via parentId, then via epic_ref front matter
  const exForEpic = epTask => {
    const byParent = ex.filter(x => x.parentId === epTask.id);
    if (byParent.length) return byParent;
    const epRef = shortRef(specId(epTask));
    return ex.filter(x => {
      const ref = extractFrontMatterField(x.content, 'epic_ref') || '';
      return ref && (ref.includes(epRef) || shortRef(ref) === epRef);
    });
  };

  // Link VA→EX via parentId, then execution_ref
  const vaForEx = exTask => {
    const byParent = va.filter(v => v.parentId === exTask.id);
    if (byParent.length) return byParent;
    const exRef = shortRef(specId(exTask));
    return va.filter(v => {
      const ref = extractFrontMatterField(v.content, 'execution_ref') || '';
      return ref && (ref.includes(exRef) || shortRef(ref) === exRef);
    });
  };

  // Link Epic→NS via parentId, then north_star_ref
  const epicsForNs = nsTask => {
    const byParent = ep.filter(e => e.parentId === nsTask.id);
    if (byParent.length) return byParent;
    const nsRef = shortRef(specId(nsTask));
    return ep.filter(e => {
      const ref = extractFrontMatterField(e.content, 'north_star_ref') || '';
      return ref && (ref.includes(nsRef) || shortRef(ref) === nsRef);
    });
  };

  // Build the Current Focus block.
  // When an active task is registered in state, inject a focus-tree widget scoped to that task.
  // When idle (no active task), show a minimal "nothing in flight" message.
  // The full progress-summary widget lives in Section 2 (Initiative Summary) — NOT here.
  const activeTaskId = iState?.activeTaskId;
  let focusWidgetDiv;
  if (activeTaskId) {
    focusWidgetDiv = `<div data-type="plannerWidget" data-datasphere-id="${dsId}" data-datasphere-uri="${dsUri}" data-plan-mode-id="${planModeId}" data-widget-type="focus-tree" data-active-task-id="${activeTaskId}" class="planner-widget-placeholder"></div>`;
  } else {
    focusWidgetDiv = `<div data-type="plannerWidget" data-datasphere-id="${dsId}" data-datasphere-uri="${dsUri}" data-plan-mode-id="${planModeId}" data-widget-type="focus-tree" class="planner-widget-placeholder"></div>`;
  }

  // Wrap in focus markers — these delimit the injected block for future updates
  const focusBlock = `<!-- #focus -->\n${focusWidgetDiv}\n<!-- /focus -->`;

  // GET current page content
  const pageRes = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}/pages/${pageSlug}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!pageRes.ok) die(`Could not fetch page ${pageSlug}: ${pageRes.status}`);
  const pageData = await pageRes.json();
  let content = pageData.page?.content || pageData.content || '';

  // Injection strategy:
  // 1. If both <!-- #focus --> and <!-- /focus --> exist: replace between them (clean update).
  //    Also handles malformed case where <!-- #focus --> was embedded inside an <h2> tag —
  //    the optional h2 prefix is consumed so the orphaned heading tag is removed.
  // 2. If only <!-- #focus --> exists (old h2-based format): remove the h2 heading + replace block
  // 3. Otherwise: insert after progress-summary widget div (first publish)
  if (content.includes('<!-- #focus -->') && content.includes('<!-- /focus -->')) {
    // Match an optional orphaned "<h2>...</h2> prefix that was left when the marker was
    // embedded inside the h2 opening tag, then match the full focus block.
    const updated = content.replace(
      /(?:<h2[^>]*>[^<]*)?<!-- #focus -->[\s\S]*?<!-- \/focus -->/i,
      focusBlock
    );
    content = updated;
  } else if (content.includes('<!-- #focus -->')) {
    // Old format: h2 heading contains <!-- #focus --> comment inline, followed by content up to next h2.
    // Use [\s\S]*? to handle <-containing comments inside the heading.
    const replaced = content.replace(
      /(<h2[\s\S]*?Current Focus[\s\S]*?<\/h2>)([\s\S]*?)(?=<h2|$)/i,
      `${focusBlock}\n\n`
    );
    content = replaced !== content ? replaced : content.replace(/<!-- #focus -->[\s\S]*$/, focusBlock);
  } else {
    // First inject: look for an existing focus-tree widget or a Trace Graph heading to insert before.
    // The dashboard template publishes a focus-tree widget in the Current Focus section;
    // if no #focus markers exist yet, insert the block before the Trace Graph heading as fallback.
    const existingFocusTree = content.replace(
      /(<div[^>]*data-widget-type="focus-tree"[^>]*><\/div>)/i,
      `<!-- #focus -->\n$1\n<!-- /focus -->`
    );
    content = existingFocusTree !== content ? existingFocusTree : content.replace(
      /(<h2[^>]*>(?:Trace\s+Graph)[^<]*<\/h2>)/i,
      `${focusBlock}\n\n$1`
    );
  }

  const putRes = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}/pages/${pageSlug}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    die(`PUT page failed (${putRes.status}): ${t.slice(0, 200)}`);
  }

  const focusLabel = activeTaskId ? `task ${activeTaskId}` : 'idle (no active task)';
  ok(`Current Focus widget updated — ${focusLabel}`);
  info(`\nDashboard: ${env.DATASPHERES_BASE_URL?.replace('http://localhost', 'https://dataspheres.ai') || baseUrl}/pages/${dsUri}/${pageSlug}`);
}

// ---------------------------------------------------------------------------
// cmdCreateOrUpdateNextSteps — DONE mode exit gate (SKILL.md § Mode: DONE)
// Builds / updates the `<initiative>-next-steps` close-out summary page.
// Dashboard = live tracker (stays). This page = loop exit target.
// ---------------------------------------------------------------------------

async function cmdCreateOrUpdateNextSteps(dsUri, dsId, planModeId, slug, baseUrl, apiKey, taskList, dashboardUrl) {
  const nextStepsSlug = `${slug}-next-steps`;
  const plannerUrl    = `${baseUrl}/app/${dsUri}/planner?mode=${planModeId}`;
  const publicBase    = baseUrl.replace('http://localhost', 'https://dataspheres.ai');

  const nsTasks  = taskList.filter(t => /^NS-/i.test(t.title || '') || getColumnName(t).toLowerCase() === 'north stars');
  const epTasks  = taskList.filter(t => /^EP-/i.test(t.title || '') || getColumnName(t).toLowerCase() === 'epics');
  const vaTasks  = taskList.filter(t => /^VA-/i.test(t.title || '') || getColumnName(t).toLowerCase() === 'validation');
  const arTasks  = taskList.filter(t => /^AR-/i.test(t.title || '') || getColumnName(t).toLowerCase() === 'artifacts');

  const doneCount = taskList.filter(t => isDone(t)).length;
  const total     = taskList.length;
  const pct       = total > 0 ? Math.round(doneCount / total * 100) : 100;

  // ---- Epic cards HTML ----
  const epicCardsHtml = epTasks.map(ep => {
    const epId   = extractSpecId(ep.content) || ep.title?.match(/^EP-\d+/)?.[0] || '';
    const epName = ep.title.replace(/&middot;/g, '&middot;').replace(/^EP-\d+\s*[&middot;·\s]*\s*/i, '').trim();
    const done   = isDone(ep);
    const chip   = done
      ? `<span style="background:#dcfce7;color:#16a34a;font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.05em;">&#10003;&nbsp;Done</span>`
      : `<span style="background:#fef3c7;color:#b45309;font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;text-transform:uppercase;letter-spacing:.05em;">&#9888;&nbsp;In Progress</span>`;
    const epVAs  = vaTasks.filter(va => {
      const epRef = extractFrontMatterField(va.content || '', 'epic_ref') || '';
      return epRef.toUpperCase() === epId.toUpperCase();
    });
    const vaLines = epVAs.slice(0, 3).map(va => {
      const vaId   = extractSpecId(va.content) || va.title?.match(/^VA-\d+/)?.[0] || '';
      const vaName = va.title.replace(/&middot;/g, '&middot;').replace(/^(SPEC-[A-Z]+-)?VA-\d+[\*\s·&middot;]*/i, '').trim().slice(0, 80);
      const vaDone = isDone(va) ? '&#10003;' : '&#9675;';
      return `<li style="margin:0;color:#475569;font-size:12px;line-height:1.7;">${vaDone}&nbsp;<span style="font-family:monospace;font-size:11px;color:#94a3b8;">${escapeHtml(vaId)}</span> ${escapeHtml(vaName)}</li>`;
    }).join('');
    const moreVAs = epVAs.length > 3 ? `<li style="color:#94a3b8;font-size:12px;">+ ${epVAs.length - 3} more</li>` : '';
    return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:20px 24px;margin-bottom:14px;background:#f8fafc;">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
    ${chip}
    <span style="font-size:12px;font-family:monospace;color:#94a3b8;">${escapeHtml(epId)}</span>
    <a href="${plannerUrl}&amp;taskId=${ep.id}" style="margin-left:auto;font-size:11px;color:#64748b;text-decoration:none;" title="Open in planner">&#8599;</a>
  </div>
  <h3 style="margin:0 0 8px;font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(epName)}</h3>
  ${epVAs.length > 0 ? `<ul style="margin:4px 0 0;padding-left:14px;list-style:none;">${vaLines}${moreVAs}</ul>` : ''}
</div>`;
  }).join('\n');

  // ---- UAT sections HTML (one per done NS, using VA AC items as evidence) ----
  const uatHtml = nsTasks.filter(ns => isDone(ns)).map(ns => {
    const nsId   = extractSpecId(ns.content) || ns.title?.match(/^NS-\d+/)?.[0] || '';
    const nsName = ns.title.replace(/&middot;/g, '&middot;').replace(/^NS-\d+\s*[&middot;·\s]*/i, '').trim();
    const nsVAs  = vaTasks.filter(va => {
      const nsRef = extractFrontMatterField(va.content || '', 'north_star_ref') || '';
      return nsRef.toUpperCase() === nsId.toUpperCase() && isDone(va);
    });
    const acLines = nsVAs.flatMap(va => {
      const items = extractSectionChecklist(va.content || '', 'Acceptance Criteria');
      return items.filter(i => i.checked).slice(0, 3).map(i =>
        `<li>${escapeHtml(i.text.replace(/<[^>]+>/g, '').trim().slice(0, 100))}</li>`
      );
    }).slice(0, 8).join('');
    if (!acLines) return '';
    return `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:20px 24px;margin-bottom:16px;">
  <h3 style="margin:0 0 14px;font-size:14px;font-weight:700;color:#1e293b;">&#9989;&nbsp; ${escapeHtml(nsName)} &mdash; UAT</h3>
  <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.8;">${acLines}</ul>
</div>`;
  }).filter(Boolean).join('\n');

  // ---- Loose ends (unchecked VA items, HARD BLOCKERs) ----
  const looseEnds = vaTasks.filter(t => !isDone(t)).slice(0, 5).map(va => {
    const vaId   = extractSpecId(va.content) || va.title?.match(/^VA-\d+/)?.[0] || '';
    const vaName = va.title.replace(/&middot;/g, '&middot;').replace(/^(SPEC-[A-Z]+-)?VA-\d+[\*\s·&middot;]*/i, '').trim().slice(0, 80);
    return `<div style="border-left:4px solid #f59e0b;background:#fffbeb;border-radius:0 8px 8px 0;padding:14px 18px;margin-bottom:12px;">
  <strong style="font-size:13px;color:#92400e;">Known gap: ${escapeHtml(vaId)}</strong>
  <p style="margin:6px 0 0;font-size:13px;color:#78350f;">${escapeHtml(vaName)} &mdash; not yet validated.</p>
</div>`;
  }).join('\n');

  // ---- AR summary ----
  const arLines = arTasks.slice(0, 8).map(ar => {
    const arId   = extractSpecId(ar.content) || ar.title?.match(/^AR-\d+/)?.[0] || '';
    const arName = ar.title.replace(/&middot;/g, '&middot;').replace(/^AR-\d+\s*[&middot;·\s]*/i, '').trim().slice(0, 80);
    return `<li><span style="font-family:monospace;font-size:11px;color:#94a3b8;">${escapeHtml(arId)}</span> ${escapeHtml(arName)}</li>`;
  }).join('');

  const content = `<div class="not-prose" style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 60%,#0f172a 100%);border-radius:16px;padding:40px 36px;margin-bottom:32px;text-align:center;">
  <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.14em;">Initiative Complete</p>
  <h1 style="margin:0 0 12px;font-size:28px;font-weight:800;color:#f1f5f9;line-height:1.2;">${pct}% Done &mdash; ${doneCount}/${total} Tasks</h1>
  <p style="margin:0 0 24px;font-size:15px;color:#94a3b8;">${nsTasks.filter(t => isDone(t)).length} North Star${nsTasks.filter(t => isDone(t)).length !== 1 ? 's' : ''} achieved</p>
  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
    <a href="${dashboardUrl}" style="display:inline-block;padding:10px 22px;background:#a67c00;color:#fff;font-size:13px;font-weight:700;border-radius:8px;text-decoration:none;">&#9679;&nbsp;Live Tracker</a>
    <a href="${plannerUrl}" style="display:inline-block;padding:10px 22px;background:transparent;color:#94a3b8;font-size:13px;font-weight:700;border-radius:8px;text-decoration:none;border:1px solid #334155;">Open Planner</a>
  </div>
</div>

<h2>Progress Summary</h2>
<div data-type="plannerWidget"
     data-widget-type="progress-summary"
     data-datasphere-id="${dsId}"
     data-plan-mode-id="${planModeId}"
     data-refresh-interval="60"></div>

<h2>Epics</h2>
${epicCardsHtml || '<p>No epics found.</p>'}

${uatHtml ? `<h2>UAT &mdash; Verified Acceptance Criteria</h2>\n${uatHtml}` : ''}

${looseEnds ? `<h2>Loose Ends</h2>\n${looseEnds}` : ''}

${arLines ? `<h2>Artifacts</h2>\n<ul class="tiptap-bullet-list">${arLines}</ul>` : ''}

<div class="not-prose" style="display:flex;gap:16px;flex-wrap:wrap;margin:24px 0;">
  <div style="flex:1;min-width:200px;border:1px solid #e2e8f0;border-radius:10px;padding:20px;background:#f8fafc;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Live Tracker</p>
    <a href="${dashboardUrl}" style="font-size:14px;font-weight:600;color:#0f172a;text-decoration:none;">&#9679; Initiative Dashboard &#8599;</a>
    <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;">Real-time progress, trace graph, activity feed</p>
  </div>
  <div style="flex:1;min-width:200px;border:1px solid #e2e8f0;border-radius:10px;padding:20px;background:#f8fafc;">
    <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.08em;">Planner Board</p>
    <a href="${plannerUrl}" style="font-size:14px;font-weight:600;color:#0f172a;text-decoration:none;">&#9776; Open Kanban &#8599;</a>
    <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;">Full task board with all columns</p>
  </div>
</div>

<div class="not-prose" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px 24px;text-align:center;margin-bottom:24px;">
  <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.12em;">Powered by</p>
  <div style="display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap;margin-bottom:8px;">
    <a href="https://github.com/geekdreamzz/ari-dai-skills" style="font-size:13px;font-weight:600;color:#0f172a;text-decoration:none;">&#9881; ari-dai-skills</a>
    <span style="color:#cbd5e1;">&#183;</span>
    <a href="https://dataspheres.ai" style="font-size:13px;font-weight:600;color:#a67c00;text-decoration:none;">&#10022; dataspheres.ai</a>
  </div>
  <p style="margin:0;font-size:11px;color:#94a3b8;">Spec-driven development tracked end-to-end in Dataspheres AI</p>
</div>
<div data-type="doc-footer"></div>`;

  // Check if page exists (GET by slug)
  const checkRes = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}/pages/${nextStepsSlug}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  let pageId = null;
  if (checkRes.ok) {
    const existing = await checkRes.json();
    pageId = existing.page?.id || existing.id;
  }

  const body = JSON.stringify({ title: `${slug} &mdash; Next Steps &amp; UAT`, content, status: 'PUBLISHED', isPubliclyVisible: false });

  if (pageId) {
    // Update existing page
    const putRes = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}/pages/${nextStepsSlug}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body,
    });
    if (!putRes.ok) {
      const t = await putRes.text().catch(() => '');
      warn(`Next-steps page PUT ${putRes.status} — ${t.slice(0, 120)}`);
    } else {
      ok(`Next-steps page updated: ${publicBase}/pages/${dsUri}/${nextStepsSlug}`);
    }
  } else {
    // Create new page
    const postRes = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}/pages`, {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: `${slug} &mdash; Next Steps &amp; UAT`, content, status: 'PUBLISHED', isPubliclyVisible: false, slug: nextStepsSlug }),
    });
    if (!postRes.ok) {
      const t = await postRes.text().catch(() => '');
      warn(`Next-steps page POST ${postRes.status} — ${t.slice(0, 120)}`);
    } else {
      ok(`Next-steps page created: ${publicBase}/pages/${dsUri}/${nextStepsSlug}`);
    }
  }

  return `${publicBase}/pages/${dsUri}/${nextStepsSlug}`;
}

async function cmdSessionStart() {
  const state = loadState();
  if (!state) return;

  console.log(`\n🔄 SDD-CONDUCTOR SESSION START`);

  const initiatives = Object.entries(state.initiatives || {});
  let anyActive = false;

  for (const [slug, iState] of initiatives) {
    if (!iState.activeTask) continue;
    anyActive = true;

    info(`Initiative "${slug}": active task ${iState.activeTask.specId}`);

    try {
      const client = makeClient();
      const live = unwrapTask(await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${iState.activeTask.taskId}`));

      if (isDone(live)) {
        warn(
          `Active task ${iState.activeTask.specId} (${slug}) is DONE in the planner but still active in state.\n` +
          `  Clearing active task.`
        );
        iState.activeTask = null;
        saveInitiative(state, slug, iState);
      } else if (live.status !== 'IN_PROGRESS') {
        warn(`Task ${iState.activeTask.specId} is not IN_PROGRESS (status: ${live.status}). Re-patching.`);
        try {
          await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${iState.activeTask.taskId}`, {
            status: 'IN_PROGRESS',
          });
          info(`Re-patched to IN_PROGRESS.`);
        } catch (e) {
          warn(`Could not re-patch: ${e.message}`);
        }
      } else {
        info(`Task ${iState.activeTask.specId}: IN_PROGRESS ✓ (started ${iState.activeTask.startedAt})`);
      }
    } catch (e) {
      warn(`Could not reconcile "${slug}" with live API: ${e.message}`);
    }
  }

  if (!anyActive) {
    info(`No active tasks across ${initiatives.length} initiative(s).`);
  }

  // Silent self-update check on every session start
  try { await checkForUpdates(true); } catch {}

  // Silent compliance audit on every session start — warns without exiting
  try {
    const { violations } = await cmdAudit(false);
    if (violations && violations.length > 0) {
      const fixable = violations.filter(v => v.fixable).length;
      warn(`Board audit: ${violations.length} violation(s) (${fixable} auto-fixable). Run: node sdd-conductor.mjs audit --fix`);
    }
  } catch (e) {
    // Don't block session start on audit failure
  }
  console.log('');
}

async function cmdAudit(fixMode = false) {
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  console.log(`\n🔍 SDD-CONDUCTOR AUDIT  [${slug}]${fixMode ? ' --fix' : ''}`);

  const allTasks = await client.get(
    `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
  );
  const taskList = allTasks.tasks || allTasks || [];

  // Build lookup maps
  const byTitlePrefix = {};
  for (const t of taskList) {
    const prefix = t.title?.match(/^([A-Z]+-\d+)/)?.[1];
    if (prefix) byTitlePrefix[prefix] = t;
    // Also index by spec_id from front matter (handles compound IDs like SPEC-FAP-EX-022
    // whose titles start with "EX-022" — the regex above extracts "EX-022" not "SPEC-FAP-EX-022")
    const sid = extractFrontMatterField(t.content || '', 'spec_id');
    if (sid && sid !== prefix) byTitlePrefix[sid] = t;
  }

  // Normalize known ref drift patterns: EP-NNN → E-NNN
  function normalizeRef(ref) {
    if (!ref || ref === 'null' || ref === '~') return null;
    const ep = ref.match(/^EP-(\d+)$/);
    if (ep) return `E-${ep[1]}`;
    const exT = ref.match(/^EX-T\d+-(\d+)$/);
    if (exT) return `T-${exT[1]}`;
    return ref;
  }

  const violations = [];

  const activeTasks = taskList.filter(t => !isDone(t));
  for (const t of activeTasks) {
    const content = t.content || '';
    const specId = extractSpecId(content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || t.id;
    const col = getColumnName(t).toLowerCase();

    // 1. Front matter presence
    if (!/spec_id:/.test(content)) {
      violations.push({ taskId: t.id, specId, col, content,
        issue: 'Missing front matter (no spec_id:)', fixable: false });
      continue; // no point checking refs without front matter
    }

    // 2. Ref resolution
    for (const field of ['epic_ref', 'north_star_ref', 'execution_ref']) {
      const raw = extractFrontMatterField(content, field);
      if (!raw || raw === 'null' || raw === '~') continue;
      if (byTitlePrefix[raw]) continue; // resolves fine

      const normalized = normalizeRef(raw);
      const resolves = normalized && normalized !== raw && !!byTitlePrefix[normalized];
      violations.push({
        taskId: t.id, specId, col, content, field, raw, normalized,
        issue: `${field}: "${raw}" unresolvable${resolves ? ` → auto-fix to "${normalized}"` : ' (no matching task found)'}`,
        fixable: resolves,
        fixType: 'ref',
      });
    }

    // 3. Impl files required for Execution column tasks
    if (col === 'execution' && /^T-/.test(specId)) {
      const hasImpl = /impl_files:/i.test(content) || /Implementation Files/i.test(content);
      if (!hasImpl) {
        violations.push({ taskId: t.id, specId, col, content,
          issue: 'EX task missing Implementation Files section', fixable: false });
      }
    }

    // 4. Checklist required for EX and VA tasks
    if (col === 'execution' || col === 'validation') {
      if (!/data-type="taskItem"/.test(content) && content.length > 100) {
        violations.push({ taskId: t.id, specId, col, content,
          issue: `${col} task has no acceptance checklist (no taskItem elements)`, fixable: false });
      }
    }

    // 5. Bare <ul> without tiptap class
    const bareUls = (content.match(/<ul(?![^>]*(?:class="tiptap-bullet-list"|data-type="taskList"))[^>]*>/g) || []).length;
    if (bareUls > 0) {
      violations.push({ taskId: t.id, specId, col, content,
        issue: `${bareUls} bare <ul> without class="tiptap-bullet-list"`,
        fixable: true, fixType: 'bare-ul' });
    }

    // 6. Research gate (INV-1): NS tasks in Epics or later must have a Done RS task
    const isNS = /^NS-\d/i.test(specId);
    if (isNS) {
      const COL_ORDER = ['research', 'north stars', 'epics', 'execution', 'validation', 'done'];
      const colIdx   = COL_ORDER.findIndex(c => col.replace(/\s+/g, ' ').includes(c) || c.includes(col.replace(/\s+/g, ' ')));
      const epicsIdx = COL_ORDER.indexOf('epics');
      if (colIdx >= epicsIdx) {
        const rsRef = extractFrontMatterField(content, 'research_ref');
        if (!rsRef) {
          violations.push({ taskId: t.id, specId, col, content,
            issue: 'RESEARCH GATE [INV-1]: NS task in Epics+ has no research_ref — gate cannot be verified', fixable: false });
        } else {
          const rsTask = byTitlePrefix[rsRef];
          if (!rsTask) {
            violations.push({ taskId: t.id, specId, col, content,
              issue: `RESEARCH GATE [INV-1]: research_ref="${rsRef}" not found on board`, fixable: false });
          } else if (!isDone(rsTask)) {
            violations.push({ taskId: t.id, specId, col, content,
              issue: `RESEARCH GATE [INV-1]: NS advanced to "${col}" but ${rsRef} is not Done (currently: ${getColumnName(rsTask)})`, fixable: false });
          }
        }
      }
    }
  }

  // Apply fixes
  let fixedCount = 0;
  const resolvedKeys = new Set(); // taskId:issue to suppress from final report
  if (fixMode && violations.some(v => v.fixable)) {
    const byTask = {};
    for (const v of violations.filter(v => v.fixable)) {
      byTask[v.taskId] = byTask[v.taskId] || { specId: v.specId, violations: [], content: v.content };
      byTask[v.taskId].violations.push(v);
    }

    for (const [taskId, { specId, violations: tvs, content: origContent }] of Object.entries(byTask)) {
      let content = origContent;
      const taskFixed = [];

      for (const v of tvs) {
        if (v.fixType === 'ref' && v.field && v.normalized && v.raw) {
          const before = content;
          content = content.replace(
            new RegExp(`(${escapeRegex(v.field)}:\\s*)${escapeRegex(v.raw)}`, 'g'),
            `$1${v.normalized}`
          );
          if (content !== before) {
            info(`  Fixed ${specId}: ${v.field} "${v.raw}" → "${v.normalized}"`);
            taskFixed.push(v);
            fixedCount++;
          }
        } else if (v.fixType === 'bare-ul') {
          const before = content;
          content = content.replace(
            /<ul(?![^>]*(?:class="tiptap-bullet-list"|data-type="taskList"))((?:[^>]*)?)>/g,
            '<ul class="tiptap-bullet-list"$1>'
          );
          if (content !== before) {
            info(`  Fixed ${specId}: added class="tiptap-bullet-list" to bare <ul>`);
            taskFixed.push(v);
            fixedCount++;
          }
        }
      }

      if (taskFixed.length > 0) {
        await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`, { content });
        for (const v of taskFixed) resolvedKeys.add(`${taskId}:${v.issue}`);
      }
    }
  }

  // Filter out successfully resolved violations from the report
  const remaining = violations.filter(v => !resolvedKeys.has(`${v.taskId}:${v.issue}`));

  // Report
  if (remaining.length === 0) {
    if (fixedCount > 0) ok(`AUDIT CLEAN — fixed ${fixedCount} violation(s), board is compliant`);
    else ok(`AUDIT CLEAN — ${activeTasks.length} active tasks, 0 violations`);
    return { clean: true, violations: [] };
  }

  console.log(`\n  VIOLATIONS (${remaining.length} across ${activeTasks.length} active tasks):`);
  for (const v of remaining) {
    warn(`  ${v.specId} [${v.col}]: ${v.issue}${v.fixable ? ' ✦ auto-fixable' : ''}`);
  }

  const fixable = remaining.filter(v => v.fixable).length;
  const manual = remaining.filter(v => !v.fixable).length;

  if (fixMode) {
    console.log(`\n  Fixed: ${fixedCount} | Remaining manual: ${manual}`);
    if (manual === 0) ok('All fixable violations resolved.');
    else warn(`${manual} violation(s) require manual review.`);
  } else {
    console.log(`\n  Auto-fixable: ${fixable} | Manual: ${manual}`);
    if (fixable > 0) info(`  Run: node sdd-conductor.mjs audit --fix  to auto-remediate`);
  }

  return { clean: false, violations: remaining, fixedCount };
}

// ---------------------------------------------------------------------------
// Self-update
// ---------------------------------------------------------------------------

function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function checkForUpdates(silent = true) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(CONDUCTOR_RAW_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const remote = await res.text();
    const m = remote.match(/^const VERSION = '([^']+)'/m);
    if (!m) return null;
    const remoteVersion = m[1];
    if (!semverGt(remoteVersion, VERSION)) return null;

    fs.writeFileSync(fileURLToPath(import.meta.url), remote, 'utf-8');
    const msg = `Updated sdd-conductor ${VERSION} → ${remoteVersion}`;
    silent ? console.log(`   ${msg}`) : ok(msg);
    return remoteVersion;
  } catch {
    return null;
  }
}

async function cmdUpdate() {
  console.log('\n⬆️  SDD-CONDUCTOR UPDATE');

  const newVersion = await checkForUpdates(false);
  if (!newVersion) {
    ok(`sdd-conductor v${VERSION} is already up to date.`);
  }

  try {
    const conductorDir = path.dirname(fileURLToPath(import.meta.url));
    const skillPath    = path.resolve(conductorDir, '..', 'all-dai-sdd', 'SKILL.md');
    if (fs.existsSync(skillPath)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(SKILL_RAW_URL, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        fs.writeFileSync(skillPath, await res.text(), 'utf-8');
        info(`SKILL.md updated ✓`);
      }
    }
  } catch (e) {
    warn(`Could not update SKILL.md: ${e.message}`);
  }

  if (newVersion) {
    info(`Restart your Claude session to pick up the new version.`);
  }
}

async function cmdInstall(projectDir) {
  const target = projectDir ? path.resolve(projectDir) : findGitRoot();
  const settingsDir = path.join(target, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');
  // Use fileURLToPath — the manual replace('file:///') leaves no leading slash
  // on macOS/Linux, causing path.resolve() to prefix the cwd to the conductor
  // path. Result: hooks pointed at <project>/Users/.../sdd-conductor.mjs which
  // doesn't exist, silently breaking the file-guard / progress / session hooks.
  const conductorPath = fileURLToPath(import.meta.url);

  if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
  }

  settings.hooks = settings.hooks || {};

  const hookCmd = `node "${conductorPath}" check-file-hook`;
  const progressHookCmd = `node "${conductorPath}" progress-hook`;
  const sessionCmd = `node "${conductorPath}" session-start`;

  settings.hooks.PostToolUse = settings.hooks.PostToolUse || [];
  const existingFileHook = settings.hooks.PostToolUse.find(
    h => h.hooks?.some(hh => hh.command?.includes('check-file-hook'))
  );
  if (!existingFileHook) {
    settings.hooks.PostToolUse.push({
      matcher: 'Write|Edit',
      hooks: [{ type: 'command', command: hookCmd }],
    });
  }

  const existingProgressHook = settings.hooks.PostToolUse.find(
    h => h.hooks?.some(hh => hh.command?.includes('progress-hook'))
  );
  if (!existingProgressHook) {
    settings.hooks.PostToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: progressHookCmd }],
    });
  }

  settings.hooks.SessionStart = settings.hooks.SessionStart || [];
  const existingSessionHook = settings.hooks.SessionStart.find(
    h => h.hooks?.some(hh => hh.command?.includes('session-start'))
  );
  if (!existingSessionHook) {
    settings.hooks.SessionStart.push({
      hooks: [{ type: 'command', command: sessionCmd }],
    });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

  ok(`Hooks installed in ${settingsPath}`);
  info(`File guard:      PostToolUse(Write|Edit) → check-file-hook`);
  info(`Progress hook:   PostToolUse(Bash)        → progress-hook  (auto-posts test results)`);
  info(`Session start:   SessionStart              → session-start  (auto-updates + audit on every session)`);
  info(`Conductor path:  ${conductorPath}`);

  // Pull latest version immediately after installing
  info(`\nChecking for updates...`);
  const updated = await checkForUpdates(false);
  if (!updated) info(`sdd-conductor v${VERSION} — already up to date.`);

  info(`\nNext: node sdd-conductor.mjs init  (to set up .sdd-state.json for this project)`);
}

async function cmdDrive() {
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();
  const baseUrl = loadEnv().DATASPHERES_BASE_URL || 'https://dataspheres.ai';

  const dashboardSlug = iState.dashboardSlug || `${slug}-dashboard`;
  const dashboardUrl  = `${baseUrl}/docs/${iState.dsUri}/${dashboardSlug}`;

  const allTasks = await client.get(
    `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
  );
  const taskList = allTasks.tasks || allTasks || [];

  const bySpecId = {};
  for (const t of taskList) {
    const sid = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0];
    if (sid) bySpecId[sid] = t;
  }
  const groups = {};
  for (const t of taskList) {
    const col = getColumnName(t).toLowerCase();
    groups[col] = groups[col] || [];
    groups[col].push(t);
  }

  const doneCount = (groups['done'] || []).length;
  const pct       = taskList.length > 0 ? Math.round(doneCount / taskList.length * 100) : 0;
  const vaTasks   = (groups['validation'] || []).filter(t => !isDone(t));
  const exTasks   = (groups['execution']  || []).filter(t => !isDone(t));
  const rsTasks   = taskList.filter(t => t.title?.match(/^RS-/) && !isDone(t));

  // -------------------------------------------------------------------------
  // NORTH STAR STATUS — the only thing that matters
  // -------------------------------------------------------------------------
  const nsAll  = taskList.filter(t => /^NS-/i.test(t.title || '') || getColumnName(t).toLowerCase() === 'north stars');
  const nsDone = nsAll.filter(t => isDone(t));
  const nsOpen = nsAll.filter(t => !isDone(t));

  console.log(`\n🏔  MISSION STATUS  [${slug}]`);
  console.log(`   Dashboard: ${dashboardUrl}`);

  if (nsOpen.length === 0 && nsAll.length > 0) {
    console.log(`\n  ✅ NORTH STAR ACHIEVED — all ${nsAll.length} North Star(s) Done`);
    // Dashboard stays as live tracker — next-steps page is the loop exit target (SKILL.md § Mode: DONE)
    const env2 = loadEnv();
    const nextStepsUrl = await cmdCreateOrUpdateNextSteps(
      iState.dsUri, iState.dsId, iState.planModeId, slug,
      env2.DATASPHERES_BASE_URL || 'https://dataspheres.ai',
      env2.DATASPHERES_API_KEY,
      taskList, dashboardUrl
    ).catch(e => { warn(`Next-steps page: ${e.message}`); return dashboardUrl; });
    try { await cmdUpdateDashboard(iState.dsUri, dashboardSlug); } catch {}
    console.log(`\n  ✅ DONE. Close-out summary:`);
    console.log(`  ${nextStepsUrl}`);
    console.log(`\n  Live tracker (stays up):`);
    console.log(`  ${dashboardUrl}`);
    console.log('');
    return;
  }

  for (const ns of nsOpen) {
    const nsSpecId = extractSpecId(ns.content) || ns.title?.match(/^NS-\d+/)?.[0] || '';
    const vision   = ns.content?.match(/<h[3-4][^>]*>[^<]*Vision[^<]*<\/h[3-4]>([\s\S]*?)(?=<h[2-4]|$)/i)?.[1]
      ?.replace(/<[^>]+>/g, '').trim().slice(0, 120) || ns.title;

    console.log(`\n  ◎ ${nsSpecId} · ${ns.title.replace(/&middot;/g, '·')}`);
    if (vision) info(`  Vision: ${vision}…`);

    // Find which Epics are under this NS
    const epics = taskList.filter(t => {
      const nsRef = extractFrontMatterField(t.content || '', 'north_star_ref') || '';
      const col   = getColumnName(t).toLowerCase();
      return (col === 'epics' || /^EP-/i.test(t.title || '')) && nsRef.toUpperCase() === nsSpecId.toUpperCase();
    });

    const epicsDone = epics.filter(t => isDone(t));
    const epicsOpen = epics.filter(t => !isDone(t));
    if (epics.length > 0) {
      console.log(`\n  EPICS (${epicsDone.length}/${epics.length} Done):`);
      for (const ep of epics) {
        const epId   = extractSpecId(ep.content) || ep.title?.match(/^EP-\d+/)?.[0] || '';
        const epName = ep.title.replace(/&middot;/g, '·').replace(/^EP-\d+\s*·?\s*/, '').trim();
        const open   = vaTasks.filter(va => {
          const exRef = extractFrontMatterField(va.content || '', 'execution_ref') || '';
          const epRef = extractFrontMatterField(va.content || '', 'epic_ref')      || '';
          return epRef.toUpperCase() === epId.toUpperCase();
        });
        const status = isDone(ep) ? '✓' : open.length > 0 ? `⚠  ${open.length} VA open` : '◌';
        info(`  ${status}  ${epId} · ${epName}`);
      }
    }

    // What specifically is blocking this NS
    const blockers = vaTasks.filter(va => {
      const nsRef = extractFrontMatterField(va.content || '', 'north_star_ref') || '';
      return nsRef.toUpperCase() === nsSpecId.toUpperCase();
    });

    if (blockers.length > 0) {
      console.log(`\n  WHAT'S BLOCKING ${nsSpecId} (${blockers.length} VA task${blockers.length > 1 ? 's' : ''}):`);
      // Dedupe by what they actually need (don't list every remediation — find root cause)
      const originals  = blockers.filter(t => !/remediation/i.test(t.title || ''));
      const remeds     = blockers.filter(t => /remediation/i.test(t.title || ''));
      const showTasks  = originals.length > 0 ? originals : blockers.slice(0, 3);
      for (const va of showTasks) {
        const vaTitle = va.title.replace(/&middot;/g, '·').replace(/^(SPEC-FAP-)?VA-\d+\s*[\*·]*\s*/i, '').trim();
        info(`  ✗ ${vaTitle}`);
      }
      if (remeds.length > 0 && originals.length > 0) {
        info(`    (+ ${remeds.length} remediation task${remeds.length > 1 ? 's' : ''} cascade from the above)`);
      }

      // Analyze what specifically each VA needs
      const humanNeeded = [];
      for (const va of showTasks) {
        const acItems  = extractSectionChecklist(va.content || '', 'Acceptance Criteria');
        const frItems  = extractSectionChecklist(va.content || '', 'Functional Requirements');
        const nfrItems = extractSectionChecklist(va.content || '', 'Non-Functional Requirements');
        const unchecked = [...acItems, ...frItems, ...nfrItems].filter(i => !i.checked);
        for (const item of unchecked.slice(0, 3)) {
          humanNeeded.push(item.text.replace(/<[^>]+>/g, '').trim().slice(0, 80));
        }
      }
      if (humanNeeded.length > 0) {
        console.log(`\n  Specifically needs:`);
        for (const need of [...new Set(humanNeeded)].slice(0, 5)) {
          info(`    → ${need}`);
        }
      }
    }
  }

  // Show other initiatives if multiple exist
  const allSlugs = Object.keys(state.initiatives || {});
  if (allSlugs.length > 1) {
    console.log(`\n  Other initiatives: ${allSlugs.filter(s => s !== slug).join(', ')}`);
  }

  // -------------------------------------------------------------------------
  // WHAT TO DO NOW — one clear action, not a list of task IDs
  // -------------------------------------------------------------------------
  console.log(`\n  PROGRESS: ${doneCount}/${taskList.length} Done (${pct}%)  |  ${vaTasks.length} VA open  |  ${exTasks.length} EX open`);

  if (!iState.activeTask && vaTasks.length > 0) {
    const firstVa    = vaTasks[0];
    const vaSpecId   = extractSpecId(firstVa.content) || firstVa.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
    const vaTitle    = firstVa.title.replace(/&middot;/g, '·').replace(/^(SPEC-FAP-)?VA-\d+[\*\s·]*/i, '').trim();
    console.log(`\n  ▶ NEXT: collect evidence → validate`);
    info(`  ${vaSpecId} — ${vaTitle}`);
    info(`  node sdd-conductor.mjs collect-evidence ${firstVa.id}`);
    info(`  node sdd-conductor.mjs validate ${firstVa.id}`);
  } else if (!iState.activeTask && exTasks.length > 0) {
    const next     = exTasks[0];
    const exSpecId = extractSpecId(next.content) || next.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
    const exTitle  = next.title.replace(/&middot;/g, '·').replace(/^(SPEC-FAP-)?EX-\d+[\*\s·]*/i, '').trim();
    console.log(`\n  ▶ NEXT: start execution`);
    info(`  ${exSpecId} — ${exTitle}`);
    info(`  node sdd-conductor.mjs start ${next.id}`);
  } else if (!iState.activeTask && rsTasks.length > 0) {
    const rsTitle = rsTasks[0].title.replace(/&middot;/g, '·');
    console.log(`\n  ▶ NEXT: complete research — ${rsTitle}`);
  } else if (iState.activeTask) {
    console.log(`\n  ▶ ACTIVE: ${iState.activeTask.specId} in progress`);
  }

  console.log(`\n  Dashboard: ${dashboardUrl}`);
  console.log('');
}

async function cmdSync() {
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  console.log(`\n🔄 SDD-CONDUCTOR SYNC  [${slug}]`);

  const allTasks = await client.get(
    `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
  );
  const liveTaskList = allTasks.tasks || allTasks || [];

  const liveBySpecId = {};
  for (const t of liveTaskList) {
    const specId = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0];
    if (specId) liveBySpecId[specId] = t;
  }

  let issues = 0;

  const root = findGitRoot();
  const yamlPath = [path.join(root, 'tasks.yaml'), ...findTasksYamls(root)].find(p => fs.existsSync(p));

  if (yamlPath) {
    const yaml = fs.readFileSync(yamlPath, 'utf-8');
    const yamlIds = [...yaml.matchAll(/^\s*id:\s*(\S+)/gm)].map(m => m[1]);
    const newInYaml = yamlIds.filter(id => !liveBySpecId[id]);
    const onBoardNotInYaml = Object.keys(liveBySpecId).filter(id =>
      !yamlIds.includes(id) && !id.includes('-iter')
    );

    if (newInYaml.length > 0) {
      console.log(`\n  NEW IN TASKS.YAML (not on board):`);
      newInYaml.forEach(id => info(`  + ${id} — run: /all-dai-sdd publish to add`));
      issues += newInYaml.length;
    }
    if (onBoardNotInYaml.length > 0) {
      console.log(`\n  ON BOARD BUT NOT IN TASKS.YAML (may be auto-created iteration tasks):`);
      onBoardNotInYaml.forEach(id => info(`  ? ${id} (${liveBySpecId[id]?.title})`));
    }
  } else {
    info(`No tasks.yaml found — skipping yaml diff`);
  }

  const drifted = liveTaskList.filter(t => {
    const col = getColumnName(t).toLowerCase();
    return col === 'execution' && !isDone(t) && t.status !== 'IN_PROGRESS' && t.id !== iState.activeTask?.taskId;
  });
  if (drifted.length > 0) {
    console.log(`\n  EXECUTION DRIFT (in Execution column but not IN_PROGRESS):`);
    for (const t of drifted) {
      const specId = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || t.id;
      info(`  ${specId} · ${t.title} [${t.status}]`);
    }
    issues += drifted.length;
  }

  if (iState.activeTask) {
    try {
      const live = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${iState.activeTask.taskId}`);
      if (isDone(live)) {
        warn(`Active task ${iState.activeTask.specId} is already Done on board — clearing state`);
        iState.activeTask = null;
        saveInitiative(state, slug, iState);
        issues++;
      }
    } catch { /* non-fatal */ }
  }

  const nsReady = liveTaskList.filter(t => {
    const col = getColumnName(t).toLowerCase();
    return (col === 'north stars' || t.title?.match(/^NS-/)) && !isDone(t)
      && t.content && countUncheckedItems(t.content) === 0 && t.content.includes('data-checked="true"');
  });
  if (nsReady.length > 0) {
    console.log(`\n  NORTH STARS FULLY CHECKED (ready to close):`);
    for (const t of nsReady) {
      const specId = extractSpecId(t.content) || t.title?.match(/^NS-\d+/)?.[0] || t.id;
      info(`  ${specId} → node sdd-conductor.mjs complete ${t.id}`);
    }
    issues += nsReady.length;
  }

  if (issues === 0) {
    ok(`Board is in sync. ${liveTaskList.length} tasks tracked.`);
  } else {
    console.log(`\n⚠️  ${issues} sync issue(s) found above.\n`);
    process.exit(1);
  }

  // Auto-check dashboard for template drift if slug is known
  if (iState.dashboardSlug && iState.dsUri) {
    console.log(`\n📊 Checking dashboard template drift...`);
    await cmdDashboardCheck(iState.dsUri, iState.dashboardSlug).catch(e => {
      warn(`Dashboard check failed: ${e.message}`);
    });
  }
}

// ---------------------------------------------------------------------------
// verify-gates — JS implementation of gate invariants (replaces Z3 claim)
// ---------------------------------------------------------------------------

async function cmdVerifyGates() {
  const { slug, iState } = requireInitiativeState();
  const client = makeClient();

  console.log(`\n🔬 SDD-CONDUCTOR VERIFY-GATES  [${slug}]`);

  const allRes = await client.get(
    `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
  );
  const tasks = allRes.tasks || allRes || [];

  // Build lookups
  const bySpecId = new Map();
  for (const t of tasks) {
    const sid = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0];
    if (sid) bySpecId.set(sid, t);
  }

  const COL_ORDER = ['research', 'north stars', 'epics', 'execution', 'validation', 'done'];
  function colIdx(t) {
    const c = getColumnName(t).toLowerCase();
    const idx = COL_ORDER.findIndex(x => c.includes(x) || x.includes(c));
    return idx >= 0 ? idx : -1;
  }

  const violations = [];
  function v(inv, specId, col, msg) { violations.push({ inv, specId, col, msg }); }

  const COL_PREFIX = {
    research:      /^RS-\d/,
    'north stars': /^NS-\d/,
    epics:         /^E-\d/,
    execution:     /^T-\d/,
    validation:    /^V-T-\d/,
  };

  for (const t of tasks) {
    const content = t.content || '';
    const specId  = extractSpecId(content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || t.id;
    const col     = getColumnName(t).toLowerCase();
    const done    = isDone(t);

    const isRS  = /^RS-\d/i.test(specId);
    const isNS  = /^NS-\d/i.test(specId);
    const isEP  = /^E-\d/i.test(specId);
    const isEX  = /^T-\d/i.test(specId)   || /^EX-\d/i.test(specId);
    const isVA  = /^V-T-\d/i.test(specId) || /^VA-\d/i.test(specId);

    // INV-1: NS in Epics+ must reference a Done RS task
    if (isNS && colIdx(t) >= COL_ORDER.indexOf('epics')) {
      const rsRef = extractFrontMatterField(content, 'research_ref');
      if (!rsRef) {
        v('INV-1', specId, col, `NS in "${col}" has no research_ref — Research gate unverifiable`);
      } else {
        const rs = bySpecId.get(rsRef);
        if (!rs)         v('INV-1', specId, col, `research_ref="${rsRef}" not found on board`);
        else if (!isDone(rs)) v('INV-1', specId, col, `NS advanced to "${col}" but ${rsRef} is not Done (${getColumnName(rs)})`);
      }
    }

    // INV-2: EX tasks (non-done) must have epic_ref + north_star_ref + validation_ref
    if (isEX && !done) {
      for (const f of ['epic_ref', 'north_star_ref', 'validation_ref']) {
        if (!extractFrontMatterField(content, f))
          v('INV-2', specId, col, `EX task missing ${f}`);
      }
    }

    // INV-3: EX ref resolution
    if (isEX && !done) {
      for (const f of ['epic_ref', 'north_star_ref']) {
        const ref = extractFrontMatterField(content, f);
        if (ref && !bySpecId.has(ref))
          v('INV-3', specId, col, `${f}="${ref}" does not match any task on board`);
      }
    }

    // INV-4: VA tasks (non-done) must have execution_ref + epic_ref + north_star_ref
    if (isVA && !done) {
      for (const f of ['execution_ref', 'epic_ref', 'north_star_ref']) {
        if (!extractFrontMatterField(content, f))
          v('INV-4', specId, col, `VA task missing ${f}`);
      }
    }

    // INV-5: Epic tasks (non-done) must have north_star_ref
    if (isEP && !done) {
      if (!extractFrontMatterField(content, 'north_star_ref'))
        v('INV-5', specId, col, 'Epic missing north_star_ref');
    }

    // INV-6: EX tasks in Execution column must have Implementation Files
    if (isEX && col.includes('execution')) {
      if (extractImplFiles(content).length === 0)
        v('INV-6', specId, col, 'EX task in Execution has no Implementation Files section');
    }

    // INV-7: Title prefix must match column
    for (const [colKey, rex] of Object.entries(COL_PREFIX)) {
      if (col.includes(colKey) && !rex.test(t.title || '')) {
        v('INV-7', specId, col, `Wrong title prefix for "${col}" column: "${(t.title||'').slice(0,50)}"`);
        break;
      }
    }

    // INV-8: No bare <ul> wrapping taskItem elements in checklist
    if (/<ul(?![^>]*(?:class="tiptap-bullet-list"|data-type="taskList"))[^>]*>[\s\S]{0,80}<li[^>]*data-type="taskItem"/.test(content)) {
      v('INV-8', specId, col, 'Checklist uses bare <ul> without data-type="taskList"');
    }

    // INV-9: EX/VA tasks with content must have at least one checklist item
    if ((isEX || isVA) && !done && content.length > 200) {
      if (!/data-type="taskItem"/.test(content))
        v('INV-9', specId, col, `${isEX ? 'EX' : 'VA'} task has no acceptance checklist items`);
    }

    // INV-10: front matter spec_id must match title prefix
    const fmSpecId = extractSpecId(content);
    const titleSpecId = t.title?.match(/^([A-Z]+-[\dT]+)/)?.[1];
    if (fmSpecId && titleSpecId && fmSpecId !== titleSpecId) {
      v('INV-10', specId, col, `spec_id frontmatter "${fmSpecId}" does not match title prefix "${titleSpecId}"`);
    }
  }

  if (violations.length === 0) {
    ok(`VERIFY-GATES: CLEAN — ${tasks.length} tasks checked, 0 invariant violations.`);
    info(`All 10 invariants pass: NS research gate, EX/VA hierarchy refs, title prefixes, checklists, impl files.`);
    return;
  }

  console.error(`\n🚫 VERIFY-GATES: ${violations.length} invariant violation(s) across ${tasks.length} tasks:\n`);
  const byInv = {};
  for (const viol of violations) {
    byInv[viol.inv] = byInv[viol.inv] || [];
    byInv[viol.inv].push(viol);
  }
  for (const [inv, viols] of Object.entries(byInv)) {
    console.error(`  ${inv}  (${viols.length} violation${viols.length > 1 ? 's' : ''})`);
    for (const viol of viols) {
      console.error(`    ${viol.specId} [${viol.col}]: ${viol.msg}`);
    }
    console.error('');
  }
  console.error(`  Fix these violations before advancing tasks.\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function findTasksYamls(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        results.push(...findTasksYamls(full));
      } else if (e.name === 'tasks.yaml') {
        results.push(full);
      }
    }
  } catch {}
  return results;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

if (!command || command === '--help' || command === '-h') {
  console.log(`
sdd-conductor v${VERSION} — SDD lifecycle enforcement

Commands:
  init                                  Bootstrap initiative in .sdd-state.json (run once per initiative)
  switch <slug>                         Switch current initiative
  workspace                             Cross-project view of all registered initiatives
  drive                                 Ordered mission brief — what to do next
  sync                                  Mid-plan reconcile: diff tasks.yaml vs live board
  start <taskId>                        Mark task IN_PROGRESS. BLOCKED if deps not Done.
  complete <taskId>                     Verify checklist + test evidence → Done → propagate NS/Epic.
  progress <message>                    Post progress milestone to active task (board visibility).
  validate <vaTaskId> [flags]           Ralph loop gate. Pass → Done+propagate. Fail → next iteration.
    --metric <n>                          Current metric (e.g. 85 for 85% pass rate)
    --threshold <n>                       Required to pass (default: 100)
    --iteration <n>                       Current iteration number (default: 1)
  status                                Show all initiatives + active task status.
  gate <name> [taskId]                  Verify named gate condition.
  dashboard-check <dsUri> <slug>        Verify dashboard page has all 5 required sections.
  check-file-hook                       PostToolUse(Write|Edit) hook — file guard.
  progress-hook                         PostToolUse(Bash) hook — auto-post test results.
  session-start                         SessionStart hook — reconcile state + run silent audit.
  audit [--fix]                         Scan board for compliance drift; --fix auto-remediates.
  verify-gates                          Check all 10 JS gate invariants against live board. Exits 1 on violations.
  install [project-dir]                 Inject all hooks into .claude/settings.json.
  collect-evidence <vaTaskId>           Auto-collect evidence (nvidia-smi, logs, configs) → upload → AR task.
  resume                                Show stuck tasks + exact recovery commands.
  brief                                 Inject session briefings into pending Execution tasks.
  recover <taskId>                      Force stuck Validation/Execution task to Done (gate_status: PASS).
  update                                Pull latest sdd-conductor.mjs + SKILL.md from GitHub.

Global flag (any command):
  --initiative <slug>                   Target a specific initiative instead of currentInitiative

Gate names: deps-done, research-done, no-mocks, checklist, impl-files, hierarchy, checklist-format, title-prefix, tracker-link, tiptap-html

Exit codes: 0=pass  1=gate blocked / loop continues  2=hard error

Multi-initiative example:
  node sdd-conductor.mjs init                    # init first initiative
  node sdd-conductor.mjs init                    # init second (different tasks.yaml, run from its dir)
  node sdd-conductor.mjs status                  # see all initiatives
  node sdd-conductor.mjs switch auth-v2          # switch current
  node sdd-conductor.mjs drive --initiative auth-v2  # drive a specific one
  node sdd-conductor.mjs workspace               # cross-project view
`);
  process.exit(0);
}

try {
  switch (command) {
    case 'init':            await cmdInit(); break;
    case 'switch':          await cmdSwitch(args[0]); break;
    case 'workspace':       await cmdWorkspace(); break;
    case 'drive':           await cmdDrive(); break;
    case 'sync':            await cmdSync(); break;
    case 'start':           await cmdStart(args[0]); break;
    case 'complete':        await cmdComplete(args[0]); break;
    case 'progress':        await cmdProgress(args.join(' ')); break;
    case 'validate':        await cmdValidate(args[0], args.slice(1)); break;
    case 'collect-evidence': await cmdCollectEvidence(args[0]); break;
    case 'status':          await cmdStatus(); break;
    case 'gate':            await cmdGate(args[0], args[1]); break;
    case 'trace-graph': {
      const { iState: tgDisp } = requireInitiativeState();
      await cmdGateTraceGraph(tgDisp.dsId, tgDisp.planModeId);
      break;
    }
    case 'auto-template': {
      if (!args[0]) die('Usage: auto-template <taskId>');
      const { iState: atDisp } = requireInitiativeState();
      const atClient = makeClient();
      const atTask = unwrapTask(await atClient.get(`/api/v2/dataspheres/${atDisp.dsId}/tasks/${args[0]}`));
      const atResult = await cmdAutoTemplate(args[0], atTask, atClient, atDisp);
      if (atResult) ok(`auto-template: front-matter wired for ${atTask.title}`);
      else ok(`auto-template: nothing to patch — all refs already present`);
      break;
    }
    case 'dashboard-check':   await cmdDashboardCheck(args[0], args[1]); break;
    case 'update-dashboard':  await cmdUpdateDashboard(args[0], args[1]); break;
    case 'create-next-steps': {
      const { state: cnsState, slug: cnsSlug, iState: cnsIS } = requireInitiativeState();
      const cnsEnv = loadEnv();
      const cnsClient = makeClient();
      const cnsTasks = (await cnsClient.get(
        `/api/v2/dataspheres/${cnsIS.dsId}/tasks?planModeId=${cnsIS.planModeId}&limit=500`
      )).tasks || [];
      const cnsDashSlug = cnsIS.dashboardSlug || `${cnsSlug}-dashboard`;
      const cnsDashUrl  = `${cnsEnv.DATASPHERES_BASE_URL || 'https://dataspheres.ai'}/docs/${cnsIS.dsUri}/${cnsDashSlug}`;
      await cmdCreateOrUpdateNextSteps(
        cnsIS.dsUri, cnsIS.dsId, cnsIS.planModeId, cnsSlug,
        cnsEnv.DATASPHERES_BASE_URL || 'https://dataspheres.ai',
        cnsEnv.DATASPHERES_API_KEY,
        cnsTasks, cnsDashUrl
      );
      break;
    }
    case 'check-file-hook':   await cmdCheckFileHook(); break;
    case 'progress-hook':   await cmdProgressHook(); break;
    case 'session-start':   await cmdSessionStart(); break;
    case 'audit':           await cmdAudit(args.includes('--fix')); break;
    case 'verify-gates':    await cmdVerifyGates(); break;
    case 'install':         await cmdInstall(args[0]); break;
    case 'resume':          await cmdResume(); break;
    case 'brief':           await cmdBrief(); break;
    case 'recover':         await cmdRecover(args[0]); break;
    case 'update':          await cmdUpdate(); break;
    default:                die(`Unknown command: ${command}. Run with --help.`);
  }
} catch (e) {
  if (e.code === 'ERR_CONDUCTOR_GATE') {
    process.exit(1);
  }
  die(`Unexpected error: ${e.message}`);
}
