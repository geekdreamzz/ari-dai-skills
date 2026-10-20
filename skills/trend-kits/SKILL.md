---
name: trend-kits
description: The autonomous trend-to-kit loop run FROM Claude Code (owner 2026-10-19): Google Trends now -> pick a topic not yet covered -> substantiate it with your own research and vision checks -> author the deck + script -> local render -> kit -> gates -> YouTube -> ledger -> next topic. Use it when asked to run or resume the trend loop, or when a scheduled run invokes it.
---

# Trend kits, from Claude Code

Owner, 2026-10-19: *"keep running an agent continuously by looking at google trends ... find the topic you can substantiate via your
own research ... kick off a media kit ... substantiate that media kit and once it passes automatically publish to youtube ...
pick another topic we haven't substantiated and do it again ... autonomously continuously"* and *"run as much of this off the
Claude Code IDE and cli as possible ... research + using claude to analyze images and media."*

**Division of labor.** You (Claude Code) do every judgment: topic choice, research, reading images and frames, authoring, review.
`scripts/ide-driver/run.mjs` (dataspheres-ai) does every mechanical stage and refuses to continue without your written verdicts.
The platform stores pages, voices, renders on the local worker, gates (GOV rulebook), serves the kit page and posts to YouTube.
Read `IDE-MODE.md` in content-governance first; this skill only adds the loop around it.

## Setup every run
- Workspace: `export WORK=.tmp/ide-driver/trend-kits/<YYYY-MM-DD>[-<n>]` inside dataspheres-ai. Receipts live in `$WORK/receipts.json`
  (`run.mjs status`); a crashed run resumes from its last receipt, never restarts.
- Kill switch: `~/.dataspheres-trendkits/STOP` halts every stage (exit 3). Check it first; obey it.
- Destination: the agent's datasphere (`run.mjs process <uri>` prints its recipe, baseline and gates). Go Viral lives in `wtf-america`;
  sports topics publish in `sports-intelligence` (GOV-029). Publish as the Faceless profile only.
- Preflight: `run.mjs preflight <uri>` (GOV-042) must pass before any work.

## 1. Hunt
`run.mjs hunt 15 US` -> `$WORK/hunt.json`: Trends now minus the done-ledger (`run.mjs ledger list`), each term with its headlines and
downloaded hero images. Score every candidate on the recipe's scorecard (substance, unknown-but-true, wild, social signal, search,
stake, identity-safe, runway). **Look at the hero images** (Read each `heroFile`): they tell you what the story really is.

Routing before any research:
- A death, shooting, disaster or abuse story is the **sensitive class**: never auto-published. Write `run.mjs verdict topic fail sensitive: <why>`
  and move to the next candidate (or stop and tell the owner if they asked for coverage).
- Pure celebrity / sports-score / entertainment-release chatter with no stake for the viewer scores low; skip it.
- The first candidate scoring >= the recipe threshold (default 60/100) wins. If none does, `run.mjs verdict topic fail none cleared <best score>`
  and end the run: a quiet tick is a correct result.

## 2. Substantiate (the bar, all four)
1. **Primary source**: the document, filing, dataset, transcript or official statement itself, saved to `$WORK/sources.json` with a dated URL.
2. **Two independent outlets** reporting it, dated, with the figures they give (note every disagreement).
3. **Cross-platform signal**: what X / Reddit / TikTok / YouTube / Threads say (the angle people care about, the claims circulating that
   the primary source confirms or refutes).
4. **Pictures that are what they say**: `run.mjs scrape sources.json` pulls each source's text + lead image. Read every image you intend
   to place and write `run.mjs verdict pictures pass <who/what each shows, credit>` only when each one shows what its caption will claim,
   is licensed editorial media or official art, and names its person in the caption lead (GOV-047). Otherwise fail and replace it.
Write the numbers against a yardstick (GOV-036) and the other side's strongest case (baseline `other-side`). If any of the four is missing,
`run.mjs verdict substantiated fail <what is missing>` and go back to the hunt.

## 3. Author
- `$WORK/create-body.json`: the recipe's sections on the baseline arc (welcome -> dive-in -> insights first -> narrative -> climax -> meaning
  -> close). Picture captions lead with name + role. Charts carry units. No slide without a picture or a data visual beyond the
  GOV-035 share. `run.mjs deck create-body.json <uri>` -> deck id; `run.mjs gates <id>` must print four passes; `run.mjs shots <uri> <slug> <n>`.
- **Look at every screenshot** (`$WORK/shots/r*.png`). `run.mjs verdict slides pass <what you checked>` only when nothing is truncated,
  every picture renders, every table reads, and the welcome/close slides are right.
- `$WORK/script.json`: the format's cast from the datasphere's hosts, welcome first with the show name and the goal, tone per GOV-046
  (set `goal.tone`), one bold call, the sign-up close. `run.mjs attach <id> script.json` (cast, identity, tone and welcome checks, cues).
  Read the cue table it prints: a line that names a pictured person cues that picture; a line naming nobody pictured never cues a face.

## 3b. The portrait short first (GOV-048, owner 2026-10-20)
Before the long video and the kit, plan the SHORT as its own production: `$WORK/short-beats.json` with six beats (hook, turn,
climax, action, loop, signup), each on a portrait template (number, compare, photo, timeline, checklist, quote, signup) with its
data and the voiced turns (or sentences) it speaks. `run.mjs short <renderJobId>` refuses on any GOV-048 issue and otherwise
writes `$WORK/short/portrait-short.mp4` and prints the dev preview link. **Watch it, send it to the owner, and wait**: the
owner's verdict on the short is the substance litmus test; `run.mjs verdict short pass|fail <what you saw and what the owner said>`;
`run.mjs require short` before the kit. No two-speaker footer in portrait; one active-speaker chip; captions in the middle; no
word may break.

## 4. Render and look
`run.mjs render <uri> <id>` -> job id; `run.mjs jobstat <jobId>` until SUCCEEDED (the worker refuses a timeline with a wrong face:
GOV-047 picture + subject audits in its log). Then pull frames (`ffmpeg -ss <t> -i <mp4> -frames:v 1`) at the welcome, each picture
slide, each lineup/table and the close, **read them**, and write `run.mjs verdict video pass <what you saw>`; fail -> fix the deck or
script, re-render with `requeue-voice.ts <jobId>` ($0, same voice).

## 5. Kit, publish, post
`run.mjs require video` then `run.mjs kit <id> <jobId> <kitStem> <uri>` in its phases (deck -> pages -> kit; the kit job on the dev
worker between pages and kit). The kit phase registers the render on the public base and writes the kit page (GOV-041). Read the kit
page once more (`check.mjs kit-page`). Then `run.mjs post <uri> <publicDeckId> public` (video + Short) when the recipe's publish gate is
`auto`; when it is `require_approval`, stop and hand the owner the links.

## 6. Ledger and tracker
`run.mjs ledger add "<topic key>" '{"status":"posted","kitUrl":"...","youtube":"...","aliases":[...]}'` so the next hunt skips it, and add the
edition's row to the datasphere's tracker page (scorecard, posted time, reads due at 24h/72h/7d). Append the run to the session log.

## What never happens
- No verdict written without looking. No publish while a required verdict is missing or failed. No vendor or model names in copy.
- No dev or localhost link in anything published. No sensitive-class story auto-published. No post from any account but Faceless.
- No spend cap games: one edition per tick, the content and the gates decide; the owner decides the cadence.
