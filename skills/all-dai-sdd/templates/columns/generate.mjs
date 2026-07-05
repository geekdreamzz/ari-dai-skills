// Generates the canonical per-column SDD artifact templates from the SAME spec
// loop.mjs enforces (V2_TEMPLATES). Mirrors loop.mjs — keep in sync.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: node gen-sdd-templates.mjs <outDir>'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

// tier → { name, parent, frontMatter[], sections[], purpose, hints{section:hint}, extraFM{} }
const TIERS = {
  IN: { name: 'Intake', parent: null, fm: ['type'], sections: ['Origin Prompt'],
    purpose: 'The verbatim user prompt / bug report / stakeholder request that roots this chain. The ONLY tier with no parent.',
    hints: { 'Origin Prompt': 'Paste the request VERBATIM in a blockquote with attribution + date. Not a paraphrase.' } },
  RS: { name: 'Research & References', parent: 'IN', fm: ['type', 'parent_uuid'],
    sections: ['Search Results', 'Sources', 'Codebase Context', 'Reusable Modules', 'Synthesis'],
    purpose: 'Evidence gathered before committing to an approach — web search + code analysis. Gates everything downstream.',
    hints: { 'Search Results': 'Verbatim excerpts from real searches, each quoted + cited. Or "N/A — no external search" with why.',
      'Sources': 'Resolvable links backing the Search Results.',
      'Codebase Context': 'Existing src/ files relevant to the approach, with at least one real snippet. Or "N/A — greenfield".',
      'Reusable Modules': 'Existing components/services/primitives this should reuse instead of rebuilding.',
      'Synthesis': 'What the evidence concludes; the recommended approach and why.' } },
  PC: { name: 'Problem & Customer Segment', parent: 'RS', fm: ['type', 'parent_uuid'],
    sections: ['Problem Statement', 'Customer Segment'],
    purpose: 'Ties the research to the concrete pain point and the persona who feels it.',
    hints: { 'Problem Statement': 'The specific problem, grounded in the research above.',
      'Customer Segment': 'Who experiences this — the persona / user role.' } },
  VP: { name: 'Value Proposition', parent: 'PC', fm: ['type', 'parent_uuid'],
    sections: ['Value Proposition', 'Why Worth Solving'],
    purpose: 'The value the solution promises and the case for spending effort on it.',
    hints: { 'Value Proposition': 'The value delivered if solved.',
      'Why Worth Solving': 'The cost of NOT solving it / the opportunity.' } },
  SS: { name: 'Solution Specs & Scenarios', parent: 'VP', fm: ['type', 'parent_uuid'],
    sections: ['Functional Requirements', 'Non-Functional Requirements', 'Artifacts Needed'],
    purpose: 'The functional + non-functional requirements and the typed artifacts the solution must produce.',
    hints: { 'Functional Requirements': 'FR-1, FR-2… what the solution must DO.',
      'Non-Functional Requirements': 'NFRs: performance, cost, security, platform constraints (extracted from the origin prompt).',
      'Artifacts Needed': 'The typed deliverables — code, media, reports — this will yield.' } },
  DO: { name: 'Desired Outcomes', parent: 'SS', fm: ['type', 'parent_uuid'],
    sections: ['Success Metrics', 'Final Outcomes'],
    purpose: 'How success is measured and what the world looks like if it works.',
    hints: { 'Success Metrics': 'Measurable targets — retention/growth/latency/accuracy.',
      'Final Outcomes': 'The end state if successful.' } },
  EP: { name: 'Epics', parent: 'DO', fm: ['type', 'parent_uuid'],
    sections: ['Milestone', 'Scope', 'Task Checklist'],
    purpose: 'A core milestone grouping the tasks that achieve a desired outcome.',
    hints: { 'Milestone': 'The milestone this epic represents.',
      'Scope': 'What is in / out of scope for this epic.',
      'Task Checklist': 'The TK items under this epic (checkbox list, propagated by the loop).' } },
  TK: { name: 'Tasks', parent: 'EP', fm: ['type', 'parent_uuid'],
    sections: ['Implementation Steps', 'Implementation Files', 'Acceptance Criteria'],
    purpose: 'A concrete micro-step with the files it touches and its acceptance checklist. Belongs to an epic.',
    hints: { 'Implementation Steps': 'Ordered steps to implement this task.',
      'Implementation Files': 'The exact src/ paths this task creates/edits (drives the typed-coverage gate).',
      'Acceptance Criteria': 'ATC checklist — each item independently checkable with evidence.' } },
  VC: { name: 'Validation Criteria', parent: 'TK', fm: ['type', 'parent_uuid', 'validation_kind'],
    sections: ['Acceptance Criteria'],
    purpose: 'THE work unit of the Ralph loop — typed acceptance criteria + the exact commands that prove them.',
    hints: { 'Acceptance Criteria': 'Typed AC for this validation_kind (ui/api/data/benchmark). Each with the command that verifies it and the expected result.' },
    extraFM: { validation_kind: 'ui | api | data | benchmark' } },
  AR: { name: 'Artifacts', parent: 'VC', fm: ['type', 'parent_uuid', 'artifact_type'],
    sections: ['Citations'],
    purpose: 'The shipped deliverable — verified code (with tracing decorators), media (with sha256), or a report (with citations). Never an empty stub.',
    hints: { 'Citations': 'code → every cited file exists + carries the parent VC uuid in a decorator; media → file + sha256 + bytes per asset; report → ≥2 resolvable links.' },
    extraFM: { artifact_type: 'code | media | report' } },
};

const ORDER = ['IN','RS','PC','VP','SS','DO','EP','TK','VC','AR'];

function fmBlock(t) {
  const lines = ['<!--'];
  lines.push(`  ${t.parent ? `parent_uuid: <uuid of the parent ${t.parent} item>` : 'root tier — no parent_uuid'}`);
  for (const f of t.fm) {
    if (f === 'type') lines.push(`  type: ${tierKey(t)}`);
    else if (f === 'parent_uuid') { /* rendered above */ }
    else lines.push(`  ${f}: <${(t.extraFM && t.extraFM[f]) || 'value'}>`);
  }
  lines.push(`  uuid: <this item's own board id — run --stamp-uuids after creating>`);
  lines.push('-->');
  return lines.join('\n');
}
function tierKey(t){ return ORDER.find(k => TIERS[k] === t); }

for (const key of ORDER) {
  const t = TIERS[key];
  const parent = t.parent ? `${t.parent} (${TIERS[t.parent].name})` : '— (root)';
  let md = `# ${key} · <title> — ${t.name}\n\n`;
  md += `> **Tier:** ${key} — ${t.name}  \n> **Parent:** ${parent}  \n> **Purpose:** ${t.purpose}\n\n`;
  md += `<!-- Front matter — REQUIRED (the loop.mjs gate blocks --advance if any is missing): -->\n`;
  md += fmBlock(t) + '\n\n';
  md += `---\n\n`;
  for (const s of t.sections) {
    md += `## ${s}\n\n`;
    md += `<!-- ${t.hints[s] || ''} -->\n\n`;
    md += `_TODO: fill in._\n\n`;
  }
  md += `<!-- Every section header above is REQUIRED and checked by verifyV2Template() in loop.mjs.\n`;
  md += `     Author from this template, run \`node loop.mjs --stamp-uuids\`, then \`--advance\`. -->\n`;
  writeFileSync(join(OUT, `${key}.md`), md, 'utf8');
  console.log(`  wrote ${key}.md (${t.sections.length} sections)`);
}
console.log(`\n${ORDER.length} column templates → ${OUT}`);
