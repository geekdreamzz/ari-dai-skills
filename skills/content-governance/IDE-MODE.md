# IDE mode: make a media kit from the IDE

IDE mode is the default for every media kit: you do the research, the reasoning, the picture judging, the deck, its checks and
the script in the IDE, and the platform's models run only when the owner asks for the platform by name. Owner, 2026-10-16: "the
vision judge can be inside the IDE too. literally everything... but the eleven labs voices". Scraping, checks and the render run on the local machine. **The platform is
used only for what it alone can do: storing the deck, voicing the script and serving the video.** The platform's thinking
models are never asked to plan, research or write.

The agent config still governs the run. Fetch it first and work to it exactly as the platform pipeline would:

```bash
DATASPHERES_API_KEY=... node skills/content-governance/check.mjs process <datasphere-uri>   # the agent's recipe, stages, gates, rules
DATASPHERES_API_KEY=... node skills/content-governance/check.mjs rules deck                 # live rules per stage
```

The recipe's sections, `mustCover`, visuals, banned moves and calls to action are your brief. The rulebook's every-run rules
are your checks. Follow the approval order: deck, then video, then kit, then publish. Stop for the owner at each step.

## 0. Preflight: prove the run can finish (GOV-042)

Before any research, deck, render or kit:

```bash
DATASPHERES_API_KEY=<public base key> node skills/content-governance/check.mjs preflight <uri>
```

It refuses the run unless the rulebook is served, the destination datasphere exists on the public base and opens publicly,
this key's user is a member who can upload and publish there, and the AI hosts are seated with faces. A refusal is fixed
first (add the user to the datasphere, seat the hosts); nothing starts until every line passes. This is what stops a kit
from being refused after ten minutes of work because the pages it links cannot exist.

## 1. Research and verify (IDE)

- Search the web for the edition window. Use the agent's `{since}`, which is the previous edition's date.
- Keep only stories confirmed by a primary or established source, and drop anything you can't confirm. One example: the
  "EU RFIs this week" story turned out to have been sent in August.
- Write a `sources.json` that pairs each story with its source URLs.

## 2. Scrape locally

Use a Playwright script to open each source and save its readable text plus its `og:image`. That gives you the
pictures (the subject's own site, the story's own art, or established press) and the text you will check claims against.
Rehost the pictures through the platform's uploads. Public logos may be cached.

## 3. Author the deck (IDE)

Write the deck as JSON slides that follow the recipe's sections. Then create it with
`POST /api/v1/dataspheres/:uri/pages { pageType: "PRESENTATION", status: "PUBLISHED", isPubliclyVisible: true, autoImages: false, slides, showCta, showCourse }`.
The platform adds the cover and the closing call-to-action slide; don't author a second title slide.

Rules that every deck must pass:

- **GOV-035, rich media.** At least 40% of slides carry a real picture, and no more than 3 text-only slides run in a row.
- **GOV-036, numbers in context.** A table of numbers becomes a chart (a bar or line chart, not a table). A lone big number is
  set against a yardstick, such as the #1 entry or the market. Explain benchmarks in plain words.
- **GOV-038, no visual cuts anything off.** Every chart label, value and title shows in full. Bars whose names don't fit
  under them are drawn horizontally.
- No slide or line explains how the stories were ranked; present the stories and say why each matters.

## 4. Substantiate every slide, visuals first

Check every number and named fact on every slide, and every name in the script, against the scraped text of the source
it came from. A plain string match is enough; no model is needed. Any fact confirmed only by a secondary summary is listed
for the owner, never silently passed. Then screenshot every slide from the public reader view, look at each chart, and
confirm nothing is cut off. Send the owner the deck link and the result, then wait for the deck approval.

## 5. Write the script (IDE)

Write to the show format's beats: welcome, rundown, lead-in, what happened, why it matters, bridge, takeaways and what to
watch.

- **The welcome only welcomes:** each host introduces themselves by name. It never says anything is AI generated.
- **Every move between stories is a bridge** that connects the two stories or clearly signposts the next one.
- **The course call to action goes only at the end.**
- **Write numbers and dates the way a reader reads them**: "October 12", "1.1%", "$16.8bn", "2031". The voice reads them
  correctly, and the captions and any big type show them written, never "October twelfth" or "one point one percent".
  (The renderer still rewrites a spoken date it meets as "Oct 12th".) Every fact must already be on its slide or in its notes.
- **One zoom per slide, if any.** The renderer pushes into a slide at most once, eased; it never pushes, cuts back and
  pushes again (that read as the slide re-rendering).
- **Clean hand-offs.** When a stored take is re-spaced (`respace.ts`), every cut keeps a 40 ms head and tail and lands on a
  12 ms fade; a speaker change is 100 ms, a slide change 800 ms. Listen to every topic change before sending the link; a
  clipped syllable or a hard cut into a new story fails GOV-040.
- **Greetings are said, never shown.** A welcome, "good to be with you", a sign-off: the hosts say it; nothing sets it in big type.

Attach the script to the deck as each slide's `narration`:
`{ mode: "conversation" | "solo", format, turns: [{ speaker: "host" | "guest", role, voiceId, text, bookend? }] }`.
Use `solo` when only one role speaks on a slide. Take the voice IDs from the datasphere's seated hosts. Every write goes
through the deck validator.

## 5b. Author the cut on the script, not on a timer

The video's rhythm comes from metadata on each spoken turn, never from a timed filler:

- `cue`: what the line is about, so the camera frames it as it is said. `{ kind: "element", elementId }` for the chart,
  the stat or the bullet the line speaks; `{ kind: "image", index: 0 }` on a picture slide; `{ kind: "full" }` otherwise.
- `offsetMs`: how the line follows the one before. A speaker change is 100 ms; the same voice going on is 250 ms. A slide
  change keeps the wipe's 800 ms.

The IDE helper `author-cues.ts` writes both from the slide's own elements and the line's words, through the deck validator.
Without them the planner fills gaps with pushes and phrases on a timer, which is what read as "stale" and "weird zoom".

Rules the shared renderer enforces on every path (rulebook GOV-039 and GOV-040): a picture from another slide cuts in only
over a line AND a slide that name what it shows; a number inside a name (Claude Opus 5.5, S&P 500) is never a stat callout;
a welcome or a self-introduction is never big type; a spoken date is set as a graphic writes it (Nov 30); in a calm format
(news, explainer, archive, markets) each slide settles before a cover, no cover is up under 2 s, no kinetic type covers a
chart, and no camera push cuts into a picture slide. The news briefing has no stings or whooshes: one newsroom bed.

## 6. Voice and render

Queue the render with `POST /api/v1/dataspheres/:uri/presentations/:pageId/render`. **Do not call `narrated-video` here.**
It would re-run the picture pass on chart and text slides, and it can write a new script. The platform voices the turns;
the local render worker (GPU) records and encodes the video. Watch the job with `GET .../render/:jobId`. Send the owner the
watch link and wait for the video approval before starting the kit.


## 6b. Publish to the public base (when the render happened elsewhere)

A deck rendered on dev or locally lives on that instance; the kit's links must open on the public base, and so must every
file the pages show. Carry them over with the publish script, which downloads each media file from the source, uploads it to
the target datasphere's library, confirms the copy opens, rewrites the pages, creates them on the target under the same slugs,
and confirms each opens publicly, stopping at the first failure:

```bash
SOURCE_BASE=https://dev.dataspheres.ai SOURCE_API_KEY=<dev key> DATASPHERES_BASE_URL=https://dataspheres.ai DATASPHERES_API_KEY=<public key> node skills/content-governance/publish.mjs <uri> <deck-slug> <deck-slug>-watch <deck-slug>-episode
```

Rehearse first with `--dry-run` (lists what would move) or `--slug-suffix -rehearsal` (publishes under rehearsal slugs).
Only after the deck, watch and episode pages open on the public base does the kit build (section 7); the narrative page is
published the same way afterwards.

## 7. Finish the media kit (after the video approval)

When the owner approves the video, ask one question: **"Finish the media kit?"** Do nothing until they say yes. Then:

1. **Write the carousel caption and hashtags in the IDE**, then **build the kit on the platform** from the approved render:
   `POST /api/v1/dataspheres/:uri/presentations/:pageId/distribution-kit` with body `{ "caption": { "text": "...", "hashtags": ["..."] } }`
   (the kit uses your caption after the ban check and writes none itself; a body of `{}` would make the platform write it). Poll
   `GET .../distribution-kit` until `job.status` is `SUCCEEDED`; refuse to go on while `kit.status` is not `ready`.
   The kit holds the 16:9 video, the 9:16 cut, the vertical highlight, the raw audio (WAV + MP3 + voice stem), captions, the
   script text, the carousel, the per-platform titles, descriptions and tags, and the thumbnail. It never buys voice.
2. **Fetch the shared download/copy panel**: `GET .../distribution-kit/block` returns `{ html }`, the platform's own
   `aside[data-type="distribution-kit"]`. Embed it verbatim; never rebuild its format.
3. **Write the narrative page** (`kit-page.ts <pageId>` in IDE mode): a BLOG_POST in the same datasphere, slug
   `<deck-slug>-kit`. The section order is the served template (GOV-041 `params.sections`), today:
   - the title and a one-paragraph lede (what the edition covers, in the hosts' words);
   - the full video as a preview: its thumbnail with a play button, the video loads only on click;
   - the stories, one short section each (the lead line, why it matters, the sources);
   - the audio episode, playable;
   - the download/copy panel (step 2): every raw asset, every title and description, ready to download or copy - this is
     the page's main job;
   - the course call to action, last.
   Every video on the page renders the same way: thumbnail, play button, load on click. Every image renders. Nothing links
   to dev or localhost.
4. **Check it before anyone sees it** (GOV-041, the template rule; `GET /api/v1/content-governance?stage=kit` serves its
   `params.sections`, the headings in order): `node skills/content-governance/check.mjs kit-page <uri> <slug> <deckPageId>`.
   It fails on a missing or misordered section, a video without a poster, a panel that is not the built kit's, or a dev link.
   Fix and run again; never send a page that fails.
5. **Send the owner the narrative link** and wait for the kit approval. Publish only after it.

### Re-renders without a new script cost $0

A finished job stores its voice stem and manifest. Queue the next render with `params.reuseVoice: true` and that job's
`outputs` (IDE helper `requeue-voice.ts <jobId>`): the worker replays the stored take, no voice is bought, and the owner hears
the take they already approved. To tighten the gaps between lines on a stored take, `respace.ts <jobId>` cuts every turn
from the stem and lays it back with the conversational gaps above, then `requeue-respaced.ts <jobId>` renders over it.
