/**
 * The frame-capture-cost decision (`scripts/videos/PLAN.md` — "Open question: frame capture cost"),
 * and the pure pacing math built on it.
 *
 * **Measured, not argued.** `page.screenshot()` against Studio at 1920×1080 / deviceScaleFactor 1
 * (`bootUrl`'s own defaults) averaged 66.8ms over 60 captures (p50 66.8ms, p90 72.6ms, max 87.2ms),
 * against the plan's own benchmark harness (a `first-collection` fixture boot). That is nowhere
 * near the 33ms/frame a native 30fps loop needs, and it is not comfortably inside the 66.7ms/frame
 * a 15fps loop would need either — p90 alone exceeds it. So this takes the plan's own answer:
 *
 * 1. **Capture at a fixed lower fps** ({@link CAPTURE_FPS}, 12 — `83.3ms/frame`, a margin over the
 *    measured p90 that 15fps would not have had) and let ffmpeg hold frames up to the output rate.
 * 2. **Timestamp every frame** rather than assume the cadence held, so a slow capture (the p90/max
 *    tail this repository's own dev server produced) moves the frame's PLACEMENT on the output
 *    clock instead of silently running the whole video slow against audio measured exactly
 *    (ADR-0003). `assemble.ts` builds its ffconcat file from these timestamps, never from an
 *    assumed 83.3ms step.
 *
 * `Page.startScreencast` (CDP) is not taken — the plan's option 3 — because (1) and (2) together
 * hold the measured p90 with margin to spare, which is the "worth it only if (1) and (2) measurably
 * fail" bar the plan sets.
 */

/** The capture cadence chosen above. `walkthrough.ts` sleeps this long between hold-frames. */
export const CAPTURE_FPS = 12;
export const CAPTURE_INTERVAL_MS = 1000 / CAPTURE_FPS;

/** One captured frame: its file and when it was captured, in ms since the cue started. */
export interface Frame {
  path: string;
  atMs: number;
}

/** One line of an ffconcat script's `file`/`duration` pair. */
export interface FrameDuration {
  path: string;
  seconds: number;
}

/**
 * Turn timestamped frames into ffconcat durations: frame N holds until frame N+1's timestamp, and
 * the last frame holds for whatever is left of `totalMs` — never for zero, and never for a value
 * ffmpeg's concat demuxer would reject.
 *
 * This is where option (2) actually pays for itself: two frames captured 90ms apart (a slow
 * screenshot, over the 83.3ms cadence) get a 90ms duration rather than the assumed 83.3ms, so the
 * frame after them lands where its own timestamp says it should rather than drifting later by the
 * accumulated slack — the exact failure mode the plan names ("the video runs slow against audio
 * that was measured exactly").
 */
export function frameDurations(frames: readonly Frame[], totalMs: number): FrameDuration[] {
  if (frames.length === 0) {
    return [];
  }
  const MIN_SECONDS = 1 / 1000; // Ffmpeg's concat demuxer rejects a duration of exactly zero.
  return frames.map((frame, index) => {
    const next = frames[index + 1]?.atMs ?? totalMs;
    const seconds = Math.max(MIN_SECONDS, (next - frame.atMs) / 1000);
    return { path: frame.path, seconds };
  });
}

/**
 * The ffconcat script `assemble.ts` feeds `ffmpeg -f concat`.
 *
 * The concat demuxer's own rule, not a workaround: a `duration` line applies to the file ABOVE it,
 * and the demuxer ignores the last file's duration outright — so the last file is written a second
 * time with no duration, which is what makes it actually hold for the gap between it and EOF. Paths
 * are single-quoted per the format's own escaping (`'` → `'\''`), since a project slug can carry
 * one.
 */
export function ffconcatScript(durations: readonly FrameDuration[]): string {
  const quote = (path: string) => `'${path.replaceAll("'", String.raw`'\''`)}'`;
  const lines = ["ffconcat version 1.0"];
  for (const { path, seconds } of durations) {
    lines.push(`file ${quote(path)}`, `duration ${seconds.toFixed(3)}`);
  }
  const last = durations.at(-1);
  if (last) {
    lines.push(`file ${quote(last.path)}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Whether a cue's steps ran longer than its narration — ADR-0003's "acted exceeded spoken". Never
 * fatal: the cue simply extends to cover what happened, and this is what the over-run report
 * reads.
 */
export function overrunMs(actualMs: number, budgetMs: number): number {
  return Math.max(0, actualMs - budgetMs);
}
