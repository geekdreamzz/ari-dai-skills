# Data-Viz Templates — copy, edit, encode, paste

You cannot hand-write a base64 data-URI, so the manual workflow is:

1. Copy a **raw SVG template** below and edit the text/values.
2. Run it through the encoder — it converts entities, fixes the root tag, and prints the paste-ready `<figure><img>` block:
   ```bash
   node .claude/skills/data-viz/encode.mjs < my-diagram.svg --caption "Caption here"
   ```
   …or use a named generator with JSON (no SVG authoring needed):
   ```bash
   node .claude/skills/data-viz/encode.mjs statcards \
     '[{"value":"24%","lines":["of developers merged AI code","without reviewing it"],"source":"Stack Overflow, 2025"}]' \
     --caption "AI code-quality, 2025."
   ```
3. Paste the printed `<figure>…</figure>` into the page body.

> **Reminder of the two rules** (the encoder handles both, but if you copy an SVG from elsewhere): no raw `<svg>` in page content — it must end up an `<img>` data-URI; and inside the SVG use literal Unicode (`·` `—` `→` `×`), never named entities like `&middot;`.

Brand colors: `#002244` ink/cards · `#a67c00` gold accents/numbers · `#001428` diagram container · `#2d8a4e` done/green · `#4488ff` blue.

---

## Template A — stat cards (prefer the generator)
The generator is easier than raw SVG here:
```bash
node .claude/skills/data-viz/encode.mjs statcards '[
  {"value":"24%","lines":["of developers merged AI code","without reviewing it"],"source":"Stack Overflow, 2025"},
  {"value":"1.7×","lines":["more bugs in AI-generated code","vs. human-written equivalents"],"source":"Code quality studies, 2026"},
  {"value":"75%","lines":["more logic errors than","human-written code"],"source":"Code quality studies, 2026"}
]' --caption "AI code-quality, 2025–2026."
```

## Template B — horizontal lifecycle / pipeline (generator)
```bash
node .claude/skills/data-viz/encode.mjs flowstrip '[
  {"label":"Research","badge":"ORIGIN GATE","note":"must be Done first","tone":"gold"},
  {"label":"North Stars"},{"label":"Epics"},{"label":"Execution"},{"label":"Validation"},
  {"label":"Artifacts","badge":"MANDATORY","note":"auto-created","tone":"gold"},
  {"label":"Done","tone":"green"}
]' --caption "The lifecycle."
```

## Template C — vertical architecture / data flow (generator)
```bash
node .claude/skills/data-viz/encode.mjs flowstack '[
  {"title":"Claude Code","subtitle":"AI agent reads SKILL.md, executes tasks","tone":"gold"},
  {"title":"sdd-conductor CLI","subtitle":"10 gate invariants · evidence validation","tone":"blue"},
  {"title":"Dataspheres AI Board","subtitle":"Task state · comments · gate history"},
  {"title":"Browser Dashboard","subtitle":"Trace graph · Activity feed · live","tone":"green"}
]' --caption "State lives on the platform, not the editor."
```

## Template D — bespoke diagram (raw SVG → encoder)
Save as `my-diagram.svg`, edit, then `node …/encode.mjs my-diagram.svg --caption "…"`.
```html
<svg viewBox="0 0 700 300">
  <rect x="0" y="0" width="700" height="300" rx="12" fill="#001428"/>
  <!-- boxes: fill #002244, stroke #a67c00 (accent) or #334466 (neutral) -->
  <rect x="250" y="40" width="200" height="56" rx="8" fill="#002244" stroke="#a67c00" stroke-width="1.5"/>
  <text x="350" y="74" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="700" fill="#a67c00">Step One</text>
  <!-- arrow marker -->
  <defs><marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#a67c00"/></marker></defs>
  <line x1="350" y1="96" x2="350" y2="150" stroke="#a67c00" stroke-width="1.5" marker-end="url(#ar)"/>
  <rect x="250" y="152" width="200" height="56" rx="8" fill="#002244" stroke="#334466" stroke-width="1.5"/>
  <text x="350" y="180" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="700" fill="#ffffff">Step Two</text>
  <text x="350" y="198" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#cccccc">subtitle · use · middots</text>
</svg>
```
Always give a fixed `viewBox="0 0 W H"`. The encoder adds the fixed `width`/`height` and `preserveAspectRatio` for you.
