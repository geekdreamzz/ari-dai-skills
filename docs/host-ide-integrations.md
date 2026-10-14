# Host IDE integrations: plan

**Status:** PLAN, written 2026-10-10. Not built yet. This is the brief for the content-studio skills update (M59), which resumes after the 2026-10-14 usage reset.

## The direction (owner, verbatim)

> "tell ari-da-skills to play nicely with the host IDE like claude features, codex features, cursor features....we should maintain various tools and add-ons those systems support that ari-dai-skills works nicely with and orchestrates all of them"

> "i want to update ari-dai-skills with all this so that system can fully automate this system within someone elses API_KEY via claude_code, cursor, co-pilot, codex"

## Principles

1. **One source, many hosts.** Every skill is written once as `skills/<name>/SKILL.md`, and the installer generates each host's native files from it. Never hand-maintain four copies.
2. **Use the host's own features, not a lowest common denominator.** When a host has subagents, hooks, slash commands or MCP, the kit uses them. When it has none, the kit falls back to plain instructions.
3. **The Dataspheres MCP server is the orchestration hub.** The platform already serves one (`src/server/v2/mcp/server.ts`, `v2/routes/mcp.routes.ts`). Each host connects to it with the user's own API key, so every tool (pipeline, video, kit, publish, link-to-show, hosts) is callable natively. The REST recipes in SKILL.md stay as the fallback.
4. **The user's key, the user's datasphere, the user's capacity.** The key is never printed and never written into a generated file. Generated configs reference an environment variable.
5. **Human gates stay human.** No host automation may approve a deck, script or publish gate on its own. It asks the user, or the user sets the gate to auto.
6. **A maintained compatibility matrix.** `docs/host-matrix.md` lists, for each host and feature, what the kit generates, the host version it was verified on, and the verify date. A check script fails when a generated file is missing or has drifted from its source.

## What each host gets

Verify every path and format against the host's current docs at build time. Hosts change fast, and this list is a starting point, not the truth.

| Host feature | Claude Code | Codex | Cursor | GitHub Copilot |
|---|---|---|---|---|
| Always-on instructions | `CLAUDE.md` | `AGENTS.md` | `.cursor/rules/*.mdc` (alwaysApply) / `AGENTS.md` | `.github/copilot-instructions.md` / `AGENTS.md` |
| Per-skill instructions | `.claude/skills/<name>/SKILL.md` | skills dir if supported, else sections in `AGENTS.md` | `.cursor/rules/<name>.mdc` (agent-requested, with description) | `.github/instructions/<name>.instructions.md` (applyTo) |
| Slash commands / prompts | `.claude/commands/*.md` (e.g. `/make-show <link>`, `/kit`, `/publish-youtube`) | custom prompts dir | `.cursor/commands/*.md` | `.github/prompts/*.prompt.md` |
| Subagents / modes | `.claude/agents/*.md` (researcher, creative director, fact checker, kit reviewer) | (none, or profiles) | (modes/agents if supported) | `.github/agents` / chat modes |
| MCP (Dataspheres tools) | `.mcp.json` | `~/.codex/config.toml` `[mcp_servers]` | `.cursor/mcp.json` | `.vscode/mcp.json` |
| Hooks / automation | `settings.json` hooks (e.g. notify when a run reaches a gate) | (none or notify) | (none) | (none) |
| Headless / background | `claude -p`, Agent SDK, scheduled runs | `codex exec` | background agents | Copilot coding agent |

## Orchestration the kit provides on every host

- **Make a show from a link:** start a link-to-show run, poll it, surface each gate to the user, then hand back the watch page and kit links.
- **Watch a run:** poll the pipeline run and report progress in plain words, with the cost against the budget. Use host notifications or hooks where they exist.
- **Review a gate:** fetch the deck or script, summarise it, and ask the user for approve or reject. Never decide on the user's behalf.
- **Publish:** post to the connected channels (YouTube now; Instagram and TikTok once approved) after the user confirms.
- **Schedule:** create standing pipelines (for example "every Friday, preview each Sunday game").

## Build checklist (resume)

1. The installer (`install.sh`, `install.bat`, `update.sh`) generates all four hosts from SKILL.md sources, with `--ide claude|codex|cursor|copilot|all` (today it supports claude, cursor and copilot).
2. MCP config templates for each host point at `${DATASPHERES_BASE_URL}/api/v2/mcp` with the bearer key from the environment. Check the server's auth (API key) and that the tool list covers the content-studio tools.
3. Commands, prompts and subagents for the content-studio flows, in each host's native format.
4. Write `docs/host-matrix.md`, plus `scripts/verify-hosts.mjs` (generated files exist, match their sources, and MCP config parses).
5. Doc-test every REST and MCP example against dev with a test key.
6. VERSION 0.3.0, CHANGELOG, REGISTRY and README.
7. Push only after the platform features exist on the live site, or with a clear "on dev, coming soon" note. The owner approved pushing the skills update on 2026-10-10 ("push that out").

## Onboarding: brand first (owner, 2026-10-10)

> "it should be using the dataspheres ai logo in the presentation whenever it references dataspheres ai or the main host datasphere's logo for that content....ari-dai-skills should recommend users to set logos for their dataspheres and onboard them"

- **First-run onboarding for `content-studio`.** Before a user's first show, check the datasphere's brand: the logo (`profileImageUrl`), the banner, the show name and the call-to-action target. If anything is missing, walk the user through setting it (upload, or pick from the media library) before spending anything. Say why: "Your logo appears on the cover, the sign-off card and every slide that names your datasphere."
- **The platform side.** Wherever the host datasphere's brand appears (the cover, the call-to-action card, the lower-thirds, any slide that names it), the deck and the video use its logo, never a letter placeholder. The pipeline's plan stage warns when no logo is set.

## YouTube thumbnails (owner, 2026-10-10)

The kit's first thumbnail let faint slide text show through behind the title. The owner asked for the better version to go into ari-dai-skills. The recipe that worked, which the post pack should generate and the `distribution-kit` skill should describe:
- **For a matchup:** a split screen in each side's color (Commanders burgundy #5A1414, Giants blue #0B2265), each side's headshot cutout, each team's logo in its top corner, a huge "VS" in the center with a heavy outline, a short question hook ("WHO WINS?") in an accent color, and a solid bar along the bottom with the title in a heavy condensed face.
- **For a single subject:** one subject cutout, the brand logo, a 2-4 word hook and the title bar.
- **For a picks or lineups show:** the two or three key players' headshots, a huge hook number or word ("$1M") in an accent color with a heavy outline, salary or stat tags on each player, team-color swashes, and the contest name in the bottom bar.
- **Always:** 1280x720, no slide text behind the title, faces large and unobstructed, the host datasphere's logo when the brand appears.

**One image, three jobs (owner, 2026-10-11):**

> "everything needs a feature banner image esp the narrative page for SEO share ability can just generate the YouTube thumbnail so it's a twofer ... Make sure that's part of the media kit moving forward"

- The YouTube thumbnail is also the narrative page's top banner, and the og:image share card for both the article and the deck.
- The media kit applies it automatically: deck + every article linking to the deck. It never overwrites a feature image that's already set.
- For a hand-made thumbnail, call `POST /api/v1/dataspheres/:uri/pages/:slug/feature-image`:
  - send multipart field `image` (cropped to 1280x720), or `{ "url": "https://..." }`;
  - `banner=false` sets the share card only.
- Make the thumbnail before the narrative page goes up for review, so the owner sees the banner from the start.
- Nothing publishes without a feature image (governance GOV-020).

## ARI and ari-dai-skills parity (owner question, 2026-10-10)

> "ari-dai-skills and ari on the platform is 100% in sync right? in terms of capabilities?"

They are not in sync today. The capability registry found the skills kit covers about 5 of the 28 content-studio capabilities, while in-app ARI has tools for most of them. The fix:
- one shared surface, the platform MCP server, which exposes the same tool registry ARI uses;
- every SKILL.md generated from, or checked against, that registry;
- a parity check (`scripts/verify-parity.mjs`) that fails when ARI has a tool that no skill or MCP tool covers, or when a skill documents a route that no longer exists.

## Production links only (owner, 2026-10-10)

> "anytime we publish social media they need to be prod links"

- Everything meant for the public (post packs, YouTube descriptions, captions, carousel captions, CTA QR codes, the sign-off card) links to the live site (`https://dataspheres.ai/...`). Never a dev or localhost address.
- Before linking a page, confirm it exists and is public on the live site. If it doesn't, leave the link out rather than point at a dead page.
- Skills: the `distribution-kit` and `publish` skills check every link in a post with a HEAD/GET against the live site before posting, and refuse to post a dev address.

## Kit order (owner, 2026-10-10)

> "thats the order of the kit."

The distribution kit, its download zip, its UI and the publish flow all follow this order:
1. YouTube: the 16:9 video, captions (SRT), thumbnail, title, description with chapters, and tags.
2. YouTube Short: the vertical highlight, linked to the main video.
3. TikTok: the vertical highlight, with the AI label and a link in bio.
4. Instagram Reel: the vertical highlight, with the AI info label.
5. Instagram slides: the carousel, with its caption.
6. Raw audio, all of it: the final mix (WAV and MP3) and voice only (WAV).
7. A link to the full presentation in fullscreen present mode, on the live site. The platform needs a `?present=1` link that opens present mode; browsers require one tap to go fullscreen.

## The API key page in every skill (owner, 2026-10-10)

> "make sure ari-dai-skills links https://dataspheres.ai/app/developers in it's docs"

Every skill's auth or setup section links **https://dataspheres.ai/app/developers?tab=keys** (create, rotate or replace a key) and handles `401 Invalid API key` the same way: stop, never try other keys, and send the user to that page to make a new key and put it in `.env`. Today it's linked in README, CLAUDE.md, `skills/ari-dai-skills` and `skills/dataspheres-api`. The content-studio skills (M59) must include it, and `scripts/verify-hosts.mjs` checks that every SKILL.md with an auth section contains the link.

## Local render worker for everyone (owner, 2026-10-11)

> "for ari-dai-skills just let ppl build and run it locally - have it install the local stuff needed to run it publicly and locally where needed to generate this stuff"

Anyone with an API key can make videos and kits on their own machine and send the results to their datasphere, on the live site or locally. No hosting cost, and no database access.

**A new skill, `render-worker`:**
- **Install.** One command checks for and installs what rendering needs: Node 20+, ffmpeg (with hardware encoding when the machine has a GPU), and Playwright's Chromium. It covers Windows (winget), macOS (brew) and Linux (apt). It prints exactly what it installed.
- **Run.** `dai render-worker start`. Polls the user's own render jobs on the platform (`DATASPHERES_BASE_URL`, live site or local) with `DATASPHERES_API_KEY`. `stop` and `status` work as usual. Optional: run as a background service or at login.
- **Works in every host:** run it from a Claude Code, Codex, Cursor or Copilot command, or by hand in a terminal.

**Platform API the worker needs** (today the worker reads the database directly, which only works on our own machine):
- `POST /api/v1/render-jobs/claim`: claim the next queued job owned by the key's user. Single-flight, with a lease.
- `GET /api/v1/render-jobs/:id/input`: the deck, script, voices and timeline, plus a short-lived record token for the record page.
- `POST /api/v1/render-jobs/:id/progress`: stage and percent, plus a heartbeat that renews the lease.
- `POST /api/v1/render-jobs/:id/outputs`: upload the MP4s, HLS, captions, audio, carousel and thumbnail into the job's media.
- `POST /api/v1/render-jobs/:id/complete` and `.../fail`.
- **Scoped to the key's own jobs.** A new `render:worker` key scope, so ordinary keys can't act as a worker. Rate limits apply, and every upload is type-checked and size-limited.

**Billing:** voice generation stays metered to the user's capacity as today. Rendering on their own machine costs them nothing.

**First user:** us. Tonight's "render here, upload to production" flow becomes this worker pointed at dataspheres.ai with the Faceless AI key.

**Inside the host tool (owner, 2026-10-11: "within some harness like cursor, claude code, codex, co-pilot").** People install and run the worker from inside their AI coding tool, not by hand. The tool's agent runs the install, starts the worker as a background task, watches its progress and reports results in chat.
- **Claude Code:** a `/render-worker` slash command and a skill. The worker runs as a background shell task, and a hook posts "video ready" with the links.
- **Codex:** an `AGENTS.md` section plus a custom prompt, run through `codex exec` or the sandboxed shell, with permission to install ffmpeg and Chromium.
- **Cursor:** a `.cursor/commands/render-worker.md` command and a rule. It runs in Cursor's terminal or a background agent.
- **Copilot:** a `.github/prompts/render-worker.prompt.md` prompt, run in agent mode's terminal.
- **The same source for all four.** One SKILL.md, generated into each tool's native files, with the platform MCP server for job status. Installs ask before adding system packages. The key stays in `.env` and is never printed.

## More platforms: X, Threads, LinkedIn, Reddit (owner, 2026-10-11)

> "how can we post to reddit and thread and x?? should we link our youtube links ... or just upload natively ... how can we build followings there with our kit strategy? maybe all this comes together into the course ... lets add LinkedIN also"

- **Native first, link second.** Upload natively everywhere. The YouTube and datasphere link goes in the first reply or comment, never the post body, since X, Threads and LinkedIn tend to show linked posts to fewer people. YouTube is the hub everything points to.
- **New post-pack entries:**
  - an X thread: one post per game, with the top play and 2-4 carousel images; the link in the last reply;
  - a Threads post: the vertical highlight or carousel (up to 20 images);
  - a LinkedIn post: the carousel exported as a PDF document post, plus a how-it-was-made angle;
  - a Reddit text post: lineup tables in Reddit markdown, following each community's self-promotion rules.
- **Publishers** (ChannelPublisher adapters next to YouTube):
  - X API (posting quota depends on tier);
  - Threads API (Meta app review);
  - LinkedIn (personal profiles via member posting; company pages need marketing approval);
  - Reddit (OAuth script app). Reddit always requires a human approve per post, because communities ban automated posting.
  - Every public post needs the owner's approval first.
- **Cross-platform asset matrix:**
  - the vertical highlight goes to Shorts, TikTok, Reels, Threads and X;
  - the carousel goes to Instagram, a LinkedIn PDF and X thread images;
  - the 16:9 video goes to YouTube and LinkedIn;
  - the audio goes to podcast apps;
  - the tables go to Reddit.
- **Course:** "Easy Media Kits" (making research and posting a breeze), a Dataspheres course with one module per platform: what to post natively, where the link goes, how to grow a following, and which kit file to use.

### Course must cover every platform and monetization (owner, 2026-10-11)

> "make sure the course includes all platforms but I Want to include how to monetize"

Title: "Easy Media Kits" - making research and posting a breeze (owner 2026-10-14: not everything is a show). The course page keeps its published URL /pages/dataspheres-ai/one-show-every-platform because printed QR codes point there. Modules:
1. **The kit:** every asset and where it goes.
2. **Per platform** (YouTube and Shorts, TikTok, Instagram, Threads, X, LinkedIn, Reddit, podcasts): what to post natively, where the link goes, cadence, growth, AI disclosure settings.
3. **Monetization by platform.** Live-checked, dated thresholds, because they change: YouTube Partner Program tiers, TikTok Creator Rewards, X creator revenue sharing and subscriptions, Instagram and Threads subscriptions, gifts and bonuses, LinkedIn (leads, newsletters, sponsors), Reddit (credibility and traffic), podcast ads and video podcast partner programs.
4. **Off-platform money:**
   - paid Dataspheres memberships and paid newsletters (Stripe Connect is already built);
   - sponsorships;
   - affiliate deals, including DFS and sportsbook programs: only where legal, with age limits, responsible-gaming copy and FTC disclosure;
   - courses and consulting.
5. **Keeping AI content monetizable:** original analysis, editorial choices, human review, honest synthetic-media disclosure, no reused footage. This avoids "mass-produced or repetitive content" demonetization.
6. **The weekly playbook:** posting calendar, metrics, when to double down.

Built as a Dataspheres course (courses skill), with the kit files from a real episode as worked examples.

## At a minimum, the skills kit does what we did by hand tonight (owner, 2026-10-11)

> "ari-dai-skills should be able to do it ... at a minimum"

The working scripts from the Week 5 fantasy run become skills, so anyone can repeat the flow with their own key:
- **`research-batch`:** start N deep research runs in parallel, one per game or item, poll them, re-run any that come back empty, and pull the write-ups. (Prod bug seen tonight: a run can finish "complete" with an empty write-up. A retry works.)
- **`deck-from-data`:** build a deck from a compact JSON description. Matchup cover, stats, both sides' stories, player cards, injury table, picks tables, roster wall, lineups. Includes a **live-site compatibility mode** that maps studio layouts to basic ones when the target site doesn't support them yet. Posted as a DRAFT (the owner approves before anything is public, video or kit).
- **`dfs-lineups`:** a salary table pulled from the research, then lineups checked by script. DraftKings Classic: QB, 2 RB, 3 WR, TE, FLEX, DST, $50,000 cap. It rejects any lineup that's over the cap, has a wrong slot, a repeated player or a missing salary, and flags salaries confirmed by only one source.
- **`deck-mirror`:** copy an approved live-site deck to a local or dev instance to render, then upload the kit back (the render-here, upload-to-production flow) until the `render-worker` API exists.
- Each skill: plain "Say this" usage, the REST calls verified against the code, and links in the order the owner wants them, each with its title and description.

## Knowledge graphs in articles and decks (owner, 2026-10-11)

> "Should the narrative page embed a knowledge graph?? That would look nice those and in the presentation blocks too"

Yes. Each research run already extracts ranked entities (`resultEntities`; the SNF run found 299). For each game, build a graph with the graphs skill:
- **Nodes:** both teams (logos), the key players (headshots), the coaches, the injured players.
- **Edges:** plays-for, Out / Questionable, unit-vs-unit matchups, and "a pick in this deck".
- **Grouping:** a container bubble per team.

**Where it appears:**
- the article: one embedded `/graph/:uri/:graphId?embed=1` per game, plus one for the slate;
- the deck: an embed slide after the matchup cover, and later a `knowledge-graph` composition.

**Skill:** `research-to-graph`. The same entities feed the graph, the deck and the video.

## Iterate before showing (owner rule, 2026-10-11)

> "you and ari-dai-skills need a rule that you set a timer to substantiate and iterate on the research, the multi media, and the presentation itself and iterate and enforce and govern the workflow ... research based ... psychology based ... advanced interactive presentation media design"

The `content-studio` skill runs a time-boxed loop for every piece (research → deck → video → kit):
- **Each round:** substantiate, critique against the rubric, improve, re-check. At least 2 rounds; a timer or wakeup keeps it going.
- **The audience and psychology rubric:**
  - who it's for and their goal;
  - a 3-second hook;
  - curiosity gaps and open loops;
  - stakes;
  - concrete numbers;
  - social proof;
  - loss aversion;
  - one idea per slide;
  - pattern interrupts every 6-10 s;
  - a payoff and a CTA.
- **The design rubric:** broadcast graphics (player cards on team colours, matchup splits, charts that build, headshot lineup walls), thumbnail-worthy slides, varied motion, no camera zooms into tables, no stock or repeated jokes, real host faces.
- **Order, with an owner approval at each step:** deck, then video, then kit, then publish.
- **The workflow is enforced:** a skill never publishes past a step its owner hasn't approved.
