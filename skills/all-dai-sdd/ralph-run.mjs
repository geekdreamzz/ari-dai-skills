#!/usr/bin/env node
/**
 * ralph-run.mjs — Stateless external loop runner for all-dai-sdd
 *
 * Solves the "long-session attention decay" problem: instead of running Claude
 * in one continuous conversation until the board is 100% Done (risking drift
 * and rubber-stamping as the context window fills), this runner drives each
 * task as an independent, fresh claude -p invocation.
 *
 * Flow per task:
 *   1. loop.mjs --next          → JSON with next incomplete task
 *   2. Build a focused prompt   → task spec + failure context + advance sigil instructions
 *   3. claude --print --max-turns 30 < prompt  → Claude works the task
 *   4. Parse ADVANCE_READY sigil from output    → extract evidence
 *   5. loop.mjs --advance <id> --evidence "..."  → gate checks + board write
 *   6. On failure → log to .sdd-failures.log, inject into next task's prompt
 *
 * Usage:
 *   node ralph-run.mjs                           # run until done or first failure
 *   node ralph-run.mjs --initiative <slug>       # target a specific initiative
 *   node ralph-run.mjs --max-tasks <n>           # stop after N tasks (default: unlimited)
 *   node ralph-run.mjs --dry-run                 # print prompts, no claude invocations
 *   node ralph-run.mjs --claude <path>           # override claude executable (default: claude)
 *
 * Requirements:
 *   - `claude` CLI installed and on PATH (https://claude.ai/claude-code)
 *   - DATASPHERES_API_KEY set in ~/.dataspheres.env or .env
 *   - .sdd-state.json initialised (node sdd-conductor.mjs init)
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── CLI args ──────────────────────────────────────────────────────────────────
let initiativeSlug = null;
let maxTasks = Infinity;
let dryRun = false;
let claudeExe = 'claude';

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--initiative' && process.argv[i + 1]) initiativeSlug = process.argv[++i];
  else if (process.argv[i] === '--max-tasks' && process.argv[i + 1]) maxTasks = parseInt(process.argv[++i]);
  else if (process.argv[i] === '--dry-run') dryRun = true;
  else if (process.argv[i] === '--claude' && process.argv[i + 1]) claudeExe = process.argv[++i];
}

// ── Paths ─────────────────────────────────────────────────────────────────────
function findGitRoot() {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim(); }
  catch { return process.cwd(); }
}

const GIT_ROOT = findGitRoot();
const SKILL_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const LOOP_MJS = path.join(SKILL_DIR, 'loop.mjs');
const FAIL_LOG = path.join(GIT_ROOT, '.sdd-failures.log');

function loop(...extraArgs) {
  const base = ['node', LOOP_MJS];
  if (initiativeSlug) base.push('--initiative', initiativeSlug);
  return [...base, ...extraArgs];
}

// ── Failure log ───────────────────────────────────────────────────────────────
function appendFailure(taskId, taskKey, reason) {
  const entry = `[${new Date().toISOString()}] ${taskKey || taskId} — ${reason}\n---\n`;
  fs.appendFileSync(FAIL_LOG, entry, 'utf-8');
}

function recentFailures(n = 5) {
  if (!fs.existsSync(FAIL_LOG)) return '';
  const lines = fs.readFileSync(FAIL_LOG, 'utf-8').split('\n');
  return lines.slice(-Math.min(lines.length, n * 10)).join('\n');
}

// ── Prompt builder ────────────────────────────────────────────────────────────
function buildPrompt(task, failures) {
  const failCtx = failures
    ? `\n## Recent Failures (do NOT repeat these mistakes)\n\`\`\`\n${failures}\n\`\`\`\n`
    : '';

  return `You are the all-dai-sdd loop runner. Your job is to complete the following task and output the ADVANCE_READY sigil when done.

## Task
Key: ${task.key || task.type}
ID:  ${task.id}
Title: ${task.title}

## Task Content (full spec)
${task.content}
${failCtx}
## Instructions

1. READ the task content above carefully. Understand what is required.
2. DO the actual work:
   - For EX tasks: implement the code, verify files exist, run a smoke test
   - For VA tasks: run each acceptance criterion, measure actual results vs thresholds
   - For RS tasks: search the web for evidence, populate all required sections with real findings
   - For EP tasks: confirm all child EX+VA tasks are Done, verify epic AC
   - For AR tasks: document the real produced artifacts with file paths and line counts
3. When the work is complete, output the following sigil EXACTLY on its own line, followed by your evidence:

ADVANCE_READY
[EXECUTED]
<the command or action you ran>

[OUTPUT]
<real output — file paths, line counts, test results, measured values>

[VERDICT]
<what passed, what failed, what you fixed>

IMPORTANT:
- The evidence MUST be at least 200 characters
- Do NOT use boilerplate like "job ran", "file saved", "no errors", "all done"
- Include real file paths, actual command output, or measured numbers
- If the task FAILS (cannot be completed), output BLOCKED instead of ADVANCE_READY,
  followed by a clear explanation of what is blocking it
`;
}

// ── Advance sigil parser ──────────────────────────────────────────────────────
function parseClaudeOutput(output) {
  const advIdx = output.indexOf('ADVANCE_READY');
  if (advIdx !== -1) {
    const evidence = output.slice(advIdx + 'ADVANCE_READY'.length).trim();
    return { action: 'advance', evidence };
  }
  const blockedIdx = output.indexOf('BLOCKED');
  if (blockedIdx !== -1) {
    const reason = output.slice(blockedIdx + 'BLOCKED'.length).trim();
    return { action: 'blocked', reason };
  }
  return { action: 'unknown', raw: output.slice(-500) };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n━━━ ralph-run: all-dai-sdd external loop runner ━━━');
  if (dryRun) console.log('  DRY RUN — no claude invocations, no board writes\n');
  if (initiativeSlug) console.log(`  Initiative: ${initiativeSlug}`);
  console.log(`  Loop script: ${LOOP_MJS}`);
  console.log(`  Claude exe:  ${claudeExe}`);
  console.log(`  Fail log:    ${FAIL_LOG}\n`);

  // Verify loop.mjs exists
  if (!fs.existsSync(LOOP_MJS)) {
    console.error(`✗ loop.mjs not found at ${LOOP_MJS}`);
    process.exit(2);
  }

  let tasksCompleted = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  while (tasksCompleted < maxTasks) {
    // ── Step 1: get next task ──────────────────────────────────────────────
    let nextJson;
    try {
      const [, ...nextArgs] = loop('--next');
      const result = spawnSync('node', [LOOP_MJS, ...(initiativeSlug ? ['--initiative', initiativeSlug] : []), '--next'], {
        encoding: 'utf-8', timeout: 30000,
      });
      if (result.status !== 0) {
        console.error('✗ loop.mjs --next failed:', result.stderr?.slice(0, 300));
        process.exit(1);
      }
      nextJson = JSON.parse(result.stdout.trim());
    } catch (e) {
      console.error('✗ Failed to get next task:', e.message);
      process.exit(1);
    }

    if (nextJson.status === 'done') {
      console.log(`\n✅ All tasks complete! ${nextJson.done}/${nextJson.total} (${nextJson.pct}%)`);
      break;
    }

    if (!nextJson.task) {
      console.error('✗ --next returned no task but status != done. Board may be in an inconsistent state.');
      process.exit(1);
    }

    const task = nextJson.task;
    console.log(`\n→ [${tasksCompleted + 1}] ${task.key || task.type} · ${task.title}`);
    console.log(`   Progress: ${nextJson.done}/${nextJson.total} (${nextJson.pct}%)`);

    // ── Step 2: build prompt ───────────────────────────────────────────────
    const failures = recentFailures(3);
    const prompt = buildPrompt(task, failures);

    if (dryRun) {
      console.log('\n[DRY RUN] Would send prompt:');
      console.log(prompt.slice(0, 500) + '...');
      tasksCompleted++;
      continue;
    }

    // ── Step 3: invoke claude ──────────────────────────────────────────────
    console.log(`   Invoking: ${claudeExe} --print --max-turns 30`);
    const claudeResult = spawnSync(claudeExe, ['--print', '--max-turns', '30'], {
      input: prompt,
      encoding: 'utf-8',
      timeout: 600000, // 10 min max per task
    });

    if (claudeResult.error) {
      console.error(`✗ Failed to spawn ${claudeExe}: ${claudeResult.error.message}`);
      console.error('  Is the claude CLI installed? https://claude.ai/claude-code');
      appendFailure(task.id, task.key, `spawn failed: ${claudeResult.error.message}`);
      process.exit(2);
    }

    const claudeOutput = (claudeResult.stdout || '') + (claudeResult.stderr || '');

    // ── Step 4: parse sigil ────────────────────────────────────────────────
    const parsed = parseClaudeOutput(claudeOutput);

    if (parsed.action === 'blocked') {
      console.log(`   ⚠  Task BLOCKED by Claude: ${parsed.reason.slice(0, 200)}`);
      appendFailure(task.id, task.key, `BLOCKED: ${parsed.reason.slice(0, 300)}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n✗ ${MAX_CONSECUTIVE_FAILURES} consecutive failures — halting. Check ${FAIL_LOG} for details.`);
        process.exit(1);
      }
      continue;
    }

    if (parsed.action !== 'advance') {
      console.log(`   ⚠  No ADVANCE_READY sigil found in Claude output.`);
      console.log(`   Last 300 chars: ${(claudeOutput || '').slice(-300)}`);
      appendFailure(task.id, task.key, `no ADVANCE_READY sigil. Output tail: ${claudeOutput.slice(-200)}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n✗ ${MAX_CONSECUTIVE_FAILURES} consecutive failures — halting. Check ${FAIL_LOG} for details.`);
        process.exit(1);
      }
      continue;
    }

    // ── Step 5: advance task ───────────────────────────────────────────────
    console.log(`   Advancing ${task.key} with evidence (${parsed.evidence.length} chars)...`);
    const advResult = spawnSync('node', [
      LOOP_MJS,
      ...(initiativeSlug ? ['--initiative', initiativeSlug] : []),
      '--advance', task.id,
      '--evidence', parsed.evidence,
    ], { encoding: 'utf-8', timeout: 60000 });

    if (advResult.status !== 0) {
      const errMsg = (advResult.stdout || '') + (advResult.stderr || '');
      console.error(`   ✗ --advance failed for ${task.key}:`);
      console.error(`   ${errMsg.slice(0, 400)}`);
      appendFailure(task.id, task.key, `--advance failed: ${errMsg.slice(0, 300)}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n✗ ${MAX_CONSECUTIVE_FAILURES} consecutive failures — halting. Check ${FAIL_LOG} for details.`);
        process.exit(1);
      }
      continue;
    }

    console.log(`   ✅ ${task.key} Done`);
    if (advResult.stdout) process.stdout.write(advResult.stdout);
    tasksCompleted++;
    consecutiveFailures = 0;
  }

  if (tasksCompleted >= maxTasks) {
    console.log(`\n⏹  Stopped after ${tasksCompleted} tasks (--max-tasks ${maxTasks}).`);
  }
}

main().catch(e => {
  console.error('✗ Unexpected error:', e.message);
  process.exit(2);
});
