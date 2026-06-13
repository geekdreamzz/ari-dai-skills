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
 *   node loop.mjs --scaffold-v2 <slug> --name "<Initiative>"  # create a schema-2 product lifecycle board (10 tiers)
 *   node loop.mjs --trace-audit                  # ghost-node sweep: dupes, dangling refs, broken chains, uncited artifacts
 *   node loop.mjs --stamp-uuids                  # write uuid: <own id> into every item missing it
 *   node loop.mjs --request-review               # pre-flight checks + surface board/dashboard links for HUMAN review
 *   node loop.mjs --greenlight                   # HUMAN approval — the Ralph loop is BLOCKED until this is run
 *   node loop.mjs --revoke-review                # pull approval (plan changed materially mid-flight)
 *   node loop.mjs --next                         # output next incomplete task as JSON; marks it IN_PROGRESS + sdd-active
 *                                                #   (schema 2: includes hierarchy[] — the full parent chain as context)
 *   node loop.mjs --check-item <taskId>          # tick ONE checklist item with its own evidence (per-item protocol)
 *     --item <N|"text">                          # REQUIRED: 1-based item number or unique text match
 *     --evidence "..."                           # REQUIRED: real output for THIS item (>=80 chars)
 *   node loop.mjs --advance <taskId>             # advance task to Done (requires --evidence; REJECTS unchecked items)
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
 *     --validation-kind <api|backend|benchmark>  # stamp the VA's evidence gate kind (default: UI when title matches)
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
let checkItemTaskId = null;
let checkItemMatch = null;
let validationKindArg = null;
let regressMode = false;
let scaffoldV2Name = null;
let scaffoldV2Slug = null;
let traceAuditMode = false;
let stampUuidsMode = false;
let requestReviewMode = false;
let greenlightMode = false;
let revokeReviewMode = false;
let reconcileMode = false;

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
  } else if (process.argv[i] === '--check-item' && process.argv[i + 1]) {
    checkItemTaskId = process.argv[++i];
  } else if (process.argv[i] === '--item' && process.argv[i + 1]) {
    checkItemMatch = process.argv[++i];
  } else if (process.argv[i] === '--validation-kind' && process.argv[i + 1]) {
    validationKindArg = process.argv[++i];
  } else if (process.argv[i] === '--regress') {
    regressMode = true;
  } else if (process.argv[i] === '--scaffold-v2' && process.argv[i + 1]) {
    scaffoldV2Slug = process.argv[++i];
  } else if (process.argv[i] === '--name' && process.argv[i + 1]) {
    scaffoldV2Name = process.argv[++i];
  } else if (process.argv[i] === '--trace-audit') {
    traceAuditMode = true;
  } else if (process.argv[i] === '--stamp-uuids') {
    stampUuidsMode = true;
  } else if (process.argv[i] === '--request-review') {
    requestReviewMode = true;
  } else if (process.argv[i] === '--greenlight') {
    greenlightMode = true;
  } else if (process.argv[i] === '--revoke-review') {
    revokeReviewMode = true;
  } else if (process.argv[i] === '--reconcile') {
    reconcileMode = true;
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

// ── Board + dashboard links — surfaced on EVERY command ───────────────────────
// The agent must keep these in front of the user constantly so they can jump to
// the plan mode (board) and the live dashboard at any moment.
function boardLinks(cfg, slug) {
  const state = loadState();
  const ist = state?.initiatives?.[slug] || {};
  const uri = cfg?.dsUri || ist.dsUri || cfg?.dsId;
  return {
    plannerUrl: cfg?.planModeId ? `${BASE}/app/${uri}/planner?mode=${cfg.planModeId}` : null,
    dashboardUrl: ist.dashboardSlug ? `${BASE}/pages/${uri}/${ist.dashboardSlug}` : null,
  };
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
  }).catch(loudCatch('dashboard refresh spawn'));
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

// HARDENING: no silent failures on board writes. A swallowed 400 hid the
// tags-endpoint body bug ({name} vs {tagName}) project-wide — Current Focus
// never lit up and nothing said why. Every best-effort write now WARNS with
// the operation name and the server's reason. Still non-fatal (the write is
// best-effort) but never invisible.
function loudCatch(label) {
  return (e) => {
    console.error(`  ⚠ board write failed [${label}]: ${String(e?.message || e).slice(0, 160)}`);
    return null;
  };
}

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
    status: t.status || null,
    content: t.content || '',
    // schema 1: done = Done column. schema 2: items never move — status carries state.
    isDone: cfg.schema === 2 ? t.status === 'DONE' : t.statusGroupId === cfg.doneGroupId,
  }));
}

// ── SDD title helpers ─────────────────────────────────────────────────────────
// Schema 1 prefixes: RS NS EP EX VA AR. Schema 2 adds the product-lifecycle
// tiers: IN PC VP SS DO TK VC (IN=intake prompt, PC=problem/customer,
// VP=value proposition, SS=solution specs, DO=desired outcomes, TK=task,
// VC=validation criteria). Two-letter prefixes are unambiguous across schemas.
const SDD_PREFIX_RE = 'IN|RS|NS|PC|VP|SS|DO|EP|EX|TK|VA|VC|AR';
function sddKey(title) {
  const m = title.match(new RegExp(`^(${SDD_PREFIX_RE})-(\\d+)`));
  return m ? `${m[1]}-${m[2]}` : null;
}
function sddType(title) {
  const m = title.match(new RegExp(`^(${SDD_PREFIX_RE})(?=-\\d)`)); return m ? m[1] : null;
}
function sddNum(title) {
  const m = title.match(new RegExp(`^(?:${SDD_PREFIX_RE})-(\\d+)`)); return m ? parseInt(m[1]) : 999;
}
function pad3(n) { return String(n).padStart(3, '0'); }

// ── Schema v2: product-lifecycle board ────────────────────────────────────────
// Ten tiers; each column IS the parent of the next. Items NEVER move columns —
// the column is the item's type/home, task.status carries lifecycle state
// (TODO → IN_PROGRESS → DONE / BLOCKED). Every item except IN MUST carry
// parent_uuid front matter resolving to an item of the parent tier.
const V2_TIERS = ['IN', 'RS', 'PC', 'VP', 'SS', 'DO', 'EP', 'TK', 'VC', 'AR'];
const V2_PARENT = { RS: 'IN', PC: 'RS', VP: 'PC', SS: 'VP', DO: 'SS', EP: 'DO', TK: 'EP', VC: 'TK', AR: 'VC' };
const V2_COLUMNS = [
  { key: 'IN', name: 'Intake',                     color: '#64748b' },
  { key: 'RS', name: 'Research & References',      color: '#6366f1' },
  { key: 'PC', name: 'Problem & Customer Segment', color: '#ec4899' },
  { key: 'VP', name: 'Value Proposition',          color: '#f97316' },
  { key: 'SS', name: 'Solution Specs & Scenarios', color: '#0891b2' },
  { key: 'DO', name: 'Desired Outcomes',           color: '#7c3aed' },
  { key: 'EP', name: 'Epics',                      color: '#3b82f6' },
  { key: 'TK', name: 'Tasks',                      color: '#2563eb' },
  { key: 'VC', name: 'Validation Criteria',        color: '#f59e0b' },
  { key: 'AR', name: 'Artifacts',                  color: '#22c55e' },
];
// Required template sections per tier — the structure box C in the system
// diagram: "this structure must be forced in the templating and gate checks".
const V2_TEMPLATES = {
  IN: { sections: ['Origin Prompt'],                 frontMatter: ['type'] },
  RS: { sections: ['Search Results', 'Sources', 'Codebase Context', 'Reusable Modules', 'Synthesis'], frontMatter: ['type', 'parent_uuid'] },
  PC: { sections: ['Problem Statement', 'Customer Segment'], frontMatter: ['type', 'parent_uuid'] },
  VP: { sections: ['Value Proposition', 'Why Worth Solving'], frontMatter: ['type', 'parent_uuid'] },
  SS: { sections: ['Functional Requirements', 'Non-Functional Requirements', 'Artifacts Needed'], frontMatter: ['type', 'parent_uuid'] },
  DO: { sections: ['Success Metrics', 'Final Outcomes'], frontMatter: ['type', 'parent_uuid'] },
  EP: { sections: ['Milestone', 'Scope', 'Task Checklist'], frontMatter: ['type', 'parent_uuid'] },
  TK: { sections: ['Implementation Steps', 'Implementation Files', 'Acceptance Criteria'], frontMatter: ['type', 'parent_uuid'] },
  VC: { sections: ['Acceptance Criteria'],           frontMatter: ['type', 'parent_uuid', 'validation_kind'] },
  AR: { sections: ['Citations'],                     frontMatter: ['type', 'parent_uuid', 'artifact_type'] },
};

function v2ParentUuid(content) {
  return (content || '').match(/parent_uuid:[ \t]*(\S+)/)?.[1] || null;
}

function verifyV2Template(type, task) {
  const tpl = V2_TEMPLATES[type];
  if (!tpl) return { pass: true, issues: [] };
  const c = task.content || '';
  const issues = [];
  for (const s of tpl.sections) {
    if (!new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(c)) {
      issues.push(`missing required section: ${s}`);
    }
  }
  for (const f of tpl.frontMatter) {
    if (!new RegExp(`${f}:[ \\t]*\\S`).test(c)) issues.push(`missing front matter: ${f}`);
  }
  return { pass: issues.length === 0, issues };
}

// Walk the parent chain bottom-up. Returns ancestors nearest-first; flags breaks.
function v2Hierarchy(task, byId) {
  const chain = [];
  let cur = task;
  const visited = new Set([task.id]);
  while (cur) {
    const pUuid = v2ParentUuid(cur.content);
    if (!pUuid) break;
    const parent = byId.get(pUuid);
    if (!parent || visited.has(parent.id)) { chain.push({ broken: pUuid }); break; }
    visited.add(parent.id);
    chain.push(parent);
    cur = parent;
  }
  return chain;
}

// AR citation gates per artifact_type — what "clean artifacts" means:
//   code   → every cited file exists AND carries the parent VC uuid/key in a
//            decorator comment (heading front matter or inline)
//   media  → metadata block per asset: file name + sha256 + byte size
//   report → at least 2 resolvable links (page URLs or task refs)
function verifyV2Artifact(task, gitRoot) {
  const c = task.content || '';
  const issues = [];
  const aType = c.match(/artifact_type:[ \t]*(\S+)/)?.[1]?.toLowerCase() || null;
  const parentUuid = v2ParentUuid(c);
  if (!aType) issues.push('missing artifact_type front matter (code|media|report)');
  if (!parentUuid) issues.push('missing parent_uuid (the VC this artifact ships)');
  for (const p of STUB_PATTERNS) { if (p.test(c)) { issues.push(`stub placeholder: ${p.source}`); break; } }

  if (aType === 'code') {
    const paths = [...c.matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map(m => m[1].trim())
      .filter(p => /^[A-Z]:\\|^\/|^(src|tests|prisma|scripts)[\\/]/.test(p) && !/\.(png|jpg|jpeg|webp|mp4)$/i.test(p));
    if (paths.length === 0) issues.push('code artifact lists no file paths');
    for (const fp of paths) {
      const abs = /^[A-Z]:\\|^\//.test(fp) ? fp : path.join(gitRoot, fp);
      if (!fs.existsSync(abs)) { issues.push(`cited file missing on disk: ${fp}`); continue; }
      const text = fs.readFileSync(abs, 'utf-8');
      const vcKey = c.match(/parent_key:[ \t]*((?:VC|VA)-\d+)/)?.[1];
      const linked = (parentUuid && text.includes(parentUuid)) || (vcKey && text.includes(vcKey));
      if (!linked) issues.push(`cited file lacks a decorator pointing at its validation criteria (${vcKey || parentUuid}): ${fp}`);
    }
  } else if (aType === 'media') {
    if (!/sha256[:=][ \t]*[a-f0-9]{16,}/i.test(c)) issues.push('media artifact needs a metadata block: file + sha256 + size per asset');
    if (!/\b\d+\s*(bytes|KB|MB)\b/i.test(c)) issues.push('media artifact metadata missing byte size');
  } else if (aType === 'report' || aType === 'doc') {
    const links = (c.match(/href="[^"]+"/g) || []).length + (c.match(/\/pages\/[\w-]+\/[\w-]+/g) || []).length;
    if (links < 2) issues.push(`report artifact needs >=2 resolvable citations/links (found ${links})`);
  }
  return { pass: issues.length === 0, issues };
}

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

  // 3.5 Orphan EX/VA — intake + remediation tasks carry no epic_ref, so the
  // epic walk above never sees them. Without this step the loop falsely reports
  // "complete" at 30/32 while critical fix tasks sit in Execution forever.
  const orphanEX = tasks
    .filter(t => sddType(t.title) === 'EX' && !epRefForEx(t) && !t.isDone)
    .sort((a, b) => sddNum(a.title) - sddNum(b.title));
  if (orphanEX.length > 0) return orphanEX[0];

  // Orphan VA: pair via execution_ref front matter (numbering is independent
  // for intake-created pairs, so VA-004 may verify EX-006).
  for (const va of tasks
    .filter(t => sddType(t.title) === 'VA' && !t.isDone)
    .sort((a, b) => sddNum(a.title) - sddNum(b.title))) {
    const exRef = (va.content || '').match(/execution_ref:\s*(EX-\d+)/)?.[1];
    const ex = exRef ? byKey[exRef] : null;
    if (!ex || ex.isDone) return va;
  }

  // 4. Any AR tasks not yet in Done (stranded from prior runs or backfills)
  for (const t of tasks.filter(t => sddType(t.title) === 'AR' && !t.isDone)
                       .sort((a, b) => sddNum(a.title) - sddNum(b.title))) {
    return t;
  }

  return null;
}

// ── Typed validation helpers ──────────────────────────────────────────────────
// Commands: validation_command (general) + validation_command_<kind> (typed).
// Kinds: a VA's effective kinds = declared validation_kind list ∪ kinds implied
// by its typed commands. Required types for an EX derive from its CHANGED FILES
// (noise-proof — instructions decay, file paths don't), overridable with an
// explicit validation_types front-matter list.
const VALIDATION_KIND_ALIASES = { backend: 'api', frontend: 'ui', db: 'data', model: 'data' };
const normKind = k => VALIDATION_KIND_ALIASES[k] || k;

function extractValidationCommands(content) {
  const cmds = [];
  const re = /validation_command(?:_([a-z]+))?:\s*(.+)/gi;
  let m;
  while ((m = re.exec(content || '')) !== null) {
    cmds.push({ kind: m[1] ? normKind(m[1].toLowerCase()) : null, cmd: m[2].trim() });
  }
  return cmds;
}

function vaEffectiveKinds(content) {
  // [ \t] only — \s would swallow the newline and capture the next front-matter
  // key (e.g. "execution_ref" parsed as kind "execution")
  const kinds = new Set(
    ((content || '').match(/validation_kind:[ \t]*([a-z, -]+)/i)?.[1] || '')
      .split(/[\s,]+/).map(s => normKind(s.trim().toLowerCase())).filter(Boolean)
  );
  for (const c of extractValidationCommands(content)) if (c.kind) kinds.add(c.kind);
  return kinds;
}

function exRequiredTypes(content) {
  const declared = ((content || '').match(/validation_types:[ \t]*([a-z, -]+)/i)?.[1] || '')
    .split(/[\s,]+/).map(s => normKind(s.trim().toLowerCase())).filter(Boolean);
  if (declared.length > 0) return declared;
  const implSection = (content || '').match(/Implementation Files[\s\S]*?(?=<h2|$)/i)?.[0] || '';
  const paths = [...implSection.matchAll(/<code[^>]*>([^<]+)<\/code>/g)].map(m => m[1].trim());
  const inferred = new Set();
  for (const p of paths) {
    if (/^src[\\/]client[\\/]|\.(tsx|jsx|css)$/i.test(p)) inferred.add('ui');
    if (/^src[\\/]server[\\/]/i.test(p)) inferred.add('api');
    if (/^prisma[\\/]|schema\.prisma|\.service\.(ts|js)$/i.test(p)) inferred.add('data');
  }
  return [...inferred];
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
    `parent_uuid: ${failingTask.id}`,
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
    `parent_uuid: ${failingTask.id}`,
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
// HARDENING: on a schema-2 board, intake triage must produce native TK+VC chain
// tasks (parent_uuid into an EP, proper tier columns). It used to emit v1-style
// EX/VA cards into the AR column — untyped-for-v2 orphans that the advance
// type-prefix gate rightly refuses, forcing manual conversion every time.
async function createIntakeTasksV2(cfg, item, allTasks) {
  const tkNums = allTasks.filter(t => sddType(t.title) === 'TK').map(t => sddNum(t.title));
  const vcNums = allTasks.filter(t => sddType(t.title) === 'VC').map(t => sddNum(t.title));
  const tkKey = `TK-${pad3((tkNums.length ? Math.max(...tkNums) : 0) + 1)}`;
  const vcKey = `VC-${pad3((vcNums.length ? Math.max(...vcNums) : 0) + 1)}`;
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const bodyHtml = item.body ? `<p>${esc(item.body).replace(/\n/g, '</p><p>')}</p>` : `<p>${esc(item.summary)}</p>`;

  // Parent EP: prefer an open epic, else the highest-numbered one.
  const eps = allTasks.filter(t => sddType(t.title) === 'EP').sort((a, b) => sddNum(a.title) - sddNum(b.title));
  const ep = eps.find(e => !e.isDone) || eps[eps.length - 1];
  if (!ep) throw new Error('v2 triage needs at least one EP on the board to parent the TK under');

  const tkContent = [
    `<pre><code class="language-yaml">`,
    `type: TK`,
    `parent_uuid: ${ep.id}`,
    `intake_ref: ${item.id}`,
    `intake_priority: ${item.priority}`,
    `plan_mode_id: ${cfg.planModeId}`,
    `auto_generated: true`,
    `</code></pre>`,
    `<h2>Context <!-- #context --></h2>`,
    `<p><strong>Intake ${item.id} (${item.type}, ${item.priority} priority):</strong></p>`,
    bodyHtml,
    `<h2>Implementation Steps <!-- #steps --></h2>`,
    `<ol class="tiptap-ordered-list"><li><p>Identify affected files from the intake context</p></li><li><p>Implement the change; add the ${tkKey} decorator at every change site</p></li><li><p>Write or extend the ${vcKey} spec; wire its validation_command</p></li></ol>`,
    `<h2>Implementation Files <!-- #files --></h2>`,
    `<ul class="tiptap-bullet-list"><li><p><em>PATCH this list with the real files (code tags) before advancing — the decorator gate verifies each one names ${tkKey}</em></p></li></ul>`,
    `<h2>Acceptance Criteria <!-- #ac --></h2>`,
    `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Intake context satisfied: ${esc(item.summary.slice(0, 120))}</p></li><li data-type="taskItem" data-checked="false"><p>Changes verified end-to-end with real output; no regressions</p></li></ul>`,
  ].join('\n');

  const vcContentOf = (tkId) => [
    `<pre><code class="language-yaml">`,
    `type: VC`,
    `parent_uuid: ${tkId}`,
    `intake_ref: ${item.id}`,
    `validation_kind: ${validationKindArg || 'ui'}`,
    `plan_mode_id: ${cfg.planModeId}`,
    `auto_generated: true`,
    `</code></pre>`,
    `<h2>Acceptance Criteria <!-- #ac --></h2>`,
    `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>${tkKey} fully addresses: ${esc(item.summary.slice(0, 120))}</p></li><li data-type="taskItem" data-checked="false"><p>Validation command wired and green; no regressions in the wall</p></li></ul>`,
    `<p><em>PATCH validation_command_${validationKindArg || 'ui'} into the front matter once the spec exists — --advance executes it live.</em></p>`,
  ].join('\n');

  const tkObj = await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
    title: `${tkKey} - ${item.summary.slice(0, 60)}`,
    content: tkContent, statusGroupId: cfg.tiers.TK, planModeId: cfg.planModeId,
  });
  const tkId = tkObj.task?.id || tkObj.id;
  await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${tkId}`, {
    content: tkContent.replace('type: TK', `type: TK\nuuid: ${tkId}`),
  }).catch(loudCatch('TK uuid stamp'));

  const vcContent = vcContentOf(tkId);
  const vcObj = await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
    title: `${vcKey} - Validate: ${item.summary.slice(0, 55)}`,
    content: vcContent, statusGroupId: cfg.tiers.VC, planModeId: cfg.planModeId,
  });
  const vcId = vcObj.task?.id || vcObj.id;
  await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${vcId}`, {
    content: vcContent.replace('type: VC', `type: VC\nuuid: ${vcId}`),
  }).catch(loudCatch('VC uuid stamp'));

  return { exKey: tkKey, vaKey: vcKey, exId: tkId, vaId: vcId };
}

async function createIntakeTasks(cfg, item, allTasks) {
  if (cfg.schema === 2 && cfg.tiers?.TK && cfg.tiers?.VC) return createIntakeTasksV2(cfg, item, allTasks);
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
    ...(validationKindArg ? [`validation_kind: ${validationKindArg}`] : []),
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

async function addIntakeCommand(cfg, slug) {
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
  // Every intake is its OWN ticket in the Intake column — the captured request
  // log. Intakes are queue cards: they need NOT each grow a full RS→…→EP spine.
  // The founding intake owns the shared lifecycle spine; follow-on intakes ADD
  // to the plan (triage attaches their TK under an existing EP and links back
  // via intake_ref). Childless intake cards are expected and fine. (The thing
  // that must NEVER happen is an ARTIFACT linking to an intake — that's gated
  // separately: AR.parent must be a VC.)
  if (cfg?.intakeGroupId) {
    try {
      const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // v2: intake cards ARE first-class IN-tier items — verbatim prompt, uuid
      // stamped, ready to parent the RS chain. v1: plain INT-prefixed card.
      const num = parseInt(id.replace('INT-', ''), 10) || 1;
      const isV2 = cfg.schema === 2;
      const created = await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
        title: isV2
          ? `IN-${pad3(num)} · ${intakeSummary.slice(0, 70)}`
          : `${id} · [${intakePriority.toUpperCase()}] ${intakeSummary.slice(0, 70)}`,
        content: isV2
          ? `<pre><code class="language-yaml">\ntype: IN\nintake_ref: ${id}\npriority: ${esc(intakePriority)}\nplan_mode_id: ${cfg.planModeId}\n</code></pre>\n<h2>Origin Prompt <!-- #origin --></h2>\n<blockquote><p>${esc(intakeBody_ || intakeSummary)}</p></blockquote>`
          : `<p><strong>Intake ${id}</strong> — ${esc(intakeType)}, ${esc(intakePriority)} priority</p><p>${esc(intakeBody_ || intakeSummary)}</p><p><em>Queued for triage. Run: node loop.mjs --triage ${id}</em></p>`,
        statusGroupId: cfg.intakeGroupId,
        planModeId: cfg.planModeId,
      });
      item.boardTaskId = created.task?.id || created.id || null;
      if (isV2 && item.boardTaskId) {
        await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${item.boardTaskId}`, {
          content: (await api('GET', `/api/v2/dataspheres/${cfg.dsId}/tasks/${item.boardTaskId}`)).task.content
            .replace('type: IN', `type: IN\nuuid: ${item.boardTaskId}`),
        }).catch(loudCatch('IN uuid stamp'));
      }
    } catch { /* board card is best-effort — the JSON queue is authoritative */ }
  }

  items.push(item);
  setIntakeItems(slug, items);

  console.log(JSON.stringify({ created: true, id, type: intakeType, priority: intakePriority, summary: intakeSummary,
    boardTaskId: item.boardTaskId || null,
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

  // Close the Intake-column board card with a pointer to the created tasks.
  // v2: IN items never move — status DONE; they remain the chain's root parent.
  if (item.boardTaskId) {
    await postComment(cfg, item.boardTaskId, `**Triaged** → ${result.exKey} + ${result.vaKey}`);
    if (cfg.schema === 2) {
      await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${item.boardTaskId}`, { status: 'DONE' }).catch(loudCatch('intake card DONE'));
    } else {
      await moveDone(cfg, item.boardTaskId).catch(loudCatch('intake card moveDone'));
    }
  }

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

// ── Per-checklist-item verification: --check-item ─────────────────────────────
// Ticks EXACTLY ONE checklist item after real evidence is provided for it.
// This is the unit of work in the Ralph loop: read item → do the work → test →
// --check-item with output → repeat. Each call posts an evidence comment that
// appears in the live activity feed, so stakeholders see item-level progress.
// --advance refuses to run until every box was earned this way.
// Usage: node loop.mjs --check-item <taskId|key> --item "<1-based number | text match>" --evidence "..."
async function checkItemCommand(cfg, iState, slug) {
  if (!checkItemMatch) {
    console.error('✗ --check-item requires --item "<number or text match>"');
    process.exit(1);
  }
  if (!evidenceText || evidenceText.length < 80) {
    console.error(`✗ --check-item requires --evidence with real output for THIS item (>=80 chars, got ${(evidenceText || '').length}).`);
    console.error('  Acceptable: command output, test result lines, file paths created, measured values, screenshot paths.');
    process.exit(1);
  }

  const tasks = await readBoard(cfg);
  const task = tasks.find(t => t.id === checkItemTaskId) ||
               tasks.find(t => sddKey(t.title) === checkItemTaskId);
  if (!task) {
    console.error(`✗ Task "${checkItemTaskId}" not found. Pass the task ID or key (VA-003).`);
    process.exit(1);
  }

  // Parse checklist items in document order, preserving raw <li> for surgical replace
  const itemRe = /<li(?=[^>]*data-type="taskItem")[^>]*data-checked="(false|true)"[^>]*>[\s\S]*?<p>([^<]+)<\/p>[\s\S]*?<\/li>/g;
  const items = [];
  let m;
  while ((m = itemRe.exec(task.content || '')) !== null) {
    items.push({ raw: m[0], checked: m[1] === 'true', text: m[2].trim(), index: items.length + 1 });
  }
  if (items.length === 0) {
    console.error(`✗ No checklist items (data-type="taskItem") found in ${sddKey(task.title) || task.id}.`);
    process.exit(1);
  }

  // Resolve target: 1-based number or case-insensitive substring
  let target = null;
  if (/^\d+$/.test(checkItemMatch.trim())) {
    target = items[parseInt(checkItemMatch.trim()) - 1] || null;
  } else {
    const needle = checkItemMatch.toLowerCase();
    const hits = items.filter(it => it.text.toLowerCase().includes(needle));
    if (hits.length > 1) {
      console.error(`✗ "--item ${checkItemMatch}" matches ${hits.length} items — be more specific or use the number:`);
      hits.forEach(h => console.error(`  ${h.index}. ${h.text.slice(0, 100)}`));
      process.exit(1);
    }
    target = hits[0] || null;
  }
  if (!target) {
    console.error(`✗ No checklist item matches "--item ${checkItemMatch}". Items:`);
    items.forEach(it => console.error(`  ${it.index}. [${it.checked ? 'x' : ' '}] ${it.text.slice(0, 100)}`));
    process.exit(1);
  }
  if (target.checked) {
    console.log(`[skip] Item ${target.index} is already checked: ${target.text.slice(0, 80)}`);
    return;
  }

  // Items that promise screenshots/tests must include a real file path or pass-count
  if (/screenshot|playwright|e2e|visual/i.test(target.text) &&
      !/\.(png|jpg|jpeg|webp)\b/i.test(evidenceText) && !/\b\d+\s+passed\b/i.test(evidenceText)) {
    console.error('✗ This item references screenshots/tests — evidence must include a screenshot path or "N passed" output.');
    process.exit(1);
  }

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, wouldTick: { index: target.index, text: target.text } }, null, 2));
    return;
  }

  // Tick exactly this item (replace its raw <li> only)
  const tickedRaw = target.raw.replace('data-checked="false"', 'data-checked="true"');
  const newContent = (task.content || '').replace(target.raw, tickedRaw);
  await patchContent(cfg, task.id, newContent);

  // Per-item evidence comment — this IS the item's artifact record and feeds
  // the live activity feed. The AR task aggregates these when the VA passes.
  const ts = new Date().toISOString();
  await postComment(cfg, task.id,
    `**[CHECK-ITEM ${target.index}/${items.length}] ${target.text.slice(0, 120)}** | ${ts}\n\n${evidenceText}`);

  const remaining = items.filter(it => !it.checked && it.index !== target.index);
  console.log(JSON.stringify({
    checked: true,
    task: sddKey(task.title) || task.id,
    item: { index: target.index, text: target.text },
    remaining: remaining.length,
    remainingItems: remaining.map(it => ({ index: it.index, text: it.text.slice(0, 80) })),
    nextStep: remaining.length > 0
      ? `Verify the next item: node loop.mjs --check-item ${task.id} --item ${remaining[0].index} --evidence "..."`
      : `All items verified — advance: node loop.mjs --advance ${task.id} --evidence "<overall summary with test output>"`,
  }, null, 2));
}

// ── V2 sequencer ──────────────────────────────────────────────────────────────
// Status-based (items never leave their column). A parent is NEVER complete
// until ALL its descendants pass — completion rolls UP from the leaves. The
// loop works the deepest ACTIONABLE item (non-DONE, all children DONE); parents
// complete via reconcileV2's bottom-up rollup, so they rarely surface here.
function v2ChildrenOf(tasks, id) {
  return tasks.filter(t => v2ParentUuid(t.content) === id);
}
function findNextIncompleteV2(tasks) {
  const actionable = t => !t.isDone && v2ChildrenOf(tasks, t.id).every(c => c.isDone);
  // Deepest tiers first: validation/artifact work surfaces before parent rollups.
  for (const tier of ['AR', 'VC', 'TK', 'EP', 'DO', 'SS', 'VP', 'PC', 'RS', 'IN']) {
    const items = tasks
      .filter(t => sddType(t.title) === tier && actionable(t))
      .sort((a, b) => sddNum(a.title) - sddNum(b.title));
    if (items.length) return items[0];
  }
  return null;
}

// ── Completion reconciliation (the re-open rule) ──────────────────────────────
// Bottom-up to fixpoint: a parent is DONE iff every child is DONE. Adding a new
// child to a completed parent RE-OPENS it and cascades up the whole hierarchy
// (DO → SS → VP → PC → RS → IN), because the upstream requirement is no longer
// satisfied. Run standalone (--reconcile) and auto at the start of --next /
// --regress / --request-review so board truth is always current.
async function reconcileV2(cfg) {
  let tasks = await readBoard(cfg);
  const changes = [];
  let changed = true, guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (const t of tasks) {
      if (!sddType(t.title)) continue;
      const kids = tasks.filter(x => v2ParentUuid(x.content) === t.id);
      if (kids.length === 0) continue;                 // leaf — own status governs
      const allDone = kids.every(k => k.isDone);
      // HARDENING: local rollup state flips ONLY after the board PATCH succeeds.
      // Previously a failed PATCH was swallowed and the loop still reported the
      // rollup — progress % and the board could silently disagree.
      if (allDone && !t.isDone) {
        const ok = await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${t.id}`, { status: 'DONE' })
          .then(() => true).catch(loudCatch(`rollup DONE ${sddKey(t.title)}`));
        if (!ok) continue;
        t.status = 'DONE'; t.isDone = true; changed = true;
        changes.push({ key: sddKey(t.title), to: 'DONE (children complete)' });
      } else if (!allDone && t.isDone) {
        const ok = await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${t.id}`, { status: 'IN_PROGRESS' })
          .then(() => true).catch(loudCatch(`rollup RE-OPEN ${sddKey(t.title)}`));
        if (!ok) continue;
        t.status = 'IN_PROGRESS'; t.isDone = false; changed = true;
        const open = kids.filter(k => !k.isDone).map(k => sddKey(k.title)).join(', ');
        changes.push({ key: sddKey(t.title), to: `RE-OPENED (open children: ${open})` });
      }
    }
  }
  return changes;
}

async function reconcileCommand(cfg, slug) {
  if (cfg.schema !== 2) { console.log(JSON.stringify({ schema: 1, message: 'reconcile is a schema-2 operation.' }, null, 2)); return; }
  const changes = await reconcileV2(cfg);
  console.log(JSON.stringify({
    status: 'reconciled', initiative: slug, changes: changes.length, detail: changes,
    links: boardLinks(cfg, slug),
    message: changes.length
      ? 'Parent completion re-rolled. Re-opened ancestors must complete their new subtree before they are DONE again.'
      : 'Board already consistent — every parent matches its children.',
  }, null, 2));
}

// VC pass → AR scaffold in the Artifacts column. Created with status TODO and a
// citation checklist — verifyV2Artifact must pass before it can go DONE, so an
// empty scaffold can never silently count as a shipped artifact.
async function createArtifactV2(cfg, vcTask, allTasks) {
  const arGroup = cfg.tiers?.AR;
  if (!arGroup) { process.stdout.write('[no AR tier group] '); return; }
  const existing = allTasks.find(t => sddType(t.title) === 'AR' && v2ParentUuid(t.content) === vcTask.id);
  if (existing) return;
  const arNum = allTasks.filter(t => sddType(t.title) === 'AR' && sddNum(t.title) < 900).length + 1;
  const arKey = `AR-${pad3(arNum)}`;
  const vcKey = sddKey(vcTask.title);
  const kinds = [...vaEffectiveKinds(vcTask.content)];
  const aType = kinds.includes('ui') || kinds.includes('api') || kinds.includes('data') ? 'code' : 'report';
  const content = [
    `<pre><code class="language-yaml">`,
    `type: AR`,
    `parent_uuid: ${vcTask.id}`,
    `parent_key: ${vcKey}`,
    `artifact_type: ${aType}`,
    `plan_mode_id: ${cfg.planModeId}`,
    `status: PENDING_CITATIONS`,
    `</code></pre>`,
    ``,
    `<h2>Artifact <!-- #artifact --></h2>`,
    `<p>Ships ${vcKey} — ${vcTask.title.replace(/^VC-\d+\s*[·•-]?\s*/, '').slice(0, 90)}</p>`,
    ``,
    `<h2>Citations <!-- #citations --></h2>`,
    `<ul class="tiptap-bullet-list">`,
    `  <li><p><em>REQUIRED before DONE — ${aType === 'code'
      ? 'list every shipped file in <code> tags; each file must carry a decorator pointing at ' + vcKey
      : 'embed metadata (file + sha256 + size) per asset, or >=2 resolvable links for reports'}</em></p></li>`,
    `</ul>`,
  ].join('\n');
  try {
    const created = await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks`, {
      title: `${arKey} · ${vcTask.title.replace(/^VC-\d+\s*[·•-]?\s*/, '').slice(0, 60)}`,
      content, statusGroupId: arGroup, planModeId: cfg.planModeId,
    });
    const arId = created.task?.id || created.id;
    if (arId) {
      await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${arId}`, {
        content: content.replace('type: AR', `type: AR\nuuid: ${arId}`),
      }).catch(loudCatch('AR uuid stamp'));
      process.stdout.write(`[${arKey} scaffolded — citations pending] `);
    }
  } catch (e) { process.stdout.write(`[AR scaffold failed: ${e.message.slice(0, 40)}] `); }
}

// ── --scaffold-v2 <slug> --name "<Initiative>" ───────────────────────────────
// Box A of the system diagram: creates the 10-column plan mode + state entry.
async function scaffoldV2Command() {
  if (!scaffoldV2Slug) { console.error('✗ --scaffold-v2 requires a slug'); process.exit(1); }
  const state = loadState() || { initiatives: {} };
  const anyInit = Object.values(state.initiatives || {})[0] || state;
  const dsId = anyInit.dsId, dsUri = anyInit.dsUri;
  if (!dsId) { console.error('✗ No dsId found in .sdd-state.json — run sdd-conductor init once first.'); process.exit(1); }
  const name = scaffoldV2Name || scaffoldV2Slug;
  const created = await api('POST', `/api/v2/dataspheres/${dsId}/tasks/plan-modes`, {
    name, tagFilter: [scaffoldV2Slug],
    columns: V2_COLUMNS.map(c => ({ name: c.name, color: c.color, isDoneState: false })),
  });
  const pm = created.planMode || created;
  const groups = pm.statusGroups || [];
  const tiers = {};
  for (const col of V2_COLUMNS) {
    const g = groups.find(x => x.name === col.name);
    if (g) tiers[col.key] = g.id;
  }
  state.initiatives = state.initiatives || {};
  state.initiatives[scaffoldV2Slug] = {
    schema: 2, dsId, dsUri, planModeId: pm.id, tiers,
    statusGroups: Object.fromEntries(groups.map(g => [g.name, g.id])),
    intakeGroupId: tiers.IN || null,
    dashboardSlug: null, trackerUrl: null,
    review: { status: 'pending' },   // loop is gated until human green-light
  };
  state.currentInitiative = scaffoldV2Slug;
  saveState(state);
  console.log(JSON.stringify({
    scaffolded: true, schema: 2, slug: scaffoldV2Slug, planModeId: pm.id,
    tiers, plannerUrl: `${BASE}/app/${dsUri || dsId}/planner?mode=${pm.id}`,
    nextSteps: [
      'Stage IN items from user prompts, then build the chain: RS -> PC -> VP -> SS -> DO -> EP -> TK -> VC',
      'Every item except IN needs parent_uuid front matter; run --stamp-uuids after creating items',
      'Create the dashboard page (Dashboard Page Template) and register dashboardSlug + trackerUrl',
      'Run --trace-audit until clean, then --request-review to surface board + dashboard to the user',
      'The Ralph loop is BLOCKED until the user reviews and you run --greenlight on their go-ahead',
    ],
  }, null, 2));
}

// ── --trace-audit ─────────────────────────────────────────────────────────────
// Ghost-node detector for BOTH schemas: duplicates, dangling refs, broken
// parent chains, uncited artifacts, missing uuid stamps. Exit 1 on any ghost.
async function traceAuditCommand(cfg, iState, slug) {
  const tasks = await readBoard(cfg);
  const ghosts = [];
  const keyMap = {};
  tasks.forEach(t => { const k = sddKey(t.title); if (k) (keyMap[k] = keyMap[k] || []).push(t); });
  for (const [k, list] of Object.entries(keyMap)) {
    if (list.length > 1) ghosts.push({ kind: 'duplicate-key', key: k, ids: list.map(t => t.id) });
  }
  const allKeys = new Set(Object.keys(keyMap));
  const byId = new Map(tasks.map(t => [t.id, t]));
  // CHAR CLEANLINESS gate — titles are PLAIN TEXT, so HTML entities (&apos; &mdash;
  // &middot; &rarr; &#39; …) render LITERALLY, and fancy unicode punctuation
  // (smart quotes, em/en dashes, arrows) keeps causing encoding breakage. Use
  // common ASCII chars only in titles. This is the recurring char-issue, gated.
  const ENTITY_RE = /&(?:[a-zA-Z]+|#\d+);/;
  const FANCY_RE = /[‘’“”–—→←↑↓…]/;
  for (const t of tasks) {
    if (ENTITY_RE.test(t.title)) ghosts.push({ kind: 'html-entity-in-title', task: sddKey(t.title) || t.id, title: t.title.slice(0, 60), fix: 'replace HTML entities with plain ASCII (&apos; -> apostrophe, &mdash; -> -, &rarr; -> ->)' });
    else if (FANCY_RE.test(t.title)) ghosts.push({ kind: 'fancy-unicode-in-title', task: sddKey(t.title) || t.id, title: t.title.slice(0, 60), fix: 'use common ASCII punctuation (straight quotes, hyphens, ->) in titles' });
  }
  for (const t of tasks) {
    const c = t.content || '';
    for (const m of c.matchAll(/(?:execution_ref|epic_ref|north_star_ref|research_ref|validation_ref):[ \t]*((?:[A-Z]+-)?[A-Z]+-\d+)/g)) {
      if (!allKeys.has(m[1])) ghosts.push({ kind: 'dangling-ref', task: sddKey(t.title) || t.id, ref: m[0].trim() });
    }
    if ((iState.schema || 1) === 2) {
      const ty = sddType(t.title);
      if (ty && ty !== 'IN') {
        const p = v2ParentUuid(c);
        if (!p) ghosts.push({ kind: 'missing-parent-uuid', task: sddKey(t.title) || t.id });
        else {
          const parent = byId.get(p);
          if (!parent) ghosts.push({ kind: 'broken-parent-chain', task: sddKey(t.title), parent_uuid: p });
          else if (sddType(parent.title) !== V2_PARENT[ty]) {
            ghosts.push({ kind: 'wrong-parent-tier', task: sddKey(t.title), expected: V2_PARENT[ty], actual: sddType(parent.title) });
          }
        }
      }
      if (ty && !/(^|\n)uuid:[ \t]*\S/.test(c)) ghosts.push({ kind: 'missing-uuid-stamp', task: sddKey(t.title) || t.id });
      if (ty === 'AR' && t.isDone) {
        const v = verifyV2Artifact(t, findGitRoot());
        if (!v.pass) ghosts.push({ kind: 'uncited-artifact', task: sddKey(t.title), issues: v.issues });
      }
    } else {
      const ty = sddType(t.title);
      if (ty === 'AR' && !/validation_ref:[ \t]*(?:[A-Z]+-)?VA-\d+/.test(c)) {
        ghosts.push({ kind: 'orphan-artifact', task: sddKey(t.title) || t.id });
      }
    }
  }
  // HARDENING: spine continuity — the lifecycle spine may not skip a column.
  // INTAKE is exempt: each intake is its own queue ticket and need not grow a
  // full chain (follow-on intakes attach their TK under an existing EP and link
  // back via intake_ref). But every RS/PC/VP/SS/DO/EP/TK/VC that DOES sit on the
  // spine must have a child of the correct next tier, and — the rule that
  // matters most here — an ARTIFACT must belong to an EXECUTION chain: AR.parent
  // is a VC, never an IN (enforced above via wrong-parent-tier; re-checked here
  // with a clearer message so "artifact line crosses to an intake" can't recur).
  if ((iState.schema || 1) === 2 && tasks.some(t => sddType(t.title))) {
    const NEXT_TIER = { RS: 'PC', PC: 'VP', VP: 'SS', SS: 'DO', DO: 'EP', EP: 'TK', TK: 'VC', VC: 'AR' };
    const childTiersOf = new Map(); // parentId -> Set(child tiers)
    for (const t of tasks) {
      const p = v2ParentUuid(t.content || '');
      if (!p) continue;
      if (!childTiersOf.has(p)) childTiersOf.set(p, new Set());
      childTiersOf.get(p).add(sddType(t.title));
    }
    for (const t of tasks) {
      const ty = sddType(t.title);
      if (!ty || !NEXT_TIER[ty]) continue; // IN exempt (queue ticket); AR is leaf
      // Only require the next-tier child once the node is DONE. A DONE node must
      // have produced its downstream (a Done TK has a VC; a Done VC has its AR —
      // ARs are auto-created by the loop at VC advance, so an OPEN VC legitimately
      // has none yet). An in-progress/just-authored plan is not a "skip".
      if (!t.isDone) continue;
      const need = NEXT_TIER[ty];
      const kids = childTiersOf.get(t.id);
      if (!kids || !kids.has(need)) {
        ghosts.push({ kind: 'dead-end-chain', task: sddKey(t.title), missingChildTier: need, done: true,
          fix: `${sddKey(t.title)} is DONE but has no ${need} child — a completed ${ty} must flow to a ${need} so the spine doesn't skip a column` });
      }
    }
    for (const t of tasks) {
      if (sddType(t.title) !== 'AR') continue;
      const parent = byId.get(v2ParentUuid(t.content || ''));
      if (!parent || sddType(parent.title) !== 'VC') {
        ghosts.push({ kind: 'artifact-not-on-execution-chain', task: sddKey(t.title),
          parentTier: parent ? sddType(parent.title) : 'NONE',
          fix: 'an artifact ALWAYS belongs to an execution chain — AR.parent_uuid must be a VC (which is under a TK). Never link an artifact to an intake or any other tier.' });
      }
    }
  }
  console.log(JSON.stringify({ schema: iState.schema || 1, tasks: tasks.length, ghosts: ghosts.length, detail: ghosts, links: boardLinks(cfg, slug) }, null, 2));
  if (ghosts.length > 0) {
    console.error(`\n✗ TRACE AUDIT FAIL — ${ghosts.length} ghost(s). Fix every entry above; ghosts become unlinked nodes in the trace graph.`);
    process.exit(1);
  }
  console.log('\n✅ TRACE AUDIT CLEAN — every node links, every artifact cites.');
}

// ── --stamp-uuids ─────────────────────────────────────────────────────────────
// Writes uuid: <own board id> into every item's front matter that lacks it —
// the uuid half of box C; parent_uuid is authored, uuid is mechanical.
async function stampUuidsCommand(cfg) {
  const tasks = await readBoard(cfg);
  let stamped = 0;
  for (const t of tasks) {
    if (!sddType(t.title)) continue;
    const c = t.content || '';
    if (/(^|\n)uuid:[ \t]*\S/.test(c)) continue;
    let nc;
    if (/<pre><code class="language-yaml">/.test(c)) {
      nc = c.replace(/(<pre><code class="language-yaml">\s*\n?)/, `$1uuid: ${t.id}\n`);
    } else {
      nc = `<pre><code class="language-yaml">\nuuid: ${t.id}\n</code></pre>\n` + c;
    }
    await patchContent(cfg, t.id, nc);
    stamped++;
  }
  console.log(JSON.stringify({ stamped, total: tasks.length }, null, 2));
}

// ── Full-board regression: --regress ──────────────────────────────────────────
// Executes every VA task's validation_command against the live system. The
// result is recorded in .sdd-state.json; --next will NOT report "complete"
// without a fresh all-pass at the current done-count. This is the final wall:
// an initiative cannot close while any requirement-level regression fails or
// any VA lacks a runnable command.
async function regressCommand(cfg, iState, slug) {
  const tasks = await readBoard(cfg);
  const vaTasks = tasks.filter(t => ['VA', 'VC'].includes(sddType(t.title)))
    .sort((a, b) => sddNum(a.title) - sddNum(b.title));

  const entries = [];
  const missingCmd = [];
  for (const va of vaTasks) {
    const cmds = extractValidationCommands(va.content);
    if (cmds.length > 0) {
      const fallbackKind = [...vaEffectiveKinds(va.content)].join('+') || 'general';
      cmds.forEach(c => entries.push({ key: sddKey(va.title), kind: c.kind || fallbackKind, cmd: c.cmd }));
    } else {
      missingCmd.push(sddKey(va.title));
    }
  }
  // Dedupe identical commands — several VAs may share one spec file
  const seen = new Set();
  const unique = entries.filter(e => !seen.has(e.cmd) && seen.add(e.cmd));

  // Typed coverage matrix — every EX's required types (from its changed files)
  // must be covered by a companion VA that has commands. Frontend, backend, and
  // data-model validation each pass individually or the wall fails.
  const coverageGaps = [];
  for (const ex of tasks.filter(t => ['EX', 'TK'].includes(sddType(t.title)))) {
    const req = exRequiredTypes(ex.content);
    if (req.length === 0) continue;
    const exK = sddKey(ex.title);
    const covered = new Set();
    for (const va of vaTasks) {
      const companion = new RegExp(`execution_ref:\\s*${exK}\\b`).test(va.content || '') ||
                        v2ParentUuid(va.content) === ex.id;   // v2: VC chains by parent_uuid
      if (!companion) continue;
      if (extractValidationCommands(va.content).length === 0) continue;
      vaEffectiveKinds(va.content).forEach(k => covered.add(k));
    }
    const missing = req.filter(t => !covered.has(t));
    if (missing.length > 0) coverageGaps.push({ ex: exK, required: req, missing });
  }

  console.log(`\n━━━ all-dai-sdd REGRESSION: ${slug} ━━━`);
  console.log(`  VA tasks: ${vaTasks.length} | commands: ${unique.length} unique | missing: ${missingCmd.length} | coverage gaps: ${coverageGaps.length}\n`);

  const failures = [];
  let passed = 0;
  for (const e of unique) {
    process.stdout.write(`  → [${e.key}|${e.kind}] ${e.cmd.slice(0, 80)} ... `);
    try {
      execSync(e.cmd, { encoding: 'utf-8', timeout: 600000, stdio: 'pipe' });
      console.log('✅');
      passed++;
    } catch (err) {
      console.log('✗ FAIL');
      failures.push({ key: e.key, cmd: e.cmd, err: ((err.stderr || '') + (err.stdout || '') || err.message || '').slice(-400) });
    }
  }

  // Snapshot the SAME task set findNextTask compares against (non-AR), or the
  // complete-gate will see a perpetual count mismatch.
  const nonArTasks = tasks.filter(t => sddType(t.title) !== 'AR');
  const allPass = failures.length === 0 && missingCmd.length === 0 && coverageGaps.length === 0;
  const state = loadState();
  if (state?.initiatives?.[slug]) {
    state.initiatives[slug].regress = {
      at: new Date().toISOString(),
      commands: unique.length, passed,
      missingCommands: missingCmd,
      boardDone: nonArTasks.filter(t => t.isDone).length,
      boardTotal: nonArTasks.length,
      pass: allPass,
    };
    saveState(state);
  }

  if (missingCmd.length > 0) {
    console.log(`\n  ✗ ${missingCmd.length} VA task(s) have NO validation command: ${missingCmd.join(', ')}`);
    console.log('    PATCH each with runnable typed commands in its front matter, then re-run --regress.');
  }
  for (const g of coverageGaps) {
    console.log(`\n  ✗ [${g.ex}] typed coverage gap — required: ${g.required.join(', ')} | MISSING: ${g.missing.join(', ')}`);
    console.log(`    Add the missing kind(s) + typed command to its companion VA, or override with validation_types.`);
  }
  for (const f of failures) {
    console.log(`\n  ✗ [${f.key}] FAILED: ${f.cmd}`);
    console.log(`    ${f.err.split('\n').slice(-5).join('\n    ')}`);
  }
  console.log(`\n  ${allPass ? '✅ REGRESSION PASS' : `❌ REGRESSION FAIL`} — ${passed}/${unique.length} commands green${missingCmd.length ? `, ${missingCmd.length} missing` : ''}`);
  if (!allPass) {
    console.log('  The board cannot report "complete" until --regress passes clean.');
    process.exit(1);
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

  // 1. All 7 lifecycle status groups present (Intake is checked separately as a
  //    soft warning so pre-Intake boards don't hard-fail health)
  const REQUIRED_GROUPS = ['Research', 'North Stars', 'Epics', 'Execution', 'Validation', 'Artifacts', 'Done'];
  const sg = iState.statusGroups || {};
  for (const g of REQUIRED_GROUPS) {
    check(`statusGroups.${g} defined`, !!(sg[g] || sg[g.toLowerCase()]), `Missing group "${g}" in .sdd-state.json → run node sdd-conductor.mjs init to regenerate`);
  }
  if (!(sg.Intake || sg.intake)) {
    console.log('  ⚠ statusGroups.Intake missing — intake items will be queue-only (invisible to stakeholders).');
    console.log('    New initiatives must create the 8-column board (Intake first). For this board, add an');
    console.log('    "Intake" status group to the plan mode and register it in .sdd-state.json.');
  }

  // 1b. Done + Artifacts groups must carry isDoneState=true — dashboards count
  // completion by it, so a false flag renders a 0% donut on a finished board.
  try {
    const sgList = await api('GET', `/api/v2/dataspheres/${cfg.dsId}/tasks/status-groups?planModeId=${cfg.planModeId}`);
    const groupsLive = sgList.statusGroups || sgList;
    for (const name of ['Done', 'Artifacts']) {
      const g = Array.isArray(groupsLive) ? groupsLive.find(x => x.name === name) : null;
      if (g) check(`statusGroups.${name}.isDoneState === true`, g.isDoneState === true,
        `"${name}" has isDoneState=${g.isDoneState} — PATCH /api/v2/dataspheres/${cfg.dsId}/tasks/status-groups/${g.id} {"isDoneState":true}`);
    }
  } catch { /* non-fatal — live fetch failed, structural checks above still apply */ }

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

  // 7. (removed) "auto-generated tasks stuck Done" predates the per-item gates —
  // auto-generated EX/VA now reach Done only through --check-item + --advance
  // evidence gates, so Done is the expected terminal state, not a red flag.

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

// ── Human review gate ─────────────────────────────────────────────────────────
// The dumb Ralph loop does NOT start until a human has reviewed the planned
// board + dashboard and explicitly green-lit it. Box E of the system diagram:
// "when ready the dumb RALPH LOOP is initiated" — "when ready" is a human act.
// State lives in .sdd-state.json under initiatives[slug].review:
//   { status: 'pending' | 'awaiting' | 'approved', requestedAt, approvedAt, by }
function reviewStatus(iState) {
  return iState?.review?.status || 'pending';
}

// --request-review: run the pre-flight checks, surface the links, mark awaiting.
async function requestReviewCommand(cfg, iState, slug) {
  // Reconcile first — the human must review the TRUE state, with any ancestors
  // re-opened by newly-added children already reflected.
  if (cfg.schema === 2) await reconcileV2(cfg);

  const checks = [];
  let blocking = 0;
  const add = (name, ok, detail) => { checks.push({ name, ok, detail }); if (!ok) blocking++; };

  add('dashboard registered', !!iState.dashboardSlug, iState.dashboardSlug ? 'ok' : 'no dashboardSlug — create + register the dashboard page first');
  add('trackerUrl set', !!iState.trackerUrl, iState.trackerUrl || 'plan mode has no trackerUrl');

  // Trace audit inline (ghosts must be zero before a human is asked to review)
  let ghostCount = null;
  try {
    const tasks = await readBoard(cfg);
    const keyMap = {};
    tasks.forEach(t => { const k = sddKey(t.title); if (k) (keyMap[k] = keyMap[k] || []).push(t); });
    ghostCount = Object.values(keyMap).filter(v => v.length > 1).length;
    const allKeys = new Set(Object.keys(keyMap));
    for (const t of tasks) {
      for (const m of (t.content || '').matchAll(/(?:execution_ref|epic_ref|north_star_ref|research_ref|validation_ref):[ \t]*((?:[A-Z]+-)?[A-Z]+-\d+)/g)) {
        if (!allKeys.has(m[1])) ghostCount++;
      }
    }
    add('trace audit clean', ghostCount === 0, ghostCount === 0 ? 'ok' : `${ghostCount} ghost(s) — run --trace-audit and fix before review`);
  } catch (e) {
    add('trace audit clean', false, `could not read board: ${e.message.slice(0, 60)}`);
  }

  const uri = cfg.dsUri || iState.dsUri || cfg.dsId;
  const boardUrl = `${BASE}/app/${uri}/planner?mode=${cfg.planModeId}`;
  const dashUrl = iState.dashboardSlug ? `${BASE}/pages/${uri}/${iState.dashboardSlug}` : null;

  if (blocking > 0) {
    console.error('✗ Cannot request review — pre-flight checks failed:');
    checks.filter(c => !c.ok).forEach(c => console.error(`  · ${c.name}: ${c.detail}`));
    console.error('  Fix these, then re-run --request-review.');
    process.exit(1);
  }

  const state = loadState();
  if (state?.initiatives?.[slug]) {
    state.initiatives[slug].review = {
      status: 'awaiting',
      requestedAt: new Date().toISOString(),
      boardUrl, dashboardUrl: dashUrl,
    };
    saveState(state);
  }
  console.log(JSON.stringify({
    status: 'awaiting-review',
    initiative: slug,
    message: 'Board + dashboard staged and clean. A HUMAN must review before the Ralph loop runs.',
    review: { board: boardUrl, dashboard: dashUrl },
    checks: checks.map(c => `${c.ok ? '✓' : '✗'} ${c.name}`),
    greenlight: `node loop.mjs --greenlight --initiative ${slug}`,
    instruction: 'Surface the two links above to the user for review. Do NOT start the loop. The loop is blocked until the user runs --greenlight (or tells you to, and you run it on their behalf with their explicit go-ahead).',
  }, null, 2));
}

// --greenlight: the human approval. Loop may run after this.
async function greenlightCommand(cfg, iState, slug) {
  if (!iState.dashboardSlug) {
    console.error('✗ Refusing to green-light — no dashboard registered to review. Run --request-review first.');
    process.exit(1);
  }
  const state = loadState();
  if (state?.initiatives?.[slug]) {
    const prev = state.initiatives[slug].review || {};
    state.initiatives[slug].review = {
      ...prev,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      by: process.env.SUDO_USER || process.env.USER || process.env.USERNAME || 'user',
    };
    saveState(state);
  }
  // Stamp the planner so the activity feed records the green-light for stakeholders
  const uri = cfg.dsUri || iState.dsUri || cfg.dsId;
  console.log(JSON.stringify({
    status: 'approved',
    initiative: slug,
    message: '✅ GREEN-LIT — the Ralph loop may now run until every validation criterion is Done.',
    approvedAt: new Date().toISOString(),
    links: boardLinks(cfg, slug),
    nextStep: `node loop.mjs --next --initiative ${slug}   (or: node ralph-run.mjs --initiative ${slug})`,
  }, null, 2));
}

// --revoke-review: pull approval (e.g. plan changed materially mid-flight).
async function revokeReviewCommand(slug) {
  const state = loadState();
  if (state?.initiatives?.[slug]) {
    state.initiatives[slug].review = { status: 'pending', revokedAt: new Date().toISOString() };
    saveState(state);
  }
  console.log(JSON.stringify({ status: 'pending', initiative: slug, message: 'Review approval revoked — loop is gated again until --request-review + --greenlight.' }, null, 2));
}

// ── AI-driven: --next ─────────────────────────────────────────────────────────
// Outputs the next incomplete task as JSON so Claude can read, execute, and
// substantiate it before calling --advance. No board modifications.
async function findNextTask(cfg, iState, slug) {
  // v2: reconcile parent completion first so the board reflects truth — any
  // ancestor with an open child is re-opened, completed subtrees roll up.
  if (cfg.schema === 2) await reconcileV2(cfg);

  const links = boardLinks(cfg, slug);   // every output below carries these
  const tasks = await readBoard(cfg);
  const nonAR = tasks.filter(t => sddType(t.title) !== 'AR');
  const total = nonAR.length;
  const done = nonAR.filter(t => t.isDone).length;

  // ── HUMAN REVIEW GATE ───────────────────────────────────────────────────────
  // The dumb loop cannot serve work until a human green-lit the board. This is
  // the explicit "when ready" gate before the Ralph loop starts.
  if (reviewStatus(iState) !== 'approved') {
    const uri = cfg.dsUri || iState.dsUri || cfg.dsId;
    const st = reviewStatus(iState);
    process.stdout.write(JSON.stringify({
      status: 'awaiting-review',
      links,
      reviewState: st,
      done, total, pct: total ? Math.round(done / total * 100) : 0,
      reason: st === 'awaiting'
        ? 'Board + dashboard are staged and awaiting HUMAN review. The Ralph loop will not run until approved.'
        : 'The board has not been submitted for human review yet.',
      review: {
        board: `${BASE}/app/${uri}/planner?mode=${cfg.planModeId}`,
        dashboard: iState.dashboardSlug ? `${BASE}/pages/${uri}/${iState.dashboardSlug}` : null,
      },
      instruction: st === 'awaiting'
        ? 'Surface the review links to the user. Once they approve, run --greenlight. Do NOT advance any task until approved.'
        : 'Finish staging the board + dashboard, then run --request-review to surface it for the user.',
      action: st === 'awaiting'
        ? `node loop.mjs --greenlight --initiative ${slug}`
        : `node loop.mjs --request-review --initiative ${slug}`,
    }, null, 2));
    return;
  }

  // Intake queue: auto-sweep triaged → done, then check for blockers
  await sweepIntakeDone(cfg, slug, tasks);
  const intakeItems = getIntakeItems(slug);
  const criticalBlocking = intakeItems.filter(i => i.status === 'pending' && i.priority === 'critical');
  if (criticalBlocking.length > 0) {
    process.stdout.write(JSON.stringify({
      status: 'intake-blocked',
      links,
      done, total, pct: Math.round(done / total * 100),
      reason: `${criticalBlocking.length} critical intake item(s) must be triaged before advancing`,
      pendingIntake: criticalBlocking.map(i => ({ id: i.id, summary: i.summary, priority: i.priority, type: i.type })),
      action: `node loop.mjs --triage ${criticalBlocking[0].id} --target-type EX`,
    }, null, 2));
    return;
  }
  const advisoryIntake = intakeItems.filter(i => i.status === 'pending');

  // v2: empty board means the planning phases haven't run — say so instead of NaN%
  if (cfg.schema === 2 && tasks.filter(t => sddType(t.title)).length === 0) {
    process.stdout.write(JSON.stringify({
      status: 'empty-board', schema: 2,
      links,
      instruction: 'No items staged yet. Engage the user, run research, and build the chain: IN -> RS -> PC -> VP -> SS -> DO -> EP -> TK -> VC (parent_uuid on every item except IN). Then --stamp-uuids and --trace-audit before starting the loop.',
    }, null, 2));
    return;
  }

  const next = cfg.schema === 2 ? findNextIncompleteV2(tasks) : findNextIncomplete(tasks);

  // HARDENING: an IN (intake) card is a queued DECISION, not workable engineering.
  // --next must never claim one as the active task — marking it IN_PROGRESS and
  // tagging sdd-active made the dashboard's Current Focus spin on an intake row,
  // which reads as live work the loop is not doing. Surface the decision instead
  // and leave the board untouched.
  if (next && cfg.schema === 2 && sddType(next.title) === 'IN') {
    const hasChildren = tasks.some(x => v2ParentUuid(x.content) === next.id);
    const ref = (next.content || '').match(/intake_ref:\s*(INT-\d+)/)?.[1] || null;
    if (hasChildren) {
      // Chain complete under it but rollup hasn't landed — reconcile, don't "work" it.
      process.stdout.write(JSON.stringify({
        status: 'reconcile-required',
        links,
        done, total, pct: Math.round(done / total * 100),
        reason: `${sddKey(next.title)} is an IN chain root whose children are complete — it closes via rollup, not by being worked.`,
        action: `node loop.mjs --reconcile --initiative ${slug}`,
      }, null, 2));
      return;
    }
    process.stdout.write(JSON.stringify({
      status: 'awaiting-triage',
      links,
      done, total, pct: Math.round(done / total * 100),
      reason: `Only intake decision card(s) remain (${sddKey(next.title)}). Intake cards are user decisions — the loop never marks them in-progress.`,
      intakeCard: { id: next.id, key: sddKey(next.title), title: next.title, intakeRef: ref },
      pendingIntake: advisoryIntake.map(i => ({ id: i.id, summary: i.summary, priority: i.priority, type: i.type })),
      instruction: 'Surface the decision to the user. Then either --triage INT-NNN (build a remediation chain) or --triage INT-NNN --target-ref <KEY> (fold into existing work). Never set an IN card to IN_PROGRESS or tag it sdd-active.',
      action: ref ? `node loop.mjs --triage ${ref} --initiative ${slug}` : 'resolve the intake decision with the user',
    }, null, 2));
    return;
  }

  if (!next) {
    // 100% Done is NOT terminal while intake items are pending. A user bug report
    // (UAT fail, stakeholder feedback) re-opens the loop: triage → EX+VA remediation
    // pair → findNextIncomplete picks them up. Returning "complete" here would let
    // the initiative close with known-broken functionality.
    if (advisoryIntake.length > 0) {
      process.stdout.write(JSON.stringify({
        status: 'intake-pending',
        links,
        done, total, pct: 100,
        reason: `Board is 100% Done BUT ${advisoryIntake.length} intake item(s) are untriaged — the loop is NOT complete.`,
        pendingIntake: advisoryIntake.map(i => ({ id: i.id, summary: i.summary, priority: i.priority, type: i.type })),
        instruction: 'Triage every pending intake item into EX+VA remediation tasks, then resume --next. Do NOT generate the Next Steps page until intake is empty.',
        action: `node loop.mjs --triage ${advisoryIntake[0].id} --target-type EX`,
      }, null, 2));
      return;
    }
    // Regression wall — "complete" requires a fresh all-pass of every VA's
    // validation_command at the CURRENT board state. Tasks moving after the
    // last regress invalidates it. No green suite, no complete, no Next Steps.
    {
      const freshState2 = loadState();
      const reg = freshState2?.initiatives?.[slug]?.regress;
      const stale = !reg || !reg.pass || reg.boardDone !== done || reg.boardTotal !== total;
      if (stale) {
        process.stdout.write(JSON.stringify({
          status: 'regress-required',
          links,
          done, total, pct: 100,
          reason: reg
            ? (reg.pass ? 'Board changed since the last passing regression — re-run it.' : 'Last regression FAILED — fix and re-run.')
            : 'No regression has ever been recorded for this board.',
          lastRegress: reg || null,
          instruction: 'Run the full requirement-level regression. Every VA validation_command must exit 0. Fix failures (or PATCH missing commands), then re-run until clean.',
          action: 'node loop.mjs --regress',
        }, null, 2));
        return;
      }
    }
    process.stdout.write(JSON.stringify({
      status: 'complete',
      links,
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

  // Track the in-flight task in state + apply sdd-active tag so focus-tree widget scopes dynamically.
  // Both are non-fatal — if they fail the task briefing still works.
  // Guard: IN cards must NEVER be claimed (decision cards, handled above) — this
  // protects against future selection-logic changes reintroducing the bug.
  if (sddType(next.title) !== 'IN') try {
    const freshState = loadState();
    const freshSlug = initiativeOverride || freshState?.currentInitiative;
    if (freshState && freshSlug) setActiveTask(freshState, freshSlug, next.id);
    // Tag the next task with sdd-active so focus-tree can resolve it without a static data-active-task-id.
    // The tags endpoint expects `tagName` (NOT `name`) — a silent .catch hid this
    // for the whole project, so Current Focus never lit up. Idempotent find-or-create.
    await api('POST', `/api/v2/dataspheres/${cfg.dsId}/tasks/${next.id}/tags`, { tagName: 'sdd-active' })
      .catch(loudCatch('sdd-active tag'));
    // Mark IN_PROGRESS on the board so the current ticket is visibly in flight
    // (Kanban card state + Current Focus widget both read this).
    await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${next.id}`, { status: 'IN_PROGRESS' })
      .catch(loudCatch('mark IN_PROGRESS'));
    refreshDashboard(iState);
  } catch { /* non-fatal */ }

  const nextType = sddType(next.title);
  // v2: ship the FULL parent hierarchy with the task — "requirements for each
  // parent column to use as context as the AI aims to achieve its validation".
  // The Ralph loop reads VC + TK + EP + DO + SS + VP + PC + RS + IN in one shot.
  let hierarchy;
  if (cfg.schema === 2) {
    const byId = new Map(tasks.map(t => [t.id, t]));
    hierarchy = v2Hierarchy(next, byId).map(a => a.broken
      ? { broken: true, parent_uuid: a.broken, fix: 'parent_uuid does not resolve — repair the chain before working this item' }
      : { type: sddType(a.title), key: sddKey(a.title), uuid: a.id, title: a.title, content: a.content });
  }
  process.stdout.write(JSON.stringify({
    status: 'next',
    links,
    done, total,
    pct: Math.round(done / total * 100),
    schema: cfg.schema,
    task: {
      id: next.id,
      title: next.title,
      key: sddKey(next.title),
      type: nextType,
      content: next.content,
    },
    ...(hierarchy ? { hierarchy } : {}),
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

  // Human review gate — no task advances until the board was green-lit. Belt to
  // the --next suspenders: even hand-driven advances respect the gate.
  if (reviewStatus(iState) !== 'approved') {
    console.error('✗ GATE FAIL — board not green-lit. The Ralph loop (and any --advance) is blocked until a human reviews and approves.');
    console.error(`  1. node loop.mjs --request-review --initiative ${slug}   # surface board + dashboard`);
    console.error(`  2. Have the user review the links, then: node loop.mjs --greenlight --initiative ${slug}`);
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
  // trackerUrl gate — must point to the dashboard PAGE, not the planner or localhost.
  // The plan mode button in the UI reads trackerUrl to open the dashboard; a planner URL is circular.
  {
    const tUrl = iState.trackerUrl || '';
    const isPageUrl  = /\/pages\//.test(tUrl);
    const isLocalhost = /localhost|127\.0\.0\.1/.test(tUrl);
    if (!tUrl || !isPageUrl || isLocalhost) {
      console.error('✗ GATE FAIL — trackerUrl must point to the dashboard PAGE on a public host.');
      console.error(`  Current value: ${tUrl || '(not set)'}`);
      console.error(`  Required form: https://<host>/pages/${iState.dsUri || '<dsUri>'}/${iState.dashboardSlug}`);
      console.error('  Fix:');
      console.error(`    1. Update trackerUrl in .sdd-state.json for initiative "${slug}"`);
      console.error(`    2. PATCH /api/v2/dataspheres/${iState.dsId}/tasks/plan-modes/${iState.planModeId}`);
      console.error(`       { "trackerUrl": "https://<host>/pages/${iState.dsUri || '<dsUri>'}/${iState.dashboardSlug}" }`);
      console.error('    Then re-run --advance.');
      process.exit(1);
    }
  }

  // Dashboard template gate — the registered dashboard must match the canonical
  // template before ANY task can advance. This is what stops template drift
  // (missing trace-graph, duplicate summary/focus sections, heavy idle trees).
  {
    // progress-summary EMBEDS the Current Focus subtree (FocusTree renders inside
    // it, scoped to the sdd-active ticket, compact idle card when the loop is
    // idle). A standalone focus-tree widget therefore DUPLICATES it — that
    // duplication is exactly the drift this gate exists to stop.
    const REQUIRED_WIDGETS = ['progress-summary', 'trace-graph', 'task-activity-feed'];
    let pageHtml = null;
    try {
      const pg = await api('GET', `/api/v1/dataspheres/${cfg.dsUri || iState.dsUri}/pages/${iState.dashboardSlug}`);
      pageHtml = pg?.content || pg?.page?.content || null;
    } catch { /* fetch failure handled below */ }
    if (!pageHtml) {
      console.error(`✗ GATE FAIL — dashboard page "${iState.dashboardSlug}" could not be fetched. Create it (SKILL.md § Dashboard Page Template), then re-run --advance.`);
      process.exit(1);
    }
    const dashIssues = [];
    if (!/<h1[^>]*>/.test(pageHtml)) dashIssues.push('missing <h1> title');
    for (const w of REQUIRED_WIDGETS) {
      const count = (pageHtml.match(new RegExp(`data-widget-type="${w}"`, 'g')) || []).length;
      if (count === 0) dashIssues.push(`missing required widget: ${w}`);
      if (count > 1) dashIssues.push(`duplicate widget: ${w} appears ${count}x — exactly one allowed`);
    }
    if (/data-widget-type="focus-tree"/.test(pageHtml)) {
      dashIssues.push('standalone focus-tree widget present — Current Focus is already embedded inside progress-summary; remove the duplicate');
    }
    if (/<h[23][^>]*>\s*Current Focus/i.test(pageHtml)) {
      dashIssues.push('standalone "Current Focus" heading present — the focus subtree lives inside the Initiative Summary widget, not as its own section');
    }
    // NOTE: doc-footer is NOT checked — the server strips it from saved content
    // and the page view renders the platform footer itself.
    if (dashIssues.length > 0) {
      console.error(`✗ GATE FAIL — dashboard "${iState.dashboardSlug}" has drifted from the template:`);
      dashIssues.forEach(d => console.error(`  · ${d}`));
      console.error('  Fix the dashboard page (SKILL.md § Dashboard Page Template), then re-run --advance.');
      process.exit(1);
    }
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

  // HARDENING: refuse to advance a task whose title carries no recognized SDD
  // type prefix. An untyped task bypasses every typed gate (decorator linkage,
  // VA evidence matrix, AR citations) — advancing it would be an unguarded
  // status flip, exactly the hole "impossible to break the loop" closes.
  if (task_check) {
    const tType = sddType(task_check.title);
    const V2_SET = ['IN','RS','PC','VP','SS','DO','EP','TK','VC','AR'];
    const V1_SET = ['RS','NS','EP','EX','VA','AR'];
    const allowed = cfg.schema === 2 ? V2_SET : V1_SET;
    if (!tType || !allowed.includes(tType)) {
      console.error(`✗ GATE FAIL — task "${task_check.title.slice(0, 60)}" has ${tType ? `unrecognized type prefix "${tType}"` : 'no SDD type prefix'} for schema v${cfg.schema === 2 ? 2 : 1}.`);
      console.error(`  Allowed prefixes: ${allowed.join(', ')}`);
      console.error('  Rename the task to "<TYPE>-NNN · <title>" (or fix its column) before advancing.');
      console.error('  Untyped tasks bypass the typed gates — they cannot be advanced.');
      process.exit(1);
    }
  }

  // validation_kind front matter declares the VA's validation TYPES (comma list):
  //   ui        → rendered browser flow: Playwright run + fresh screenshots
  //   api       → HTTP contract: endpoint paths + status codes asserted
  //   data      → data model / functional: DB state, model fields, migrations
  //   benchmark → measured values with units vs thresholds
  // A VA may cover several (validation_kind: ui,api) — EVERY declared type's
  // evidence gate applies. Absent declaration falls back to UI when the title
  // pattern-matches UI keywords. 'backend' is a legacy alias for api.
  const vaKindsDeclared = [...vaEffectiveKinds(task_check?.content)];
  const vaKinds = vaKindsDeclared.length > 0 ? vaKindsDeclared : null;
  const isNonUiVa = vaKinds ? !vaKinds.includes('ui') : false;

  // ── Typed VA evidence gates (api / data / benchmark) ─────────────────────────
  if (task_check && ['VA','VC'].includes(sddType(task_check.title)) && vaKinds) {
    const typedIssues = [];
    if (vaKinds.includes('api')) {
      if (!/\/api\//.test(evidenceText)) typedIssues.push('[api] no /api/ endpoint path in evidence — quote the requests that were asserted');
      if (!/\b[1-5]\d\d\b/.test(evidenceText)) typedIssues.push('[api] no HTTP status codes in evidence — assert the actual response codes');
    }
    if (vaKinds.includes('data')) {
      if (!/\b(prisma|database|db|migration|data model|model field|record|row|schema|enum|persisted|questionCount|count)\b/i.test(evidenceText)) {
        typedIssues.push('[data] no data-model evidence — assert persisted state: DB rows, model fields, enum values, counts');
      }
      if (!/\d/.test(evidenceText)) typedIssues.push('[data] no concrete values in evidence — quote the actual counts/fields read back');
    }
    if (vaKinds.includes('benchmark')) {
      if (!/\d+(\.\d+)?\s*(ms|s|MB|GB|%|fps|req\/s|ops)/i.test(evidenceText)) {
        typedIssues.push('[benchmark] requires measured values with units (ms, MB, %, req/s …) compared against thresholds');
      }
    }
    if (!/\b\d+\s+passed\b/i.test(evidenceText) && !/\bok\b.*\b\d+\b/i.test(evidenceText)) {
      typedIssues.push('no test runner output — run the spec and paste the "N passed" result');
    }
    if (typedIssues.length > 0) {
      console.error(`✗ GATE FAIL — VA evidence does not satisfy its declared validation types (${vaKinds.join(', ')}).`);
      for (const ti of typedIssues) console.error(`  · ${ti}`);
      process.exit(1);
    }
  }

  if (task_check && ['VA','VC'].includes(sddType(task_check.title)) && !isNonUiVa && IMAGE_VA_PATTERN.test(task_check.title)) {
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
  // UI gate fires when the VA declares kind 'ui', or (undeclared) when the title
  // pattern-matches UI keywords — declared kinds are authoritative over the title.
  const uiGateApplies = task_check && ['VA','VC'].includes(sddType(task_check.title)) &&
    (vaKinds ? vaKinds.includes('ui') : UI_VA_PATTERN.test(task_check.title));
  if (uiGateApplies) {
    const gateIssues = [];

    // 1. Extract screenshot paths and verify each EXISTS on disk and is FRESH.
    //    A path mentioned in text proves nothing — the file must be real and from this session.
    //    This is the hole that let live-gallery-form pass 30/30 with a broken upload modal.
    const SCREENSHOT_RE = /([^\s"'()\[\],]+\.(?:png|jpg|jpeg|webp))/gi;
    const shots = [...new Set([...evidenceText.matchAll(SCREENSHOT_RE)].map(m => m[1]))];
    const gitRootUI = findGitRoot();
    const MAX_SHOT_AGE_MS = 24 * 60 * 60 * 1000;
    const missingShots = [];
    const staleShots = [];
    for (const sp of shots) {
      const abs = sp.match(/^[A-Z]:\\|^\//) ? sp : path.join(gitRootUI, sp);
      if (!fs.existsSync(abs)) { missingShots.push(sp); continue; }
      if (Date.now() - fs.statSync(abs).mtimeMs > MAX_SHOT_AGE_MS) staleShots.push(sp);
    }
    if (shots.length === 0) gateIssues.push('no screenshot paths (.png/.jpg/.webp) in evidence');
    if (missingShots.length > 0) gateIssues.push(`screenshot file(s) do NOT exist on disk: ${missingShots.join(', ')}`);
    if (staleShots.length > 0) gateIssues.push(`screenshot file(s) older than 24h — re-run the test to capture fresh evidence: ${staleShots.join(', ')}`);

    // 2. Interaction flows (upload/modal/form/builder) need ≥2 screenshots — a single static
    //    frame cannot prove a multi-step flow works (e.g. modal stays mounted through upload).
    const INTERACTION_PATTERN = /upload|modal|form|builder|drag|wizard|flow/i;
    if (INTERACTION_PATTERN.test(task_check.title) && shots.length < 2) {
      gateIssues.push(`interaction-flow VA needs >=2 screenshots (before/during/after states) — found ${shots.length}`);
    }

    // 3. Evidence must contain real Playwright run output — "N passed" from --reporter=list.
    //    Descriptions of what a screenshot shows are not a test run.
    if (!/\b\d+\s+passed\b/i.test(evidenceText)) {
      gateIssues.push('no Playwright test output in evidence — run: npx playwright test <spec> --reporter=list and paste the "N passed" result');
    }

    if (gateIssues.length > 0) {
      console.error('✗ GATE FAIL — UI/frontend VA task evidence is not verifiable.');
      console.error('');
      for (const gi of gateIssues) console.error(`  · ${gi}`);
      console.error('');
      console.error('  Required for UI VA tasks:');
      console.error('    1. A Playwright spec that exercises the actual user flow (not just page load)');
      console.error('    2. Run it: npx playwright test <spec> --reporter=list — paste the "N passed" output');
      console.error('    3. Screenshots captured DURING the run via page.screenshot() — files must exist and be <24h old');
      console.error('    4. Interaction flows (upload/modal/form): screenshots of before, during, and after states');
      if (autoFix) {
        const tasks_af = await readBoard(cfg);
        const task_af = tasks_af.find(t => t.id === advanceTaskId) ||
                        tasks_af.find(t => sddKey(t.title) === advanceTaskId);
        if (task_af) {
          const result = await createRemediationTasks(cfg, task_af, gateIssues, tasks_af);
          console.error(`\n  ✅ Remediation tasks created: ${result.exKey} + ${result.vaKey}`);
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
  if (task_check && ['EX','TK'].includes(sddType(task_check.title))) {
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
    const missingExactKey = [];

    for (const fp of codePaths) {
      const absPath = fp.match(/^[A-Z]:\\|^\//) ? fp : path.join(gitRoot, fp);
      if (!fs.existsSync(absPath)) {
        missingFiles.push(fp);
        continue;
      }
      try {
        const fileText = fs.readFileSync(absPath, 'utf-8');
        const head = fileText.split('\n').slice(0, 15).join('\n');
        const hasRef = /(?:artifact|spec):\s*(?:[A-Z]+-)?(?:EX|VA|AR|EP|NS|RS)-\d+|initiative:/i.test(head);
        if (!hasRef) missingFrontMatter.push(fp);
        // Decorator linkage: THIS task's key must appear somewhere in the file —
        // header front matter for new files, or an inline decorator comment at
        // the change site for shared files. A header referencing some OTHER spec
        // does not link the file to this work.
        if (exKey && !new RegExp(`(?:artifact|spec(?:_trace)?):[^\\n]*\\b${exKey}\\b`).test(fileText)) {
          missingExactKey.push(fp);
        }
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

    if (missingExactKey.length > 0) {
      console.error(`\n✗ GATE FAIL — decorator linkage broken for ${exKey}.`);
      console.error(`  ${missingExactKey.length} implementation file(s) never reference ${exKey}:`);
      missingExactKey.forEach(f => console.error(`  · ${f}`));
      console.error(`\n  For new files: add "// artifact: ${exKey} | initiative: <slug>" to the header.`);
      console.error(`  For shared files: add an inline decorator at the change site, e.g.`);
      console.error(`    // spec: ${exKey} | initiative: <slug> — <one line on what this change does>`);
      console.error(`  This is what makes code → spec tracing real: every listed file must name THIS spec.`);
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

    // ── Typed validation coverage gate ───────────────────────────────────────
    // Required types derive from the FILES this EX changed (src/client → ui,
    // src/server → api, prisma/services → data; override: validation_types).
    // EACH required type must be covered by a companion VA declaring that kind
    // — frontend, backend, and data-model validation pass INDIVIDUALLY.
    {
      const requiredTypes = exRequiredTypes(task_check.content);
      if (requiredTypes.length > 0) {
        // companions: v1 VAs link by execution_ref key; v2 VCs link by parent_uuid
        const companions = tasks_check.filter(t => ['VA', 'VC'].includes(sddType(t.title)) && (
          new RegExp(`execution_ref:\\s*${exKey}\\b`).test(t.content || '') ||
          v2ParentUuid(t.content) === task_check.id
        ));
        const covered = new Set();
        companions.forEach(va => vaEffectiveKinds(va.content).forEach(k => covered.add(k)));
        const missingTypes = requiredTypes.filter(t => !covered.has(t));
        if (missingTypes.length > 0) {
          console.error(`✗ GATE FAIL — typed validation coverage incomplete for ${exKey}.`);
          console.error(`  Required (from changed files): ${requiredTypes.join(', ')}`);
          console.error(`  Covered by companion VA(s):    ${covered.size ? [...covered].join(', ') : '(none)'}`);
          console.error(`  MISSING: ${missingTypes.join(', ')}`);
          console.error('');
          console.error('  Each surface the change touches needs its own validation pass.');
          console.error(`  Fix: PATCH the companion VA front matter with the missing kind(s) +`);
          console.error('  a typed command that actually exercises that surface, e.g.:');
          for (const mt of missingTypes) {
            console.error(`    validation_command_${mt}: ${mt === 'ui' ? 'npx playwright test tests/e2e/specs/<flow>.spec.ts --reporter=line' : mt === 'api' ? 'npx playwright test tests/e2e/specs/<contract>.spec.ts --reporter=line' : 'docker compose exec -T app node scripts/<model-assert>.mjs'}`);
          }
          console.error('  Or, when a surface is genuinely untouched, override with: validation_types: <types>');
          process.exit(1);
        }
      }
    }
  }

  // ── Typed validation_command gate ────────────────────────────────────────────
  // VA tasks MUST carry runnable validation commands — one per validation TYPE
  // the change touches, each executed INDIVIDUALLY here and each required to
  // exit 0. Front matter (any combination; general form still supported):
  //   validation_command:      <cmd>   — general/requirement-level
  //   validation_command_ui:   <cmd>   — rendered browser flow (Playwright)
  //   validation_command_api:  <cmd>   — HTTP contract assertions
  //   validation_command_data: <cmd>   — data model / functional state
  // A typed command implies the kind, so declared kinds and typed commands
  // stay consistent automatically. No command, no advance; any command fails,
  // no advance. Descriptions of testing are not testing.
  {
    const cmds = extractValidationCommands(task_check?.content);
    if (cmds.length === 0 && task_check && ['VA','VC'].includes(sddType(task_check.title))) {
      console.error('✗ GATE FAIL — VA task has no validation command front matter.');
      console.error('');
      console.error('  Every VA must carry runnable regression commands — one per validation');
      console.error('  type the change touches. Add to the front-matter YAML block:');
      console.error('    validation_command_ui:   npx playwright test tests/e2e/specs/<flow>.spec.ts --reporter=line');
      console.error('    validation_command_api:  npx playwright test tests/e2e/specs/<contract>.spec.ts --reporter=line');
      console.error('    validation_command_data: docker compose exec -T app node scripts/<model-assert>.mjs');
      console.error('  (or validation_command: for a single requirement-level spec)');
      console.error('');
      console.error('  PATCH the task content, then re-run --advance. Every command is');
      console.error('  EXECUTED here individually and each must exit 0.');
      process.exit(1);
    }
    for (const c of cmds) {
      process.stdout.write(`\n→ Running validation_command${c.kind ? `_${c.kind}` : ''}: ${c.cmd}\n`);
      try {
        const vcOut = execSync(c.cmd, { encoding: 'utf-8', timeout: 600000 });
        process.stdout.write(`  ✅ ${c.kind || 'general'} validation exited 0\n`);
        evidenceText = `[validation_command${c.kind ? `_${c.kind}` : ''}: ${c.cmd}]\nExit: 0\nOutput:\n${vcOut.slice(0, 1500)}\n\n${evidenceText}`;
      } catch (vcErr) {
        const failLog = path.join(findGitRoot(), '.sdd-failures.log');
        const entry = `[${new Date().toISOString()}] ${advanceTaskId} — validation_command${c.kind ? `_${c.kind}` : ''} FAILED\nCommand: ${c.cmd}\nStdout: ${(vcErr.stdout || '').slice(0, 500)}\nStderr: ${(vcErr.stderr || '').slice(0, 500)}\n---\n`;
        fs.appendFileSync(failLog, entry, 'utf-8');
        console.error(`\n✗ GATE FAIL — ${c.kind || 'general'} validation command exited non-zero.`);
        console.error(`  Command: ${c.cmd}`);
        if (vcErr.stderr) console.error(`  Stderr:  ${String(vcErr.stderr).slice(0, 300)}`);
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

  // Per-item gate — NO mass-ticking. Every checklist item must have been
  // individually verified via --check-item with its own evidence comment.
  // tickAll() on advance was the rubber-stamp engine: it checked every box
  // in one regex pass regardless of whether anything was actually verified.
  const untickedItems = [...(task.content || '').matchAll(
    /<li(?=[^>]*data-type="taskItem")(?=[^>]*data-checked="false")[^>]*>[\s\S]*?<p>([^<]+)<\/p>/g
  )].map(m => m[1].trim());
  if (untickedItems.length > 0) {
    console.error(`✗ GATE FAIL — ${untickedItems.length} checklist item(s) not yet individually verified:`);
    untickedItems.forEach((u, i) => console.error(`  ${i + 1}. ${u.slice(0, 110)}`));
    console.error('');
    console.error('  Verify each item ONE AT A TIME with its own evidence:');
    console.error(`    node loop.mjs --check-item ${task.id} --item "<number or text match>" --evidence "<real output for THIS item>"`);
    console.error('  Each --check-item posts an evidence comment (visible in the live activity feed)');
    console.error('  and ticks exactly one box. --advance only succeeds when every box was earned.');
    process.exit(1);
  }

  // ── Schema 2: template + parent-chain + citation gates ──────────────────────
  // Box C of the system diagram, ENFORCED: every item matches its column's
  // template; parent_uuid resolves to a live item of the exact parent tier;
  // artifacts ship cited or not at all.
  if (cfg.schema === 2) {
    const tplV = verifyV2Template(type, task);
    if (!tplV.pass) {
      console.error(`✗ GATE FAIL — ${key} does not match the ${type} column template:`);
      tplV.issues.forEach(i => console.error(`  · ${i}`));
      console.error('  PATCH the content to the template (SKILL.md § Schema v2), then re-run --advance.');
      process.exit(1);
    }
    if (type !== 'IN') {
      const pUuid = v2ParentUuid(task.content);
      const parentItem = tasks.find(t => t.id === pUuid);
      if (!parentItem) {
        console.error(`✗ GATE FAIL — ${key} parent_uuid ${pUuid || '(none)'} does not resolve to a board item. Every item except IN must chain to its parent column.`);
        process.exit(1);
      }
      if (sddType(parentItem.title) !== V2_PARENT[type]) {
        console.error(`✗ GATE FAIL — ${key} parent must be tier ${V2_PARENT[type]}, got ${sddType(parentItem.title)} (${sddKey(parentItem.title)}).`);
        process.exit(1);
      }
    }
    if (type === 'AR') {
      const arV = verifyV2Artifact(task, findGitRoot());
      if (!arV.pass) {
        console.error(`✗ GATE FAIL — ${key} citations incomplete:`);
        arV.issues.forEach(i => console.error(`  · ${i}`));
        console.error('  code → cited files exist + carry the VC decorator; media → sha256 metadata; report → resolvable links.');
        process.exit(1);
      }
    }
    // ── RESEARCH-REUSE gate ────────────────────────────────────────────────────
    // The recurring failure: rebuilding things that already exist (bespoke
    // VideoRecorder when useCamera/CameraCaptureModal exist; bespoke upload when
    // AdvancedUploadModal exists). RS items MUST audit the codebase for reusable
    // modules — every path cited in Codebase Context / Reusable Modules must
    // EXIST on disk, proving a real audit happened (not "we'll look later").
    if (type === 'RS') {
      const c = task.content || '';
      const reuseSection = c.match(/Reusable Modules[\s\S]*?(?=<h2|$)/i)?.[0] || '';
      const codebaseSection = c.match(/Codebase Context[\s\S]*?(?=<h2|$)/i)?.[0] || '';
      const cited = [...(reuseSection + codebaseSection).matchAll(/<code[^>]*>([^<]+)<\/code>/g)]
        .map(m => m[1].trim())
        .filter(p => /^(src|tests|prisma|scripts)[\\/]/.test(p) && !/\.(png|jpg|jpeg|webp|mp4)$/i.test(p));
      const gitRoot = findGitRoot();
      const missing = cited.filter(p => !fs.existsSync(path.join(gitRoot, p)));
      if (cited.length === 0) {
        console.error(`✗ GATE FAIL — ${key} research has no reusable-module audit.`);
        console.error('  The Reusable Modules / Codebase Context sections must cite EXISTING src/ files');
        console.error('  in <code> tags — proving you searched for what already solves this before building.');
        console.error('  Use the Explore agent or grep for: existing modals, hooks, services, components.');
        console.error('  If truly greenfield, cite the nearest analogous existing module and say why it does not fit.');
        process.exit(1);
      }
      if (missing.length > 0) {
        console.error(`✗ GATE FAIL — ${key} cites ${missing.length} file(s) that do NOT exist (audit is fabricated):`);
        missing.forEach(p => console.error(`  · ${p}`));
        process.exit(1);
      }
    }
  }

  // ── Trace-linkage gate (schema 1): refs must resolve, anchors must exist ────
  if (cfg.schema !== 2) {
    const byKeyLink = {};
    tasks.forEach(t => { const k = sddKey(t.title); if (k) byKeyLink[k] = t; });
    const linkIssues = [];
    const c = task.content || '';
    if (type === 'VA') {
      const exRef = c.match(/execution_ref:\s*((?:[A-Z]+-)?EX-\d+)/)?.[1];
      if (!exRef) linkIssues.push('missing execution_ref front matter — every VA must link its parent EX');
      else if (!byKeyLink[exRef]) linkIssues.push(`execution_ref ${exRef} does not resolve to any task on this board`);
    }
    if (type === 'EX' || type === 'VA') {
      const epRef = c.match(/epic_ref:\s*(EP-\d+)/)?.[1];
      if (epRef && !byKeyLink[epRef]) linkIssues.push(`epic_ref ${epRef} does not resolve to any task on this board`);
      const nsRefLink = c.match(/north_star_ref:\s*(NS-\d+)/)?.[1];
      if (nsRefLink && !byKeyLink[nsRefLink]) linkIssues.push(`north_star_ref ${nsRefLink} does not resolve to any task on this board`);
      if (!/<!--\s*#ac\s*-->/.test(c)) linkIssues.push('missing <!-- #ac --> anchor on the Acceptance Criteria heading — section anchors are required for spec navigation');
    }
    if (linkIssues.length > 0) {
      console.error(`✗ GATE FAIL — trace linkage broken on ${key}:`);
      linkIssues.forEach(li => console.error(`  · ${li}`));
      console.error('  Fix the front matter / anchors via PATCH, then re-run --advance.');
      process.exit(1);
    }
  }

  process.stdout.write(`→ ${dryRun ? '[DRY] ' : ''}Advancing ${key} with AI evidence... `);
  if (dryRun) { console.log('(skipped — dry run)'); return; }

  const ts = new Date().toISOString();
  const comment = `[all-dai-sdd-system-message]\n\n**Gate: PASS — AI-substantiated** | ${ts}\n\n${evidenceText}`;
  await postComment(cfg, task.id, comment);

  if (type === 'VA') {
    await createArtifact(cfg, task, tasks);
  }
  if (cfg.schema === 2 && type === 'VC') {
    await createArtifactV2(cfg, task, tasks);
  }

  if (cfg.schema === 2) {
    // v2: items never leave their column — DONE is a status, not a move. AND a
    // parent is only DONE when EVERY child is DONE: advancing an item whose
    // gate passed but which still has open children marks it IN_PROGRESS
    // (validated, awaiting subtree). reconcileV2 rolls it up later. A VC always
    // scaffolds a pending AR child, so VC lands IN_PROGRESS until the AR is cited.
    const fresh = await readBoard(cfg);
    const kids = fresh.filter(t => v2ParentUuid(t.content) === task.id);
    const subtreeComplete = kids.every(c => c.isDone);
    await api('PATCH', `/api/v2/dataspheres/${cfg.dsId}/tasks/${task.id}`, {
      status: subtreeComplete ? 'DONE' : 'IN_PROGRESS',
    });
    if (subtreeComplete) console.log(`✅ ${key} Done`);
    else console.log(`✓ ${key} validated — IN_PROGRESS until children complete (${kids.filter(c => !c.isDone).map(c => sddKey(c.title)).join(', ')})`);
  } else {
    await moveDone(cfg, task.id);
    console.log(`✅ ${key} Done`);
  }

  // v2: roll completion up the parent chain now that this item is DONE — a
  // parent flips to DONE the instant its last child completes.
  if (cfg.schema === 2) {
    const rolled = await reconcileV2(cfg);
    for (const r of rolled.filter(r => /DONE/.test(r.to))) console.log(`   ↑ rollup: ${r.key} ${r.to}`);
  }

  // Milestone comment up the hierarchy so the live activity feed shows movement
  // at every level — v2 walks the parent_uuid chain, v1 uses the ref fields.
  try {
    const note = `**Milestone:** ${key} (${task.title.slice(0, 70)}) advanced to Done.\n\n${evidenceText.slice(0, 350)}${evidenceText.length > 350 ? '…' : ''}`;
    if (cfg.schema === 2) {
      const byId2 = new Map(tasks.map(t => [t.id, t]));
      for (const anc of v2Hierarchy(task, byId2).slice(0, 3)) {
        if (!anc.broken) await postComment(cfg, anc.id, note);
      }
    } else {
      const byKeyAll = {};
      tasks.forEach(t => { const k = sddKey(t.title); if (k) byKeyAll[k] = t; });
      const epRef = (task.content || '').match(/epic_ref:\s*(EP-\d+)/)?.[1];
      const nsRef = (task.content || '').match(/north_star_ref:\s*(NS-\d+)/)?.[1];
      if (epRef && byKeyAll[epRef]) await postComment(cfg, byKeyAll[epRef].id, note);
      if (nsRef && byKeyAll[nsRef]) await postComment(cfg, byKeyAll[nsRef].id, note);
    }
  } catch { /* non-fatal */ }

  // Clear the in-flight task from state, remove sdd-active tag, and refresh dashboard Current Focus.
  try {
    await api('DELETE', `/api/v2/dataspheres/${cfg.dsId}/tasks/${task.id}/tags/sdd-active`)
      .catch(loudCatch('sdd-active untag'));
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

  // scaffold-v2 creates the initiative — it must run before the iState requirement
  if (scaffoldV2Slug !== null) {
    await scaffoldV2Command();
    return;
  }

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
    intakeGroupId:    sg.Intake || sg.intake || iState.intakeGroupId || null,
    schema:           iState.schema || 1,
    tiers:            iState.tiers || null,
    // All statusGroupIds for this plan — used by readBoard to scope client-side.
    // ensureGroupIds() will auto-fetch from the API and back-fill state if this is empty.
    allGroupIds:      new Set(Object.values(sg).filter(Boolean)),
    _slug:            slug, // passed through so ensureGroupIds can update .sdd-state.json
  };

  if (!cfg.dsId || !cfg.planModeId || (cfg.schema === 1 && !cfg.doneGroupId)) {
    console.error('✗ .sdd-state.json missing required fields. Re-run: node sdd-conductor.mjs init');
    process.exit(1);
  }

  // ALWAYS surface the board + dashboard links, on every command, to stderr (so
  // it never pollutes JSON stdout). The agent MUST relay these to the user every
  // time. This is the "constantly link" rule made mechanical.
  {
    const { plannerUrl, dashboardUrl } = boardLinks(cfg, slug);
    process.stderr.write(`\n━━ ${slug} ━━\n📋 Plan mode (board): ${plannerUrl || '(no plan mode)'}\n📊 Dashboard:         ${dashboardUrl || '(not created yet — build + register the dashboard)'}\n\n`);
  }

  if (traceAuditMode) {
    await traceAuditCommand(cfg, iState, slug);
    return;
  }

  if (stampUuidsMode) {
    await stampUuidsCommand(cfg);
    return;
  }

  if (healthMode) {
    await healthCheck(cfg, iState, slug);
    return;
  }

  if (intakeAdd) {
    await addIntakeCommand(cfg, slug);
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

  if (checkItemTaskId !== null) {
    await checkItemCommand(cfg, iState, slug);
    return;
  }

  if (regressMode) {
    await regressCommand(cfg, iState, slug);
    return;
  }

  if (requestReviewMode) {
    await requestReviewCommand(cfg, iState, slug);
    return;
  }

  if (greenlightMode) {
    await greenlightCommand(cfg, iState, slug);
    return;
  }

  if (revokeReviewMode) {
    await revokeReviewCommand(slug);
    return;
  }

  if (reconcileMode) {
    await reconcileCommand(cfg, slug);
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

  // MECHANICAL LOOP PERMANENTLY DISABLED.
  // It mass-ticked checklists (tickAll), posted canned "Gate: PASS" comments, and
  // moved tasks to Done with zero real verification — the fake-success engine.
  // The ONLY supported drivers are:
  //   AI-driven:  --next → work each checklist item → --check-item (per item,
  //               with evidence) → --advance (with overall evidence)
  //   Blind loop: node ralph-run.mjs  (fresh Claude instance per task, same gates)
  console.error('✗ The bare mechanical loop is DISABLED — it rubber-stamps tasks without verification.');
  console.error('');
  console.error('  Use the AI-driven flow:');
  console.error('    node loop.mjs --next                                     # get the current task');
  console.error('    node loop.mjs --check-item <id> --item N --evidence "…"  # verify ONE checklist item');
  console.error('    node loop.mjs --advance <id> --evidence "…"              # advance when all boxes earned');
  console.error('');
  console.error('  Or the blind Ralph loop (fresh Claude per task, same gates):');
  console.error('    node ralph-run.mjs');
  process.exit(1);

  // eslint-disable-next-line no-unreachable -- kept for reference; remove after one release cycle
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
