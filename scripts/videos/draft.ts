/**
 * `walkthroughs:draft` — authoring from docs (`scripts/videos/PLAN.md`, Phase 4).
 *
 * A walkthrough is a **compilation of a documentation page** (see "Authoring" in the plan), and
 * this is the one place an agent may write narration: at authoring time, into a diff a human
 * reviews, never at render time — R3 forbids that, and `voice.ts`'s cache (keyed on the text) would
 * never hit against words that differ every run anyway.
 *
 * This file is the three constraints the plan names, made mechanical — never the generation step
 * itself:
 *
 * - **It may only emit ids the registry declares.** {@link validateDraft} runs the SAME check
 *   `scripts/check-shot-contract.ts` runs on the committed manifest, before a human ever sees the
 *   draft — a hallucinated command or region fails as a diff that will not pass CI, not as a
 *   confusing video.
 * - **One cue per documented step, under a word cap.** {@link MAX_WORDS_PER_CUE} — keeps the over-run
 *   report meaningful and keeps a walkthrough a micro-tutorial ("One walkthrough, one flow" in the
 *   plan).
 * - **It must render once and attach the over-run report.** `main()` does not render — that is
 *   `run.ts`'s job, unchanged, against the stub voice by default so an iterating draft costs no
 *   hosted-TTS billing. Once a draft passes the registry gate here, `bun run walkthroughs --only
 *   <name>` is the render step: "the reviewer reads prose and watches a video; nobody reviews JSON"
 *   is satisfied by folding the draft into the manifest and rendering it for real, not by this
 *   script fabricating a preview render of its own.
 *
 * **Writing the cues themselves is deliberately not code in this file.** The plan's own words are
 * "an agent drafts the manifest by reading the page and driving Studio while it does" — which is
 * this repository asking the coding agent already in the loop (a human's Claude Code session) to
 * read `docs/<slug>.md`, drive Studio via `packages/studio`'s automation surface the way this
 * script's constraints describe, and write the cues, rather than asking this script to embed its
 * own model call and API key. `DraftedCue[]` is the interface a session (or, later, a scripted
 * caller with its own model access) hands to {@link validateDraft} — swappable the same way
 * `voice.ts` separates "an audio driver exists" from "which one is configured".
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkShotContract,
  DEFAULT_COMMAND_SOURCES,
  loadCommandTable,
  WALKTHROUGH_BUDGET,
} from "../check-shot-contract";
import type { CommandTable } from "../check-shot-contract";
import { validateWalkthroughsManifest } from "./lib/types";
import type { ShotStep } from "./lib/types";
import { wordCount } from "./lib/voice";

/** One cue's `steps`, one word-capped line — the shape a draft is written in before it validates. */
export interface DraftedCue {
  say: string;
  steps?: ShotStep[];
}

export interface DraftedWalkthrough {
  name: string;
  docs: string[];
  open?: Record<string, unknown>;
  cues: DraftedCue[];
}

/**
 * One cue per documented step, so the over-run report stays legible and the flow stays a
 * micro-tutorial.
 */
export const MAX_WORDS_PER_CUE = 40;

export interface DraftIssue {
  cue: number;
  message: string;
}

/**
 * The registry gate, run BEFORE a human sees the draft. Wraps the drafted walkthrough in a
 * contract-1 manifest and runs it through the exact reader `scripts/check-shot-contract.ts` runs on
 * the committed one — one definition of "a valid id", never a second copy for drafts.
 */
export function validateDraft(
  draft: DraftedWalkthrough,
  commands: CommandTable,
): { ok: boolean; violations: string[]; issues: DraftIssue[] } {
  const issues: DraftIssue[] = [];
  for (const [index, cue] of draft.cues.entries()) {
    const words = wordCount(cue.say);
    if (words > MAX_WORDS_PER_CUE) {
      issues.push({
        cue: index + 1,
        message: `${words} words, over the ${MAX_WORDS_PER_CUE}-word cap — split into another cue`,
      });
    }
  }

  let manifest: unknown;
  try {
    manifest = validateWalkthroughsManifest({
      contract: 1,
      outDir: ".cache/videos",
      walkthroughs: [draft],
    });
  } catch (error) {
    return {
      issues,
      ok: false,
      violations: [error instanceof Error ? error.message : String(error)],
    };
  }

  const result = checkShotContract({ budget: WALKTHROUGH_BUDGET, commands, manifest });
  return {
    issues,
    ok: result.violations.length === 0 && issues.length === 0,
    violations: result.violations,
  };
}

/** `docs/<slug>.md` exists — the source a walkthrough compiles from, per "Authoring" in the plan. */
export function docsPagePath(repoRoot: string, slug: string): string {
  return resolve(repoRoot, "docs", `${slug}.md`);
}

export function checkDocsExists(repoRoot: string, slug: string): void {
  const path = docsPagePath(repoRoot, slug);
  if (!existsSync(path)) {
    throw new Error(
      `docs page "${slug}" does not exist at ${path} — a walkthrough compiles a page that is already there`,
    );
  }
}

const USAGE = "Usage: bun run walkthroughs:draft <docs-slug> --steps <draft.json>";

/**
 * `--steps <draft.json>` is the {@link DraftedWalkthrough} an authoring session wrote (see the file
 * header). This entry point is the gate, not the generator: it checks the docs page exists, runs
 * {@link validateDraft}, and — only if that passes — prints the manifest fragment for a human to
 * fold into `manifest.json` and render for real with `bun run walkthroughs`.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const [slug, ...rest] = argv;
  if (!slug || slug.startsWith("--")) {
    console.error(USAGE);
    return 2;
  }
  const stepsFlag = rest.indexOf("--steps");
  if (stepsFlag === -1 || !rest[stepsFlag + 1]) {
    console.error(USAGE);
    return 2;
  }

  const repoRoot = resolve(import.meta.dir, "../..");
  try {
    checkDocsExists(repoRoot, slug);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const draft = (await Bun.file(rest[stepsFlag + 1]!).json()) as DraftedWalkthrough;
  if (!draft.docs?.includes(slug)) {
    console.error(`draft's docs field must include "${slug}" — the source, not a tag`);
    return 1;
  }

  const commands = await loadCommandTable(DEFAULT_COMMAND_SOURCES);
  const { issues, ok, violations } = validateDraft(draft, commands);
  if (!ok) {
    console.error(`draft "${slug}" is not ready — a human should never see a hallucinated id:\n`);
    for (const issue of issues) {
      console.error(`  ✗ cue ${issue.cue}: ${issue.message}`);
    }
    for (const violation of violations) {
      console.error(`  ✗ ${violation}`);
    }
    return 1;
  }

  console.log(JSON.stringify(draft, null, 2));
  console.log(
    `\ndraft "${slug}" passes the registry gate — fold it into scripts/videos/manifest.json ` +
      `and render it (\`bun run walkthroughs --only ${draft.name}\`) to see the rendered video and ` +
      "over-run report before it goes in a diff.",
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
