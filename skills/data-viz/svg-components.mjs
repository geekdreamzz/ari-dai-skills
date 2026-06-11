/**
 * svg-components.mjs — sanitizer-safe inline data visualizations for Dataspheres pages.
 *
 * WHY THIS EXISTS
 *   Page content (created via the REST API or ARI) is stored and re-serialized through
 *   TipTap. Two things bite you when embedding SVG:
 *     1. Raw inline <svg> is NOT in TipTap's node schema — it gets stripped on the next
 *        re-serialization, flattening the diagram to run-on text. Only <img> survives.
 *     2. An <img src="data:image/svg+xml;..."> is parsed as STRICT XML:
 *          - named HTML entities (&middot; &mdash; &rarr; ...) are invalid → broken image
 *          - width="100%" on the <svg> root gives an indeterminate intrinsic size →
 *            the browser mis-maps the viewBox and CLIPS content.
 *   This module wraps every diagram as an <img> data-URI with numeric/literal entities,
 *   fixed width/height from the viewBox, and preserveAspectRatio — so it survives every
 *   round-trip and never clips. Use it from REST publish scripts and ARI tool flows.
 *
 * USAGE
 *   import { statCards, flowStrip, flowStack, toFigure, PALETTE } from './svg-components.mjs';
 *   const html = statCards([
 *     { value: '24%', lines: ['of developers merged AI code', 'without reviewing it'], source: 'Stack Overflow, 2025' },
 *     ...
 *   ]);
 *   // drop `html` straight into your page content string.
 *
 * Every exported generator returns a complete `<figure>…</figure>` HTML string.
 */

// ─── Brand palette ──────────────────────────────────────────────────────────────
export const PALETTE = {
  ink:      '#002244', // dark-midnight-blue — card / box fill
  gold:     '#a67c00', // luxurious-gold — numbers, accents, gate borders
  bgDark:   '#001428', // diagram container background
  boxLine:  '#334466', // neutral box border
  white:    '#ffffff',
  textDim:  '#cccccc',
  green:    '#2d8a4e', // success / done
  greenBg:  '#0d3320',
  greenTxt: '#44bb66',
  blue:     '#4488ff', // layer / branch A
  red:      '#cc4444', // failure path
  font:     'system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
};

// ─── Core: make any SVG sanitizer-safe and wrap it as a <figure><img> ────────────

const ENTITY_MAP = { '&middot;':'·','&mdash;':'—','&ndash;':'–','&rarr;':'→','&larr;':'←','&times;':'×','&hellip;':'…','&bull;':'•','&check;':'✓' };

/** Convert XML-invalid named entities to literal Unicode (keeps amp/lt/gt/quot/apos). */
export function xmlSafeEntities(svg) {
  let s = svg;
  for (const [name, ch] of Object.entries(ENTITY_MAP)) s = s.split(name).join(ch);
  return s;
}

/**
 * Normalize an `<svg>…</svg>` string so it renders correctly inside an <img> data-URI:
 *   - converts named entities to literal Unicode
 *   - removes width="100%" + inline style from the root
 *   - sets fixed width/height = viewBox dims + preserveAspectRatio
 * Throws if an XML-invalid entity remains (catch bugs before publish).
 */
export function sanitizeSvg(rawSvg) {
  let s = xmlSafeEntities(rawSvg);
  const vb = s.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!vb) throw new Error('sanitizeSvg: <svg> needs a viewBox="0 0 W H"');
  const W = vb[1], H = vb[2];
  s = s.replace(/<svg[^>]*>/, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet">`);
  const bad = s.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)[a-zA-Z]+;/);
  if (bad) throw new Error(`sanitizeSvg: XML-invalid entity ${bad[0]} — add it to ENTITY_MAP`);
  return s;
}

/** Base64-encode a UTF-8 string (Node Buffer or btoa fallback). */
function b64(str) {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Wrap a full `<svg>…</svg>` string as a responsive, sanitizer-safe <figure><img>.
 * Use this directly for hand-authored bespoke diagrams.
 * @param {string} rawSvg  complete <svg> markup with a viewBox
 * @param {object} o       { alt, caption, maxWidth=880, rounded=false }
 */
export function toFigure(rawSvg, { alt = '', caption = '', maxWidth = 880, rounded = false } = {}) {
  const safe = sanitizeSvg(rawSvg);
  const uri = `data:image/svg+xml;base64,${b64(safe)}`;
  const radius = rounded ? 'border-radius:10px;' : '';
  return `<figure style="margin:2rem 0;text-align:center">
  <img src="${uri}" alt="${esc(alt)}" style="width:100%;max-width:${maxWidth}px;height:auto;display:block;margin:0 auto;${radius}" loading="lazy"/>
  ${caption ? `<figcaption style="margin-top:0.5rem;font-size:0.85rem;color:#888;font-style:italic">${esc(caption)}</figcaption>` : ''}
</figure>`;
}

// ─── escaping helpers ────────────────────────────────────────────────────────────
function esc(s = '') { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
// SVG text bodies: escape XML specials (no named entities — they break data:svg)
function t(s = '') { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ─── Generator 1: stat cards ─────────────────────────────────────────────────────
/**
 * A row of N stat cards: big number, 1–2 descriptor lines, optional source line.
 * @param {Array<{value, lines?:string[], source?:string}>} cards
 * @param {object} o { alt, caption, gap=22, cardH=170, pad=14, maxWidth }
 */
export function statCards(cards, o = {}) {
  const gap = o.gap ?? 22, cardH = o.cardH ?? 170, padBottom = 18;
  const n = cards.length;
  const cardW = 285;
  const W = n * cardW + (n - 1) * gap;
  const H = cardH + padBottom;
  let body = '';
  cards.forEach((c, i) => {
    const x = i * (cardW + gap), cx = x + cardW / 2;
    body += `<rect x="${x}" y="0" width="${cardW}" height="${cardH}" rx="12" fill="${PALETTE.ink}"/>`;
    body += `<text x="${cx}" y="72" text-anchor="middle" font-family="${PALETTE.font}" font-size="60" font-weight="800" fill="${PALETTE.gold}">${t(c.value)}</text>`;
    const lines = c.lines || [];
    lines.slice(0, 2).forEach((ln, j) => {
      body += `<text x="${cx}" y="${103 + j * 17}" text-anchor="middle" font-family="${PALETTE.font}" font-size="13" fill="${PALETTE.white}" opacity="0.78">${t(ln)}</text>`;
    });
    if (c.source) body += `<text x="${cx}" y="148" text-anchor="middle" font-family="${PALETTE.font}" font-size="11" fill="${PALETTE.gold}" opacity="0.9">${t(c.source)}</text>`;
  });
  const svg = `<svg viewBox="0 0 ${W} ${H}">${body}</svg>`;
  return toFigure(svg, { alt: o.alt || cards.map(c => `${c.value} ${(c.lines || []).join(' ')}`).join('; '), caption: o.caption, maxWidth: o.maxWidth });
}

// ─── Generator 2: horizontal flow strip (lifecycle / pipeline) ───────────────────
/**
 * Horizontal labeled steps connected by arrows, inside a dark rounded container.
 * @param {Array<{label, badge?:string, note?:string, tone?:'gold'|'green'|'default'}>} steps
 * @param {object} o { alt, caption, maxWidth }
 */
export function flowStrip(steps, o = {}) {
  const boxW = 110, boxH = 70, gapX = 18, padX = 12, padTop = 22, padBottom = 23, noteH = steps.some(s => s.note) ? 16 : 0;
  const innerW = steps.length * boxW + (steps.length - 1) * gapX;
  const W = innerW + padX * 2;
  const H = padTop + boxH + padBottom + noteH;
  let body = `<rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="${PALETTE.bgDark}"/>`;
  body += `<defs><marker id="fsArr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="${PALETTE.gold}"/></marker></defs>`;
  body += `<g font-family="${PALETTE.font}" font-size="12" font-weight="600" text-anchor="middle">`;
  steps.forEach((s, i) => {
    const x = padX + i * (boxW + gapX), cx = x + boxW / 2, midY = padTop + boxH / 2;
    const tone = s.tone || (s.badge ? 'gold' : 'default');
    const fill = tone === 'green' ? PALETTE.greenBg : PALETTE.ink;
    const stroke = tone === 'green' ? PALETTE.green : tone === 'gold' ? PALETTE.gold : PALETTE.boxLine;
    body += `<rect x="${x}" y="${padTop}" width="${boxW}" height="${boxH}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    if (s.badge) {
      body += `<text x="${cx}" y="${padTop + 26}" fill="${PALETTE.gold}" font-size="9" font-weight="700">${t(s.badge)}</text>`;
      body += `<text x="${cx}" y="${padTop + 43}" fill="${tone === 'green' ? PALETTE.greenTxt : PALETTE.white}">${t(s.label)}</text>`;
    } else {
      body += `<text x="${cx}" y="${midY + 4}" fill="${tone === 'green' ? PALETTE.greenTxt : PALETTE.white}">${t(s.label)}</text>`;
    }
    if (i < steps.length - 1) {
      const ax = x + boxW, midY2 = padTop + boxH / 2;
      body += `<line x1="${ax}" y1="${midY2}" x2="${ax + gapX - 2}" y2="${midY2}" stroke="${PALETTE.gold}" stroke-width="1.5" marker-end="url(#fsArr)"/>`;
    }
    if (s.note) body += `<text x="${cx}" y="${padTop + boxH + 14}" fill="${PALETTE.gold}" font-size="9" font-weight="400">${t(s.note)}</text>`;
  });
  body += `</g>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}">${body}</svg>`;
  return toFigure(svg, { alt: o.alt || `Flow: ${steps.map(s => s.label).join(' → ')}`, caption: o.caption, maxWidth: o.maxWidth });
}

// ─── Generator 3: vertical flow stack (architecture / pipeline) ──────────────────
/**
 * Vertical stack of labeled boxes connected top-to-bottom by arrows, in a dark container.
 * @param {Array<{title, subtitle?:string, tone?:'gold'|'green'|'blue'|'default'}>} nodes
 * @param {object} o { alt, caption, maxWidth, boxW=420 }
 */
export function flowStack(nodes, o = {}) {
  const boxW = o.boxW ?? 420, boxH = 56, gapY = 22, padX = 40, padTop = 24, padBottom = 24;
  const W = boxW + padX * 2;
  const H = padTop + nodes.length * boxH + (nodes.length - 1) * gapY + padBottom;
  let body = `<rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="${PALETTE.bgDark}"/>`;
  body += `<defs><marker id="fkArr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="${PALETTE.gold}"/></marker></defs>`;
  body += `<g font-family="${PALETTE.font}" text-anchor="middle">`;
  const cx = W / 2;
  nodes.forEach((nd, i) => {
    const y = padTop + i * (boxH + gapY);
    const x = (W - boxW) / 2;
    const stroke = nd.tone === 'green' ? PALETTE.green : nd.tone === 'blue' ? PALETTE.blue : nd.tone === 'gold' ? PALETTE.gold : PALETTE.boxLine;
    const titleColor = nd.tone === 'green' ? PALETTE.greenTxt : nd.tone === 'blue' ? PALETTE.blue : nd.tone === 'gold' ? PALETTE.gold : PALETTE.white;
    body += `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="8" fill="${PALETTE.ink}" stroke="${stroke}" stroke-width="1.5"/>`;
    body += `<text x="${cx}" y="${y + (nd.subtitle ? 24 : 33)}" font-size="14" font-weight="700" fill="${titleColor}">${t(nd.title)}</text>`;
    if (nd.subtitle) body += `<text x="${cx}" y="${y + 42}" font-size="11" fill="${PALETTE.textDim}">${t(nd.subtitle)}</text>`;
    if (i < nodes.length - 1) body += `<line x1="${cx}" y1="${y + boxH}" x2="${cx}" y2="${y + boxH + gapY - 2}" stroke="${PALETTE.gold}" stroke-width="1.5" marker-end="url(#fkArr)"/>`;
  });
  body += `</g>`;
  const svg = `<svg viewBox="0 0 ${W} ${H}">${body}</svg>`;
  return toFigure(svg, { alt: o.alt || `Stack: ${nodes.map(n => n.title).join(' → ')}`, caption: o.caption, maxWidth: o.maxWidth });
}
