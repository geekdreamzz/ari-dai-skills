#!/usr/bin/env node
// The machine checks of the live content rulebook (GET /api/v1/content-governance). Exit 0 = pass, 1 = refuse, 2 = usage/unreachable.
//   node check.mjs rules [stage]          print the live rules (all, or one stage)
//   node check.mjs links <url> [...]      GOV-001: every link is on the live site and opens a real page there
//   node check.mjs page <uri> <slug>      GOV-020: the page has a feature image (og:image) that loads
//   node check.mjs process <templateId> [uri]  the ONE media-kit process the platform serves (destination, stages, gates);
//                                         with a uri, GOV-029: refuse when the run would start outside the template's datasphere
//   node check.mjs hosts <uri>            GOV-003: the datasphere has AI hosts and every one has a face (before any voice is bought)
// DATASPHERES_BASE_URL overrides the live site (default https://dataspheres.ai); DATASPHERES_API_KEY is needed for `page`.
// Verdicts are returned, never process.exit()ed: on Windows, Node 24 aborts on a libuv assertion when exit() races fetch's closing
// sockets, which turned every verdict into a crash code and hid refusals from the agents and CI that gate on them.
const BASE = (process.env.DATASPHERES_BASE_URL || 'https://dataspheres.ai').replace(/\/+$/, '');
const UA = 'facebookexternalhit/1.1 (+ari-dai-skills content-governance)';
const [cmd, ...args] = process.argv.slice(2);

class Verdict { constructor(code) { this.code = code; } }

async function rules(stage) {
  const r = await fetch(`${BASE}/api/v1/content-governance${stage ? `?stage=${encodeURIComponent(stage)}` : ''}`);
  if (!r.ok) { console.error(`rulebook unavailable (${r.status}) - do not publish without it`); throw new Verdict(2); }
  return r.json();
}

async function linkLive(url) {
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: 'not a URL' }; }
  if (u.origin !== new URL(BASE).origin) return { ok: false, reason: `not the live site (${u.origin}) - every published link and QR points at ${BASE}` };
  const nl = u.pathname.match(/^\/newsletters\/([^/?#]+)/);
  const probe = nl ? `${u.origin}/api/newsletters/public/${nl[1]}` : u.toString();
  try {
    const r = await fetch(probe, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!r.ok) return { ok: false, reason: `${nl ? 'newsletter' : 'page'} not found (${r.status})` };
    if (nl) { const j = await r.json().catch(() => null); if (!j?.data) return { ok: false, reason: 'newsletter not found' }; }
    return { ok: true };
  } catch (e) { return { ok: false, reason: `unreachable: ${e.message}` }; }
}

async function main() {
  if (cmd === 'rules') {
    const g = await rules(args[0]);
    // An unknown stage (a gate name like script_review) matches nothing - "0 rules" must never read as "nothing to check".
    if (args[0] && !g.rules.length) {
      const all = await rules();
      console.error(`no stage "${args[0]}" - stages are: ${[...new Set(all.rules.map((r) => r.stage))].join(', ')}`);
      return 2;
    }
    console.log(`content governance v${g.version}.${g.hash} - ${g.rules.length} rule(s)${args[0] ? ` for ${args[0]}` : ''}`);
    for (const r of g.rules) console.log(`${r.id} [${r.stage}/${r.enforce}] ${r.rule}`);
    return 0;
  }
  if (cmd === 'links') {
    if (!args.length) { console.error('usage: check.mjs links <url> [...]'); return 2; }
    let bad = 0;
    for (const url of [...new Set(args)]) { const c = await linkLive(url); if (!c.ok) bad++; console.log(`${c.ok ? 'OK  ' : 'DEAD'} ${url}${c.ok ? '' : ` - ${c.reason}`}`); }
    console.log(bad ? `GOV-001: ${bad} dead link(s) - refuse until fixed` : 'GOV-001: all links live');
    return bad ? 1 : 0;
  }
  if (cmd === 'page') {
    const [uri, slug] = args;
    if (!uri || !slug || !process.env.DATASPHERES_API_KEY) { console.error('usage: DATASPHERES_API_KEY=... check.mjs page <uri> <slug>'); return 2; }
    const r = await fetch(`${BASE}/api/v1/dataspheres/${uri}/pages/${slug}`, { headers: { Authorization: `Bearer ${process.env.DATASPHERES_API_KEY}` } });
    const j = await r.json().catch(() => ({}));
    const p = j.page || j;
    const img = p.ogImage;
    const loads = img ? (await fetch(img, { method: 'HEAD' }).catch(() => ({ ok: false }))).ok : false;
    console.log(img ? `feature image: ${img} (${loads ? 'loads' : 'DOES NOT LOAD'})` : 'feature image: NONE');
    console.log(img && loads ? 'GOV-020: pass' : 'GOV-020: refuse - set it with POST /api/v1/dataspheres/:uri/pages/:slug/feature-image');
    return img && loads ? 0 : 1;
  }
  if (cmd === 'process') {
    // One definition for ARI and for this skill (owner 2026-10-14: "media kits needs to be a consistent process whether its
    // ari-dai-skills or ari in the platform"): read it from the platform, never keep a copy of the steps here.
    const [id, uri] = args;
    if (!id) { console.error('usage: check.mjs process <templateId> [uri]'); return 2; }
    const r = await fetch(`${BASE}/api/v1/content-templates/${encodeURIComponent(id)}`);
    if (!r.ok) { console.error(`template ${id} unavailable (${r.status})`); return 2; }
    const p = (await r.json()).process;
    if (!p) { console.error('this platform does not serve the process yet - update it before running a media kit'); return 2; }
    console.log(`${p.templateId} v${p.templateVersion} - governance v${p.governance.version}.${p.governance.hash}`);
    console.log(`publish in: ${p.destination ? `${p.destination.name} (${p.destination.datasphereUri})` : 'the datasphere you start in'}`);
    p.stages.forEach((st, i) => console.log(`${String(i + 1).padStart(2)}. ${st.label}${st.gate ? `  <- STOP: ${st.gateLabel} (the owner decides)` : ''}`));
    console.log(`rules: ${p.rules.join(', ')}`);
    if (uri && p.destination && uri !== p.destination.datasphereUri) { console.log(`GOV-029: refuse - start this run in ${p.destination.datasphereUri}, not ${uri}`); return 1; }
    if (uri) console.log('GOV-029: pass');
    return 0;
  }
  if (cmd === 'hosts') {
    const [uri] = args;
    if (!uri || !process.env.DATASPHERES_API_KEY) { console.error('usage: DATASPHERES_API_KEY=... check.mjs hosts <uri>'); return 2; }
    const r = await fetch(`${BASE}/api/v1/dataspheres/${uri}/hosts`, { headers: { Authorization: `Bearer ${process.env.DATASPHERES_API_KEY}` } });
    if (!r.ok) { console.error(`hosts unavailable (${r.status})`); return 2; }
    const hosts = ((await r.json()).hosts || []);
    for (const h of hosts) console.log(`${h.headshotUrl ? 'FACE   ' : 'NO FACE'} ${h.name} (${h.sheet?.roleLane ?? '?'})`);
    const faceless = hosts.filter((h) => !h.headshotUrl);
    const ok = hosts.length > 0 && !faceless.length;
    console.log(ok ? `GOV-003: pass - ${hosts.length} hosts, all with faces` : `GOV-003: refuse - ${hosts.length ? `${faceless.length} host(s) without a face` : 'no AI hosts in this datasphere'}; seat hosts with faces before writing the script`);
    return ok ? 0 : 1;
  }
  console.error('usage: check.mjs rules [stage] | links <url> [...] | page <uri> <slug> | process <templateId> [uri] | hosts <uri>');
  return 2;
}

process.exitCode = await main().catch((e) => {
  if (e instanceof Verdict) return e.code;
  console.error(`unreachable: ${e.message} - do not publish on a check that did not run`);
  return 2;
});
