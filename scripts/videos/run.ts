/**
 * The video runner.
 *
 * Reads `scripts/videos/manifest.json`, spawns the repo dev server, materialises a writable overlay
 * of every project a walkthrough opens, drives Jx Studio in headless Chromium through
 * `window.__jxAutomation`, and renders each walkthrough to an mp4 under the manifest's `outDir`.
 *
 * Per cue: narration is synthesized FIRST (`voice.ts`) and measured with `ffprobe` (ADR-0003), then
 * the browser is driven and frames captured, paced to that measured length (`walkthrough.ts`).
 * Frames, narration and the pointer log are then assembled into one mp4 (`assemble.ts`).
 *
 * ```bash
 * bun run walkthroughs                     # every walkthrough
 * bun run walkthroughs --only first-collection
 * OPENAI_API_KEY=… bun run walkthroughs    # real voice instead of the keyless stub
 * ```
 *
 * The contract this manifest is written in is `scripts/videos/lib/types.ts` and is enforced
 * statically by `scripts/check-shot-contract.ts` — the same gate that reads the screenshot
 * manifest.
 */

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { launchBrowser, newShotContext } from "../screenshots/lib/browser";
import { ensureDevServer, overlayProject } from "../screenshots/lib/server";
import { assembleWalkthrough } from "./lib/assemble";
import { parseArgs } from "./lib/args";
import { measureSeconds, cachingVoice, selectVoice } from "./lib/voice";
import {
  resolveFps,
  resolveVoice,
  resolveWalkthrough,
  validateWalkthroughsManifest,
} from "./lib/types";
import { runWalkthrough } from "./lib/walkthrough";

const repoRoot = resolve(import.meta.dir, "../..");

const { manifestPath, only } = parseArgs(
  process.argv.slice(2),
  resolve(import.meta.dir, "manifest.json"),
);
const manifest = validateWalkthroughsManifest(await Bun.file(manifestPath).json());

const selected = manifest.walkthroughs.filter((w) => only.size === 0 || only.has(w.name));
if (selected.length === 0) {
  throw new Error(`no walkthroughs matched --only ${[...only].join(",")}`);
}

const outDir = resolve(repoRoot, manifest.outDir);
const cacheDir = join(repoRoot, ".cache/videos");
const audioCacheDir = join(cacheDir, "audio");
await mkdir(outDir, { recursive: true });

const studioPath = "/packages/studio/index.html";
const server = await ensureDevServer({
  repoRoot,
  studioPath,
  url: "http://127.0.0.1:3000",
});
const fps = resolveFps(manifest);
const voice = cachingVoice(selectVoice(audioCacheDir), audioCacheDir);

let failed = 0;
const browser = await launchBrowser({});
try {
  for (const walkthrough of selected) {
    const resolved = resolveWalkthrough(manifest, walkthrough);
    const overlay = resolved.open.project
      ? await overlayProject(repoRoot, resolved.open.project)
      : null;
    const { dispose, page } = await newShotContext(browser);
    const frameDir = join(cacheDir, "frames", walkthrough.name);
    try {
      // Narration first (ADR-0003): every cue is synthesized and its true length measured with
      // `ffprobe` BEFORE the browser is driven, so capture is paced to a number that already
      // Exists rather than to one the render is trying to hit.
      const voiceId = resolveVoice(manifest, walkthrough);
      // Indexed by position in `walkthrough.cues`, not by object identity — `resolved.cues` is
      // `walkthrough.cues` today only because `resolveWalkthrough`'s spread happens not to touch
      // It, and nothing pins that down against a future change that normalizes a cue field.
      const spoken: { path: string; seconds: number }[] = [];
      for (const cue of walkthrough.cues) {
        const audio = await voice.speak(cue.say, voiceId);
        const seconds = await measureSeconds(audio.path);
        spoken.push({ path: audio.path, seconds });
        console.log(`[voice] "${cue.say.slice(0, 40)}…" ${seconds.toFixed(2)}s`);
      }

      const result = await runWalkthrough(page, resolved, (_cue, index) => spoken[index]!.seconds, {
        frameDir,
        log: console.log,
        projectRoot: overlay?.root,
        repoRoot,
        serverUrl: server.url,
        studioPath,
      });

      for (const [index, cue] of walkthrough.cues.entries()) {
        const over = result.cues[index]!.overrunMs;
        if (over > 0) {
          console.warn(
            `[cue ${index + 1}] over-run: acted ${Math.round(over)}ms longer than spoken ` +
              `("${cue.say.slice(0, 60)}…") — write a longer line, or the render stays correct and slow`,
          );
        }
      }

      const outPath = join(outDir, `${walkthrough.name}.mp4`);
      await assembleWalkthrough({
        cacheDir,
        cueResults: result.cues,
        fps,
        frameDir,
        outPath,
        pointerLog: result.pointerLog,
        wavPaths: spoken.map((s) => s.path),
      });

      const report = {
        cues: result.cues.map((c, i) => ({
          actualMs: Math.round(c.actualMs),
          overrunMs: Math.round(c.overrunMs),
          say: walkthrough.cues[i]!.say,
          spokenMs: Math.round((spoken[i]?.seconds ?? 0) * 1000),
        })),
        name: walkthrough.name,
      };
      await Bun.write(
        join(outDir, `${walkthrough.name}.report.json`),
        JSON.stringify(report, null, 2),
      );
      console.log(`[walkthrough:${walkthrough.name}] ${outPath}`);
    } catch (error) {
      failed += 1;
      console.error(
        `[walkthrough:${walkthrough.name}] FAILED:`,
        error instanceof Error ? error.message : error,
      );
    } finally {
      await dispose();
      await overlay?.reset();
    }
  }
} finally {
  await browser.close();
  await server.dispose();
}

if (failed > 0) {
  console.error(`${failed}/${selected.length} walkthrough(s) failed`);
  process.exit(1);
}
console.log(`${selected.length} walkthrough(s) rendered to ${manifest.outDir}`);
