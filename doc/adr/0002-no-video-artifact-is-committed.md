# No video artifact is committed

`docs/images/` is committed and locked by `check-image-lock.ts` because a still capture is
byte-stable by construction — the determinism flags in `screenshots/lib/browser.ts` exist to make it
so. A walkthrough films real interaction motion paced by synthesized audio, which never will be, so
we render walkthroughs to the gitignored `.cache/videos/` and commit only the manifest and the
narration. Publishing a finished video is a human step, out of band.

## Considered Options

A video lock mirroring `capture.lock.json` was rejected: it would churn megabytes on every render
while asserting nothing, since frame timing cannot hash the same twice. Git LFS was rejected because
it adds a clone-and-CI dependency the repository does not otherwise have.

## Consequences

**CI cannot tell you a video is wrong — only that its manifest is.** That is the same split the
screenshot pipeline already lives with, and the reason `check-shot-contract.ts` exists. The
walkthrough contract gate is therefore not optional convenience; it is the only automated check that
survives this decision.
