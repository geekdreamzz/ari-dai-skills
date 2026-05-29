#!/usr/bin/env node
/**
 * comfyui-restart — kill and restart the local ComfyUI process, poll until ready.
 *
 * Configuration (env vars, all optional with sensible defaults):
 *   COMFYUI_PYTHON   — path to the Python executable that runs ComfyUI
 *                      default: "python" (system PATH)
 *   COMFYUI_MAIN_PY  — path to ComfyUI's main.py
 *                      default: "ComfyUI/main.py" (relative to cwd)
 *   COMFYUI_WORKDIR  — working directory for the ComfyUI process
 *                      default: dirname of COMFYUI_MAIN_PY, or cwd
 *   COMFYUI_LOGFILE  — log file path (created / overwritten on each restart)
 *                      default: "comfyui.log" beside main.py
 *   COMFYUI_HEALTH   — health-check URL to poll after restart
 *                      default: "http://127.0.0.1:8188/system_stats"
 *
 * CLI overrides (take precedence over env vars):
 *   --health-url=<url>   override health URL
 *   --timeout=<seconds>  override poll timeout (default 120)
 *
 * Usage:
 *   node comfyui-restart.mjs
 *   COMFYUI_PYTHON=.venv/bin/python node comfyui-restart.mjs --timeout=180
 *
 * Claude Code invoke:
 *   node ari-dai-skills/skills/comfyui-restart/comfyui-restart.mjs
 */

import { execSync, spawn } from 'child_process';
import { existsSync, openSync } from 'fs';
import { dirname, resolve } from 'path';

// Resolve paths — env vars first, then safe defaults
const PYTHON    = process.env.COMFYUI_PYTHON   ?? 'python';
const MAIN_PY   = process.env.COMFYUI_MAIN_PY  ?? 'ComfyUI/main.py';
const WORKDIR   = process.env.COMFYUI_WORKDIR  ?? (existsSync(MAIN_PY) ? dirname(resolve(MAIN_PY)) : process.cwd());
const LOGFILE   = process.env.COMFYUI_LOGFILE  ?? resolve(dirname(resolve(MAIN_PY)), 'comfyui.log');
const HEALTH    = process.argv.find(a => a.startsWith('--health-url='))?.split('=')[1]
                ?? process.env.COMFYUI_HEALTH
                ?? 'http://127.0.0.1:8188/system_stats';
const TIMEOUT   = parseInt(process.argv.find(a => a.startsWith('--timeout='))?.split('=')[1] ?? '120', 10);
const ARGS      = ['--listen', '--port', '8188'];

function log(msg) { console.log(`[comfyui-restart] ${msg}`); }
function die(msg) { console.error(`[comfyui-restart] ERROR: ${msg}`); process.exit(1); }

function findComfyPid() {
  // Use netstat to find whatever process is listening on port 8188
  try {
    const out = execSync('netstat -ano', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    for (const line of out.split('\n')) {
      if (line.includes(':8188') && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(pid)) return pid;
      }
    }
  } catch {}
  // Fallback: WMIC by command line (backslashes need quadruple escape in WMIC LIKE)
  try {
    const out = execSync(
      'wmic process where "CommandLine like \'%ComfyUI%main.py%\'" get ProcessId /format:value',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const m = out.match(/ProcessId=(\d+)/);
    if (m) return parseInt(m[1], 10);
  } catch {}
  return null;
}

function kill(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    log(`Killed PID ${pid}.`);
  } catch {
    log(`PID ${pid} already gone.`);
  }
}

async function pollReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    try {
      const res = await fetch(HEALTH, { signal: AbortSignal.timeout(4000) });
      if (res.ok) return true;
    } catch { /* still starting */ }
    const sLeft = Math.max(0, Math.round((deadline - Date.now()) / 1000));
    log(`Waiting... (${sLeft}s left)`);
  }
  return false;
}

async function main() {
  // 1. Kill existing ComfyUI
  const pid = findComfyPid();
  if (pid) {
    log(`Stopping ComfyUI (PID ${pid})...`);
    kill(pid);
    await new Promise(r => setTimeout(r, 2000));
  } else {
    log('No running ComfyUI found — starting fresh.');
  }

  // 2. Start new ComfyUI (detached, log to file)
  if (!existsSync(PYTHON)) die(`Python not found: ${PYTHON}`);
  if (!existsSync(MAIN_PY)) die(`main.py not found: ${MAIN_PY}`);

  log(`Starting ComfyUI...`);
  const logFd = openSync(LOGFILE, 'w');
  const child = spawn(PYTHON, [MAIN_PY, ...ARGS], {
    cwd: WORKDIR,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  // close the fd in parent — child has its own reference
  import('fs').then(({ closeSync }) => { try { closeSync(logFd); } catch {} });
  log(`ComfyUI started (PID ${child.pid}). Log: ${LOGFILE}`);

  // 3. Poll until ready
  log(`Polling ${HEALTH} (timeout: ${TIMEOUT}s)...`);
  const ready = await pollReady(TIMEOUT * 1000);

  if (ready) {
    log(`ComfyUI is READY. PID=${child.pid}`);
    console.log(`PID=${child.pid}`);
    process.exit(0);
  } else {
    die(`ComfyUI did not respond within ${TIMEOUT}s. Check ${LOGFILE}`);
  }
}

main().catch(e => die(e.message));
