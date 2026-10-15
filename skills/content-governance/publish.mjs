#!/usr/bin/env node
// Publish pages rendered on one Dataspheres instance (dev, local) to the public one (production), media included.
// GOV-042 (owner, 2026-10-15): every link a kit hands out must open on the public base, so the deck, watch, episode and
// narrative pages - and every file they show - are carried over, verified, and only then counted as published.
//
// Usage:
//   SOURCE_BASE=https://dev.dataspheres.ai SOURCE_API_KEY=... \
//   DATASPHERES_BASE_URL=https://dataspheres.ai DATASPHERES_API_KEY=... \
//   node skills/content-governance/publish.mjs <uri> <slug> [<slug> ...] [--slug-suffix -x] [--dry-run]
//
// For each slug: read the page on the source (any page type), find every media URL in it (plain and URI-encoded, inside
// embed figures and kit payloads too), download each from the source, upload it to the target datasphere's library,
// confirm the uploaded copy opens, rewrite the page to the new URLs, create (or update) the page on the target under the
// same slug, and confirm it opens publicly. A single failure stops the run before anything half-published is announced.
// --dry-run lists what would move and writes nothing. --slug-suffix publishes under <slug><suffix> (a rehearsal).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = (process.env.SOURCE_BASE || '').replace(/\/+$/, '');
const SRC_KEY = process.env.SOURCE_API_KEY || '';
const DST = (process.env.DATASPHERES_BASE_URL || 'https://dataspheres.ai').replace(/\/+$/, '');
const DST_KEY = process.env.DATASPHERES_API_KEY || '';
const UA = 'facebookexternalhit/1.1 (+ari-dai-skills publish)';
const ONE_SHOT_MAX = 95 * 1024 * 1024; // the platform's single-request ceiling; larger files are refused here (multipart is a later step)
const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const sfxAt = argv.indexOf('--slug-suffix');
const suffix = sfxAt >= 0 ? String(argv[sfxAt + 1] || '') : '';
const positional = argv.filter((a, i) => !a.startsWith('--') && !(sfxAt >= 0 && i === sfxAt + 1));
const [uri, ...slugs] = positional;

const die = (m) => { console.error(`REFUSE: ${m}`); process.exit(1); };
if (!uri || !slugs.length) die('usage: publish.mjs <uri> <slug> [<slug> ...] [--slug-suffix -x] [--dry-run]');
if (!SRC || !SRC_KEY) die('SOURCE_BASE and SOURCE_API_KEY are required (where the pages were rendered)');
if (!DST_KEY) die('DATASPHERES_API_KEY (the public base) is required');
if (SRC === DST && !suffix) die('source and target are the same base: pass --slug-suffix for a rehearsal');

const api = async (base, key, p, init = {}) => {
  const r = await fetch(`${base}${p}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const readPage = async (base, key, slug) => { const j = await api(base, key, `/api/v1/dataspheres/${uri}/pages/${slug}`); return j.page || j; };
const opensPublicly = async (url) => { const r = await fetch(url, { headers: { 'User-Agent': UA } }).catch(() => null); return !!r && r.ok; };
const mediaRe = /(?:https?:\/\/[^\s"'<>)]+|\/api\/public\/uploads\/[^\s"'<>)]+)/g;
const isMedia = (u) => /\.(mp4|m4v|webm|mp3|wav|m4a|jpg|jpeg|png|webp|gif|svg|vtt|srt|json|zip|txt|pdf)(\?|$)/i.test(u) && !/\.m3u8/i.test(u);
const sourceLocal = (u) => u.startsWith('/api/public/uploads/') || (SRC && u.startsWith(`${SRC}/`));
const absSrc = (u) => (u.startsWith('/') ? `${SRC}${u}` : u);

(async () => {
  // 1. the target datasphere, and this key's right to upload there (GOV-042) - before any download
  const dsj = await api(DST, DST_KEY, `/api/v1/dataspheres/${uri}`);
  const ds = dsj.datasphere || dsj.data || dsj;
  if (!ds.id) die(`target datasphere "${uri}" not found on ${DST}`);
  await api(DST, DST_KEY, `/api/v1/dataspheres/${uri}/documents`).catch((e) => die(`this key's user cannot publish to "${uri}" on ${DST}: ${e.message}`));
  console.log(`target ${DST} datasphere ${uri} (${ds.id})${dry ? ' [dry run]' : ''}`);

  // 2. read every page and collect the media they show
  const pages = [];
  const wanted = new Map(); // source url (as written) -> { abs }
  for (const slug of slugs) {
    const p = await readPage(SRC, SRC_KEY, slug);
    const content = typeof p.content === 'string' ? p.content : JSON.stringify(p.content ?? '');
    const found = new Set();
    for (const m of content.matchAll(mediaRe)) { const u = m[0]; if (isMedia(u) && sourceLocal(u)) found.add(u); }
    for (const m of decodeURIComponent(content.replace(/%(?![0-9A-Fa-f]{2})/g, '%25')).matchAll(mediaRe)) { const u = m[0]; if (isMedia(u) && sourceLocal(u)) found.add(u); }
    for (const u of found) wanted.set(u, { abs: absSrc(u) });
    pages.push({ slug, page: p, content, media: [...found] });
    console.log(`page ${slug}: ${p.pageType || '?'} "${p.title || ''}" - ${found.size} media file(s)`);
  }
  // HLS streams are not carried (the player falls back to the MP4): strip their attributes so no link points at the source
  const stripHls = (s) => s.replace(/\s?data-hls-url="[^"]*"/g, '').replace(/%20data-hls-url%3D%22[^%]*(?:%[0-9A-F]{2}[^%]*)*%22/g, '');

  // 3. move the media: download, upload, verify, map - one at a time, stop at the first failure
  const map = new Map();
  let bytes = 0;
  for (const [u, { abs }] of wanted) {
    const r = await fetch(abs);
    if (!r.ok) die(`source media ${abs} HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    bytes += buf.length;
    const name = decodeURIComponent(abs.split('/').pop().split('?')[0]);
    if (buf.length > ONE_SHOT_MAX) die(`${name} is ${(buf.length / 1048576).toFixed(1)} MB, over the single-request ceiling; split it (multipart) before publishing`);
    if (dry) { console.log(`  would upload ${name} (${(buf.length / 1048576).toFixed(1)} MB)`); continue; }
    const ext = name.toLowerCase().split('.').pop();
    // captions and sidecars carry their own types (a source may serve them as octet-stream)
    const byExt = { vtt: 'text/vtt', srt: 'application/x-subrip', json: 'application/json', txt: 'text/plain', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', zip: 'application/zip', pdf: 'application/pdf' };
    const mime = byExt[ext] || (r.headers.get('content-type') || 'application/octet-stream').split(';')[0];
    const fd = new FormData();
    fd.append('document', new Blob([buf], { type: mime }), name);
    fd.append('datasphereId', ds.id);
    fd.append('caption', `Published from ${SRC} for ${slugs[0]}`);
    const up = await api(DST, DST_KEY, '/api/documents/upload', { method: 'POST', body: fd });
    const doc = up.document || up.data || up;
    if (!doc.id) die(`upload of ${name} returned no document: ${JSON.stringify(up).slice(0, 300)}`);
    // the library stores it private: publish it, then find the public copy by its storage key (the API's own public read
    // route on a local store; the public bucket on S3), and prove it opens anonymously before trusting it
    const pub = await api(DST, DST_KEY, `/api/v1/dataspheres/${uri}/documents/${doc.id}`, { method: 'PATCH', body: JSON.stringify({ isPublic: true }) });
    const pd = pub.document || pub.data || pub;
    // the key: the publish response's storagePath, else the upload response's download path, else a document read
    const fromUrl = (u) => (String(u || '').includes('/download/') ? decodeURIComponent(String(u).split('/download/')[1].split('?')[0]) : '');
    let key = pd.storagePath || doc.storagePath || fromUrl(doc.fileUrl) || fromUrl(doc.url);
    if (!key) { const got = await api(DST, DST_KEY, `/api/v1/dataspheres/${uri}/documents/${doc.id}`).catch(() => ({})); const gd = got.document || got.data || got; key = gd.storagePath || fromUrl(gd.fileUrl); }
    if (!key) die(`published ${name} but no storage key came back: ${JSON.stringify(pd).slice(0, 300)}`);
    const candidates = [pd.publicUrl, process.env.PUBLIC_MEDIA_BASE ? `${process.env.PUBLIC_MEDIA_BASE.replace(/\/+$/, '')}/${key}` : null, `${DST}/api/public/uploads/${key}`, `https://dataspheres-ai-documents.s3.us-east-1.amazonaws.com/${key}`].filter(Boolean);
    let url = null;
    for (const c of candidates) if (await opensPublicly(c)) { url = c; break; }
    if (!url) die(`uploaded and published ${name} (document ${doc.id}, key ${key}) but no public URL opens anonymously (tried ${candidates.join(', ')}) - set PUBLIC_MEDIA_BASE to the store's public base`);
    map.set(u, url);
    console.log(`  ${name} -> ${url}`);
  }
  console.log(`media: ${wanted.size} file(s), ${(bytes / 1048576).toFixed(1)} MB${dry ? ' (not moved)' : ' moved and verified'}`);
  if (dry) return;

  // 4. rewrite and create the pages on the target, verifying each opens publicly
  const rewrite = (s) => { let out = stripHls(s); for (const [from, to] of map) { out = out.split(from).join(to).split(encodeURIComponent(from)).join(encodeURIComponent(to)); } return out; };
  for (const { slug, page, content } of pages) {
    const target = `${slug}${suffix}`;
    const body = { title: page.title, slug: target, pageType: page.pageType, status: 'PUBLISHED', isPubliclyVisible: true, content: rewrite(content), ...(page.showCta ? { showCta: page.showCta } : {}), ...(page.showCourse ? { showCourse: page.showCourse } : {}) };
    // nothing may still point at the source (its host, or any localhost); on a same-base rehearsal only localhost counts
    const srcHost = SRC.replace(/^https?:\/\//, '');
    if (/localhost/i.test(body.content) || (SRC !== DST && body.content.includes(srcHost))) die(`page ${slug} would still link to the source after rewriting`);
    const made = await api(DST, DST_KEY, `/api/v1/dataspheres/${uri}/pages`, { method: 'POST', body: JSON.stringify(body) });
    const url = page.pageType === 'PRESENTATION' ? `${DST}/pages/${uri}/presentations/${target}` : `${DST}/pages/${uri}/${target}`;
    if (!(await opensPublicly(url))) die(`published page ${target} does not open publicly at ${url}`);
    console.log(`page ${target} -> ${url} (${made.id || made.data?.id || 'created'})`);
  }
  console.log('PUBLISHED: every page and file opens on the public base');
})().catch((e) => die(e.message));
