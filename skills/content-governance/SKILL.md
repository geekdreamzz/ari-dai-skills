---
name: content-governance
description: Fetch and enforce the Dataspheres content rulebook (GOV-001..) before and during any research -> deck -> video -> media kit -> publish run. Use at the start of every content run, at every review step, and before anything is posted or published.
---

# Content governance

The rules for making and publishing content live on the platform, not in this skill:

```
GET https://dataspheres.ai/api/v1/content-governance          # every rule
GET https://dataspheres.ai/api/v1/content-governance?stage=kit
```

The response carries `version` and `hash`. The platform's content pipeline agent (ARI) stamps every run with the same pair. This skill
never copies the rules, so a new rule reaches every agent the moment it deploys. There's nothing to reinstall.

## At the start of every content run

1. Fetch the rulebook. Record `version.hash` in your run notes.
2. Read the `approvalOrder`: the owner approves the deck before the video, the video before the kit, and the kit before publishing. Never skip a step, and never publish or post without the owner's go.
3. For each stage you work on (`research`, `deck`, `video`, `kit`, `publish`; gate names like `script_review` are not stages), fetch `?stage=<stage>` and work to those rules. `enforce: machine` rules have a check that must pass. `enforce: review` rules are a rubric you score and record.

## The media-kit process: one definition, served by the platform

ARI in the platform and this skill run the same process. Read it from the template; never keep your own list of steps:

```bash
node skills/content-governance/check.mjs process nfl-weekly-pickem sports-intelligence   # steps, gates, rules; GOV-029 destination check
DATASPHERES_API_KEY=... node skills/content-governance/check.mjs hosts sports-intelligence  # GOV-003: every AI host has a face
```

1. **Destination first (GOV-029).** Start the run in `process.destination` (sports analysis publishes in Sports Analytics, `sports-intelligence`, never the main DATASPHERES AI datasphere). The platform refuses a run started anywhere else.
2. **Faces before voice (GOV-003).** The datasphere's AI hosts are seated on every on-screen seat, each with a face. No hosts, no script: seat them first.
3. **Follow `process.stages` in order and stop at every `process.gates` entry** for the owner's decision. Never skip a gate.

## Before you show the owner anything, and before anything is published

Run the machine checks this skill ships:

```bash
node skills/content-governance/check.mjs links <url> [<url> ...]   # every link and QR target opens a real page on the live site
node skills/content-governance/check.mjs page <uri> <slug>         # the page has its feature image (banner + share card)
node skills/content-governance/check.mjs rules [stage]             # print the live rules for a stage
```

Exit code 0 = pass. Non-zero = refuse: fix it, then run again. Never send the owner a link, or publish, while a check fails.

## Rules that caught real failures (from the live rulebook; fetch it for the current set)

- **GOV-001 links are live, on the live site.** A 200 status means nothing on its own, because the site answers 200 for every path. `check.mjs links` reads newsletters through their public API and pages through the crawler render, which answers 404 for a missing page. A posted carousel's QR once went to a newsletter that existed only on dev.
- **GOV-020 one image, three jobs.** The 1280x720 YouTube thumbnail is also the article's top banner and the share card. Set it with `POST /api/v1/dataspheres/:uri/pages/:slug/feature-image` (multipart `image`, or `{ "url" }`).
- **GOV-015 / GOV-016 every pick says why; every named person is followed through.** Give the injury status, the Vegas line and implied total, the team's net points per game, and the matchup stat.
- **GOV-019 people have faces.** Use the verified headshot. A labelled AI image may show a role or a scene, never stand in for a named real person.
- **GOV-011 watch it yourself.** Watch the whole video and read the script before the owner sees it.
- **GOV-030 / GOV-031 / GOV-032 the script makes calls.** Say an uncertainty once, then commit (at most one caveat per talk slide). Never use the template's banned phrases (sports: "the market"). Make at least one labelled bold call with the data behind it. All three are checked at script review, before any voice is bought.
- **GOV-033 schedules run in kickoff order.** Pick sheets, slates and written pick lists go Thursday to Monday, never sorted by a score.
- **GOV-034 a weekly pickem just makes the pick.** Each game: the pick, why, the upset risk, the kickoff. No pool or confidence points anywhere.

## Proposing a rule

Rules change in one place: `config/content-governance.json` in the platform repo, through a reviewed change. If you hit a failure no rule
covers, say so in your report and propose the rule (id, stage, enforce, rule, check, and the owner's words that prompted it).
