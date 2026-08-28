# Plan: tutorial videos as code

> **The question:** can a tutorial video be a **manifest** rather than a recording — so that when
> Studio's UI moves, the video is re-rendered by a script instead of re-recorded by a human?

**Glossary:** [CONTEXT.md](../../CONTEXT.md). Decisions:
[ADR-0002: No video artifact is committed](../../doc/adr/0002-no-video-artifact-is-committed.md),
[ADR-0003: Narration-first pacing](../../doc/adr/0003-narration-first-pacing.md).

**Status:** planned. Nothing in `scripts/videos/` is written yet. Branch
`feat/tutorial-video-pipeline`, cut from `origin/main`.

## Why build it: the pipeline is a test suite

This is the property that makes tutorials-as-code worth the build, and it needs no new code. The
step executor in `screenshots/lib/shot.ts` **already** throws on an unknown command id, on any
`toggle*` id, and when a command's own `enablement` refuses; `expect` already fails a shot when a
named region resolves to nothing. Inherited wholesale, a renamed command or a removed panel **fails
the render**, naming the id.

So the pipeline reports "this tutorial is now wrong" as a build failure, rather than as a viewer's
confusion six months later. Two layers, matching the screenshot lanes:

- **The contract gate** — no browser, seconds, red in the pull request that did the renaming. This
  is where the alert should almost always come from.
- **The render itself** — slower, needs Chrome, catches what static checking cannot: a flow that
  still names valid ids but no longer _works_.

## The shape: a walkthrough is a shot with a clock

The manifest grammar is the shot contract's five verbs plus one. A **walkthrough** is a boot
(`open`) and an ordered list of **cues**; a cue is one line of narration plus the steps performed
while it is spoken, and its length is the length of that narration. The nouns are the glossary's —
`take` and `scene` were rejected there, with reasons.

```jsonc
{
  "contract": 1,
  "outDir": ".cache/videos",
  "defaults": {
    "viewport": { "width": 1920, "height": 1080 },
    "deviceScaleFactor": 1, // 1, not 2: 1080p output, and 2 quadruples every frame's encode cost
    "fps": 30,
    "theme": "dark",
    "voice": "narrator-a",
  },
  "walkthroughs": [
    {
      "name": "first-collection",
      "docs": ["start/first-collection"], // the source, not a tag — see Authoring, below
      "open": {
        "project": "scripts/videos/fixtures/first-collection",
        "file": "pages/index.md",
        "view": "design",
      },
      "cues": [
        {
          "say": "Every Jx project starts with a collection — a shape your content has to fit.",
          "steps": [{ "cmd": "view.showPanel", "args": { "panel": "library" } }],
        },
        {
          "say": "Add a field, and every document in the collection gains it.",
          "steps": [{ "input": "type", "text": "Title", "region": "inspector/field:name" }],
        },
      ],
      "expect": [{ "region": "navigator/panel:library" }],
    },
  ],
}
```

**The grammar starts smaller than it will end.** There is no per-cue `hold` and no per-step
`expect`: narration length already sets the clock, and a walkthrough-level `expect` already fails
the render. Each is a knob to add when the over-run report (below) demands it — never before. That
is the shot contract's own discipline: every verb is a committed budget.

Rules R1 and R2 from [the shot contract](../screenshots/README.md) carry over **unchanged**, and one
is added:

> **R3. Narration is prose in the manifest, never generated at render time.** The words a video
> says are reviewed by a human in a diff. Only the _voice_ is synthesized.

R3 is what keeps the video reviewable: a render is a pure function of (manifest, working tree, TTS
voice), and the only unreviewed bytes are the waveform.

## Authoring: the docs page is the source

`docs:` is not metadata. A walkthrough is a **compilation of a documentation page** — the same
relation the generated docs pages and the committed schemas already have to their generators in this
repository, and the same review contract: a generator produces the bytes, and you review the
meaning.

An agent drafts the manifest by reading the page and **driving Studio while it does** — so the cues
it emits describe UI states it actually observed, not states it inferred from prose:

```
bun run walkthroughs:draft start/first-collection    # emits a manifest diff; never renders to main
```

Three constraints make that safe, and none of them is new machinery:

- **It may only emit ids the registry declares.** The contract gate's readers run over the draft
  before a human sees it, so a hallucinated command or region fails as a diff that will not pass CI,
  not as a confusing video.
- **One cue per documented step, under a word cap.** Keeps the over-run report meaningful and keeps
  a walkthrough a micro-tutorial (below).
- **It must render once and attach the over-run report.** The reviewer reads prose and watches a
  video; nobody reviews JSON.

This is the answer to "can the AI write the narration": **at authoring time, yes — that is the
point.** At render time, never; R3 forbids it, and so does the audio cache, which is keyed on
`hash(text + voiceId)` and would never hit against text that differs every run.

## One walkthrough, one flow

Walkthroughs are **micro-tutorials**: a single feature flow each, not an all-in-one tour. Two
independent reasons, and they agree:

- **Timing.** Narration-first pacing resolves per cue, but a long walkthrough accumulates cue-level
  over-runs into a drift that is tedious to diagnose. Short ones fail loudly and near the line that
  caused it.
- **Staleness.** A walkthrough is invalidated by any UI change it touches. A twelve-minute one
  touches everything, so it is permanently stale; a ninety-second one is invalidated only by changes
  to its own flow — and because `docs:` is its source, `bun run docs:sync` can already say which
  pages go stale with it.

## What already exists, and is not being rebuilt

`scripts/screenshots/` is two thirds of stage 1. The video runner **imports** it rather than forking
it — each of these took an incident to get right, and a second copy would drift:

| Module           | What the video runner gets from it                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `lib/browser.ts` | `findChromium()`, `DETERMINISM_ARGS`, `DETERMINISM_ENV`, `launchBrowser()`, `newShotContext()`              |
| `lib/server.ts`  | `ensureDevServer()` (spawns its own, so the bundle is the working tree's), `overlayProject()` copy-on-write |
| `lib/shot.ts`    | the step executor: `cmd` / `seed` / `input`, region resolution, `probe.idle()`, `expect`                    |
| `lib/types.ts`   | manifest validation, and the deleted-not-deprecated discipline for retired verbs                            |

**The overlay is load-bearing here too.** A tutorial video types into a project for a minute or
more, which is strictly worse than a shot pressing Enter once. Nothing a walkthrough does may reach
`packages/starters/**`.

## Stages

Three modules, one per stage. Driving and capturing share a loop and a clock — the capture is paced
_by_ the cue — so they are one module, not two.

```
manifest.json ──► voice.ts        ──► cue .wav + length  ─┐
              └─► walkthrough.ts  ──► frames/NNNN.png      ├─► assemble.ts ──► flow.mp4
                  (imports screenshots/lib)               ─┘   (ffmpeg)
```

### `lib/voice.ts` — TTS behind one interface

```ts
export interface Voice {
  speak(text: string, voiceId: string): Promise<{ path: string; seconds: number }>;
}
```

Two drivers ship. A hosted one (`OPENAI_API_KEY` / `ELEVENLABS_API_KEY`), and a **keyless stub**
that emits correctly-timed silence estimated from the word count. The stub is not a mock — it is the
default, and it makes the whole pipeline runnable on a machine with no key, no network and no
account. You get a silent cut with correct pacing; the same manifest produces the real voiceover the
moment a key is present. Audio is cached by `hash(text + voiceId)` under `.cache/`, so re-rendering
after a step change does not re-bill the narration.

Audio is generated **first** and measured with `ffprobe`, and the capture is paced to fill that
length — [ADR-0003](../../doc/adr/0003-narration-first-pacing.md). A cue whose steps run longer than
its line extends the cue and is reported: _acted_ exceeded _spoken_, which is a prompt to write a
longer line.

### `lib/walkthrough.ts` — drive and capture

Boot via the shared seam, then per cue: run the steps, capturing full-viewport frames on a fixed
cadence until the cue's spoken length is covered. Full viewport only; a video has no `capture.of`
region grammar, because a cropped video of a moving app is a video of nothing. Frames are numbered,
so ffmpeg's `image2` demuxer reads them with no concat file.

**A render takes at least real time.** Narration-first pacing makes wall clock the floor: a
ninety-second walkthrough cannot render in less than ninety seconds. See
[Frame capture cost](#open-question-frame-capture-cost) for the ceiling, which is the one number in
this plan that is not yet known.

### `lib/assemble.ts` — ffmpeg

Frames → h264 at `fps`; cue wavs concatenated; the two muxed, and the cursor sprite composited (see
below). One `ffmpeg` invocation per stage, each logged in full, because an ffmpeg failure that is
not reproducible from the log is undebuggable.

## The cursor: composited at assemble time

Chromium's screenshot does not include the pointer — the same omission Playwright has, and for the
same reason: the cursor is drawn by the compositor, not the page. A tutorial that shows clicks
landing with nothing visibly clicking is confusing, so the runner draws one.

**It is drawn by the runner, never by `src/`** — that is R2. The runner logs `(t, x, y)` per pointer
move and composites a sprite in `assemble.ts`, interpolating between logged points. `regionPoint()`
in `shot.ts` already returns the exact top-document coordinate of every gesture, so the log is a
by-product of driving rather than new machinery.

The alternative — injecting a fixed-position element via `evaluateOnNewDocument` — is simpler to
write and rejected anyway: it is _in the page_, so it can be caught by a `probe.idle()` mutation
observer or by an `expect`. A capture that never touches the page cannot perturb the thing it is
capturing.

## What is committed

The manifest and the narration. No `.mp4`, no `.wav`, no frame —
[ADR-0002](../../doc/adr/0002-no-video-artifact-is-committed.md), whose consequence is that **CI can
only tell you the manifest is wrong, never the video.** That is what makes the contract gate
load-bearing rather than convenient.

## Open question: frame capture cost

This is the only unresolved decision, and it wants a measurement rather than an argument.

`page.screenshot()` on a 30 fps interval at 1920×1080 is ~2,700 round-trips for a ninety-second
walkthrough. If a screenshot costs more than 33 ms, the loop silently captures fewer frames than it
asked for and the video runs slow against audio that was measured exactly. Three answers, in
increasing order of what they cost elsewhere:

1. **Capture at 10–15 fps, output at 30.** UI motion is mostly discrete; ffmpeg holding frames looks
   fine, and this halves the cost with no new dependency and no decision reversed. **Try first.**
2. **Time-stamp every frame and let ffmpeg place them on the true clock**, instead of assuming the
   cadence held. Robust to a slow screenshot rather than fast; combines with (1).
3. **`Page.startScreencast`.** Purpose-built for this and much cheaper — but it is **CDP**, and
   `screenshots/README.md` deliberately drives BiDi, because it is the W3C's protocol and everything
   the pipeline asks of a browser is in it. `JX_SHOTS_PROTOCOL=cdp` exists as a regression escape
   hatch, so the path is there; taking it for video would make this the one lane that is
   standards-off by design. Worth it only if (1) and (2) measurably fail.

Phase 1 is where this gets a number. Do not decide it in advance.

## Phases

### Phase 0 — extract the shared seam (~½ day)

`screenshots/lib/shot.ts` is 1,039 lines and currently ends in "photograph regions". The step
executor, region resolution and `expect` evaluation must be importable **without** the capture tail.
Refactor in place, no behaviour change; `bun run screenshots --force` must reproduce
`capture.lock.json` byte-for-byte, which is the acceptance test.

### Phase 1 — one walkthrough, silent (~1 day)

`manifest.json` with a single walkthrough, `walkthrough.ts`, `assemble.ts`, the stub voice.
Deliverable: an mp4 that shows Studio doing something, with no sound — and a measured answer to
[frame capture cost](#open-question-frame-capture-cost).

Retarget an **existing screenshot fixture** rather than authoring a new project, so the first
walkthrough proves the pipeline and not the fixture.

CI classification lands in the same pull request, because `scripts/videos/**` is currently
unclassified in `scripts/ci/affected.ts` and unknown paths **fail open** — so until this edit, a
comment fix in the video runner costs a full workspace matrix run. Either add `scripts/videos/**` to
the `EXTRA_EDGES` entry that already seeds `packages/studio` for `scripts/screenshots/**`, with the
test file that proves the edge, or classify it `NO_TESTS` if no studio test reads it. Per
`scripts/README.md`, tests live under `scripts/`, run by `bun test --isolate scripts`, with every
unit behind `if (import.meta.main)`.

### Phase 2 — voice (~½ day)

`voice.ts`, both drivers, the cache, narration-first pacing, the over-run report.

### Phase 3 — the gate (~½ day)

**Teach `check-shot-contract.ts` about `walkthroughs[]`.** It was going to be a second script; it is
the same registry readers over the same command ids and region ids in the same app, so a second
script is a second definition of "a valid id" waiting to drift. One gate, two manifests — and one
CI entry, one README row.

### Phase 4 — authoring from docs (~1 day)

`walkthroughs:draft`, per [Authoring](#authoring-the-docs-page-is-the-source). It comes after the
gate on purpose: the gate is what makes an agent-authored manifest reviewable, so building the
drafter first would be building a proposal nobody can check.

### Phase 5 — specs & docs

Per CLAUDE.md, a behaviour-changing change lands code, spec edits and docs together. This adds no
product behaviour — it is tooling, like the screenshot pipeline, whose normative home is
`scripts/screenshots/README.md` rather than a spec section. So: a `scripts/videos/README.md` carrying
the walkthrough contract, a row in `scripts/README.md`'s directory table, and **no `spec:bump`**.
Confirm against `bun run docs:sync` before committing.

## Deferred

**Chapters.** Once walkthroughs exist, a chaptered video is `assemble.ts` concatenating several of
their outputs plus a title card and an ffmpeg chapter-marker metadata file. It composes finished
walkthroughs and adds no capability, so building it before a single one renders correctly would be
building the roof first.

---

<sup>The architecture is the generic "programmatic video generator" — drive the browser, generate an
AI voiceover, compile the two — with each dependency substituted for one this repository already
has: Bun + TypeScript for Python (a venv is a second toolchain `bun.nix` cannot see),
`puppeteer-core` over WebDriver BiDi for Playwright (system Chrome, no download, works on NixOS —
already solved in `screenshots/lib/browser.ts`), and `ffmpeg` directly for MoviePy (already on PATH
and in the flake; MoviePy is a Python wrapper over the same binary). Only the premise of the source
tutorial was provided, not its numbered steps; if the original names a particular TTS model or
ffmpeg filter graph, check it against this plan before Phase 1.</sup>
