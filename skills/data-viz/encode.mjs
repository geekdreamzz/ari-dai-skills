#!/usr/bin/env node
/**
 * encode.mjs — turn a raw SVG (or a named generator + JSON) into the sanitizer-safe
 * <figure><img> block you paste into page content. The manual-editing entry point.
 *
 *   # bespoke SVG from a file or stdin:
 *   node encode.mjs < diagram.svg
 *   node encode.mjs diagram.svg --caption "My diagram" --alt "..."
 *
 *   # named generators (args are JSON):
 *   node encode.mjs statcards '[{"value":"24%","lines":["…"],"source":"…"}]' --caption "…"
 *   node encode.mjs flowstrip '[{"label":"Research","badge":"ORIGIN GATE","tone":"gold"}]'
 *   node encode.mjs flowstack '[{"title":"Claude Code","subtitle":"…","tone":"gold"}]'
 *
 * Prints the <figure>…</figure> HTML to stdout. Copy it into your page.
 */
import { readFileSync } from 'fs';
import { statCards, flowStrip, flowStack, toFigure } from './svg-components.mjs';

const argv = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--caption') opts.caption = argv[++i];
  else if (argv[i] === '--alt') opts.alt = argv[++i];
  else if (argv[i] === '--max-width') opts.maxWidth = +argv[++i];
  else positional.push(argv[i]);
}

const GENERATORS = { statcards: statCards, flowstrip: flowStrip, flowstack: flowStack };
const first = positional[0];

let html;
if (first && GENERATORS[first.toLowerCase()]) {
  const data = JSON.parse(positional[1] || '[]');
  html = GENERATORS[first.toLowerCase()](data, opts);
} else {
  // bespoke SVG: from a file path, else stdin
  let svg;
  if (first && first.endsWith('.svg')) svg = readFileSync(first, 'utf8');
  else svg = readFileSync(0, 'utf8'); // stdin
  if (!/<svg[\s\S]*<\/svg>/.test(svg)) { console.error('No <svg>…</svg> found on input.'); process.exit(1); }
  html = toFigure(svg.trim(), opts);
}

process.stdout.write(html + '\n');
