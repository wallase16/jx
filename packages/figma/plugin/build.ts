/**
 * Build.ts — Bundle the Figma plugin spike.
 *
 * Figma loads two artifacts: `dist/code.js` (sandbox) and `dist/ui.html` (a single self-contained
 * iframe document). We bundle code.ts and ui.ts with Bun, then inline the UI bundle — runtime and
 * converter included — into ui.html so it needs no network or external files.
 *
 * Run from packages/figma: `bun run plugin/build.ts`
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const here = import.meta.dir;
const distDir = join(here, "dist");
await mkdir(distDir, { recursive: true });

// Sandbox entry — plain bundle, no DOM.
const code = await Bun.build({
  entrypoints: [join(here, "code.ts")],
  target: "browser",
  minify: true,
});
if (!code.success) {
  console.error(code.logs.join("\n"));
  throw new Error("code.ts bundle failed");
}
await Bun.write(join(distDir, "code.js"), await code.outputs[0].text());

// UI entry — bundles the Jx runtime + converter, then inline into the HTML template.
const ui = await Bun.build({
  entrypoints: [join(here, "ui.ts")],
  target: "browser",
  format: "iife",
  minify: { whitespace: true, syntax: true, identifiers: false },
});
if (!ui.success) {
  console.error(ui.logs.join("\n"));
  throw new Error("ui.ts bundle failed");
}
const uiJs = await ui.outputs[0].text();
const template = await Bun.file(join(here, "ui.html")).text();
const html = template.replace("<!-- __JX_UI_BUNDLE__ -->", `<script>${uiJs}</script>`);
await Bun.write(join(distDir, "ui.html"), html);

console.log("Built dist/code.js and dist/ui.html");
