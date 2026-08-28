import { describe, expect, test } from "bun:test";
import { loadCommandTable, DEFAULT_COMMAND_SOURCES } from "../check-shot-contract";
import { checkDocsExists, docsPagePath, MAX_WORDS_PER_CUE, validateDraft } from "./draft";
import type { DraftedWalkthrough } from "./draft";

const commands = await loadCommandTable(DEFAULT_COMMAND_SOURCES);

function draft(patch: Partial<DraftedWalkthrough> = {}): DraftedWalkthrough {
  return {
    cues: [
      {
        say: "Every Jx project starts with a collection.",
        steps: [{ args: { section: "content" }, cmd: "settings.open" }],
      },
    ],
    docs: ["start/first-collection"],
    name: "first-collection",
    ...patch,
  };
}

describe("validateDraft", () => {
  test("a draft naming real registry ids passes", () => {
    const result = validateDraft(draft(), commands);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test("a hallucinated command id fails, naming both sides", () => {
    const result = validateDraft(
      draft({ cues: [{ say: "x", steps: [{ cmd: "view.showPanel" }] }] }),
      commands,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("view.showPanel"))).toBe(true);
  });

  test("a malformed region in expect fails the same way — the manifest validator catches it first", () => {
    const withExpect = draft();
    (withExpect as DraftedWalkthrough & { expect?: unknown }).expect = [
      { region: "#css-selector" },
    ];
    const result = validateDraft(withExpect, commands);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("is not a region id"))).toBe(true);
  });

  test("a cue over the word cap is flagged, not silently accepted", () => {
    const longCue = { say: Array.from({ length: MAX_WORDS_PER_CUE + 1 }, () => "word").join(" ") };
    const result = validateDraft(draft({ cues: [longCue] }), commands);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        cue: 1,
        message: `${MAX_WORDS_PER_CUE + 1} words, over the ${MAX_WORDS_PER_CUE}-word cap — split into another cue`,
      },
    ]);
  });

  test("a cue right at the cap is fine", () => {
    const cue = { say: Array.from({ length: MAX_WORDS_PER_CUE }, () => "word").join(" ") };
    const result = validateDraft(draft({ cues: [cue] }), commands);
    expect(result.issues).toEqual([]);
  });

  test("a toggle id fails the same clause a committed manifest is held to", () => {
    const result = validateDraft(
      draft({ cues: [{ say: "x", steps: [{ cmd: "canvas.togglePreview" }] }] }),
      commands,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("delta against unstated state"))).toBe(true);
  });
});

describe("docsPagePath / checkDocsExists", () => {
  test("resolves under docs/, with the .md extension", () => {
    expect(docsPagePath("/repo", "start/first-collection")).toBe(
      "/repo/docs/start/first-collection.md",
    );
  });

  test("passes for a docs page that exists", () => {
    expect(() => checkDocsExists(process.cwd(), "start/first-collection")).not.toThrow();
  });

  test("names the path for a docs page that does not exist", () => {
    expect(() => checkDocsExists(process.cwd(), "nowhere/nothing")).toThrow(
      /docs page "nowhere\/nothing" does not exist/,
    );
  });
});
