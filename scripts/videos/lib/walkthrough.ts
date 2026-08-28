/**
 * `lib/walkthrough.ts` — drive and capture (`scripts/videos/PLAN.md`).
 *
 * Boot via the shared seam (`screenshots/lib/drive.ts`), then per cue: run the steps, capturing
 * full-viewport frames until the cue's spoken length is covered. Full viewport only — a video has
 * no `capture.of` region grammar, because a cropped video of a moving app is a video of nothing.
 *
 * Every frame is timestamped and every pointer move logged, which is what
 * {@link "./pacing"|pacing.ts} and {@link "./cursor"|cursor.ts} need and is the reason this file
 * stays thin: the capture-cost decision, the duration math and the cursor interpolation are ALL
 * pure functions elsewhere, tested without a browser. This file is the one place they meet a real
 * page — matching `shot.ts`'s own orchestrator, which likewise carries no test of its own.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "puppeteer-core";
import {
  applyOpenState,
  assertExpectations,
  assertNoUninvitedModal,
  bootUrl,
  regionPoint,
  runStep,
  settle,
  trackRequests,
} from "../../screenshots/lib/drive";
import type { RequestTracker } from "../../screenshots/lib/drive";
import { isInputStep } from "../../screenshots/lib/types";
import type { ShotStep } from "../../screenshots/lib/types";
import { CAPTURE_INTERVAL_MS, overrunMs } from "./pacing";
import type { Frame } from "./pacing";
import type { PointerEvent } from "./cursor";
import type { Cue, ResolvedWalkthrough } from "./types";

export interface WalkthroughContext {
  log: (line: string) => void;
  frameDir: string;
  repoRoot: string;
  serverUrl: string;
  studioPath: string;
  projectRoot?: string;
}

export interface CueResult {
  frames: Frame[];
  actualMs: number;
  overrunMs: number;
}

export interface WalkthroughResult {
  cues: CueResult[];
  pointerLog: PointerEvent[];
}

const pad = (n: number): string => String(n).padStart(6, "0");

/**
 * `(t, x, y)` for one step, if it moved a pointer anywhere — the by-product `assemble.ts`'s cursor
 * compositing reads (`cursor.ts`). `t` is seconds since the WALKTHROUGH started, matching the video
 * timeline `assemble.ts` composites the cursor sprite against, not the cue's own clock.
 *
 * `hover`/`type`(with a region)/`dragOver` resolve through {@link regionPoint} — the same call
 * `drive.ts`'s own `runInput` makes for these kinds, so the logged point is exactly where the
 * gesture landed. `caret` resolves through `probe.revealPath`, because its target is a `JxPath`
 * rather than a region id. A `cmd` or `seed` step moves nothing visible and logs nothing.
 */
async function logPointer(
  page: Page,
  step: ShotStep,
  pointerLog: PointerEvent[],
  walkthroughStartMs: number,
  at: string,
): Promise<void> {
  if (!isInputStep(step)) {
    return;
  }
  let point: { x: number; y: number } | null = null;
  if (step.input === "caret") {
    point = await page.evaluate((path) => window.__jxAutomation.probe.revealPath(path), step.path);
  } else if (step.input === "hover" || step.input === "dragOver") {
    point = await regionPoint(page, step.region, at).catch(() => null);
  } else if (step.input === "type" && step.region !== undefined) {
    point = await regionPoint(page, step.region, at).catch(() => null);
  }
  if (point) {
    pointerLog.push({ t: (performance.now() - walkthroughStartMs) / 1000, x: point.x, y: point.y });
  }
}

/**
 * One cue: run its steps (capturing a frame right after each, so motion is visible), then hold-
 * capture at {@link CAPTURE_INTERVAL_MS} until `budgetMs` is covered.
 *
 * `frameIndex` is a mutable cursor across the WHOLE walkthrough, not per cue — frames are numbered
 * once, globally, so ffmpeg's `image2`-style ordering needs no per-cue offsetting.
 */
async function captureCue(
  page: Page,
  net: RequestTracker,
  cue: Cue,
  budgetMs: number,
  ctx: WalkthroughContext,
  walkthroughStartMs: number,
  frameIndexRef: { next: number },
  pointerLog: PointerEvent[],
  at: string,
): Promise<CueResult> {
  const cueStart = performance.now();
  const frames: Frame[] = [];

  const captureFrame = async (): Promise<void> => {
    const buffer = Buffer.from(await page.screenshot({ type: "png" }));
    const path = join(ctx.frameDir, `${pad(frameIndexRef.next)}.png`);
    await writeFile(path, buffer);
    frames.push({ atMs: performance.now() - cueStart, path });
    frameIndexRef.next += 1;
  };

  await captureFrame();
  const steps = cue.steps ?? [];
  for (const [index, step] of steps.entries()) {
    const stepAt = `${at} step ${index + 1}`;
    await runStep(page, step, stepAt);
    await settle(page, net, stepAt);
    await logPointer(page, step, pointerLog, walkthroughStartMs, stepAt);
    await captureFrame();
  }

  while (performance.now() - cueStart < budgetMs) {
    await Bun.sleep(CAPTURE_INTERVAL_MS);
    await captureFrame();
  }

  const actualMs = performance.now() - cueStart;
  ctx.log(`[cue] "${cue.say.slice(0, 40)}…" ${frames.length} frame(s), ${Math.round(actualMs)}ms`);
  return { actualMs, frames, overrunMs: overrunMs(actualMs, budgetMs) };
}

/**
 * Run a whole walkthrough: boot, then every cue in order, each paced to its measured narration
 * length (`cueSecondsFor`, supplied by the caller after `voice.ts` has synthesized and `ffprobe`
 * has measured it — ADR-0003).
 */
export async function runWalkthrough(
  page: Page,
  walkthrough: ResolvedWalkthrough,
  cueSecondsFor: (cue: Cue, index: number) => number,
  ctx: WalkthroughContext,
): Promise<WalkthroughResult> {
  await mkdir(ctx.frameDir, { recursive: true });
  const net = trackRequests(page);
  const { open } = walkthrough;
  await page.setViewport({
    deviceScaleFactor: open.deviceScaleFactor,
    height: open.viewport.height,
    width: open.viewport.width,
  });
  // Deliberately NOT `prefers-reduced-motion: reduce` and NOT `armFreeze()` — both are `shot.ts`'s
  // Choice for a STILL, where any animation mid-flight is nondeterminism to kill. A walkthrough's
  // Whole point is to show real interaction motion (ADR-0002: "real interaction motion is not
  // Byte-stable", which is exactly why no video artifact is committed); reducing or freezing it
  // Here would suppress the panel transitions and highlights a cue is narrating.

  const url = bootUrl(ctx, open);
  ctx.log(`[walkthrough:${walkthrough.name}] ${url}`);
  await page.goto(url, { timeout: 120_000, waitUntil: "networkidle2" });
  await page.waitForFunction(() => Boolean(window.__jxAutomation), { timeout: 30_000 });
  await settle(page, net, "boot");
  await assertNoUninvitedModal(page, walkthrough.name);
  await applyOpenState(page, open, net);

  const walkthroughStartMs = performance.now();
  const frameIndexRef = { next: 0 };
  const pointerLog: PointerEvent[] = [];
  const cues: CueResult[] = [];
  for (const [index, cue] of walkthrough.cues.entries()) {
    const budgetMs = cueSecondsFor(cue, index) * 1000;
    const at = `walkthrough "${walkthrough.name}" cue ${index + 1}`;
    cues.push(
      await captureCue(
        page,
        net,
        cue,
        budgetMs,
        ctx,
        walkthroughStartMs,
        frameIndexRef,
        pointerLog,
        at,
      ),
    );
  }
  await assertExpectations(page, walkthrough.expect ?? [], `walkthrough "${walkthrough.name}"`);
  return { cues, pointerLog };
}
