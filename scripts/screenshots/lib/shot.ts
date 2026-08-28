/**
 * One shot, executed against the contract (UX-REDESIGN-PLAN §13.2–§13.4).
 *
 * Boot the app into a stated world, drive it through named capabilities, assert, photograph region
 * ids. Nothing in this file names a CSS selector, and nothing in it sleeps.
 *
 * Boot, freeze, quiescence, region resolution, driving and asserting live in `./drive` — the half
 * of the contract that has nothing to do with photographing a PNG, and that
 * `scripts/videos/PLAN.md` (Phase 0) needs importable without this file's
 * visual-diff-against-a-committed-image tail. This file re-exports the pieces `run.ts` and its
 * tests already address as `./shot`, and keeps the capture tail: deciding whether a re-render is
 * worth writing, and the top-level shot orchestrator.
 */

import { basename, join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { Page } from "puppeteer-core";
import {
  applyOpenState,
  armFreeze,
  assertExpectations,
  assertNoUninvitedModal,
  bootUrl,
  measureRegion,
  resetPointerAndFocus,
  restoreScrollState,
  runStep,
  saveScrollState,
  settle,
  trackRequests,
} from "./drive";
import type { Rect, RequestTracker } from "./drive";
import { VIEWPORT_TARGET } from "./types";
import type { Capture, ResolvedShot, ThenSegment } from "./types";

export {
  applyOpenState,
  armFreeze,
  assertExpectations,
  assertNoUninvitedModal,
  bootUrl,
  DOCK_COMMAND,
  frameBlockers,
  matchState,
  measureRegion,
  OPEN_COMMANDS,
  regionPoint,
  resetPointerAndFocus,
  runStep,
  trackRequests,
} from "./drive";
export type { AutomationHook, CanvasPoint, Rect, RequestTracker } from "./drive";

/**
 * A re-render that's visually indistinguishable from the committed PNG keeps the old bytes, so the
 * checked-in screenshots don't churn in git on every run. Per §13.4 this is for REVIEW PRESENTATION
 * and is no longer load-bearing for identity — the capture lock's `sha256` is.
 *
 * Sized against MEASUREMENT, not intuition — and RE-sized against a second one, because the first
 * measured the wrong thing. That sample was 21 rewrites across 24 `chore(screenshots)` commits, and
 * it was taken while the lane still passed `--force`: `writeIfChanged` never ran, so it recorded
 * Chromium's encoder rather than anything this constant decides. `--force` left the lane in
 * 7ce93986. The ten days after it are the first honest sample — 51 commits, 181 rewrites, every
 * delta recomputed from the committed blobs with `changedPixelRatio` at `CHANNEL_TOLERANCE`:
 *
 * | Δ              | rewrites | the shots that dominate it                |
 * | -------------- | -------- | ----------------------------------------- |
 * | ≤ 0.02 %       | 29       | the rail's git badge: mode-*, state-panel |
 * | (0.02, 0.05 %] | 29       | `media-upload`'s drop-zone indicator ×19  |
 * | (0.05, 0.10 %] | 25       | a `data-grid` cell's range outline ×13    |
 * | (0.10, 0.25 %] | 43       | `blog-grid`'s collection row order ×12    |
 * | (0.25, 1 %]    | 11       | mixed                                     |
 * | (1, 5 %]       | 16       | single-occurrence, every one of them      |
 * | > 5 %          | 28       | unambiguously real                        |
 *
 * The four bands were fixed WHERE THEY ARE CAUSED rather than absorbed here — between them
 * `mode-manage`, `media-upload`, `data-grid` and `blog-grid` were 74 of the 181 rewrites. Each was
 * diagnosed from the committed blobs, by taking the changed-pixel bounding box of every historical
 * rewrite: body copy re-rendering while every heading stayed byte-identical (a webfont race, see
 * `frameBlockers` in `./drive`), a cell outline present in one capture and absent in the next (the
 * grid called itself settled on the range MODEL, `grid/grid-view.ts`), and rows swapping places (an
 * unsorted directory listing, `byPathOrder` in `server/src/studio-api.ts`). None of that is
 * something a threshold could have separated from a real edit: their deltas are stable and small,
 * so a value that hid them would hide everything they are indistinguishable from.
 *
 * 0.01 is where the distribution stops looking like noise, and the two signatures are what separate
 * them. Noise REPEATS at a stable small value — `mode-manage` 22 times at a median 0.075 %,
 * `media-upload` 21 times at 0.038 %. A real edit happens ONCE and is large — `elements-panel` at
 * 68 %, `new-project-modal` at 46 %. All sixteen rewrites between 1 % and 5 % carry the second
 * signature, which is why this stops at 1 % instead of the 5 % that would suppress them too.
 *
 * This DOES give up the ~0.1 % status-bar regression 0.0002 was sized to catch, and that is the
 * trade, made deliberately: at 0.0002 the gate reported that regression alongside 152 other
 * rewrites in ten days, so nobody read it, and `docs/images` grew to 90 % of the repository's pack
 * — 567 of 634 MiB, 1,401 blob versions of 64 files. A gate nobody reads catches nothing either.
 */
const DIFF_THRESHOLD = 0.01;

/**
 * How far one channel may move before a pixel counts as different.
 *
 * The predecessor compared 32x32 THUMBNAILS of both images and averaged the absolute channel
 * difference. At that size a 3840x2400 capture's entire status bar is a fraction of one pixel row,
 * so the metric could not see text at all: the rail losing two buttons and the status bar being
 * rewritten together scored 0.07 %, the stale bytes were kept, and the lock then certified a
 * picture of an app that no longer existed as current. A screenshot pipeline that reports
 * "unchanged" for a changed app is worse than no pipeline, because it converts a stale picture into
 * an attested one.
 *
 * The metric is now a COUNT of pixels that moved more than this tolerance, at native resolution.
 * Anti-aliasing and font-hinting jitter move edge pixels a little and few of them; a control that
 * appeared, moved or changed its words moves many pixels a lot. `DIFF_THRESHOLD` is the fraction of
 * the frame that may do so and still count as noise.
 *
 * This tolerance is the half of the pair that did NOT move: 16 is wide enough that anti-aliasing
 * and font-hinting jitter never register, and narrow enough that a redrawn control always does.
 * `DIFF_THRESHOLD` went from 0.0002 to 0.01 instead — and the argument that used to close this
 * paragraph is the thing measurement overturned. It read: "churn is the cheaper failure — a
 * re-captured image that did not need re-capturing costs a diff, and a kept image that did costs a
 * documentation page that lies." At 0.0002 a diff is not what churn cost. It cost 1,401 blob
 * versions of 64 images, 90 % of this repository's pack, and a report of 181 rewrites in ten days
 * that no reviewer could triage — which is the same blindness by a different route. Both failures
 * are real; the one actually suffered here was the cheap-sounding one.
 */
const CHANNEL_TOLERANCE = 16;

// ─── Capturing ────────────────────────────────────────────────────────────────

export interface ShotContext {
  log: (line: string) => void;
  outDir: string;
  repoRoot: string;
  serverUrl: string;
  studioPath: string;
  /** Overwrite every image regardless of the visual-diff check (for a wholesale re-baseline). */
  force: boolean;
  /**
   * The absolute project root the shot actually opens.
   *
   * Never the repo-relative path the manifest wrote: `lib/server.ts` materialises a copy-on-write
   * overlay, so a shot that types into a starter page cannot reach the committed file. Absent for a
   * shot that opens no project.
   */
  projectRoot?: string;
}

/**
 * Normalized visual difference in [0,1] between two PNG buffers. Both are decoded and downscaled to
 * a 32×32 thumbnail in the (already-running) browser — no native image deps, since Sharp is
 * unavailable on some hosts — and compared as mean per-channel absolute difference.
 */
async function visualDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async (aB64, bB64, tolerance) => {
      const pixels = async (b64: string) => {
        const img = new Image();
        await new Promise<void>((res, rej) => {
          img.addEventListener("load", () => res());
          img.addEventListener("error", () => rej(new Error("decode failed")));
          img.src = `data:image/png;base64,${b64}`;
        });
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const c2d = canvas.getContext("2d", { willReadFrequently: true });
        if (!c2d) {
          throw new Error("no 2d context");
        }
        c2d.drawImage(img, 0, 0);
        return {
          data: c2d.getImageData(0, 0, canvas.width, canvas.height).data,
          height: canvas.height,
          width: canvas.width,
        };
      };
      const [pa, pb] = await Promise.all([pixels(aB64), pixels(bB64)]);
      // A resize is a change, full stop — and comparing two different geometries pixel-by-pixel
      // Would answer nonsense.
      if (pa.width !== pb.width || pa.height !== pb.height) {
        return 1;
      }
      let differing = 0;
      for (let i = 0; i < pa.data.length; i += 4) {
        const dr = Math.abs((pa.data[i] ?? 0) - (pb.data[i] ?? 0));
        const dg = Math.abs((pa.data[i + 1] ?? 0) - (pb.data[i + 1] ?? 0));
        const db = Math.abs((pa.data[i + 2] ?? 0) - (pb.data[i + 2] ?? 0));
        if (Math.max(dr, dg, db) > tolerance) {
          differing += 1;
        }
      }
      return differing / (pa.width * pa.height);
    },
    a.toString("base64"),
    b.toString("base64"),
    CHANNEL_TOLERANCE,
  );
}

/**
 * Write `buffer` to `outPath`, but skip the write when it's visually indistinguishable from the
 * existing PNG (unless `ctx.force`), so committed screenshots don't churn. Logs the outcome.
 */
async function writeIfChanged(
  page: Page,
  outPath: string,
  buffer: Buffer,
  ctx: ShotContext,
  shotName: string,
): Promise<void> {
  const name = basename(outPath);
  if (!ctx.force && existsSync(outPath)) {
    try {
      const diff = await visualDiff(page, buffer, await readFile(outPath));
      const pct = `Δ${(diff * 100).toFixed(2)}%`;
      if (diff <= DIFF_THRESHOLD) {
        ctx.log(`[shot:${shotName}] ${name} unchanged (${pct}) — kept`);
        return;
      }
      await writeFile(outPath, buffer);
      ctx.log(`[shot:${shotName}] ${name} updated (${pct})`);
      return;
    } catch {
      // Any decode/read failure → fall through to an unconditional write.
    }
  }
  await writeFile(outPath, buffer);
  ctx.log(`[shot:${shotName}] ${name} written (${ctx.force ? "forced" : "new"})`);
}

/**
 * One capture: settle, measure, photograph, put the page back.
 *
 * Every capture measures from the SAME page state — save the scroll offsets, scroll to measure,
 * shoot, restore. Otherwise capture N's `scrollIntoView` is capture N+1's starting position.
 */
async function captureImage(
  page: Page,
  capture: Capture,
  shot: ResolvedShot,
  ctx: ShotContext,
  net: RequestTracker,
  at: string,
): Promise<string> {
  const target = capture.of ?? VIEWPORT_TARGET;
  await saveScrollState(page);
  try {
    let clip: Rect | undefined;
    if (target !== VIEWPORT_TARGET) {
      const { found, rect } = await measureRegion(page, target, capture.padding ?? 0, true);
      if (!found) {
        throw new Error(
          `${at}: capture "${capture.image}" names region "${target}", which resolves to nothing`,
        );
      }
      if (!rect) {
        throw new Error(
          `${at}: capture "${capture.image}" names region "${target}", whose box is empty`,
        );
      }
      clip = rect;
    }
    await resetPointerAndFocus(page);
    await settle(page, net, `${at} capture "${capture.image}"`);
    // With a clip puppeteer defaults captureBeyondViewport to TRUE, which resizes the render
    // Surface to the full page — a relayout that natively resets the canvas scroller to 0
    // Mid-capture. Clips here are clamped to the viewport, so capture strictly within it.
    const buffer = Buffer.from(
      await page.screenshot(clip ? { captureBeyondViewport: false, clip } : {}),
    );
    const outPath = join(ctx.outDir, `${capture.image}.png`);
    await writeIfChanged(page, outPath, buffer, ctx, shot.name);
    return outPath;
  } finally {
    await restoreScrollState(page);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

/** One `then` segment, or the shot's own body — they are the same three phases. */
async function runSegment(
  page: Page,
  segment: ThenSegment,
  shot: ResolvedShot,
  ctx: ShotContext,
  net: RequestTracker,
  label: string,
): Promise<string[]> {
  for (const [index, step] of (segment.steps ?? []).entries()) {
    const at = `${label} step ${index + 1}`;
    await runStep(page, step, at);
    await settle(page, net, at);
  }
  await assertExpectations(page, segment.expect ?? [], label);
  const written: string[] = [];
  for (const capture of segment.capture ?? []) {
    written.push(await captureImage(page, capture, shot, ctx, net, label));
  }
  return written;
}

export async function executeShot(
  page: Page,
  shot: ResolvedShot,
  ctx: ShotContext,
): Promise<string[]> {
  const { open } = shot;
  const net = trackRequests(page);
  await page.setViewport({
    deviceScaleFactor: open.deviceScaleFactor,
    height: open.viewport.height,
    width: open.viewport.width,
  });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

  const url = bootUrl(ctx, open);
  ctx.log(`[shot:${shot.name}] ${url}`);

  // Frozen-ness must be a property of every document this page will ever load, including the canvas
  // Iframes a view change rebuilds after this point. Arm before navigating.
  await armFreeze(page);
  await page.goto(url, { timeout: 120_000, waitUntil: "networkidle2" });
  await page.waitForFunction(() => Boolean(window.__jxAutomation), { timeout: 30_000 });

  await settle(page, net, "boot");
  await assertNoUninvitedModal(page, shot.name);
  await applyOpenState(page, open, net);

  const body: ThenSegment = {
    ...(shot.capture ? { capture: shot.capture } : {}),
    ...(shot.expect ? { expect: shot.expect } : {}),
    ...(shot.steps ? { steps: shot.steps } : {}),
  };
  const written = await runSegment(page, body, shot, ctx, net, `shot "${shot.name}"`);
  for (const [index, segment] of (shot.then ?? []).entries()) {
    written.push(
      ...(await runSegment(page, segment, shot, ctx, net, `shot "${shot.name}" then[${index}]`)),
    );
  }
  return written;
}
