/// <reference lib="dom" />
/**
 * Browser-eval entry for the perception rendered-DOM / highlight-timing axes (specs/ai-assistant.md
 * §12.6). This is the ONE thing the headless harness can't do: happy-dom stubs
 * `getBoundingClientRect` to zeroes and never paints, so it can prove the SHAPE of
 * `enumerateRenderedTree`/`applyHighlight` but not that the iframe reports real layout geometry or
 * that a highlight actually paints and clears on its TTL in a live engine.
 *
 * `build-perception-eval.ts` bundles this (IIFE, everything inlined) into a single self-contained
 * HTML file that `chrome-devtools` drives — no dev server, no LLM, no auth gate. It imports the
 * REAL shipped functions (not a reimplementation), stamps a small `data-jx-path` fixture, and
 * exposes `window.perceptionEval` for the driver to call and assert against.
 */

import { applyHighlight, enumerateRenderedTree } from "../../src/canvas/iframe-perception";
import type { RenderedNode } from "../../src/canvas/iframe-protocol";

/** The blue the real `applyHighlight` paints — `getComputedStyle` normalizes it to rgb(). */
const HIGHLIGHT_RGB = "rgb(59, 130, 246)";

/** One check in the eval report: a named assertion with its pass/fail and the observed detail. */
interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

/** The full report `runAll()` returns — the driver asserts `ok` and screenshots the fixture. */
interface EvalReport {
  ok: boolean;
  checks: Check[];
  nodes: RenderedNode[];
}

/** Serialize a document path the way `data-jx-path` is stamped, so the fixture matches selectors. */
function stamp(el: HTMLElement, path: (string | number)[]): void {
  el.dataset.jxPath = JSON.stringify(path);
}

/**
 * The stage the fixture renders into — created on first use so `buildFixture` never wipes `<body>`
 * (which would take the harness UI with it).
 */
function stage(): HTMLElement {
  let el = document.querySelector<HTMLElement>("#stage");
  if (!el) {
    el = document.createElement("div");
    el.id = "stage";
    document.body.append(el);
  }
  return el;
}

/**
 * Build a stamped fixture that forces REAL layout to matter: two side-by-side buttons (distinct
 * viewport x — impossible to fake with happy-dom's all-zero rects) and one `display:none` span
 * (exercises the `getComputedStyle`-based `hidden` flag and a zero rect).
 */
function buildFixture(): void {
  const host = stage();
  host.innerHTML = "";
  const root = document.createElement("div");
  stamp(root, []);
  root.style.display = "flex";
  root.style.gap = "24px";
  root.style.padding = "40px";

  const alpha = document.createElement("button");
  stamp(alpha, ["children", 0]);
  alpha.textContent = "Alpha";
  alpha.style.padding = "12px 20px";

  const beta = document.createElement("button");
  stamp(beta, ["children", 1]);
  beta.textContent = "Beta";
  beta.style.padding = "12px 20px";

  const ghost = document.createElement("span");
  stamp(ghost, ["children", 2]);
  ghost.textContent = "Ghost";
  ghost.style.display = "none";

  root.append(alpha, beta, ghost);
  host.append(root);
}

/** Look up a fixture element by its stamped path (same encoding as `data-jx-path`). */
function byPath(path: (string | number)[]): HTMLElement {
  const el = document.querySelector(`[data-jx-path='${JSON.stringify(path)}']`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`fixture missing element at ${JSON.stringify(path)}`);
  }
  return el;
}

/** Computed outline shorthand of an element — the driver reads this to see a painted highlight. */
function computedOutline(el: HTMLElement): string {
  const s = getComputedStyle(el);
  return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`;
}

/**
 * The rendered-DOM axis: enumerate the live fixture and assert the tree carries REAL geometry —
 * non-zero button rects, distinct x for the two buttons, a `hidden` span with a zero rect, and the
 * text snippet. None of these survive happy-dom.
 */
function checkRenderedDom(): { checks: Check[]; nodes: RenderedNode[] } {
  const nodes = enumerateRenderedTree(document);
  const at = (p: (string | number)[]): RenderedNode | undefined =>
    nodes.find((n) => JSON.stringify(n.path) === JSON.stringify(p));

  const root = at([]);
  const alpha = at(["children", 0]);
  const beta = at(["children", 1]);
  const ghost = at(["children", 2]);

  const checks: Check[] = [
    {
      name: "root enumerated with 3 stamped children",
      pass: root?.childCount === 3,
      detail: `root childCount=${root?.childCount ?? "missing"}`,
    },
    {
      name: "visible button has real (non-zero) geometry",
      pass: Boolean(alpha) && alpha!.rect.width > 0 && alpha!.rect.height > 0,
      detail: `alpha rect=${JSON.stringify(alpha?.rect)}`,
    },
    {
      name: "side-by-side buttons have distinct x (real layout, not stubbed)",
      pass: Boolean(alpha) && Boolean(beta) && beta!.rect.x > alpha!.rect.x,
      detail: `alpha.x=${alpha?.rect.x} beta.x=${beta?.rect.x}`,
    },
    {
      name: "visible button carries its text snippet",
      pass: alpha?.textSnippet === "Alpha",
      detail: `alpha.textSnippet=${alpha?.textSnippet ?? "undefined"}`,
    },
    {
      name: "display:none span flagged hidden with a zero rect",
      pass: ghost?.hidden === true && ghost.rect.width === 0 && ghost.rect.height === 0,
      detail: `ghost.hidden=${ghost?.hidden} rect=${JSON.stringify(ghost?.rect)}`,
    },
  ];

  return { checks, nodes };
}

/**
 * The highlight-timing axis: apply a highlight and assert the browser actually PAINTS it (computed
 * outline resolves to the blue 2px solid, not just an inline string), then that it clears back to
 * the original once the TTL elapses. Resolves after the TTL so the driver gets the full lifecycle.
 */
function checkHighlightTiming(ttl: number): Promise<Check[]> {
  const alpha = byPath(["children", 0]);
  const before = computedOutline(alpha);
  applyHighlight(document, [["children", 0]], ttl);
  const painted = computedOutline(alpha);

  const paintCheck: Check = {
    name: "highlight paints a resolved 2px solid blue outline",
    pass: painted.includes(HIGHLIGHT_RGB) && painted.includes("solid") && painted.includes("2px"),
    detail: `computed outline while highlighted="${painted}"`,
  };

  return new Promise((resolve) => {
    setTimeout(() => {
      const after = computedOutline(alpha);
      const clearCheck: Check = {
        name: "highlight clears to its original outline after the TTL",
        pass: after === before && !after.includes(HIGHLIGHT_RGB),
        detail: `outline before="${before}" after="${after}"`,
      };
      resolve([paintCheck, clearCheck]);
    }, ttl + 120);
  });
}

/** Re-highlight the fixture and leave it painted (no clear) so a screenshot can capture the blue. */
function highlightForScreenshot(): void {
  applyHighlight(
    document,
    [
      ["children", 0],
      ["children", 1],
    ],
    60_000,
  );
}

interface PerceptionEval {
  runAll: (ttl?: number) => Promise<EvalReport>;
  highlightForScreenshot: () => void;
}

declare global {
  interface Window {
    perceptionEval: PerceptionEval;
  }
}

window.perceptionEval = {
  async runAll(ttl = 300) {
    buildFixture();
    const dom = checkRenderedDom();
    const timing = await checkHighlightTiming(ttl);
    const checks = [...dom.checks, ...timing];
    return { ok: checks.every((c) => c.pass), checks, nodes: dom.nodes };
  },
  highlightForScreenshot() {
    buildFixture();
    highlightForScreenshot();
  },
};

/**
 * On-page harness so the file is watchable by simply opening it in a browser — no chrome-devtools
 * driver needed: a stage that shows the live fixture, a results table, and a button that replays a
 * visible highlight paint→clear cycle. `chrome-devtools`'s `window.perceptionEval` path is
 * unaffected; this only adds a human-facing surface below it.
 */
function renderReport(report: EvalReport): void {
  const rows = report.checks
    .map(
      (c) =>
        `<tr><td>${c.pass ? "✅" : "❌"}</td><td>${c.name}</td><td><code>${c.detail}</code></td></tr>`,
    )
    .join("");
  const results = document.querySelector("#results");
  if (results) {
    results.innerHTML = `<h2>${report.ok ? "✅ PASS" : "❌ FAIL"} — ${report.checks.filter((c) => c.pass).length}/${report.checks.length} checks</h2>
      <table>${rows}</table>`;
  }
}

async function mountHarnessUi(): Promise<void> {
  // Module-load `buildFixture` already created #stage; the header/controls/results go ABOVE it.
  // Nothing else touches <body> wholesale, so `runAll` (which only clears #stage) never wipes them.
  const host = stage();
  const header = document.createElement("h1");
  header.textContent = "Perception browser eval — rendered-DOM + highlight-timing (§12.6)";
  const controls = document.createElement("div");
  controls.style.margin = "16px 0";
  const replay = document.createElement("button");
  replay.textContent = "Replay highlight (1.5s TTL)";
  replay.addEventListener("click", () => {
    applyHighlight(
      document,
      [
        ["children", 0],
        ["children", 1],
      ],
      1500,
    );
  });
  controls.append(replay);
  const results = document.createElement("div");
  results.id = "results";
  host.before(header, controls, results);

  renderReport(await window.perceptionEval.runAll(1500));
  highlightForScreenshot();
}

buildFixture();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void mountHarnessUi());
} else {
  void mountHarnessUi();
}
