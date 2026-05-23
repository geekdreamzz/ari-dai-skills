#!/usr/bin/env node
// Publish all-dai-sdd architecture page with Mermaid diagrams
// Usage: node publish-arch-page.mjs [--prod]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const isProd = process.argv.includes('--prod');

// Load env
const envFile = path.join(os.homedir(), '.dataspheres.env');
const env = {};
for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
}

const API_KEY = isProd ? process.env.PROD_API_KEY : env.DATASPHERES_API_KEY;
const BASE    = isProd ? (process.env.PROD_BASE_URL || 'https://dataspheres-ai.onrender.com') : 'http://localhost:3000';
const PUBLIC  = isProd ? 'https://dataspheres.ai' : (env.DATASPHERES_PUBLIC_URL || 'https://dev.dataspheres.ai');
const DS_URI  = isProd ? (process.env.PROD_DS_URI || 'dataspheres-ai') : 'dataspheres-ai';

if (!API_KEY) { console.error('No API key — set DATASPHERES_API_KEY or pass --prod with PROD_API_KEY env var'); process.exit(1); }

// Helper: wrap mermaid code as the native TipTap node
function mermaid(code) {
  const escaped = code.replace(/"/g, '&quot;');
  return `<div data-type="mermaid" data-code="${escaped}" class="mermaid-wrapper"><pre class="mermaid">${code}</pre></div>`;
}

const content = `<h1>all-dai-sdd &mdash; System Architecture</h1>
<p>How the full dai-skills spec-driven development system works: from first invocation through end-to-end autonomous execution, continuous validation, and board propagation.</p>

<h2>System Overview</h2>
<p>Two enforcement layers run independently. Layer 1 requires the LLM to follow instructions. Layer 2 fires whether or not it does.</p>

${mermaid(`flowchart TD
    A["fa:fa-play /all-dai-sdd invoked"] --> B["LLM reads SKILL.md"]
    B --> COND["sdd-conductor CLI\\nexit 0 = proceed · exit 1 = blocked · exit 2 = error"]
    COND --> L1["Layer 1 — Explicit\\nLLM calls conductor at each step"]
    COND --> L2["Layer 2 — Ambient\\nClaude hooks fire regardless"]
    L2 --> H1["PostToolUse Write/Edit\\ncheck-file-hook\\nwarn if file outside implFiles"]
    L2 --> H2["PostToolUse Bash\\nprogress-hook\\nauto-post test results"]
    L2 --> H3["SessionStart\\nsession-start\\nreconcile state vs board"]
    style L1 fill:#3b82f6,color:#fff
    style L2 fill:#7c3aed,color:#fff`)}

<h2>Six-Column Lifecycle</h2>
<p>Every column is a gate. Nothing moves forward until the previous column completes. The AI runs this autonomously from a <code>tasks.yaml</code>.</p>

${mermaid(`flowchart LR
    RS["Research\\nRS-NNN"] -->|"RS Done\\ngate clears"| NS["North Stars\\nNS-NNN"]
    NS -->|"all Epics Done"| EP["Epics\\nEP-NNN"]
    EP -->|"deps-done\\ngate"| EX["Execution\\nEX-NNN"]
    EX -->|"complete\\n5 gates enforced"| VA["Validation\\nVA-NNN"]
    VA -->|"validate exit 0\\nmetric >= threshold"| DONE["Done"]
    VA -->|"validate exit 1\\nmetric < threshold"| ITER["Next iteration EX task\\nauto-created"]
    ITER -->|"start + fix + re-run"| VA
    style DONE fill:#22c55e,color:#fff
    style ITER fill:#f59e0b,color:#fff`)}

<h2>Execution Loop (per EX task)</h2>

${mermaid(`flowchart TD
    DR["sdd-conductor drive\\nordered mission brief"] --> ST["sdd-conductor start taskId"]
    ST -->|"deps not Done"| BLK["EXIT 1\\nFix dependencies first"]
    ST -->|"deps clear"| IP["PATCH IN_PROGRESS\\nPOST start comment\\nwrite activeTask to state"]
    IP --> CODE["LLM writes code\\ncheck-file-hook warns\\non out-of-scope files"]
    CODE --> TESTS["Run tests\\nvitest / playwright / pytest / tsc"]
    TESTS --> PH["progress-hook intercepts\\nauto-posts Test Run results\\nto board comment feed"]
    PH --> PRG["sdd-conductor progress\\nmilestone to board"]
    PRG --> COMP["sdd-conductor complete"]
    COMP --> G1{"checklist\\nall ticked?"}
    G1 -->|no| E1["EXIT 1\\ntick items"]
    G1 -->|yes| G2{"completion comment\\n+ Verified criteria?"}
    G2 -->|no| E2["EXIT 1\\npost comment"]
    G2 -->|yes| G2B{"test evidence\\nin comments?"}
    G2B -->|no| E3["EXIT 1\\nrun tests first"]
    G2B -->|yes| G2C{"1 bullet per\\nchecked criterion?"}
    G2C -->|no| E4["EXIT 1\\nadd evidence"]
    G2C -->|yes| G3{"no mocks in\\nimpl files?"}
    G3 -->|mocks found| E5["EXIT 1\\nremove mocks"]
    G3 -->|clean| OK["PATCH Done\\npropagate chain"]
    style OK fill:#22c55e,color:#fff`)}

<h2>Ralph Loop &mdash; Autonomous Validation Iteration</h2>
<p>When a VA task fails its gate, the system does not stall. <code>sdd-conductor validate</code> exit 1 auto-creates the next iteration EX task and keeps the board honest throughout every loop cycle.</p>

${mermaid(`flowchart TD
    VA["VA task in Validation column"] --> RUN["Run test or measurement"]
    RUN --> VAL["sdd-conductor validate vaTaskId\\n--metric N --threshold T --iteration N"]
    VAL -->|"metric >= threshold\\nexit 0"| PASS["Tick all VA checklist items\\nPOST completion comment\\nPATCH VA Done\\npropagate Epic and NS chain\\nLOOP ENDS"]
    VAL -->|"metric < threshold\\nexit 1"| FAIL["POST iteration N failed comment\\nAuto-create EX iter-N+1 task\\n(same implFiles, AC: metric >= T)\\nClear activeTask state"]
    FAIL --> DIAG["sdd-conductor progress\\nDiagnosis: root cause + fix"]
    DIAG --> NEXT["sdd-conductor start\\nnext iteration EX task"]
    NEXT --> RUN
    VAL -->|"Hard blocker or\\nMAX_ITERS reached"| BLOCKED["POST BLOCKED comment\\nset task BLOCKED\\nloop exits — human required"]
    style PASS fill:#22c55e,color:#fff
    style BLOCKED fill:#ef4444,color:#fff`)}

<h2>Checklist Propagation Chain</h2>
<p>When an EX task is marked Done, the conductor automatically ticks items and propagates all the way up through Epics to North Stars. Multiple NS tasks each propagate independently.</p>

${mermaid(`flowchart TD
    EX["EX task marked Done"] --> TICK["Tick EX item in parent Epic checklist"]
    TICK -->|"items remain"| REM1["Epic: N tasks remaining\\n(no further action)"]
    TICK -->|"all Epic items ticked"| EPIC_DONE["POST all EX done — Ready for Validation\\nTick Epic item in parent NS checklist"]
    EPIC_DONE -->|"NS items remain"| REM2["NS: N Epics remaining"]
    EPIC_DONE -->|"all NS items ticked"| NS_DONE["POST all Epics done — North Star achieved\\nNS ready to close"]
    NS_DONE --> CLOSE["sdd-conductor complete NS-NNN"]
    style NS_DONE fill:#7c3aed,color:#fff
    style CLOSE fill:#22c55e,color:#fff`)}

<h2>sdd-conductor Command Reference</h2>
<ul>
  <li><code>init</code> &mdash; bootstrap .sdd-state.json from tasks.yaml (run once per project)</li>
  <li><code>drive</code> &mdash; ordered mission brief: Research blocking &rarr; EX ready/blocked &rarr; VA &rarr; NS close &rarr; NEXT command</li>
  <li><code>sync</code> &mdash; mid-plan reconciliation: diff tasks.yaml vs live board, detect EX drift, surface NS ready to close</li>
  <li><code>start &lt;taskId&gt;</code> &mdash; verify deps Done, PATCH IN_PROGRESS, arm file guard, write activeTask</li>
  <li><code>complete &lt;taskId&gt;</code> &mdash; 5-gate enforced: checklist + test evidence + criterion coverage + no-mocks &rarr; Done &rarr; propagate</li>
  <li><code>progress &lt;message&gt;</code> &mdash; post milestone comment to active task board feed</li>
  <li><code>validate &lt;vaTaskId&gt; --metric --threshold --iteration</code> &mdash; Ralph loop gate (exit 0 = Done, exit 1 = next iteration)</li>
  <li><code>gate &lt;name&gt; [arg]</code> &mdash; deps-done | research-done | no-mocks | checklist | impl-files</li>
  <li><code>dashboard-check &lt;dsUri&gt; &lt;slug&gt;</code> &mdash; verify all 5 required dashboard sections present</li>
  <li><code>install [dir]</code> &mdash; inject 3 Claude hooks into .claude/settings.json</li>
</ul>

<h2>Disk State (.sdd-state.json)</h2>
<p>Single source of truth read by all three Claude hooks independently of the LLM.</p>
<pre><code class="language-json">{
  "dsId": "ds_xxx",
  "dsUri": "my-datasphere",
  "planModeId": "pm_xxx",
  "initiative": "my-feature",
  "doneGroupId": "sg_xxx",
  "executionGroupId": "sg_yyy",
  "validationGroupId": "sg_zzz",
  "statusGroups": { "research": "sg_aaa", "north stars": "sg_bbb" },
  "activeTask": {
    "taskId": "task_xxx",
    "specId": "EX-T1-001",
    "title": "EX-T1-001 Build subscriber model",
    "implFiles": ["src/server/services/subscriber.service.ts"],
    "startedAt": "2026-05-23T10:00:00Z"
  }
}</code></pre>

<h2>Install Path</h2>
<pre><code>dai update --project /path/to/project
  installs all-dai-sdd skill + runs post-install.sh
    node sdd-conductor.mjs install
      PostToolUse(Write|Edit) &rarr; check-file-hook
      PostToolUse(Bash)       &rarr; progress-hook
      SessionStart            &rarr; session-start

Once per project:
  node sdd-conductor.mjs init</code></pre>

<h2>Coming Soon &mdash; File Attachment API</h2>
<p>Design spec: <code>skills/sdd-conductor/FILE-UPLOAD-API.md</code>. When built: <code>POST /api/v2/.../library/upload</code>, task attachment CRUD, TipTap <code>fileEmbed</code> node, <code>sdd-conductor upload-evidence</code>. Test result CSVs and Playwright trace files become first-class trace artifacts in the swimlane.</p>

<div data-type="doc-footer"></div>`;

const slug = 'all-dai-sdd-architecture';
const payload = JSON.stringify({
  slug,
  title: 'all-dai-sdd — System Architecture',
  content,
  status: 'PUBLISHED',
  isPubliclyVisible: false,
  folderName: 'dai-skills Docs',
});

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

let r = await req('POST', `${BASE}/api/v1/dataspheres/${DS_URI}/pages`, payload);
if (r.status === 409 || (r.status >= 400 && r.status < 500)) {
  r = await req('PUT', `${BASE}/api/v1/dataspheres/${DS_URI}/pages/${slug}`, payload);
}

if (r.status >= 200 && r.status < 300) {
  const pageSlug = r.data.page?.slug || slug;
  console.log(`PUBLISHED slug=${pageSlug}`);
  console.log(`URL: ${PUBLIC}/pages/${DS_URI}/${pageSlug}`);
} else {
  console.error('FAILED', r.status, JSON.stringify(r.data).slice(0, 400));
  process.exit(1);
}
