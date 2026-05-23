#!/usr/bin/env node
/**
 * sdd-conductor.mjs — SDD lifecycle enforcement CLI
 *
 * Zero external dependencies — Node.js built-in fetch + fs only.
 * Every command exits 0 (pass) or 1 (gate failed) or 2 (hard error).
 * Non-zero exit is the enforcement mechanism — bash calls fail, Claude sees the error.
 *
 * Usage:
 *   node sdd-conductor.mjs init                     Bootstrap .sdd-state.json for this project
 *   node sdd-conductor.mjs start <taskId>            Mark task IN_PROGRESS. Exits 1 if deps not Done.
 *   node sdd-conductor.mjs complete <taskId>         Verify checklist → comment → PATCH Done → propagate.
 *   node sdd-conductor.mjs status                    Show current state + live task status.
 *   node sdd-conductor.mjs gate <name> [args...]     Verify named gate. Exits 1 if not met.
 *   node sdd-conductor.mjs check-file-hook           Read stdin (Claude PostToolUse JSON), warn on mismatch.
 *   node sdd-conductor.mjs session-start             Read .sdd-state.json, reconcile with live API.
 *   node sdd-conductor.mjs install [project-dir]     Inject hooks into project's .claude/settings.json.
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

const VERSION = '1.0.0';
const STATE_FILE = '.sdd-state.json';

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

function loadState() {
  const p = statePath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
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
  const uriMatch = yaml.match(/targetDatasphere:\s*(\S+)/);
  const initiativeMatch = yaml.match(/initiative:\s*(\S+)/);
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

  const state = {
    version: VERSION,
    dsId,
    dsUri,
    planModeId: pm.id,
    initiative,
    doneGroupId: doneGroup.id,
    executionGroupId: execGroup?.id || null,
    validationGroupId: validGroup?.id || null,
    statusGroups: Object.fromEntries(groups.map(g => [g.name.toLowerCase(), g.id])),
    activeTask: null,
    initializedAt: new Date().toISOString(),
  };

  saveState(state);
  ok(`Initialized .sdd-state.json — ready for SDD lifecycle enforcement`);
  info(`Done group ID: ${doneGroup.id}`);
  info(`Execution group ID: ${execGroup?.id || 'not found'}`);
}

async function cmdStart(taskId) {
  if (!taskId) die('Usage: start <taskId>');
  const state = requireState();
  const client = makeClient();

  // Warn if another task is already active
  if (state.activeTask) {
    warn(`Another task is already active: ${state.activeTask.specId || state.activeTask.taskId}`);
    warn(`Complete it first with: node sdd-conductor.mjs complete ${state.activeTask.taskId}`);
    warn(`Or force with --force flag to override`);
    if (!process.argv.includes('--force')) process.exit(1);
  }

  // Fetch the task
  const task = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${taskId}`);
  const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || taskId;
  const implFiles = extractImplFiles(task.content);
  const dependsOn = extractDependsOn(task.content);

  console.log(`\n🔵 SDD-CONDUCTOR START`);
  info(`Task: ${task.title}`);
  info(`Spec ID: ${specId}`);
  info(`Impl files: ${implFiles.length > 0 ? implFiles.join(', ') : '(none listed)'}`);
  info(`Depends on: ${dependsOn.length > 0 ? dependsOn.join(', ') : '(none)'}`);

  // Gate: verify all dependencies are Done
  if (dependsOn.length > 0) {
    info(`\nChecking dependencies...`);
    const allTasks = await client.get(
      `/api/v2/dataspheres/${state.dsId}/tasks?planModeId=${state.planModeId}&limit=200`
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

  // Verify impl files exist
  if (implFiles.length === 0) {
    warn(`Task has no Implementation Files section. Add one to the task content before coding.`);
  }

  // PATCH task to IN_PROGRESS
  await client.patch(`/api/v2/dataspheres/${state.dsId}/tasks/${taskId}`, {
    status: 'IN_PROGRESS',
  });

  // Post start comment
  await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${taskId}/comments`, {
    content: `[all-dai-sdd-system-message]\n\n**IN PROGRESS** — Starting ${specId}. Dependencies cleared. sdd-conductor v${VERSION}.`,
  });

  // Write active task to state
  state.activeTask = {
    taskId,
    specId,
    title: task.title,
    epicTaskId: task.parentId || null,
    implFiles,
    startedAt: new Date().toISOString(),
  };
  saveState(state);

  ok(`Task ${specId} marked IN_PROGRESS and logged to .sdd-state.json`);
  info(`File guard active. Any file write outside [${implFiles.join(', ')}] will trigger a warning.`);
}

async function cmdComplete(taskId) {
  if (!taskId) die('Usage: complete <taskId>');
  const state = requireState();
  const client = makeClient();

  // Fetch the task
  const task = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${taskId}`);
  const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || taskId;

  console.log(`\n🟢 SDD-CONDUCTOR COMPLETE`);
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

  // Gate 2: Completion comment must exist (with [all-dai-sdd-system-message])
  const comments = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${taskId}/comments`);
  const commentList = comments.comments || comments || [];
  const hasCompletionComment = commentList.some(c =>
    c.content?.includes('[all-dai-sdd-system-message]') &&
    (c.content?.includes('Completion summary') || c.content?.includes('Verified criteria'))
  );
  if (!hasCompletionComment) {
    gate(
      `No completion comment found on task ${specId}.\n\n` +
      `  Post a completion comment with format:\n` +
      `    [all-dai-sdd-system-message]\n` +
      `    **Completion summary:** ...\n` +
      `    **Verified criteria:** ...\n` +
      `  Then re-run: node sdd-conductor.mjs complete ${taskId}`
    );
  }
  info(`Completion comment: found ✓`);

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
  await client.patch(`/api/v2/dataspheres/${state.dsId}/tasks/${taskId}`, {
    statusGroupId: state.doneGroupId,
    status: 'DONE',
  });
  info(`Task PATCH: status=DONE, statusGroupId=${state.doneGroupId} ✓`);

  // Propagate to parent Epic checklist
  if (task.parentId) {
    await propagateEpicChecklist(client, state, task.parentId, specId, task.title);
  }

  // Clear active task from state
  state.activeTask = null;
  state.lastCompleted = {
    taskId,
    specId,
    title: task.title,
    completedAt: new Date().toISOString(),
  };
  saveState(state);

  ok(`${specId} marked Done. Checklist propagated to Epic.`);
}

async function propagateEpicChecklist(client, state, epicTaskId, doneSpecId, doneTitle) {
  try {
    const epic = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${epicTaskId}`);
    if (!epic.content) return;

    // Find the checklist item for this task and tick it
    const idPrefix = doneSpecId.match(/^[A-Z]+-\d+/)?.[0] || doneSpecId;
    const updated = epic.content.replace(
      new RegExp(`(data-checked="false"><p>)(${escapeRegex(idPrefix)}[^<]*)`, 'g'),
      `data-checked="true"><p>$2`
    );

    if (updated === epic.content) {
      info(`Epic checklist: no matching item found for ${idPrefix} (may need manual tick)`);
      return;
    }

    await client.patch(`/api/v2/dataspheres/${state.dsId}/tasks/${epicTaskId}`, {
      content: updated,
    });
    info(`Epic checklist: ticked ${idPrefix} ✓`);

    // Check if all items are now checked
    const remaining = countUncheckedItems(updated);
    if (remaining === 0) {
      info(`Epic fully complete — posting ready-for-validation comment`);
      await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${epicTaskId}/comments`, {
        content: `[all-dai-sdd-system-message]\n\nAll Execution tasks complete. Ready for Validation.`,
      });
    } else {
      info(`Epic: ${remaining} task(s) remaining`);
    }
  } catch (e) {
    warn(`Could not propagate to Epic ${epicTaskId}: ${e.message}`);
  }
}

async function cmdStatus() {
  const state = loadState();
  if (!state) {
    console.log('\n📋 No .sdd-state.json — run: node sdd-conductor.mjs init\n');
    return;
  }

  console.log(`\n📋 SDD-CONDUCTOR STATUS`);
  info(`Initiative: ${state.initiative}`);
  info(`Datasphere: ${state.dsUri} (${state.dsId})`);
  info(`Plan mode: ${state.planModeId}`);

  if (!state.activeTask) {
    info(`Active task: (none)`);
    if (state.lastCompleted) {
      info(`Last completed: ${state.lastCompleted.specId} at ${state.lastCompleted.completedAt}`);
    }
  } else {
    const t = state.activeTask;
    console.log(`\n  ACTIVE TASK:`);
    info(`  Spec ID: ${t.specId}`);
    info(`  Task ID: ${t.taskId}`);
    info(`  Title: ${t.title}`);
    info(`  Started: ${t.startedAt}`);
    info(`  Impl files: ${t.implFiles?.join(', ') || '(none)'}`);

    // Fetch live status
    try {
      const client = makeClient();
      const live = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${t.taskId}`);
      info(`  Live status: ${live.status} / ${getColumnName(live)}`);
    } catch {
      info(`  Live status: (could not fetch)`);
    }
  }
  console.log('');
}

async function cmdGate(name, arg) {
  if (!name) die('Usage: gate <name> [arg]');
  const state = requireState();
  const client = makeClient();

  switch (name) {
    case 'deps-done': {
      if (!arg) die('Usage: gate deps-done <taskId>');
      const task = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${arg}`);
      const dependsOn = extractDependsOn(task.content);
      if (dependsOn.length === 0) {
        ok(`GATE deps-done: no dependencies declared`);
        return;
      }
      const allTasks = await client.get(
        `/api/v2/dataspheres/${state.dsId}/tasks?planModeId=${state.planModeId}&limit=200`
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
      const task = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${arg}`);
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
      const task = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${arg}`);
      const unchecked = countUncheckedItems(task.content);
      if (unchecked > 0) gate(`${unchecked} unchecked items remain in task ${arg}`);
      ok(`GATE checklist: all items checked`);
      break;
    }
    case 'impl-files': {
      if (!arg) die('Usage: gate impl-files <taskId>');
      const task = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${arg}`);
      const files = extractImplFiles(task.content);
      if (files.length === 0) gate(`Task ${arg} has no Implementation Files section`);
      ok(`GATE impl-files: ${files.length} file(s) listed`);
      break;
    }
    default:
      die(`Unknown gate: ${name}. Valid: deps-done, research-done, no-mocks, checklist, impl-files`);
  }
}

async function cmdCheckFileHook() {
  // Read Claude PostToolUse JSON from stdin
  let raw = '';
  try {
    if (process.stdin.isTTY) return; // not a hook invocation, skip silently
    for await (const chunk of process.stdin) raw += chunk;
    if (!raw.trim()) return;
  } catch {
    return;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // malformed stdin, don't block
  }

  const toolName = input.tool_name || '';
  const filePath = input.tool_input?.file_path || input.tool_input?.path || '';

  if (!filePath) return;
  if (!['Write', 'Edit', 'NotebookEdit'].includes(toolName)) return;

  // Only check source files — skip config, docs, tests, lock files
  const skip = /\.(json|yaml|yml|md|lock|env|toml|txt|log|tsbuildinfo)$|node_modules|\.claude|\.git/;
  if (skip.test(filePath)) return;

  const state = loadState();
  if (!state?.activeTask) {
    // No active task — emit warning but don't block
    warn(
      `No active SDD task. Before writing code, run:\n` +
      `  node sdd-conductor.mjs start <taskId>\n\n` +
      `  This ensures the tracker stays in sync and your work is traced.`
    );
    return; // exit 0 — warn, don't hard-block
  }

  const { specId, implFiles, title } = state.activeTask;
  if (!implFiles || implFiles.length === 0) return; // no impl files declared, can't check

  // Normalize paths for comparison
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
    // Exit 0 — this is a warning, not a hard block. The LLM must address it but isn't frozen.
  }
}

async function cmdSessionStart() {
  const state = loadState();
  if (!state) return; // no SDD project, nothing to do

  console.log(`\n🔄 SDD-CONDUCTOR SESSION START`);
  info(`Initiative: ${state.initiative}`);

  if (!state.activeTask) {
    info(`No active task in state.`);
    return;
  }

  // Reconcile with live API
  try {
    const client = makeClient();
    const live = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${state.activeTask.taskId}`);
    const liveStatus = live.status;
    const liveColumn = getColumnName(live);

    if (isDone(live)) {
      warn(
        `Active task ${state.activeTask.specId} is DONE in the planner but still set as active in .sdd-state.json.\n` +
        `  This means the last session ended without a clean sdd-conductor complete.\n` +
        `  Clearing active task from state.`
      );
      state.activeTask = null;
      saveState(state);
    } else if (liveStatus !== 'IN_PROGRESS') {
      warn(
        `Active task ${state.activeTask.specId} is not IN_PROGRESS in the planner (status: ${liveStatus}).\n` +
        `  Re-marking as IN_PROGRESS to restore tracker visibility.`
      );
      try {
        await client.patch(`/api/v2/dataspheres/${state.dsId}/tasks/${state.activeTask.taskId}`, {
          status: 'IN_PROGRESS',
        });
        info(`Re-patched to IN_PROGRESS.`);
      } catch (e) {
        warn(`Could not re-patch: ${e.message}`);
      }
    } else {
      info(`Task ${state.activeTask.specId}: IN_PROGRESS ✓ (started ${state.activeTask.startedAt})`);
    }
  } catch (e) {
    warn(`Could not reconcile with live API: ${e.message}`);
  }
  console.log('');
}

async function cmdInstall(projectDir) {
  const target = projectDir ? path.resolve(projectDir) : findGitRoot();
  const settingsDir = path.join(target, '.claude');
  const settingsPath = path.join(settingsDir, 'settings.json');
  const conductorPath = path.resolve(import.meta.url.replace('file:///', '').replace('file://', ''));

  if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')); } catch {}
  }

  settings.hooks = settings.hooks || {};

  const hookCmd = `node "${conductorPath}" check-file-hook`;
  const sessionCmd = `node "${conductorPath}" session-start`;

  // PostToolUse — file guard
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

  // SessionStart — drift reconciliation
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
  info(`File guard: PostToolUse(Write|Edit) → check-file-hook`);
  info(`Session start: SessionStart → session-start`);
  info(`\nNext: node sdd-conductor.mjs init  (to set up .sdd-state.json)`);
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

const [,, command, ...args] = process.argv;

if (!command || command === '--help' || command === '-h') {
  console.log(`
sdd-conductor v${VERSION} — SDD lifecycle enforcement

Commands:
  init                     Bootstrap .sdd-state.json (run once per project)
  start <taskId>           Mark task IN_PROGRESS. BLOCKED if deps not Done.
  complete <taskId>        Verify checklist → post comment → Done → propagate.
  status                   Show current state + live task status.
  gate <name> [taskId]     Verify named gate condition.
  check-file-hook          Claude PostToolUse hook (reads stdin JSON).
  session-start            Claude SessionStart hook — reconcile state.
  install [project-dir]    Inject hooks into .claude/settings.json.

Gate names: deps-done, research-done, no-mocks, checklist, impl-files

Exit codes: 0=pass  1=gate blocked  2=hard error
`);
  process.exit(0);
}

try {
  switch (command) {
    case 'init':           await cmdInit(); break;
    case 'start':          await cmdStart(args[0]); break;
    case 'complete':       await cmdComplete(args[0]); break;
    case 'status':         await cmdStatus(); break;
    case 'gate':           await cmdGate(args[0], args[1]); break;
    case 'check-file-hook': await cmdCheckFileHook(); break;
    case 'session-start':  await cmdSessionStart(); break;
    case 'install':        await cmdInstall(args[0]); break;
    default:               die(`Unknown command: ${command}. Run with --help.`);
  }
} catch (e) {
  if (e.code === 'ERR_CONDUCTOR_GATE') {
    process.exit(1);
  }
  die(`Unexpected error: ${e.message}`);
}
