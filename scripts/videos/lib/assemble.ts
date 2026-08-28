/**
 * `lib/assemble.ts` — ffmpeg (`scripts/videos/PLAN.md`).
 *
 * Frames → h264 at `fps`; cue wavs concatenated; the two muxed, and the cursor sprite composited
 * (`cursor.ts`). One `ffmpeg` invocation per stage, each logged in full on failure — an ffmpeg
 * failure that is not reproducible from the log is undebuggable.
 *
 * The pure math — which duration each frame gets, and the interpolated cursor expression — lives in
 * `pacing.ts` and `cursor.ts` and is tested there, without a browser or a binary. This file is the
 * thin shell that turns those into command lines.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cursorExpr } from "./cursor";
import type { PointerEvent } from "./cursor";
import { ffconcatScript, frameDurations } from "./pacing";
import type { CueResult } from "./walkthrough";

async function runFfmpeg(args: string[], label: string): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", "-y", ...args], { stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg (${label}) failed (${code}):\n${stdout}\n${stderr}`);
  }
}

/**
 * A filled circle on a transparent background, generated rather than checked in — this repository
 * has no binary assets, and a 20×20 PNG drawn by `geq` costs nothing to regenerate. Cached at
 * `path`; the same sprite composites over every walkthrough.
 */
export async function ensureCursorSprite(path: string): Promise<void> {
  if (existsSync(path)) {
    return;
  }
  await mkdir(join(path, ".."), { recursive: true });
  await runFfmpeg(
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=20x20,format=rgba," +
        "geq=r='255':g='210':b='0':a='if(lte(hypot(X-10,Y-10),9),230,0)'",
      "-frames:v",
      "1",
      "-update",
      "1",
      path,
    ],
    "cursor sprite",
  );
}

/**
 * `cueResults[]`, in cue order, into one ffconcat script covering the whole walkthrough — the
 * duration math is `pacing.ts`'s; this only flattens per-cue frame lists into one document, since a
 * concatenated `file`/`duration` list needs no per-cue boundary of its own.
 */
export function walkthroughFrameConcat(cueResults: readonly CueResult[]): string {
  const durations = cueResults.flatMap((cue) => frameDurations(cue.frames, cue.actualMs));
  return ffconcatScript(durations);
}

/** Stage 1: frames → a silent, constant-framerate h264 track. */
export async function renderFrames(
  cueResults: readonly CueResult[],
  fps: number,
  frameDir: string,
  outPath: string,
): Promise<void> {
  const concatPath = join(frameDir, "frames.ffconcat");
  await writeFile(concatPath, walkthroughFrameConcat(cueResults));
  await runFfmpeg(
    [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-vf",
      `fps=${fps}`,
      "-pix_fmt",
      "yuv420p",
      outPath,
    ],
    "render frames",
  );
}

/** Stage 2: every cue's narration wav, in order, concatenated into one continuous track. */
export async function concatenateAudio(
  wavPaths: readonly string[],
  outPath: string,
): Promise<void> {
  if (wavPaths.length === 0) {
    throw new Error("concatenateAudio: no audio files to concatenate");
  }
  const inputs = wavPaths.flatMap((path) => ["-i", path]);
  const labels = wavPaths.map((_path, i) => `[${i}:a]`).join("");
  await runFfmpeg(
    [
      ...inputs,
      "-filter_complex",
      `${labels}concat=n=${wavPaths.length}:v=0:a=1[aout]`,
      "-map",
      "[aout]",
      outPath,
    ],
    "concatenate narration",
  );
}

/** Stage 3: mux video + narration, compositing the cursor sprite over the pointer log. */
export async function muxWithCursor(
  videoPath: string,
  audioPath: string,
  cursorPath: string,
  pointerLog: readonly PointerEvent[],
  outPath: string,
): Promise<void> {
  const { x, y } = cursorExpr(pointerLog);
  await runFfmpeg(
    [
      "-i",
      videoPath,
      "-i",
      audioPath,
      "-i",
      cursorPath,
      "-filter_complex",
      `[0:v][2:v]overlay=x='${x}':y='${y}':format=auto[vout]`,
      "-map",
      "[vout]",
      "-map",
      "1:a",
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-pix_fmt",
      "yuv420p",
      "-shortest",
      outPath,
    ],
    "mux + cursor",
  );
}

/** All three stages, in order — what `run.ts` calls per walkthrough. */
export async function assembleWalkthrough(opts: {
  cueResults: readonly CueResult[];
  pointerLog: readonly PointerEvent[];
  wavPaths: readonly string[];
  fps: number;
  frameDir: string;
  cacheDir: string;
  outPath: string;
}): Promise<void> {
  const videoPath = join(opts.frameDir, "video.mp4");
  const audioPath = join(opts.frameDir, "narration.wav");
  const cursorPath = join(opts.cacheDir, "cursor.png");
  await ensureCursorSprite(cursorPath);
  await renderFrames(opts.cueResults, opts.fps, opts.frameDir, videoPath);
  await concatenateAudio(opts.wavPaths, audioPath);
  await mkdir(join(opts.outPath, ".."), { recursive: true });
  await muxWithCursor(videoPath, audioPath, cursorPath, opts.pointerLog, opts.outPath);
}
