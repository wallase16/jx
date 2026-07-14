/**
 * Bundle `perception-eval.entry.ts` (which imports the REAL shipped `iframe-perception` functions)
 * into a single self-contained HTML file with all JS inlined as an IIFE — no dev server, no module
 * resolution, no CSP surprises. `chrome-devtools` opens it over `file://` and drives
 * `window.perceptionEval`. See specs/ai-assistant.md §12.6 and the L7 section of
 * `docs/ai-assistant-testing-plan.md`.
 *
 * Bun run packages/studio/tests/browser/build-perception-eval.ts
 *
 * Prints the `file://` URL to open. Output lands in `tests/browser/dist/` (gitignored).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const here = dirname(Bun.fileURLToPath(import.meta.url));
const outDir = resolve(here, "dist");
const outHtml = resolve(outDir, "perception-eval.html");

const built = await Bun.build({
  entrypoints: [resolve(here, "perception-eval.entry.ts")],
  format: "iife",
  minify: false,
  target: "browser",
});

if (!built.success) {
  for (const log of built.logs) {
    console.error(log);
  }
  process.exit(1);
}

const js = await built.outputs[0]!.text();

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Perception browser eval (§12.6)</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }
      h1 { font-size: 18px; }
      h2 { font-size: 16px; }
      table { border-collapse: collapse; margin-top: 8px; font-size: 13px; }
      td { border: 1px solid #ddd; padding: 4px 8px; vertical-align: top; }
      code { font-size: 12px; color: #334; }
      #stage { margin-top: 24px; border: 1px dashed #bbb; border-radius: 6px; }
      button { font: inherit; padding: 6px 12px; cursor: pointer; }
    </style>
  </head>
  <body>
    <script>${js}</script>
  </body>
</html>
`;

await mkdir(outDir, { recursive: true });
await writeFile(outHtml, html, "utf8");

console.log(`Wrote ${outHtml}`);
console.log(`Open in chrome-devtools: file://${outHtml}`);
