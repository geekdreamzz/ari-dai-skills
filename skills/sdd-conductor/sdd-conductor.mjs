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

  // Gate 2: Completion comment must exist with [all-dai-sdd-system-message]
  const comments = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${taskId}/comments`);
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

  // Gate 2b: Test evidence required — at least one test run or test statement in comments
  const totalCheckedItems = (task.content?.match(/data-checked="true"/g) || []).length;
  const hasTestEvidence = commentList.some(c =>
    c.content?.includes('[all-dai-sdd-system-message]') &&
    (c.content?.includes('Test Run —') || c.content?.includes('✅') || c.content?.includes('tests passed') || c.content?.includes('playwright') || c.content?.includes('vitest'))
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
    const epicSpecId = extractSpecId(updated) || epic.title?.match(/^[A-Z]+-\d+/)?.[0] || epicTaskId;
    if (remaining === 0) {
      info(`Epic fully complete — posting ready-for-validation comment`);
      await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${epicTaskId}/comments`, {
        content: `[all-dai-sdd-system-message]\n\nAll Execution tasks complete. Ready for Validation.`,
      });
      // Propagate up to parent North Star (if any)
      if (epic.parentId) {
        await propagateNsChecklist(client, state, epic.parentId, epicSpecId, epic.title);
      }
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
  if (!state?.activeTask) return;

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

    await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${state.activeTask.taskId}/comments`, {
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
  const state = requireState();
  if (!state.activeTask) die('No active task. Run: node sdd-conductor.mjs start <taskId>');
  const client = makeClient();

  await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${state.activeTask.taskId}/comments`, {
    content: `[all-dai-sdd-system-message]\n\n**Progress:** ${message}\n\n_${new Date().toISOString()}_`,
  });

  ok(`Progress posted to task ${state.activeTask.specId}`);
}

async function cmdValidate(vaTaskId, extraArgs) {
  if (!vaTaskId) die('Usage: validate <vaTaskId> [--metric <n> --threshold <n> --iteration <n>]');
  const state = requireState();
  const client = makeClient();

  // Parse flags
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

  console.log(`\n🔁 SDD-CONDUCTOR VALIDATE`);
  info(`VA task: ${vaTaskId}`);
  if (metric !== null) info(`Metric: ${metric} / threshold: ${threshold} (iteration ${iteration})`);

  const task = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${vaTaskId}`);
  const specId = extractSpecId(task.content) || task.title?.match(/^[A-Z]+-\d+/)?.[0] || vaTaskId;

  const passed = metric === null || metric >= threshold;

  if (passed) {
    info(`Metric ${metric} >= threshold ${threshold} — PASSED`);

    // Tick all checklist items
    let updatedContent = task.content || '';
    const originalContent = updatedContent;
    updatedContent = updatedContent.replace(/data-checked="false"/g, 'data-checked="true"');
    if (updatedContent !== originalContent) {
      await client.patch(`/api/v2/dataspheres/${state.dsId}/tasks/${vaTaskId}`, { content: updatedContent });
      info(`Checklist: all items ticked ✓`);
    }

    // Post completion comment
    const commentLines = [
      `[all-dai-sdd-system-message]`,
      ``,
      `**Validation PASSED** — ${specId} | ${new Date().toISOString()}`,
      ``,
    ];
    if (metric !== null) commentLines.push(`- Metric: ${metric} / threshold: ${threshold}`);
    if (iteration > 1) commentLines.push(`- Completed on iteration ${iteration}`);
    commentLines.push(`\n**Completion summary:** All acceptance criteria met.`);
    commentLines.push(`**Verified criteria:** Metric at or above threshold, all checklist items checked.`);

    await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${vaTaskId}/comments`, {
      content: commentLines.join('\n'),
    });
    info(`Completion comment posted ✓`);

    await client.patch(`/api/v2/dataspheres/${state.dsId}/tasks/${vaTaskId}`, {
      statusGroupId: state.doneGroupId,
      status: 'DONE',
    });
    info(`Task PATCH: status=DONE, statusGroupId=${state.doneGroupId} ✓`);

    if (task.parentId) {
      await propagateEpicChecklist(client, state, task.parentId, specId, task.title);
    }

    // Clear active task — VA cycle complete
    state.activeTask = null;
    state.lastCompleted = { taskId: vaTaskId, specId, title: task.title, completedAt: new Date().toISOString() };
    saveState(state);

    ok(`${specId} validated and moved to Done.`);
    process.exit(0);

  } else {
    const delta = (threshold - metric).toFixed(2);
    const nextIter = iteration + 1;
    info(`Metric ${metric} < threshold ${threshold} (delta: -${delta}) — FAILED`);

    // If there is an active EX task in state, post a link on it and clear it
    if (state.activeTask && state.activeTask.taskId !== vaTaskId) {
      try {
        await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${state.activeTask.taskId}/comments`, {
          content: [
            `[all-dai-sdd-system-message]`,
            ``,
            `**Validation failed on ${specId}** — iteration ${iteration}. Refinement task will be created.`,
            `Metric: ${metric} / threshold: ${threshold} (delta: -${delta})`,
          ].join('\n'),
        });
      } catch { /* non-fatal */ }
    }
    // Clear active EX task — a new iteration task will be started next
    state.activeTask = null;
    saveState(state);

    // Post failure comment on the VA task
    await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${vaTaskId}/comments`, {
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

    // Auto-create next iteration EX task
    if (state.executionGroupId) {
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
        `tags: [${state.initiative}, sdd, execution, refinement]`,
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

      const created = await client.post(`/api/v2/dataspheres/${state.dsId}/tasks`, {
        title: newTitle,
        statusGroupId: state.executionGroupId,
        tags: [state.initiative, 'sdd', 'execution', 'refinement'],
        parentId: task.parentId || null,
        content: newContent,
      });

      const newId = created.task?.id || created.id || 'unknown';
      info(`Iteration ${nextIter} task created: ${newTitle} (${newId})`);
    } else {
      warn(`executionGroupId not set — run 'init' again or set manually to enable auto-iteration`);
    }

    process.exit(1); // signal: loop should continue
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
  const content = data.page?.content || data.content || '';

  const REQUIRED = [
    { label: 'progress-summary widget',   pattern: /data-widget-type="progress-summary"/ },
    { label: 'trace-graph widget',        pattern: /data-widget-type="trace-graph"/ },
    { label: 'task-activity-feed widget', pattern: /data-widget-type="task-activity-feed"/ },
    { label: 'doc-footer element',        pattern: /data-type="doc-footer"/ },
    { label: 'H1 title',                  pattern: /<h1[^>]*>/ },
  ];

  const missing = REQUIRED.filter(r => !r.pattern.test(content)).map(r => r.label);

  if (missing.length > 0) {
    gate(
      `Dashboard page "${pageSlug}" is missing required sections:\n\n` +
      missing.map(m => `  ✗ ${m}`).join('\n') +
      `\n\nFix the page content at ${baseUrl}/app/${dsUri}/pages/${pageSlug} to include all 5 sections.`
    );
  }

  // Warn if inline styles are present (anti-pattern)
  if (/style="[^"]*"/.test(content)) {
    warn(`Dashboard has inline style= attributes — these should be removed (native widgets only)`);
  }

  ok(`GATE dashboard-check: all 5 required sections present`);
  REQUIRED.forEach(r => info(`  ✓ ${r.label}`));
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
  const progressHookCmd = `node "${conductorPath}" progress-hook`;
  const sessionCmd = `node "${conductorPath}" session-start`;

  // PostToolUse — file guard (Write|Edit)
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

  // PostToolUse — progress hook (Bash) — auto-posts test results to active task
  const existingProgressHook = settings.hooks.PostToolUse.find(
    h => h.hooks?.some(hh => hh.command?.includes('progress-hook'))
  );
  if (!existingProgressHook) {
    settings.hooks.PostToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: progressHookCmd }],
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
  info(`File guard:      PostToolUse(Write|Edit) → check-file-hook`);
  info(`Progress hook:   PostToolUse(Bash)        → progress-hook  (auto-posts test results)`);
  info(`Session start:   SessionStart              → session-start`);
  info(`\nNext: node sdd-conductor.mjs init  (to set up .sdd-state.json)`);
}

async function cmdDrive() {
  const state = requireState();
  const client = makeClient();

  console.log(`\n🚀 SDD-CONDUCTOR DRIVE PLAN`);
  info(`Initiative: ${state.initiative} | ${state.dsUri}`);

  const allTasks = await client.get(
    `/api/v2/dataspheres/${state.dsId}/tasks?planModeId=${state.planModeId}&limit=500`
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

  // Show active task
  if (state.activeTask) {
    console.log(`\n  ACTIVE TASK:`);
    info(`  ${state.activeTask.specId} — ${state.activeTask.title}`);
    info(`  Started: ${state.activeTask.startedAt}`);
    info(`  Impl files: ${state.activeTask.implFiles?.join(', ') || '(none)'}`);
    info(`  When done: node sdd-conductor.mjs complete ${state.activeTask.taskId}`);
  }

  // Research — any non-Done RS tasks block NS
  const rsTasks = taskList.filter(t => t.title?.match(/^RS-/) && !isDone(t));
  if (rsTasks.length > 0) {
    console.log(`\n  RESEARCH REQUIRED (${rsTasks.length}):`);
    for (const t of rsTasks) {
      const specId = extractSpecId(t.content) || t.title?.match(/^RS-\d+/)?.[0] || t.id;
      info(`  ${specId} · ${t.title}`);
      info(`    → node sdd-conductor.mjs start ${t.id}  (run start_research, populate, complete)`);
    }
  }

  // Execution — ready (all deps Done) vs blocked
  const exTasks = (groups['execution'] || []).filter(t => !isDone(t) && t.id !== state.activeTask?.taskId);
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

  // Validation — non-Done VA tasks
  const vaTasks = (groups['validation'] || []).filter(t => !isDone(t));
  if (vaTasks.length > 0) {
    console.log(`\n  NEEDS VALIDATION (${vaTasks.length}):`);
    for (const t of vaTasks) {
      const specId = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
      const iterComments = t._commentCount || '';
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

  // NS status — show any NS tasks with all checklist items checked but not Done
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

  // Summary line
  const doneCount = (groups['done'] || []).length;
  const pct = taskList.length > 0 ? Math.round(doneCount / taskList.length * 100) : 0;
  console.log(`\n  PROGRESS: ${doneCount}/${taskList.length} Done (${pct}%) | ${readyTasks.length} Ready | ${vaTasks.length} In Validation | ${blockedTasks.length} Blocked`);

  if (!state.activeTask && readyTasks.length > 0) {
    const next = readyTasks[0];
    const specId = extractSpecId(next.task.content) || next.task.title?.match(/^[A-Z]+-\d+/)?.[0] || '';
    console.log(`\n  ▶ NEXT: node sdd-conductor.mjs start ${next.task.id}  # ${specId}`);
  } else if (!state.activeTask && vaTasks.length > 0) {
    console.log(`\n  ▶ NEXT: run validation test then call: node sdd-conductor.mjs validate ${vaTasks[0].id}`);
  } else if (!state.activeTask && rsTasks.length > 0) {
    console.log(`\n  ▶ NEXT: node sdd-conductor.mjs start ${rsTasks[0].id}  # ${rsTasks[0].title}`);
  } else if (doneCount === taskList.length && taskList.length > 0) {
    console.log(`\n  ✅ All ${taskList.length} tasks complete!`);
  }
  console.log('');
}

async function cmdSync() {
  const state = requireState();
  const client = makeClient();

  console.log(`\n🔄 SDD-CONDUCTOR SYNC`);
  info(`Initiative: ${state.initiative}`);

  const allTasks = await client.get(
    `/api/v2/dataspheres/${state.dsId}/tasks?planModeId=${state.planModeId}&limit=500`
  );
  const liveTaskList = allTasks.tasks || allTasks || [];

  const liveBySpecId = {};
  for (const t of liveTaskList) {
    const specId = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0];
    if (specId) liveBySpecId[specId] = t;
  }

  let issues = 0;

  // Compare against tasks.yaml if present
  const root = findGitRoot();
  const yamlPath = [path.join(root, 'tasks.yaml'), ...findTasksYamls(root)].find(p => fs.existsSync(p));

  if (yamlPath) {
    const yaml = fs.readFileSync(yamlPath, 'utf-8');
    const yamlIds = [...yaml.matchAll(/^\s*id:\s*(\S+)/gm)].map(m => m[1]);
    const newInYaml = yamlIds.filter(id => !liveBySpecId[id]);
    const onBoardNotInYaml = Object.keys(liveBySpecId).filter(id =>
      !yamlIds.includes(id) && !id.includes('-iter') // iter tasks are auto-created, expected
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

  // Execution tasks that have drifted out of IN_PROGRESS
  const drifted = liveTaskList.filter(t => {
    const col = getColumnName(t).toLowerCase();
    return col === 'execution' && !isDone(t) && t.status !== 'IN_PROGRESS' && t.id !== state.activeTask?.taskId;
  });
  if (drifted.length > 0) {
    console.log(`\n  EXECUTION DRIFT (in Execution column but not IN_PROGRESS):`);
    for (const t of drifted) {
      const specId = extractSpecId(t.content) || t.title?.match(/^[A-Z]+-\d+/)?.[0] || t.id;
      info(`  ${specId} · ${t.title} [${t.status}]`);
    }
    issues += drifted.length;
  }

  // State vs live — active task reconciliation
  if (state.activeTask) {
    try {
      const live = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${state.activeTask.taskId}`);
      if (isDone(live)) {
        warn(`Active task ${state.activeTask.specId} is already Done on board — clearing state`);
        state.activeTask = null;
        saveState(state);
        issues++;
      }
    } catch { /* non-fatal */ }
  }

  // NS tasks ready to close
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
}

async function propagateNsChecklist(client, state, nsTaskId, doneEpicSpecId, doneEpicTitle) {
  try {
    const ns = await client.get(`/api/v2/dataspheres/${state.dsId}/tasks/${nsTaskId}`);
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

    await client.patch(`/api/v2/dataspheres/${state.dsId}/tasks/${nsTaskId}`, { content: updated });
    info(`NS checklist: ticked ${idPrefix} ✓`);

    const remaining = countUncheckedItems(updated);
    if (remaining === 0) {
      await client.post(`/api/v2/dataspheres/${state.dsId}/tasks/${nsTaskId}/comments`, {
        content: `[all-dai-sdd-system-message]\n\nAll Epics complete. North Star fully achieved — ready for final review.`,
      });
      info(`North Star ${idPrefix}: all Epics done — completion comment posted ✓`);
    }
  } catch (e) {
    warn(`Could not propagate to NS ${nsTaskId}: ${e.message}`);
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

const [,, command, ...args] = process.argv;

if (!command || command === '--help' || command === '-h') {
  console.log(`
sdd-conductor v${VERSION} — SDD lifecycle enforcement

Commands:
  init                                  Bootstrap .sdd-state.json (run once per project)
  drive                                 Ordered mission brief — what to do next end-to-end
  sync                                  Mid-plan reconcile: diff tasks.yaml vs live board
  start <taskId>                        Mark task IN_PROGRESS. BLOCKED if deps not Done.
  complete <taskId>                     Verify checklist + test evidence → Done → propagate NS/Epic.
  progress <message>                    Post progress milestone to active task (board visibility).
  validate <vaTaskId> [flags]           Ralph loop gate. Pass → Done+propagate. Fail → next iteration.
    --metric <n>                          Current metric (e.g. 85 for 85% pass rate)
    --threshold <n>                       Required to pass (default: 100)
    --iteration <n>                       Current iteration number (default: 1)
  status                                Show current state + live task status.
  gate <name> [taskId]                  Verify named gate condition.
  dashboard-check <dsUri> <slug>        Verify dashboard page has all 5 required sections.
  check-file-hook                       PostToolUse(Write|Edit) hook — file guard.
  progress-hook                         PostToolUse(Bash) hook — auto-post test results.
  session-start                         SessionStart hook — reconcile state.
  install [project-dir]                 Inject all hooks into .claude/settings.json.

Gate names: deps-done, research-done, no-mocks, checklist, impl-files

Exit codes: 0=pass  1=gate blocked / loop continues  2=hard error
`);
  process.exit(0);
}

try {
  switch (command) {
    case 'init':            await cmdInit(); break;
    case 'drive':           await cmdDrive(); break;
    case 'sync':            await cmdSync(); break;
    case 'start':           await cmdStart(args[0]); break;
    case 'complete':        await cmdComplete(args[0]); break;
    case 'progress':        await cmdProgress(args.join(' ')); break;
    case 'validate':        await cmdValidate(args[0], args.slice(1)); break;
    case 'status':          await cmdStatus(); break;
    case 'gate':            await cmdGate(args[0], args[1]); break;
    case 'dashboard-check': await cmdDashboardCheck(args[0], args[1]); break;
    case 'check-file-hook': await cmdCheckFileHook(); break;
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
