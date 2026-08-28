import { describe, expect, test } from "bun:test";
import {
  CAPTURE_FPS,
  CAPTURE_INTERVAL_MS,
  ffconcatScript,
  frameDurations,
  overrunMs,
} from "./pacing";
import type { Frame } from "./pacing";

describe("the frame-capture-cost decision", () => {
  test("CAPTURE_INTERVAL_MS holds margin over the measured p90 (72.6ms)", () => {
    expect(CAPTURE_FPS).toBe(12);
    expect(CAPTURE_INTERVAL_MS).toBeCloseTo(83.33, 1);
    expect(CAPTURE_INTERVAL_MS).toBeGreaterThan(72.6);
  });
});

describe("frameDurations", () => {
  test("each frame holds until the next frame's timestamp", () => {
    const frames: Frame[] = [
      { atMs: 0, path: "a.png" },
      { atMs: 90, path: "b.png" },
      { atMs: 170, path: "c.png" },
    ];
    const durations = frameDurations(frames, 1000);
    expect(durations).toEqual([
      { path: "a.png", seconds: 0.09 },
      { path: "b.png", seconds: 0.08 },
      { path: "c.png", seconds: 0.83 },
    ]);
  });

  test("a slow capture (over the 83.3ms cadence) gets its OWN measured duration, not the assumed one", () => {
    const frames: Frame[] = [
      { atMs: 0, path: "a.png" },
      // Captured 90ms later — the p90 tail the benchmark measured — not the assumed 83.3ms.
      { atMs: 90, path: "b.png" },
    ];
    const [first] = frameDurations(frames, 200);
    expect(first!.seconds).toBeCloseTo(0.09, 3);
    expect(first!.seconds).not.toBeCloseTo(CAPTURE_INTERVAL_MS / 1000, 3);
  });

  test("the last frame holds for whatever is left of the cue, never zero", () => {
    const frames: Frame[] = [{ atMs: 999.5, path: "a.png" }];
    const [only] = frameDurations(frames, 1000);
    expect(only!.seconds).toBeGreaterThan(0);
  });

  test("empty frames produce no durations", () => {
    expect(frameDurations([], 1000)).toEqual([]);
  });
});

describe("ffconcatScript", () => {
  test("writes a duration line under every file except the trailing repeat", () => {
    const script = ffconcatScript([
      { path: "/a.png", seconds: 0.09 },
      { path: "/b.png", seconds: 0.5 },
    ]);
    expect(script).toBe(
      "ffconcat version 1.0\n" +
        "file '/a.png'\n" +
        "duration 0.090\n" +
        "file '/b.png'\n" +
        "duration 0.500\n" +
        "file '/b.png'\n",
    );
  });

  test("escapes a single quote in a path", () => {
    const script = ffconcatScript([{ path: "/it's/here.png", seconds: 0.1 }]);
    expect(script).toContain(String.raw`/it'\''s/here.png`);
  });

  test("an empty list produces just the header", () => {
    expect(ffconcatScript([])).toBe("ffconcat version 1.0\n");
  });
});

describe("overrunMs", () => {
  test("zero when the cue's steps finished inside its budget", () => {
    expect(overrunMs(1200, 1500)).toBe(0);
  });

  test("the excess when steps ran long — acted exceeded spoken", () => {
    expect(overrunMs(1800, 1500)).toBe(300);
  });
});
