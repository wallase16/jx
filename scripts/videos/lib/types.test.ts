import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PROFILE,
  resolveFps,
  resolveVoice,
  resolveWalkthrough,
  validateWalkthroughsManifest,
} from "./types";
import type { WalkthroughsManifest } from "./types";

function manifest(patch: Partial<WalkthroughsManifest> = {}): unknown {
  return {
    contract: 1,
    outDir: ".cache/videos",
    walkthroughs: [
      {
        cues: [{ say: "Every Jx project starts with a collection." }],
        docs: ["start/first-collection"],
        name: "first-collection",
      },
    ],
    ...patch,
  };
}

describe("validateWalkthroughsManifest", () => {
  test("accepts the shape scripts/videos/PLAN.md documents", () => {
    const result = validateWalkthroughsManifest(manifest());
    expect(result.walkthroughs).toHaveLength(1);
  });

  test("rejects a wrong contract version, naming both", () => {
    expect(() => validateWalkthroughsManifest(manifest({ contract: 0 }))).toThrow(
      /declares contract 0/,
    );
  });

  test("rejects an empty walkthroughs array", () => {
    expect(() => validateWalkthroughsManifest(manifest({ walkthroughs: [] }))).toThrow(
      /non-empty array/,
    );
  });

  test("docs is required — it is the source, not a tag", () => {
    const bad = manifest();
    (bad as { walkthroughs: { docs?: string[] }[] }).walkthroughs[0]!.docs = [];
    expect(() => validateWalkthroughsManifest(bad)).toThrow(/docs must be a non-empty array/);
  });

  test("rejects a duplicate walkthrough name", () => {
    const bad = manifest();
    const [wt] = (bad as { walkthroughs: unknown[] }).walkthroughs;
    (bad as { walkthroughs: unknown[] }).walkthroughs.push(wt);
    expect(() => validateWalkthroughsManifest(bad)).toThrow(/duplicate walkthrough name/);
  });

  test("rejects an empty cues array", () => {
    const bad = manifest();
    (bad as { walkthroughs: { cues: unknown[] }[] }).walkthroughs[0]!.cues = [];
    expect(() => validateWalkthroughsManifest(bad)).toThrow(/cues must be a non-empty array/);
  });

  test("rejects a cue with no narration", () => {
    const bad = manifest();
    (bad as { walkthroughs: { cues: { say: string }[] }[] }).walkthroughs[0]!.cues[0]!.say = "  ";
    expect(() => validateWalkthroughsManifest(bad)).toThrow(/say must be a non-empty string/);
  });

  test("a cue step is validated against the shared step contract", () => {
    const bad = manifest();
    (bad as { walkthroughs: { cues: { steps: unknown[] }[] }[] }).walkthroughs[0]!.cues[0]!.steps =
      [{ cmd: "view.showPanel", selector: "#x" }];
    expect(() => validateWalkthroughsManifest(bad)).toThrow(/never name a selector/);
  });

  test("a removed shot key fails the same way it does in a shot", () => {
    const bad = manifest({
      walkthroughs: [
        {
          cues: [{ say: "x" }],
          docs: ["x"],
          name: "x",
          // Deleted from the shot contract; a walkthrough refuses it the same way.
          wait: 500,
        } as never,
      ],
    });
    expect(() => validateWalkthroughsManifest(bad)).toThrow(/"wait" was deleted/);
  });

  test("defaults.fps must be a positive number", () => {
    expect(() => validateWalkthroughsManifest(manifest({ defaults: { fps: 0 } }))).toThrow(
      /defaults.fps must be a positive number/,
    );
  });

  test("defaults still validates open fields through the shared validator", () => {
    expect(() => validateWalkthroughsManifest(manifest({ defaults: { theme: "" } }))).toThrow(
      /open.theme must be a non-empty string/,
    );
  });
});

describe("resolveFps / resolveVoice", () => {
  test("fall back to the documented defaults", () => {
    const m = validateWalkthroughsManifest(manifest());
    expect(resolveFps(m)).toBe(30);
    expect(resolveVoice(m, m.walkthroughs[0]!)).toBe("narrator-a");
  });

  test("manifest defaults win over the built-in default", () => {
    const m = validateWalkthroughsManifest(
      manifest({ defaults: { fps: 24, voice: "narrator-b" } }),
    );
    expect(resolveFps(m)).toBe(24);
    expect(resolveVoice(m, m.walkthroughs[0]!)).toBe("narrator-b");
  });
});

describe("resolveWalkthrough", () => {
  test("folds defaults into open the same way a shot does", () => {
    const m = validateWalkthroughsManifest(
      manifest({ defaults: { theme: "dark", viewport: { height: 1080, width: 1920 } } }),
    );
    const resolved = resolveWalkthrough(m, m.walkthroughs[0]!);
    expect(resolved.open.theme).toBe("dark");
    expect(resolved.open.viewport).toEqual({ height: 1080, width: 1920 });
    expect(resolved.open.profile).toBe(DEFAULT_PROFILE);
  });
});
