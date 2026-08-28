# Plan: tutorial videos as code

> **The question:** can a tutorial video be a **manifest** rather than a recording — so that when
> Studio's UI moves, the video is re-rendered by a script instead of re-recorded by a human?

**Status:** planned. Nothing in `scripts/videos/` is written yet. Branch
`feat/tutorial-video-pipeline`, cut from `origin/main`.

This follows the "programmatic video generator" architecture — drive the browser, generate an AI
voiceover, compile the two into a finished video — mapped onto the toolchain this repository
already has. The mapping is not cosmetic; each substitution removes a whole dependency:

| The generic tutorial          | Here                                 | Why                                                                                             |
| ----------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Python                        | Bun + TypeScript                     | `scripts/` is entirely Bun TS. A venv is a second toolchain `bun.nix` cannot see.               |
| Playwright                    | `puppeteer-core` over WebDriver BiDi | Already solved in `screenshots/lib/browser.ts`: **system** Chrome, no download, works on NixOS. |
| MoviePy                       | `ffmpeg` directly                    | Already on PATH and in the flake. MoviePy is a Python wrapper over the same binary.             |
| `page.screenshot()` in a loop | the same, but paced by the audio     | See [Timing](#timing-narration-first-not-video-first).                                          |

## What already exists, and is not being rebuilt

`scripts/screenshots/` is two thirds of stage 1 of this pipeline. The video runner **imports** it
rather than forking it — each of these took an incident to get right, and a second copy would drift:

| Module           | What the video runner gets from it                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `lib/browser.ts` | `findChromium()`, `DETERMINISM_ARGS`, `DETERMINISM_ENV`, `launchBrowser()`, `newShotContext()`              |
| `lib/server.ts`  | `ensureDevServer()` (spawns its own, so the bundle is the working tree's), `overlayProject()` copy-on-write |
| `lib/shot.ts`    | the step executor: `cmd` / `seed` / `input`, region resolution, `probe.idle()`, `expect`                    |
| `lib/types.ts`   | manifest validation, and the deleted-not-deprecated discipline for retired verbs                            |

**The overlay is load-bearing here too.** A tutorial video types into a project for a minute or
more, which is strictly worse than a shot pressing Enter once. Nothing a take does may reach
`packages/starters/**`.

## The shape: a take is a shot with a script

The manifest grammar is the shot contract's five verbs plus one. A **take** is a boot (`open`) and
an ordered list of **scenes**; a scene is one line of narration plus the steps performed while it
is spoken.

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
  "takes": [
    {
      "name": "first-collection",
      "docs": ["start/first-collection"],
      "open": {
        "project": "scripts/videos/fixtures/first-collection",
        "file": "pages/index.md",
        "view": "design",
      },
      "scenes": [
        {
          "say": "Every Jx project starts with a collection — a shape your content has to fit.",
          "steps": [{ "cmd": "view.showPanel", "args": { "panel": "library" } }],
          "hold": 0.5,
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

Rules R1 and R2 from [the shot contract](../screenshots/README.md) carry over **unchanged**, and
one is added:

> **R3. Narration is prose in the manifest, never generated at render time.** The words a video
> says are reviewed by a human in a diff. An LLM may draft them into the manifest in a pull request;
> nothing calls a text model during a render. Only the _voice_ is synthesized.

R3 is what keeps the video reviewable. A render is then a pure function of (manifest, working
tree, TTS voice), and the only unreviewed bytes are the waveform.

## Timing: narration first, not video first

The naive order — record the browser, then narrate over it — needs the narration to fit a duration
that was fixed before the words existed. Inverting it removes the whole problem:

1. Synthesize each scene's `say` to a `.wav`.
2. `ffprobe` it for an exact duration.
3. Drive that scene's steps, capturing frames until the scene's audio duration is covered; `hold`
   adds a deliberate pause after the steps settle.
4. A scene whose steps take **longer** than its narration extends the scene and is reported — the
   video is still correct, and the report is the prompt to write a longer line.

Frames are captured on a fixed wall-clock cadence during the scene, so real interaction motion
(a menu opening, a caret moving) is preserved. This is the one place the pipeline is deliberately
**not** deterministic, which is why nothing it produces is committed — see below.

## Stages

```
manifest.json ──► voice.ts   ──► scene .wav + duration   ─┐
              └─► scene.ts   ──► frames/NNNN.png          ├─► assemble.ts ──► take.mp4
                  (imports screenshots/lib)               ─┘   (ffmpeg)
```

### `lib/voice.ts` — TTS behind one interface

```ts
export interface Voice {
  speak(text: string, voiceId: string): Promise<{ path: string; seconds: number }>;
}
```

Two drivers ship. A hosted one (`OPENAI_API_KEY` / `ELEVENLABS_API_KEY`), and a **keyless stub**
that emits correctly-timed silence estimated from the word count. The stub is not a mock — it is
the default, and it makes the whole pipeline runnable on a machine with no key, no network and no
account. You get a silent cut with correct pacing; the same manifest produces the real voiceover the
moment a key is present. Synthesized audio is cached by `hash(text + voiceId)` under `.cache/`, so
re-rendering after a step change does not re-bill the narration.

### `lib/frames.ts` — capture

`page.screenshot()` on an interval, into `.cache/videos/<take>/frames/`. Full viewport only; a
video has no `capture.of` region grammar, because a cropped video of a moving app is a video of
nothing. Frame files are numbered, so ffmpeg's `image2` demuxer reads them directly with no
concat file.

### `lib/assemble.ts` — ffmpeg

Frames → h264 at `fps`; scene wavs concatenated; the two muxed. One `ffmpeg` invocation per stage,
each logged in full, because an ffmpeg failure that is not reproducible from the log is
undebuggable.

## What is committed, and what is not

**The manifest and the narration are committed. No `.mp4`, no `.wav`, no frame is.** `docs/images/`
is locked by `check-image-lock.ts` because a PNG capture is byte-stable by construction; a video of
real interaction motion never will be, so a video lock would churn megabytes on every render and
assert nothing. Output goes to `.cache/videos/`, which is already gitignored. Publishing a finished
video is a human step, out of band.

The consequence to accept: **CI cannot tell you the video is wrong.** It can only tell you the
manifest is — which is exactly what the Lane 1 / Lane 2 split already says about screenshots, and
the reason `check-shot-contract.ts` exists.

## The cursor

Chromium's screenshot does not include the pointer — the same omission Playwright has, and for the
same reason: the cursor is drawn by the compositor, not the page. A tutorial that shows clicks
landing with nothing visibly clicking is confusing, so the runner draws one.

**It is drawn by the runner, never by `src/`.** That is R2: nothing may exist in the application
solely to be filmed. Two implementations qualify, and both are honest under that rule:

|                    | How                                                                                                                                  | Cost                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **DOM overlay**    | The runner injects a fixed-position element via `evaluateOnNewDocument`, moved to each coordinate the step executor already computes | Simple; but it is in the page, so it can be caught by a `probe.idle()` mutation observer or an `expect` |
| **ffmpeg overlay** | Frames stay clean; the runner logs `(t, x, y)` per pointer move and composites a cursor sprite at assemble time                      | Nothing enters the page at all; costs a filter graph, and per-frame interpolation between logged points |

Preferred: **ffmpeg**. `regionPoint()` in `shot.ts` already returns the exact top-document
coordinate of every gesture, so the log is a by-product of driving, not new machinery — and a
capture that never touches the page cannot perturb the thing it is capturing.

## One take, one flow

Takes are **micro-tutorials**: a single feature flow each, not an all-in-one tour. Two independent
reasons, and they agree:

- **Timing.** Narration-first pacing (above) resolves per scene, but a long take accumulates
  scene-level over-runs into a drift that is tedious to diagnose. Short takes fail loudly and near
  the line that caused it.
- **Staleness.** A take is invalidated by any UI change it touches. A twelve-minute take touches
  everything, so it is permanently stale; a ninety-second take is invalidated only by changes to
  its own flow, and the `docs:` field says exactly which pages go stale with it.

Chapters are therefore a **compose step over several takes**, not a longer take — see
[Chapters](#chapters-later-not-phase-1).

## The pipeline is a test suite

This is the property that makes tutorials-as-code worth the build, and it needs no new code: the
step executor **already** throws on an unknown command id, on any `toggle*` id, and when a
command's own `enablement` refuses. `expect` already fails a shot when a named region resolves to
nothing. Inherited wholesale, that means a renamed command or a removed panel **fails the render**,
naming the id — the video pipeline reports "this tutorial is now wrong" as a build failure rather
than as a viewer's confusion six months later.

Two layers, matching the screenshot lanes:

- **Phase 3's `check-take-contract.ts`** — no browser, seconds, red in the pull request that did
  the renaming. This is where the alert should almost always come from.
- **The render itself** — slower, needs Chrome, catches what static checking cannot: a flow that
  still names valid ids but no longer _works_.

## Chapters (later, not Phase 1)

Once takes exist, a chaptered video is `assemble.ts` concatenating several takes' outputs plus a
title card per chapter and an ffmpeg chapter-marker metadata file. It is deliberately **not** in
Phase 1: it composes finished takes and adds no capability, so building it before a single take
renders correctly would be building the roof first.

## Phases

### Phase 0 — extract the shared seam (~½ day)

`screenshots/lib/shot.ts` is 997 lines and currently ends in "photograph regions". The step
executor, region resolution and `expect` evaluation must be importable **without** the capture
tail. Refactor in place, no behaviour change; `bun run screenshots --force` must reproduce
`capture.lock.json` byte-for-byte, which is the acceptance test.

### Phase 1 — one take, silent (~1 day)

`manifest.json` with a single take over an existing screenshot fixture, `frames.ts`,
`assemble.ts`, the stub voice. Deliverable: an mp4 that shows Studio doing something, with no
sound.

### Phase 2 — voice (~½ day)

`voice.ts`, both drivers, the cache, narration-first pacing, the over-run report.

### Phase 3 — the gate (~½ day)

`scripts/check-take-contract.ts`: the video analogue of `check-shot-contract.ts`. No browser,
seconds, red in the pull request that renames a command a take names. It reuses the shot
contract's registry readers directly — same command ids, same region ids, same app.

### Phase 4 — CI classification (~¼ day)

`scripts/videos/**` is currently **unclassified** in `scripts/ci/affected.ts`, and unknown paths
**fail open** — so today a comment fix in the video runner would cost a full workspace matrix run.
Two edits, in the same pull request as Phase 1:

- Add `scripts/videos/**` to the `EXTRA_EDGES` entry that already seeds `packages/studio` for
  `scripts/screenshots/**`, with the test file that proves the edge, **or** classify it `NO_TESTS`
  if no studio test reads it.
- Per `scripts/README.md`: tests live under `scripts/`, run by `bun test --isolate scripts`, and
  every unit sits behind `if (import.meta.main)` so the gate is testable.

### Phase 5 — specs & docs

Per CLAUDE.md, a behaviour-changing change lands code, spec edits and docs together. This one adds
no product behaviour — it is tooling, like the screenshot pipeline, whose normative home is
`scripts/screenshots/README.md` rather than a spec section. So: a `scripts/videos/README.md`
carrying the take contract, a row in `scripts/README.md`'s directory table, and **no `spec:bump`**.
Confirm against `bun run docs:sync` before committing.

## Open questions

- **Cursor overlay: which of the two.** Decided in principle (see [The cursor](#the-cursor));
  the remaining choice is DOM-injected versus ffmpeg-composited, and it is cheap to defer to
  Phase 1 where both can be looked at.
- **Which video first.** Phase 1 should retarget an existing screenshot fixture rather than
  authoring a new project, so the first take proves the pipeline and not the fixture.
- **The source tutorial.** Only the premise of the tutorial being followed was provided, not its
  numbered steps. The five stages above are reconstructed from that premise; Its pro-tips (cursor
  injection, micro-tutorials, the pipeline as an alerting test suite) are folded in above. If the
  original has further specifics — a particular TTS model, a particular ffmpeg filter graph — they
  should be checked against this plan before Phase 1 starts.
