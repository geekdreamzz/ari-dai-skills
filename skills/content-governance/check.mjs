#!/usr/bin/env node
// The machine checks of the live content rulebook (GET /api/v1/content-governance). Exit 0 = pass, 1 = refuse, 2 = usage/unreachable.
//   node check.mjs rules [stage]          print the live rules (all, or one stage)
//   node check.mjs links <url> [...]      GOV-001: every link is on the live site and opens a real page there
//   node check.mjs page <uri> <slug>      GOV-020: the page has a feature image (og:image) that loads
//   node check.mjs process <uri> [agent]  the media-kit process each AI agent of the datasphere serves (destination, stages, gates);
//                                         GOV-029: refuse an agent whose recipe publishes somewhere else; no agent = create one first
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
    // ari-dai-skills or ari in the platform"). A media kit starts FROM one of the datasphere's AI agents (owner: "media-kits need to
    // select an ai-agent or create a new one before getting started"); each agent serves the process its runs follow.
    const [uri, which] = args;
    if (!uri || !process.env.DATASPHERES_API_KEY) { console.error('usage: DATASPHERES_API_KEY=... check.mjs process <uri> [agent id or label]'); return 2; }
    const r = await fetch(`${BASE}/api/v2/content-pipelines?datasphere=${encodeURIComponent(uri)}`, { headers: { Authorization: `Bearer ${process.env.DATASPHERES_API_KEY}` } });
    if (!r.ok) { console.error(`agents unavailable (${r.status})`); return 2; }
    const agents = ((await r.json()).data?.definitions || []);
    const pick = which ? agents.filter((d) => d.id === which || d.label.toLowerCase() === which.toLowerCase()) : agents;
    if (!pick.length) { console.log(`no AI agent ${which ? `"${which}" ` : ''}in ${uri}: create one first (POST /api/v2/content-pipelines, or ARI's create_content_pipeline), then start the media kit from it`); return 1; }
    let refused = false;
    for (const d of pick) {
      const p = d.process;
      console.log(`\n${d.label} (${d.id})${d.cron ? ` - ${d.enabled ? 'scheduled' : 'schedule paused'} ${d.cron} ${d.timezone ?? ''}` : ''}${d.config?.render === 'hold' ? ' - stops at Ready to render' : ''}`);
      if (!p) { console.log('  no recipe: the platform research-to-deck path, the datasphere it lives in'); continue; }
      console.log(`  recipe ${p.recipeId} v${p.recipeVersion}.${p.recipeHash} - governance v${p.governance.version}.${p.governance.hash}`);
      console.log(`  publish in: ${p.destination ? `${p.destination.name} (${p.destination.datasphereUri})` : 'this datasphere'}`);
      p.stages.forEach((st, i) => console.log(`  ${String(i + 1).padStart(2)}. ${st.label}${st.gate ? `  <- STOP: ${st.gateLabel} (the owner decides)` : ''}`));
      console.log(`  rules: ${p.rules.join(', ')}`);
      if (p.destination && p.destination.datasphereUri !== uri) { console.log(`  GOV-029: refuse - this agent publishes in ${p.destination.datasphereUri}, not ${uri}`); refused = true; }
      else console.log('  GOV-029: pass');
    }
    return refused ? 1 : 0;
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
  if (cmd === 'preflight') {
    // GOV-042: destination access BEFORE any work (owner, 2026-10-15: a kit was refused after ten minutes of work because the
    // key's user could not publish to the destination). Refuse to start a run until every line below is a pass.
    const [uri] = args;
    if (!uri || !process.env.DATASPHERES_API_KEY) { console.error('usage: DATASPHERES_API_KEY=... check.mjs preflight <uri>'); return 2; }
    const auth = { headers: { Authorization: `Bearer ${process.env.DATASPHERES_API_KEY}` } };
    const rows = [];
    const row = (ok, label, detail) => { rows.push(ok); console.log(`${ok ? 'PASS   ' : 'REFUSE '} ${label}${detail ? ` - ${detail}` : ''}`); };
    let rb = null; try { rb = await rules(); } catch { rb = null; }
    row(!!rb && Array.isArray(rb.rules) && rb.rules.length > 0, 'rulebook served', rb ? `v${rb.version} ${rb.hash}` : `not served by ${BASE}`);
    const ds = await fetch(`${BASE}/api/v1/dataspheres/${uri}`, auth).catch(() => ({ ok: false, status: 0 }));
    const dsj = ds.ok ? await ds.json().catch(() => ({})) : {};
    const d = dsj.datasphere || dsj.data || dsj;
    row(ds.ok && !!d.id, `destination "${uri}" exists on ${BASE}`, ds.ok ? `${d.name || ''} (${d.id || '?'})` : `HTTP ${ds.status}`);
    const pub = await fetch(`${BASE}/pages/${uri}`, { headers: { 'User-Agent': UA } }).catch(() => ({ ok: false, status: 0 }));
    row(pub.ok, `destination page opens publicly`, `${BASE}/pages/${uri} HTTP ${pub.status}`);
    const docs = await fetch(`${BASE}/api/v1/dataspheres/${uri}/documents`, auth).catch(() => ({ ok: false, status: 0 }));
    row(docs.ok, "this key's user is a member who can upload and publish there", docs.ok ? 'member' : `HTTP ${docs.status} - add the user to the datasphere (or use a member's key) before any work`);
    const hr = await fetch(`${BASE}/api/v1/dataspheres/${uri}/hosts`, auth).catch(() => ({ ok: false, status: 0 }));
    const hosts = hr.ok ? ((await hr.json().catch(() => ({}))).hosts || []) : [];
    const faceless = hosts.filter((h) => !h.headshotUrl);
    row(hosts.length > 0 && !faceless.length, 'AI hosts seated with faces (GOV-003)', hosts.length ? `${hosts.length} hosts, ${faceless.length} without a face` : 'no hosts');
    const ok = rows.every(Boolean);
    console.log(ok ? 'GOV-042: pass - start the run' : `GOV-042: refuse - ${rows.filter((r) => !r).length} precondition(s) unmet; fix them before any research, deck or render`);
    return ok ? 0 : 1;
  }
  if (cmd === 'kit-page') {
    // GOV-041: the media-kit narrative page follows the served template (owner, 2026-10-15: "just template it and enforce it").
    const [uri, slug, deckPageId] = args;
    if (!uri || !slug || !deckPageId || !process.env.DATASPHERES_API_KEY) { console.error('usage: DATASPHERES_API_KEY=... check.mjs kit-page <uri> <slug> <deckPageId>'); return 2; }
    const auth = { headers: { Authorization: `Bearer ${process.env.DATASPHERES_API_KEY}` } };
    const rule = ((await rules('kit')).rules || []).find((x) => x.id === 'GOV-041');
    const sections = rule && rule.params && rule.params.sections;
    if (!Array.isArray(sections) || !sections.length) { console.error('GOV-041 template is not served - do not write the page'); return 2; }
    const pr = await fetch(`${BASE}/api/v1/dataspheres/${uri}/pages/${slug}`, auth);
    const pj = await pr.json().catch(() => ({}));
    const html = String((pj.page || pj).content || '');
    if (!pr.ok || !html) { console.error(`page unavailable (${pr.status})`); return 2; }
    const kr = await fetch(`${BASE}/api/v1/dataspheres/${uri}/presentations/${deckPageId}/distribution-kit`, auth);
    const kit = kr.ok ? (await kr.json()).kit : null;
    const failures = [];
    const headings = [...html.matchAll(/<h2[^>]*>(.*?)<[/]h2>/gi)].map((m) => m[1].replace(/<[^>]+>/g, '').trim().toLowerCase());
    let pos = -1;
    for (const sec of sections) { const at = headings.findIndex((h, i) => i > pos && h === String(sec).toLowerCase()); if (at < 0) failures.push(`section "${sec}" is missing or out of order`); else pos = at; }
    const inline = [...html.matchAll(/<video(?=[ >])[^>]*>/gi)].map((m) => m[0]);
    const embedded = [...html.matchAll(/data-embed-html="([^"]*)"/g)].map((m) => decodeURIComponent(m[1])).filter((h) => /<video(?=[ >])/i.test(h)).map((h) => (h.match(/<video(?=[ >])[^>]*>/i) || [''])[0]);
    const videos = [...inline, ...embedded];
    if (!videos.length) failures.push('the page has no video preview');
    for (const v of videos) if (!/ poster="[^"]+"/i.test(v)) failures.push('a video on the page has no poster (it must be a thumbnail + play preview)');
    const panels = [...html.matchAll(/<aside[^>]*data-type="distribution-kit"[^>]*>/g)].map((m) => m[0]);
    if (panels.length !== 1) failures.push('the page must contain exactly one shared download/copy panel');
    else {
      const owner = (panels[0].match(/data-deck-page-id="([^"]*)"/) || [])[1];
      if (owner !== deckPageId) failures.push('the download/copy panel belongs to a different deck');
      if (!kit) failures.push('the kit has not been built');
      else { let saved = null; try { saved = JSON.parse(decodeURIComponent((panels[0].match(/data-kit="([^"]*)"/) || [])[1] || '')); } catch { saved = null; }
        if (!saved || saved.sourceJobId !== kit.sourceJobId || saved.builtAt !== kit.builtAt) failures.push('the download/copy panel does not match the built kit'); }
    }
    if (html.includes('localhost') || html.includes('dev.dataspheres')) failures.push('the page links to dev or localhost');
    const unique = [...new Set(failures)];
    for (const f of unique) console.log(`  - ${f}`);
    console.log(unique.length ? `GOV-041: refuse - fix the ${unique.length} issue(s) above, then run again` : `GOV-041: pass - the narrative follows the kit template (${sections.join(' > ')})`);
    return unique.length ? 1 : 0;
  }
  console.error('usage: check.mjs rules [stage] | links <url> [...] | page <uri> <slug> | process <uri> [agent] | hosts <uri> | preflight <uri> | kit-page <uri> <slug> <deckPageId> | (publish: node skills/content-governance/publish.mjs)');
  return 2;
}

process.exitCode = await main().catch((e) => {
  if (e instanceof Verdict) return e.code;
  console.error(`unreachable: ${e.message} - do not publish on a check that did not run`);
  return 2;
});
