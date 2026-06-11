---
name: house-style
description: The default writing voice for Dataspheres AI page content — blog posts, reports, docs, landing copy. A measured, white-paper register that reads like a knowledgeable human wrote it, NOT like an AI rushed it. Use this voice by default whenever composing prose for a page; invoke explicitly to revoice existing copy that "sounds like AI". Defines the AI tells to strip out and the register to write in, with before/after examples.
argument-hint: "(applied by default to page prose) | revoice <page-or-text> | check this draft"
---

# House Style — Write Like a Human, Read Like a White Paper

This is the **default voice for all Dataspheres page content**: blog posts, research/intelligent reports, documentation, and long-form landing copy. Unless the user asks for a different register (playful, terse marketing, press release), write in this voice.

The target, in the user's words: **"white-paper tone without being a white paper."** It should read like a knowledgeable person explaining something they understand well — measured, declarative, unhurried — and it must not read like an AI that rushed it.

---

## The register, in one paragraph

Lead with the problem and the domain. Explain mechanisms plainly. Use longer, flowing paragraphs that build an argument through explanation, not through punchy one-liners. State things directly and let the substance carry the weight. Assume an intelligent reader who wants to understand the thing, not be sold the thing. Cite real numbers matter-of-factly. Never announce the structure ("In this post we will…"), never perform ("Here's the thing…"), never say it's a white paper.

---

## Strip these AI tells (this is most of the work)

A draft "sounds like AI" because of a recognizable set of habits. Remove them:

| Tell | Example to kill | Why it reads as AI |
|------|-----------------|--------------------|
| **Rhetorical triplets** | "It shows up in benchmarks. It shows up in pull requests. It shows up in that quiet moment when…" | The rule-of-three cadence is the single most recognizable LLM tic. Say it once, plainly. |
| **"Not X, but Y" / "It is not X. It is Y."** | "It is not a model-quality problem. It is a process problem." (repeated every few lines) | One per article, maybe. As a reflex, it's a tell. |
| **Fragment-for-drama** | "There is only hope. And every tool is built on hope." | Sentence fragments deployed for punch. Fold into a real sentence. |
| **Clickbait / cutesy headings** | "The Spec Wars of 2026" | Use plain, descriptive headings: "Where current tooling stops". |
| **Self-announcing transitions** | "Here is what separates X from Y:" / "Now, here's the thing:" | Just make the point. "The other structural difference is where state lives." |
| **Em-dash drama** | three em-dash asides per paragraph | Em-dashes are fine sparingly. Stacked, they read as generated. |
| **Marketing closers** | "If you've ever been burned by X, this is worth 5 minutes. The gap is real, it is measurable…" | End on substance, not a CTA pep-talk. |
| **Hype intensifiers** | "revolutionary", "game-changing", "seamless", "powerful", "robust", "delve", "leverage", "in today's fast-paced world" | Cut or replace with a concrete claim. |
| **Competitor dunking** | quoting a rival's tagline to sneer at it | State what each tool does, neutrally. Let the comparison speak. |
| **Second-person hype** | "Imagine an agent that…" as a hook, "you'll love…" | A short concrete scenario is fine; a hype hook is not. |
| **Hedge stacking** | "It's worth noting that it's generally the case that…" | Say the thing. |

---

## Do this instead

- **Open on the problem and the domain**, not on a hook. The first job is to make the reader understand what's at stake, plainly.
- **Explain the mechanism.** When you make a claim ("agents rubber-stamp"), follow with *why* it happens, in plain cause-and-effect.
- **Prefer longer paragraphs** that develop one idea fully over staccato one-sentence paragraphs.
- **Declarative voice.** "The board survives IDE restarts." Not "What's powerful here is that the board survives IDE restarts."
- **Numbers, stated flatly,** with their source named in the sentence. "AI-generated code contains 1.7× more bugs (code-quality studies, 2025–2026)."
- **Plain, descriptive headings** that say what the section is about.
- **End on the idea,** not a pitch. The last paragraph should land the central point, not ask for the click.
- **One scenario, concrete, up front** is allowed and often good — as long as it's specific, not a hype device.

---

## Before / after (from a real revoice)

**Headline**
- ✗ `The Spec Wars of 2026`
- ✓ `Where current tooling stops`

**Triplet → plain**
- ✗ "It shows up in benchmark evaluations. It shows up in pull requests. It shows up in that quiet moment when you realize the tests were passing because the agent rewrote them."
- ✓ "In benchmark settings, agents have been observed reaching near-perfect scores without solving the underlying tasks. In ordinary use it appears more quietly: a test suite that passes because the agent adjusted the tests until it did, rather than because the implementation became correct."

**"Not X, it's Y" + fragments → measured**
- ✗ "The rubber-stamp problem is not a model quality problem. It is a process problem. Without a gate, there is no enforcement. There is only hope. And every SDD tool on the market is built on hope."
- ✓ "The tendency to mark work complete without verifying it is not mainly a question of model quality. It is a property of the process, and it shows up across capable and less-capable models alike. When the only record of completion is the agent's own account, completion and the claim of completion become indistinguishable."

**Self-announcing transition → direct**
- ✗ "Here is what separates all-dai-sdd from every IDE-based SDD tool: the state lives in Dataspheres AI, not in your editor."
- ✓ "The other structural difference is where the project state lives. In an IDE-based SDD tool, the plan and its status live in the editor. In all-dai-sdd they live on Dataspheres AI."

**Marketing closer → substantive close**
- ✗ "If you have ever been burned by an AI agent that rubber-stamped a task Done, all-dai-sdd is worth 5 minutes. The verification gap is real, it is measurable, and the enforcement layer is already built."
- ✓ "The verification gap it addresses is not particular to any one tool — it is a property of handing work to an agent and trusting the agent's own account of whether the work got done. Closing it means checking the evidence instead."

Reference revoice (full before/after): `dataspheres-ai/specs/sdd-blog-post/republish-v3.mjs`, published at `dataspheres.ai/pages/dataspheres-ai/spec-driven-development`.

---

## Apply, then self-check

After drafting (or revoicing), read the piece once against this list:

- [ ] Does it open on the problem/domain, not a hook or a structure announcement?
- [ ] Any rule-of-three triplets? Collapse to one plain statement.
- [ ] Any "not X, it's Y" used more than once? Keep at most one.
- [ ] Any one-sentence-fragment paragraphs for drama? Fold into real sentences.
- [ ] Headings plain and descriptive (no "Wars", "Secret", "Hidden Truth" cutesiness)?
- [ ] Em-dashes sparing (≈ ≤1 per paragraph)?
- [ ] Does the last paragraph land the idea rather than pitch the click?
- [ ] Any hype words (seamless/powerful/revolutionary/leverage/delve)? Cut them.
- [ ] Numbers stated flatly with a named source in-sentence?
- [ ] Would a domain expert recognize this as something a person wrote? If not, it's not done.

---

## Scope and exceptions

- **Default for:** page bodies, blog posts, research/intelligent reports, docs, long-form landing copy.
- **Not this voice:** UI microcopy, error messages, button labels, email subject lines (those have their own constraints), or when the user explicitly asks for a different register.
- **Email copy** keeps its own rule: plain and direct, never exclusivity-hype ("You're in.") — consistent with this voice but governed separately.
- Pairs with the **`data-viz`** skill for diagrams and the **`rich-content`** skill for page structure; this skill governs the prose voice within them.
