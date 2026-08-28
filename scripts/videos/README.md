# The walkthrough contract

This is the **normative home of the walkthrough contract** — tooling, like the screenshot pipeline,
so it lives here rather than in a `specs/` section (see `scripts/videos/PLAN.md`, Phase 5: this
adds no product behaviour, so no `spec:bump`).

Walkthroughs live in [manifest.json](./manifest.json). The runner boots the repo dev server,
materialises a writable copy of every project a walkthrough opens, drives Studio in headless
Chromium through `window.__jxAutomation`, synthesizes narration, and renders one mp4 per
walkthrough to the manifest's `outDir` (gitignored — see
[ADR-0002](../../doc/adr/0002-no-video-artifact-is-committed.md)).

```bash
bun run walkthroughs                          # every walkthrough
bun run walkthroughs --only first-collection  # one (comma-separate for several)
OPENAI_API_KEY=… bun run walkthroughs         # real voice instead of the keyless stub
bun run walkthroughs:draft <slug> --steps <draft.json>   # the registry gate for an authored draft
```

## The grammar: the shot contract's five verbs, plus one

A walkthrough is a boot (`open`) and an ordered list of **cues**. `open`, a cue's `steps` (`cmd` |
`seed` | `input`) and the walkthrough's own `expect` are the **same types** `scripts/screenshots/
lib/types.ts` declares for a shot — imported, not re-declared, in `lib/types.ts`. What a walkthrough
adds is the one thing a shot has no use for:

```jsonc
{
  "contract": 1,
  "outDir": ".cache/videos",
  "defaults": {
    "viewport": { "width": 1920, "height": 1080 },
    "deviceScaleFactor": 1, // 1080p output; 2 quadruples every frame's encode cost
    "fps": 30,
    "theme": "dark",
    "voice": "narrator-a",
  },
  "walkthroughs": [
    {
      "name": "first-collection",
      "docs": ["start/first-collection"], // the SOURCE this walkthrough compiles — never a tag
      "open": { "project": "…", "file": "pages/index.md", "view": "preview" },
      "cues": [
        {
          "say": "Every Jx project starts with a collection — a shape your content has to fit.",
          "steps": [{ "cmd": "settings.open", "args": { "section": "content" } }],
        },
      ],
      "expect": [{ "region": "pane.primary" }],
    },
  ],
}
```

A **cue** is one line of narration (`say`) and the steps performed while it is spoken. There is no
per-cue `hold` and no per-step `expect` — narration length sets the clock
([ADR-0003](../../doc/adr/0003-narration-first-pacing.md)), and a walkthrough-level `expect` already
fails the render. Each is a knob to add when the over-run report demands it, never before.

`docs` is **required** and is the source, not a tag: `bun run walkthroughs:draft` reads that page to
draft cues, and `bun run docs:sync` can say which pages go stale with a walkthrough the same way it
already does for a source file.

## The gate

`scripts/check-shot-contract.ts` reads this manifest with the **same reader** it uses for
`scripts/screenshots/manifest.json` — one definition of "a valid id" for both files (see that
file's header, "One gate, two manifests"). A cue naming a command the registry does not declare, a
toggle id, or a malformed region fails here, in seconds, with no browser — the same failure a shot
gets, naming both sides of the break. Its own budget (`WALKTHROUGH_BUDGET`) is tracked separately
from the screenshot manifest's: `bun scripts/check-shot-contract.ts` (no args) checks both files in
one run.

## Rendering: narration first

Per cue: `lib/voice.ts` synthesizes the narration and `ffprobe` measures its true length
**before** the browser is driven ([ADR-0003](../../doc/adr/0003-narration-first-pacing.md)); the
capture is then paced to that measured length. A cue whose steps run longer than its line extends
and is reported (`acted` exceeded `spoken`) — a prompt to write a longer line, never a timing bug.

Two drivers ship behind `Voice` (`lib/voice.ts`): a hosted one, selected by whichever of
`OPENAI_API_KEY` / `ELEVENLABS_API_KEY` is set, and a **keyless stub** that emits correctly-timed
silence estimated from the word count — the default, and what makes the whole pipeline runnable
with no key, no network and no account. Audio is cached under `.cache/videos/audio/`, keyed on
`hash(text + voiceId)`, so re-rendering after a step change does not re-synthesize (or re-bill)
narration that did not change.

### Frame capture cost

`page.screenshot()` against Studio measured ~67ms mean / ~73ms p90 at 1920×1080 — nowhere near a
native 30fps loop's 33ms budget, and too close to a 15fps loop's 66.7ms one. `lib/pacing.ts` (fully
tested, no browser) is the answer: capture at a fixed 12fps and **timestamp every frame**, so
`assemble.ts` places each one on the measured clock instead of assuming the cadence held. See
`scripts/videos/PLAN.md`'s "Open question: frame capture cost" for the full measurement and the
options it ruled out.

### The cursor

Composited at assemble time, never drawn by `src/` — Chromium's own screenshot has no pointer, and
injecting one into the page would let it be caught by `probe.idle()` or an `expect` (a capture that
touches the page can perturb the thing it is capturing). `lib/cursor.ts` builds the ffmpeg overlay
expression from the logged `(t, x, y)` pointer moves; `lib/assemble.ts` composites it in the same
invocation that muxes narration onto the rendered frames.

## Authoring from docs

`bun run walkthroughs:draft <slug> --steps <draft.json>` is the registry gate for a hand- or
agent-authored draft (`draft.ts`) — never the generator itself. Per the plan: an agent reads the
docs page and drives Studio while drafting, so its cues describe UI states it actually observed;
this script only enforces the three constraints that make a draft safe to review:

1. every id the draft names must be one the registry declares (the same check the committed
   manifest is held to);
2. one cue per documented step, under a 40-word cap;
3. a draft that passes folds into `manifest.json` and renders for real
   (`bun run walkthroughs --only <name>`) before it goes in a diff — a reviewer reads prose and
   watches a video; nobody reviews JSON.

## What this imports, and does not fork

`lib/voice.ts`, `lib/pacing.ts`, `lib/cursor.ts`, `lib/walkthrough.ts` and `lib/assemble.ts` are new;
everything else is imported from `scripts/screenshots/lib/`: `browser.ts` (`launchBrowser`,
determinism flags), `server.ts` (`ensureDevServer`, the copy-on-write project overlay — a
walkthrough types into a project for a minute or more, which is strictly worse than a shot pressing
Enter once, so nothing here may ever reach a committed starter), and `drive.ts` (the step executor,
region resolution, `probe.idle()`, `expect` — split out of `shot.ts` in Phase 0 for exactly this).
