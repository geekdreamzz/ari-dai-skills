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
 *   node sdd-conductor.mjs sync                      Mid-plan reconcile: diff tasks.yaml vs live board
 *   node sdd-conductor.mjs start <taskId>            Mark task IN_PROGRESS. Exits 1 if deps not Done.
 *   node sdd-conductor.mjs complete <taskId>         Verify checklist → comment → PATCH Done → propagate.
 *   node sdd-conductor.mjs progress <message>        Post progress milestone to active task.
 *   node sdd-conductor.mjs validate <vaTaskId>       Ralph loop gate (exit 0=pass / exit 1=next iter).
 *   node sdd-conductor.mjs status                    Show all initiatives + active task status.
 *   node sdd-conductor.mjs gate <name> [args...]     Verify named gate. Exits 1 if not met.
 *   node sdd-conductor.mjs dashboard-check <dsUri> <slug>  Verify 6 required dashboard sections.
 *   node sdd-conductor.mjs update-dashboard <dsUri> <slug> Generate/refresh Current Focus hierarchy section.
 *   node sdd-conductor.mjs check-file-hook           Read stdin (Claude PostToolUse JSON), warn on mismatch.
 *   node sdd-conductor.mjs session-start             Read .sdd-state.json, reconcile with live API.
 *   node sdd-conductor.mjs install [project-dir]     Inject hooks into project's .claude/settings.json.
 *
 * All commands accept --initiative <slug> to target a specific initiative.
 *
 * Gate names:
 *   deps-done <taskId>     All depends_on tasks are in Done
 *   research-done <rsId>   RS task is in Done column
 *   no-mocks <file>        File contains no mock/stub patterns
 *   checklist <taskId>     All acceptance checklist items are checked
 *   impl-files <taskId>    Task has Implementation Files section
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '1.1.0';
const STATE_FILE = '.sdd-state.json';
const WORKSPACE_FILE = path.join(os.homedir(), '.sdd-workspace.json');

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
  const baseUrl = env.DATASPHERES_BASE_URL || 'http://localhost:3000';
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

function extractImplFiles(content) {
  if (!content) return [];
  const implMatch = content.match(/Implementation Files[\s\S]*?<ul>([\s\S]*?)<\/ul>/i);
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

// Returns checklist items within a named H2–H4 section
function extractSectionChecklist(content, sectionTitle) {
  if (!content) return [];
  const esc = escapeRegex(sectionTitle);
  const rx = new RegExp(`<h[2-4][^>]*>[^<]*${esc}[^<]*<\\/h[2-4]>([\\s\\S]*?)(?=<h[2-4]|$)`, 'i');
  const m = content.match(rx);
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
    /generate_mock/i, /fake_result/i, /TODO:\s*replace/i, /placeholder/i,
  ];
  return patterns.filter(p => p.test(content)).map(p => p.toString());
}

function getColumnName(task) {
  return task.statusGroup?.name || task.column || 'unknown';
}

function isDone(task) {
  const col = getColumnName(task).toLowerCase();
  return col === 'done' || task.status === 'DONE';
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
  const baseUrl = env.DATASPHERES_BASE_URL || 'http://localhost:3000';
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

  const doneGroup = groups.find(g => g.name?.toLowerCase() === 'done' || g.isDoneState);
  const execGroup = groups.find(g => g.name?.toLowerCase() === 'execution');
  const validGroup = groups.find(g => g.name?.toLowerCase() === 'validation');

  if (!doneGroup) die('No "Done" status group found in plan mode');

  // Build initiative state
  const iState = {
    dsId,
    dsUri,
    planModeId: pm.id,
    initiative,
    doneGroupId: doneGroup.id,
    executionGroupId: execGroup?.id || null,
    validationGroupId: validGroup?.id || null,
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
  const task = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`);
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

  // Gate: hierarchy refs — VA needs execution_ref + epic_ref + north_star_ref
  //       EX needs epic_ref + north_star_ref; Epic needs north_star_ref
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
      if (!extractFrontMatterField(task.content, 'epic_ref'))       missing.push('epic_ref');
      if (!extractFrontMatterField(task.content, 'north_star_ref')) missing.push('north_star_ref');
    } else if (isEP) {
      if (!extractFrontMatterField(task.content, 'north_star_ref')) missing.push('north_star_ref');
    }
    if (missing.length > 0) {
      gate(`Hierarchy refs missing — trace graph edges will be broken:\n${missing.map(m => `  ✗ ${m}`).join('\n')}\n\nAdd the missing fields to the task frontmatter, then re-run start.`);
    }
  }

  // PATCH task to IN_PROGRESS
  await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`, {
    status: 'IN_PROGRESS',
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
  saveInitiative(state, slug, iState);

  ok(`Task ${specId} marked IN_PROGRESS and logged to .sdd-state.json (initiative: ${slug})`);
  info(`File guard active. Any file write outside [${implFiles.join(', ')}] will trigger a warning.`);
}

async function cmdComplete(taskId) {
  if (!taskId) die('Usage: complete <taskId>');
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  // Fetch the task
  const task = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`);
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

  // PATCH task to Done
  await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${taskId}`, {
    statusGroupId: iState.doneGroupId,
    status: 'DONE',
  });
  info(`Task PATCH: status=DONE, statusGroupId=${iState.doneGroupId} ✓`);

  // Propagate to parent Epic checklist
  if (task.parentId) {
    await propagateEpicChecklist(client, iState, task.parentId, specId, task.title);
  }

  // Clear active task from initiative state
  iState.activeTask = null;
  iState.lastCompleted = {
    taskId,
    specId,
    title: task.title,
    completedAt: new Date().toISOString(),
  };
  saveInitiative(state, slug, iState);

  ok(`${specId} marked Done. Checklist propagated to Epic.`);
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
    info(`NS ${nsSpecId}: all items verified -> moved to Done -- final research review triggered`);
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
        const live = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${t.taskId}`);
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
      const task = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${arg}`);
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
        if (!extractFrontMatterField(content, 'epic_ref'))       warnings.push('EX task missing epic_ref');
        if (!extractFrontMatterField(content, 'north_star_ref')) warnings.push('EX task missing north_star_ref');
      } else if (isEP) {
        if (!extractFrontMatterField(content, 'north_star_ref')) warnings.push('Epic missing north_star_ref');
      }

      if (warnings.length > 0) {
        gate(`Hierarchy check failed for ${specId}:\n${warnings.map(w => `  ✗ ${w}`).join('\n')}`);
      }
      ok(`GATE hierarchy: ${specId} has correct parent refs`);
      break;
    }
    default:
      die(`Unknown gate: ${name}. Valid: deps-done, research-done, no-mocks, checklist, impl-files, hierarchy`);
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

  const task = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${vaTaskId}`);
  const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || vaTaskId;

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

    await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${vaTaskId}/comments`, {
      content: commentLines.join('\n'),
    });
    info(`Verification comment posted ✓`);

    await client.patch(`/api/v2/dataspheres/${iState.dsId}/tasks/${vaTaskId}`, {
      statusGroupId: iState.doneGroupId,
      status: 'DONE',
    });
    info(`Task PATCH: status=DONE ✓`);

    // Resolve parent EX task: prefer execution_ref front-matter over parentId.
    // Hierarchy: VA belongs to EX, EX belongs to Epic. VA must propagate through EX.
    const execRef = extractFrontMatterField(task.content, 'execution_ref');
    let execTask = null;

    if (execRef) {
      try {
        const allTasks = await client.get(
          `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
        );
        const taskList = allTasks.tasks || allTasks || [];
        execTask = taskList.find(t =>
          extractSpecId(t.content) === execRef ||
          t.title?.match(/^[A-Z]+-\d+/)?.[0] === execRef
        ) || null;
      } catch { /* fall back to parentId */ }
    }

    if (!execTask && task.parentId) {
      // If parentId is an EX task (in Execution column), treat it as the EX task
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
      // Fallback: treat parentId as Epic (pre-hierarchy behaviour)
      await propagateEpicChecklist(client, iState, task.parentId, specId, task.title);
    }

    iState.activeTask = null;
    iState.lastCompleted = { taskId: vaTaskId, specId, title: task.title, completedAt: new Date().toISOString() };
    saveInitiative(state, slug, iState);

    ok(`${specId} validated and moved to Done. Hierarchical chain triggered (VA -> EX -> Epic -> NS).`);
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

    await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks/${vaTaskId}/comments`, {
      content: [
        `[all-dai-sdd-system-message]`,
        ``,
        `**Validation FAILED — Iteration ${iteration}** | ${new Date().toISOString()}`,
        ``,
        `- Metric: ${metric} / threshold: ${threshold} (delta: -${delta})`,
        `- Next: iteration ${nextIter} refinement task created in Execution`,
      ].join('\n'),
    });
    info(`Failure comment posted ✓`);

    if (iState.executionGroupId) {
      const baseTitle = task.title.replace(/\s*\(iteration \d+\)$/, '');
      const newTitle = `${baseTitle} (iteration ${nextIter})`;
      const specParts = specId.match(/^(.*?)(-\d+)(.*)$/);
      const newSpecId = specParts
        ? `${specParts[1]}${specParts[2]}-iter${nextIter}${specParts[3] || ''}`
        : `${specId}-iter${nextIter}`;

      const implFiles = extractImplFiles(task.content);
      const implSection = implFiles.length > 0
        ? `<h3>Implementation Files <!-- #impl --></h3>\n<ul>\n${implFiles.map(f => `  <li><code>${f}</code></li>`).join('\n')}\n</ul>\n\n`
        : '';

      const parentEpicRef      = extractFrontMatterField(task.content, 'epic_ref') || '';
      const parentNorthStarRef = extractFrontMatterField(task.content, 'north_star_ref') || '';

      const newContent = [
        `<pre><code class="language-yaml">`,
        `spec_id: ${newSpecId}`,
        `title: ${newTitle}`,
        `spec_type: algorithm`,
        `version: 1.0.0`,
        `status: ACTIVE`,
        `column: execution`,
        `iteration: ${nextIter}`,
        `parent_va: ${vaTaskId}`,
        ...(parentEpicRef      ? [`epic_ref: ${parentEpicRef}`]      : []),
        ...(parentNorthStarRef ? [`north_star_ref: ${parentNorthStarRef}`] : []),
        `tags: [${iState.initiative}, sdd, execution, refinement]`,
        `</code></pre>`,
        ``,
        implSection,
        `<h2>Context <!-- #ctx --></h2>`,
        `<p>Refinement iteration ${nextIter}. Previous iteration ${iteration} failed validation gate.</p>`,
        `<ul>`,
        `<li>Metric: ${metric} (target: &gt;= ${threshold})</li>`,
        `<li>Delta: ${delta} below threshold &mdash; investigate and fix.</li>`,
        `</ul>`,
        ``,
        `<h2>Acceptance Criteria <!-- #ac --></h2>`,
        `<ul data-type="taskList">`,
        `  <li data-type="taskItem" data-checked="false"><p>Metric &gt;= ${threshold}</p></li>`,
        `  <li data-type="taskItem" data-checked="false"><p>All existing tests pass</p></li>`,
        `  <li data-type="taskItem" data-checked="false"><p>No mocks or stubs introduced</p></li>`,
        `</ul>`,
      ].join('\n');

      const created = await client.post(`/api/v2/dataspheres/${iState.dsId}/tasks`, {
        title: newTitle,
        statusGroupId: iState.executionGroupId,
        tags: [iState.initiative, 'sdd', 'execution', 'refinement'],
        parentId: task.parentId || null,
        content: newContent,
      });

      const newId = created.task?.id || created.id || 'unknown';
      info(`Iteration ${nextIter} task created: ${newTitle} (${newId})`);
    } else {
      warn(`executionGroupId not set — run 'init' again or set manually to enable auto-iteration`);
    }

    process.exit(1);
  }
}

async function cmdDashboardCheck(dsUri, pageSlug) {
  if (!dsUri || !pageSlug) die('Usage: dashboard-check <dsUri> <page-slug>');
  const env = loadEnv();
  const baseUrl = env.DATASPHERES_BASE_URL || 'http://localhost:3000';
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
    { label: 'progress-summary widget',   pattern: /data-widget-type="progress-summary"/ },
    { label: 'Current Focus section',     pattern: /<!--\s*#focus\s*-->|Current Focus/i },
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
      `\n\nFix: run \`node sdd-conductor.mjs update-dashboard ${dsUri} ${pageSlug}\` to generate the Current Focus section,\n` +
      `then ensure all 6 sections are present per SKILL.md Step 12 template.`
    );
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

  ok(`GATE dashboard-check: all ${REQUIRED.length} required sections present`);
  REQUIRED.forEach(r => info(`  ✓ ${r.label}`));

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
  const baseUrl = env.DATASPHERES_BASE_URL || 'http://localhost:3000';
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

  const seenEx = new Set();
  const seenVa = new Set();

  for (const n of ns) {
    const epList = epicsForNs(n);
    // Only show NS if it has active Epics with active EX tasks
    const hasWork = epList.some(e => exForEpic(e).length > 0);
    if (!hasWork && epList.length === 0) continue;

    rows.push({ indent: '', id: specId(n), title: shortTitle(n), status: 'In Progress' });
    for (const e of epList) {
      const exList = exForEpic(e);
      if (exList.length === 0) continue; // skip Epics with no active EX tasks
      rows.push({ indent: '&nbsp;&nbsp;', id: specId(e), title: shortTitle(e), status: 'In Progress' });
      for (const x of exList) {
        if (seenEx.has(x.id)) continue;
        seenEx.add(x.id);
        const isAct = activeTaskState && x.id === activeTaskState.taskId;
        rows.push({ indent: '&nbsp;&nbsp;&nbsp;&nbsp;', id: specId(x), title: shortTitle(x), status: isAct ? '<strong>Active</strong>' : 'In Progress' });
        for (const v of vaForEx(x)) {
          if (seenVa.has(v.id)) continue;
          seenVa.add(v.id);
          rows.push({ indent: '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;', id: specId(v), title: shortTitle(v), status: 'Pending Validation' });
        }
      }
    }
  }
  // Orphan EX/VA not linked to any NS/Epic
  for (const x of ex) {
    if (!seenEx.has(x.id)) {
      const isAct = activeTaskState && x.id === activeTaskState.taskId;
      rows.push({ indent: '', id: specId(x), title: shortTitle(x), status: isAct ? '<strong>Active</strong>' : 'In Progress' });
    }
  }
  for (const v of va) {
    if (!seenVa.has(v.id)) {
      rows.push({ indent: '', id: specId(v), title: shortTitle(v), status: 'Pending Validation' });
    }
  }

  if (rows.length === 0) {
    rows.push({ indent: '', id: '—', title: 'No tasks currently in progress', status: '—' });
  }

  const tableRows = rows.map(r =>
    `<tr class="tiptap-table-row">` +
    `<td class="tiptap-table-cell"><p>${r.indent}<strong>${r.id}</strong></p></td>` +
    `<td class="tiptap-table-cell"><p>${r.title}</p></td>` +
    `<td class="tiptap-table-cell"><p>${r.status}</p></td>` +
    `</tr>`
  ).join('\n');

  const focusHtml =
    `<table class="tiptap-table"><tbody>\n` +
    `<tr class="tiptap-table-row">` +
    `<td class="tiptap-table-cell"><p><strong>ID</strong></p></td>` +
    `<td class="tiptap-table-cell"><p><strong>Task</strong></p></td>` +
    `<td class="tiptap-table-cell"><p><strong>Status</strong></p></td>` +
    `</tr>\n` +
    tableRows +
    `\n</tbody></table>`;

  // GET current page content
  const pageRes = await fetch(`${baseUrl}/api/v1/dataspheres/${dsUri}/pages/${pageSlug}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!pageRes.ok) die(`Could not fetch page ${pageSlug}: ${pageRes.status}`);
  const pageData = await pageRes.json();
  let content = pageData.page?.content || pageData.content || '';

  // Replace section between <!-- #focus --> heading and the next <h2>
  // Pattern: <h2>Current Focus <!-- #focus --></h2> ... (up to next <h2> or end)
  const focusHeading = `<h2>Current Focus <!-- #focus --></h2>`;
  const focusSection = `${focusHeading}\n${focusHtml}`;

  if (content.includes('<!-- #focus -->') || /Current Focus/i.test(content)) {
    // Replace existing section
    content = content.replace(
      /(<h2[^>]*>(?:Current Focus)[^<]*<\/h2>)([\s\S]*?)(?=<h2|$)/i,
      `${focusSection}\n\n`
    );
  } else {
    // Insert after progress-summary widget div
    content = content.replace(
      /(<\/div>\s*)((?=<h2[^>]*>(?:Trace Graph|trace.?graph)))/i,
      `$1\n${focusSection}\n\n$2`
    );
    if (!content.includes('<!-- #focus -->')) {
      // Fallback: insert after <h1> block
      content = content.replace(/(<\/p>\s*)(?=<h2)/, `$1\n${focusSection}\n\n`);
    }
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

  ok(`Current Focus section updated — ${rows.length} in-progress item(s)`);
  rows.forEach(r => info(`  ${r.indent}${r.id} · ${r.title}`));
  info(`\nDashboard: ${env.DATASPHERES_BASE_URL?.replace('http://localhost', 'https://dataspheres.ai') || baseUrl}/pages/${dsUri}/${pageSlug}`);
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
      const live = await client.get(`/api/v2/dataspheres/${iState.dsId}/tasks/${iState.activeTask.taskId}`);

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
  console.log('');
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
  info(`Session start:   SessionStart              → session-start`);
  info(`\nNext: node sdd-conductor.mjs init  (to set up .sdd-state.json)`);
}

async function cmdDrive() {
  const { state, slug, iState } = requireInitiativeState();
  const client = makeClient();

  console.log(`\n🚀 SDD-CONDUCTOR DRIVE  [${slug}]`);
  info(`Datasphere: ${iState.dsUri}`);

  // Show other initiatives if multiple exist
  const allSlugs = Object.keys(state.initiatives || {});
  if (allSlugs.length > 1) {
    info(`Other initiatives: ${allSlugs.filter(s => s !== slug).join(', ')}  (switch with: switch <slug>)`);
  }

  const allTasks = await client.get(
    `/api/v2/dataspheres/${iState.dsId}/tasks?planModeId=${iState.planModeId}&limit=500`
  );
  const taskList = allTasks.tasks || allTasks || [];

  const bySpecId = {};
  for (const t of taskList) {
    const specId = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0];
    if (specId) bySpecId[specId] = t;
  }

  const groups = {};
  for (const t of taskList) {
    const col = getColumnName(t).toLowerCase();
    groups[col] = groups[col] || [];
    groups[col].push(t);
  }

  if (iState.activeTask) {
    console.log(`\n  ACTIVE TASK:`);
    info(`  ${iState.activeTask.specId} — ${iState.activeTask.title}`);
    info(`  Started: ${iState.activeTask.startedAt}`);
    info(`  Impl files: ${iState.activeTask.implFiles?.join(', ') || '(none)'}`);
    info(`  When done: node sdd-conductor.mjs complete ${iState.activeTask.taskId}`);
  }

  const rsTasks = taskList.filter(t => t.title?.match(/^RS-/) && !isDone(t));
  if (rsTasks.length > 0) {
    console.log(`\n  RESEARCH REQUIRED (${rsTasks.length}):`);
    for (const t of rsTasks) {
      const specId = extractSpecId(t.content) || t.title?.match(/^RS-\d+/)?.[0] || t.id;
      info(`  ${specId} · ${t.title}`);
      info(`    → node sdd-conductor.mjs start ${t.id}`);
    }
  }

  const exTasks = (groups['execution'] || []).filter(t => !isDone(t) && t.id !== iState.activeTask?.taskId);
  const readyTasks = [];
  const blockedTasks = [];
  for (const t of exTasks) {
    const deps = extractDependsOn(t.content);
    const notDone = deps.filter(dep => { const dt = bySpecId[dep]; return !dt || !isDone(dt); });
    notDone.length === 0 ? readyTasks.push({ task: t }) : blockedTasks.push({ task: t, blocking: notDone });
  }

  if (readyTasks.length > 0) {
    console.log(`\n  READY TO START (${readyTasks.length}):`);
    for (const { task } of readyTasks) {
      const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
      info(`  ${specId} · ${task.title}`);
      info(`    → node sdd-conductor.mjs start ${task.id}`);
    }
  }

  const vaTasks = (groups['validation'] || []).filter(t => !isDone(t));
  if (vaTasks.length > 0) {
    console.log(`\n  NEEDS VALIDATION (${vaTasks.length}):`);
    for (const t of vaTasks) {
      const specId = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
      info(`  ${specId} · ${t.title}`);
      info(`    → node sdd-conductor.mjs validate ${t.id} --metric <measured> --threshold <gate> --iteration 1`);
    }
  }

  if (blockedTasks.length > 0) {
    console.log(`\n  BLOCKED (${blockedTasks.length}):`);
    for (const { task, blocking } of blockedTasks) {
      const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
      info(`  ${specId} · ${task.title}`);
      info(`    Waiting on: ${blocking.join(', ')}`);
    }
  }

  const nsTasks = taskList.filter(t => {
    const col = getColumnName(t).toLowerCase();
    return (col === 'north stars' || t.title?.match(/^NS-/)) && !isDone(t);
  });
  const nsReady = nsTasks.filter(t => t.content && countUncheckedItems(t.content) === 0 && t.content.includes('data-checked'));
  if (nsReady.length > 0) {
    console.log(`\n  NORTH STARS READY TO CLOSE:`);
    for (const t of nsReady) {
      const specId = extractSpecId(t.content) || t.title?.match(/^NS-\d+/)?.[0] || t.id;
      info(`  ${specId} · ${t.title}`);
      info(`    → node sdd-conductor.mjs complete ${t.id}`);
    }
  }

  const doneCount = (groups['done'] || []).length;
  const pct = taskList.length > 0 ? Math.round(doneCount / taskList.length * 100) : 0;
  console.log(`\n  PROGRESS: ${doneCount}/${taskList.length} Done (${pct}%) | ${readyTasks.length} Ready | ${vaTasks.length} In Validation | ${blockedTasks.length} Blocked`);

  if (!iState.activeTask && readyTasks.length > 0) {
    const next = readyTasks[0];
    const specId = extractSpecId(next.task.content) || next.task.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
    console.log(`\n  ▶ NEXT: node sdd-conductor.mjs start ${next.task.id}  # ${specId}`);
  } else if (!iState.activeTask && vaTasks.length > 0) {
    console.log(`\n  ▶ NEXT: run validation test then call: node sdd-conductor.mjs validate ${vaTasks[0].id}`);
  } else if (!iState.activeTask && rsTasks.length > 0) {
    console.log(`\n  ▶ NEXT: node sdd-conductor.mjs start ${rsTasks[0].id}  # ${rsTasks[0].title}`);
  } else if (doneCount === taskList.length && taskList.length > 0) {
    console.log(`\n  ✅ All ${taskList.length} tasks complete!`);
  }
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
// Utilities
// ---------------------------------------------------------------------------

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  session-start                         SessionStart hook — reconcile state.
  install [project-dir]                 Inject all hooks into .claude/settings.json.

Global flag (any command):
  --initiative <slug>                   Target a specific initiative instead of currentInitiative

Gate names: deps-done, research-done, no-mocks, checklist, impl-files, hierarchy

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
    case 'status':          await cmdStatus(); break;
    case 'gate':            await cmdGate(args[0], args[1]); break;
    case 'dashboard-check':   await cmdDashboardCheck(args[0], args[1]); break;
    case 'update-dashboard':  await cmdUpdateDashboard(args[0], args[1]); break;
    case 'check-file-hook':   await cmdCheckFileHook(); break;
    case 'progress-hook':   await cmdProgressHook(); break;
    case 'session-start':   await cmdSessionStart(); break;
    case 'install':         await cmdInstall(args[0]); break;
    default:                die(`Unknown command: ${command}. Run with --help.`);
  }
} catch (e) {
  if (e.code === 'ERR_CONDUCTOR_GATE') {
    process.exit(1);
  }
  die(`Unexpected error: ${e.message}`);
}
