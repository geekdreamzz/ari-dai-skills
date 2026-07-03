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
 *   node ralph-run.mjs --max-turns <n>           # claude turns per task (default: 60)
 *   node ralph-run.mjs --task-timeout-min <n>    # wall-clock minutes per task (default: 30)
 *   node ralph-run.mjs --no-skip-permissions     # do NOT pass --dangerously-skip-permissions
 *                                                #   (default is to pass it — unattended --print
 *                                                #   runs DENY non-allowlisted tools, killing tasks)
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
let maxTurns = 60;            // heavy scrub/refactor tasks blow past 30
let taskTimeoutMin = 30;      // per-task wall clock (was a hard 10 min)
// Unattended runs MUST skip interactive permission prompts: in --print mode a
// non-allowlisted tool call is DENIED (never prompted), so tasks silently fail
// with "no ADVANCE_READY sigil". Default ON — this runner exists for unattended
// operation. Opt out with --no-skip-permissions under a fully-allowlisted
// settings.json.
let skipPermissions = true;

for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--initiative' && process.argv[i + 1]) initiativeSlug = process.argv[++i];
  else if (process.argv[i] === '--max-tasks' && process.argv[i + 1]) maxTasks = parseInt(process.argv[++i]);
  else if (process.argv[i] === '--max-turns' && process.argv[i + 1]) maxTurns = parseInt(process.argv[++i]);
  else if (process.argv[i] === '--task-timeout-min' && process.argv[i + 1]) taskTimeoutMin = parseInt(process.argv[++i]);
  else if (process.argv[i] === '--dry-run') dryRun = true;
  else if (process.argv[i] === '--no-skip-permissions') skipPermissions = false;
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
2. WORK THE CHECKLIST ONE ITEM AT A TIME. For EACH unchecked checklist item, in order:
   a. Do the real work for that single item (write code, run the test, capture the screenshot)
   b. Verify it with its own evidence:
      node "${LOOP_MJS}" --check-item ${task.id} --item <N> --evidence "<real output for THIS item>"
   c. Only move to the next item after --check-item succeeds.
   --advance will REJECT the task if any box was not earned this way.
3. Task-type specifics:
   - For EX tasks: implement the code (add the spec front-matter comment to every file), verify files exist, run a smoke test
   - For VA tasks: run each acceptance criterion via --check-item, measure actual results vs thresholds; UI flows need Playwright runs + fresh screenshots of before/during/after states
   - For RS tasks: search the web for evidence, populate all required sections with real findings
   - For EP tasks: confirm all child EX+VA tasks are Done, verify epic AC
   - For AR tasks: the artifact must EMBED content — full file text in <pre><code> blocks,
     every cited file listed in single-line <code> tags AND carrying a decorator comment
     that names the parent VC key (e.g. "// artifact: VC-004"), plus raw test output.
     PATCH the task content via the API or loop tooling before advancing.
5. TYPED EVIDENCE REQUIREMENTS — your final evidence text is machine-gated by the
   task's validation_kind (read it from the task content front matter). Include:
   - api: quote the literal /api/... endpoint path(s) you exercised AND the HTTP
     status codes returned (e.g. "GET /api/v2/... -> 200").
   - data: use persisted-state vocabulary with real numbers — counts, rows, records,
     fields READ BACK after the change (e.g. "0 hits", "965 passed", "row count 3").
   - ui: fresh on-disk screenshot paths (<24h) + the Playwright "N passed" line;
     interaction flows need at least 2 screenshots.
   - benchmark: measured values WITH UNITS compared to the AC threshold.
   Evidence missing its kind's markers is REJECTED even when the commands passed.
6. When ALL checklist items are individually verified, output the following sigil EXACTLY on its own line, followed by your overall evidence:

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
  console.log(`  Claude exe:  ${claudeExe} (max-turns ${maxTurns}, timeout ${taskTimeoutMin}m/task, skip-permissions ${skipPermissions})`);
  console.log(`  Fail log:    ${FAIL_LOG}\n`);

  // Verify loop.mjs exists
  if (!fs.existsSync(LOOP_MJS)) {
    console.error(`✗ loop.mjs not found at ${LOOP_MJS}`);
    process.exit(2);
  }

  let tasksCompleted = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  // Tasks that died on "Reached max turns" get ONE retry at double the budget
  // before counting as a consecutive failure — heavy refactor tasks routinely
  // need more turns than the default.
  const turnBoost = new Map(); // taskId -> multiplier

  while (tasksCompleted < maxTasks) {
    // ── Step 1: get next task ──────────────────────────────────────────────
    // --next runs board reconciliation (many API writes) — it can legitimately
    // take minutes, and its JSON includes full hierarchy content (>1 MB).
    // 30s/1MB caps here previously killed the runner mid-flight with
    // "Unexpected end of JSON input". Retry transient failures with backoff.
    let nextJson = null;
    // 6 x 15s: workers edit src/, nodemon restarts the dev API, and a socket
    // error is almost always that restart window — outlast it, don't die in it.
    const NEXT_ATTEMPTS = 6;
    for (let attempt = 1; attempt <= NEXT_ATTEMPTS && !nextJson; attempt++) {
      try {
        const result = spawnSync('node', [LOOP_MJS, ...(initiativeSlug ? ['--initiative', initiativeSlug] : []), '--next'], {
          encoding: 'utf-8', timeout: 300000, maxBuffer: 64 * 1024 * 1024,
        });
        if (result.status !== 0 || !result.stdout?.trim()) {
          throw new Error(`exit=${result.status} signal=${result.signal || 'none'} stdoutLen=${result.stdout?.length || 0} stderr: ${(result.stderr || '').slice(-300)}`);
        }
        nextJson = JSON.parse(result.stdout.trim());
      } catch (e) {
        console.error(`✗ --next attempt ${attempt}/${NEXT_ATTEMPTS} failed: ${e.message.slice(0, 400)}`);
        if (attempt === NEXT_ATTEMPTS) { console.error('✗ Giving up on --next.'); process.exit(1); }
        // Portable sleep — never shell out (cmd vs GNU `timeout` are incompatible).
        spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 15000)'], { timeout: 20000 });
      }
    }

    if (nextJson.status === 'complete' || nextJson.status === 'done') {
      console.log(`\n✅ All tasks complete! ${nextJson.done}/${nextJson.total} (${nextJson.pct}%)`);
      if (nextJson.generateNextStepsPage) {
        console.log('  ⚡ DONE MODE pending — generate the Next Steps & UAT page (see SKILL.md § Mode: DONE).');
      }
      break;
    }

    if (nextJson.status === 'awaiting-review') {
      console.error(`\n⛔ Loop NOT started — board awaiting human review.`);
      console.error(`  ${nextJson.reason}`);
      if (nextJson.review?.board) console.error(`  Board:     ${nextJson.review.board}`);
      if (nextJson.review?.dashboard) console.error(`  Dashboard: ${nextJson.review.dashboard}`);
      console.error(`  The human must review and green-light before the loop runs:`);
      console.error(`  ${nextJson.action || 'node loop.mjs --greenlight'}`);
      process.exit(1);
    }

    if (nextJson.status === 'intake-blocked' || nextJson.status === 'intake-pending') {
      console.error(`\n⚠ Loop paused — ${nextJson.reason}`);
      console.error(`  ${nextJson.action || 'Triage pending intake items, then re-run.'}`);
      process.exit(1);
    }

    if (!nextJson.task) {
      console.error('✗ --next returned no task but status != complete. Board may be in an inconsistent state.');
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
    const boost = turnBoost.get(task.id) || 1;
    const effectiveTurns = maxTurns * boost;
    const claudeArgs = ['--print', '--max-turns', String(effectiveTurns)];
    if (skipPermissions) claudeArgs.push('--dangerously-skip-permissions');
    console.log(`   [${new Date().toISOString()}] Invoking: ${claudeExe} ${claudeArgs.join(' ')} (timeout ${taskTimeoutMin * boost}m${boost > 1 ? `, boosted x${boost}` : ''})`);
    const claudeResult = spawnSync(claudeExe, claudeArgs, {
      input: prompt,
      encoding: 'utf-8',
      timeout: taskTimeoutMin * boost * 60000,
      maxBuffer: 64 * 1024 * 1024,
      cwd: GIT_ROOT,            // tasks always execute from the repo root
      shell: process.platform === 'win32', // npm .cmd shims need a shell on Windows
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
      // Heavy tasks legitimately outgrow the turn budget — give the SAME task
      // one escalating retry (x2, then x4) before it counts as a failure.
      if (/reached max turns/i.test(claudeOutput) && boost < 4) {
        turnBoost.set(task.id, boost * 2);
        console.log(`   ⏫ Reached max turns (${effectiveTurns}) — retrying ${task.key} with x${boost * 2} turn budget.`);
        continue;
      }
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
    // --advance EXECUTES the VC's validation commands live (playwright suites,
    // dockerized gitleaks, …) — 60s was far too tight. 20 min + big buffer.
    ], { encoding: 'utf-8', timeout: 1200000, maxBuffer: 64 * 1024 * 1024 });

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
