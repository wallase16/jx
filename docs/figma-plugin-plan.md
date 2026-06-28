# Plan: Figma → Jx Plugin

**Status:** Phase 0 ✅ complete — next up **Phase 1 (Convert fidelity)**
**Date:** 2026-06-28
**Owner:** Gideon
**Branch:** `feat/figma-plugin` (off clean `main`)

**TL;DR** — A Figma plugin that converts Figma frames into **live, reactive Jx documents**. The
product wedge is a **trojan horse**: render the user's own design _alive_ with the real
`@jxsuite/runtime` inside the plugin iframe — the one thing Figma itself cannot do — and only then
offer a one-click **download `.jx` project** as the path into the Jx ecosystem. We deliberately do
**not** ship a static code-exporter that pushes users into Studio cold (the commoditised, losing
game every other figma-to-code tool plays).

**LOE estimate:** ~10–14 engineering-days remaining for a dev familiar with the codebase (Phase 0
already delivered in <1 day). Phases are independently shippable.

---

## Working agreement

### Turnover requirement (per-phase, mandatory)

**After completing each phase, before reporting done**, append a `Turnover (date): Phase N ✅
COMPLETE` block to that phase's section below, and update the **Status** line at the top of this
doc to point to the next phase. Each turnover block must contain:

1. **Files delivered** — a table of new/modified files and their role.
2. **Design decisions** — non-obvious choices made and why.
3. **Verification** — what was tested and the result (unit tests + at least one real Figma frame
   converted and rendered; screenshot under `docs/eval-evidence/` where visual).

Match the format of the Phase 0 turnover below (and the templates in `docs/site-cloning-plan.md`).
The plan doc is the handoff surface for the next session — without a turnover, the next agent
re-derives everything.

### Reuse policy

Depend only on **production code already on `main`**: `@jxsuite/schema` (types) and
`@jxsuite/runtime`. The `packages/import` site-cloner was rejected from `main` as too heavy and
**must not be a dependency** — when Phase 2 needs project emission, **copy the lean ~200-line core**
(`emit.ts`, the subtree-dedup idea from `componentize.ts`) into `packages/figma`, leaving behind
puppeteer/pixelmatch/style-reverse-engineering. Likewise do not branch from or merge the
`feat/ai-assistant-stack-b-v2` branch (it lost prod changes in its port).

### Style-key invariant (learned in Phase 0)

The runtime applies scalar styles via `el.style[prop] = value` (`packages/runtime/src/runtime.ts`,
`applyStyle`), so **all emitted CSS style keys must be camelCase** (`flexDirection`, not
`flex-direction`) or they silently no-op. Every mapping added in later phases must honour this.

---

## Cleanup & branch setup (pre-work)

- [x] Branch `feat/figma-plugin` created off clean `main` (released `0.32.0`), not off the
      AI/import branches.
- [x] No debris carried in: the `scratch-test-import.js`, `llm-test-1/`, and untracked
      `docs/site-cloning-guide.md` artifacts live only on the AI branch and are excluded here.
- [ ] **Commit the Phase 0 spike** on `feat/figma-plugin` (`packages/figma/**` + this plan) so the
      de-risk work is durable before fidelity work begins.
- [ ] When Phase 2 copies emit code from `packages/import`, copy **only** the lean files — re-verify
      nothing pulls `puppeteer-core`, `pixelmatch`, or `pngjs` into `packages/figma`.

---

## Phase 0: De-risk spike — conversion core + live-preview hook (✅ COMPLETE)

_Goal: prove the "it's alive inside Figma" hook is real before investing in fidelity/eject._

0. New package `packages/figma` (off `main`): pure `figmaToJx` converter, node serializer, plugin
   shell (sandbox + iframe), inline-bundled runtime.
1. Headless render proof: a converted tree mounts in the real runtime and yields correct DOM.
2. Plugin build: runtime bundles into a single self-contained `ui.html` (Figma-sandbox safe).

**Turnover (2026-06-28): Phase 0 ✅ COMPLETE.**

Built and verified end-to-end. Files delivered under `packages/figma/`:

| File                               | Role                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/convert/figma-to-jx.ts`       | Pure Figma node-tree → `JxDocument`: auto-layout→flex, solid fills→background/color, corner radius, typography, size→heading heuristic. **Emits camelCase style keys.** |
| `src/convert/serialize.ts`         | Flattens a live Figma `SceneNode` into the converter's plain input; drops `figma.mixed` symbols, reads fields defensively.                                              |
| `src/index.ts`                     | Public API re-exports.                                                                                                                                                  |
| `plugin/code.ts`                   | Sandbox entry — serializes `currentPage.selection`, posts to the UI, re-posts on `selectionchange`.                                                                     |
| `plugin/ui.ts` + `ui.html`         | Iframe — converts the node and mounts it with `Jx(doc, mount)`; status line shows element count / render errors.                                                        |
| `plugin/build.ts`                  | Bundles `code.ts` and `ui.ts` with Bun; inlines the UI bundle (runtime included) into a self-contained `dist/ui.html`.                                                  |
| `plugin/manifest.json`             | Figma plugin manifest (`networkAccess: none`, dynamic-page).                                                                                                            |
| `tests/figma-to-jx.test.ts`        | 11 tests: container/flex mapping, text+heading heuristic, colours, edge cases.                                                                                          |
| `tests/serialize.test.ts`          | 5 tests: field copy, `figma.mixed` dropping, recursion, defaults.                                                                                                       |
| `tests/render-proof.test.ts`       | **De-risk gate** — runtime mounts a `figmaToJx` tree into real (happy-dom) DOM with correct text + flex style.                                                          |
| `tests/index.test.ts`              | Public API smoke (keeps the barrel in coverage data).                                                                                                                   |
| `tests/fixtures/pricing-card.json` | Synthetic auto-layout pricing card exercising frames/text/fills/CTA.                                                                                                    |

Design decisions:

- **Two consumers, one conversion.** The preview and the (future) download must render the _exact_
  same tree, or the "it's alive" promise breaks on eject. `figmaToJx` is the single source.
- **camelCase style keys** — forced by the runtime's `applyStyle` (see invariant above); caught by
  the render-proof test failing on `flex-direction`.
- **Serialize is pure & field-driven** so it is unit-testable without the Figma runtime and copies
  only what the converter reads (keeps the postMessage payload small).
- Heading heuristic by font-size (≥32→h1, ≥24→h2, ≥18→h3) for semantic markup without a full
  type-scale pass (deferred to Phase 1).

Verification:

- `bun test --isolate --coverage` in `packages/figma`: **18+ tests pass, 100% funcs / 98% lines**;
  lint + format + `scripts/check-coverage-manifest.ts` all clean.
- `bun run build:plugin` → `dist/ui.html` ~46 KB self-contained (only `@vue/reactivity` pulled in).
- _Pending real-Figma load by Gideon_ (manifest import) — the headless gate makes this a
  formality; capture a screenshot into `docs/eval-evidence/` when done.

---

## Phase 1: Convert fidelity — recognizable medium-fidelity output (3–4 days)

_Goal: real Figma frames convert into Jx that looks like the design, not just structurally._

1. **Real fixtures.** Capture 3–4 real `figma.currentPage.selection` dumps (a marketing hero, a
   card grid, a nav bar, a form) into `tests/fixtures/`. These drive every mapping below.
2. **Geometry beyond auto-layout.** Map `layoutMode: NONE` frames using constraints / absolute
   positioning where auto-layout is absent; width/height/min/max sizing modes
   (`layoutSizingHorizontal/Vertical` → `width: 100%` / `fit-content` / fixed px).
3. **Fills & strokes.** Gradient fills → `linear-gradient(...)`; strokes → `border`; multiple fills.
4. **Image fills.** Detect `IMAGE` paints → emit `<img>`/background with a placeholder URL now;
   real asset bytes are collected in Phase 2.
5. **Effects.** Drop/inner shadows → `boxShadow`; layer blur → `filter: blur()`.
6. **Typography depth.** line-height, letter-spacing, text-decoration, text-transform; map
   `fontName.style` ("Bold"/"Medium") → `fontWeight` when numeric weight is absent.
7. **Design tokens.** Figma variables / bound styles → hoist into `project.json.$style` and emit
   `var(--token)` references (sets up Phase 2 emission). camelCase invariant applies.
8. **Vectors.** `VECTOR`/`BOOLEAN_OPERATION` → inline SVG or a sized placeholder (decide; SVG export
   needs the sandbox `exportAsync` API — record the trade-off in the turnover).

Tests: one per mapping, fixture-driven; extend `render-proof` to assert each new style lands in DOM.

**Turnover (date): Phase 1 ✅ COMPLETE.** _(required — see Working agreement)_

---

## Phase 2: Download / eject to a `.jx` project (2–3 days)

_Goal: the funnel into the ecosystem — turn the live preview into a real project the user keeps._

1. **Lean emit core.** Copy the project-emission logic from `packages/import/src/emit.ts` into
   `packages/figma/src/emit/` (project.json + pages + components + public layout). **Strip all
   puppeteer/asset-download/style-diff weight.** Build the file map **in memory** — the iframe has
   no `node:fs`/`Bun.write`.
2. **Zip in the UI.** Bundle the in-memory project into a zip and trigger a browser download from
   the plugin iframe (a small zip lib, or hand-rolled store-only zip — keep deps minimal).
3. **Image assets.** For `IMAGE` paints, pull bytes via the sandbox `image.getBytesAsync()`, route
   into `public/`, and rewrite Phase 1's placeholder URLs to local paths.
4. **`$style` tokens.** Emit the Phase 1 design tokens into `project.json.$style`.
5. **Round-trip check.** The downloaded project must open in Studio and render identically to the
   in-plugin preview (single-conversion invariant).

Tests: emit-to-memory unit tests; a fixture → full project map → schema-validate every emitted doc.

**Turnover (date): Phase 2 ✅ COMPLETE.** _(required)_

---

## Phase 3: Components & reactivity — the differentiator (3–4 days)

_Goal: the design system becomes a real, reactive Jx component set — what no exporter can do._

1. **Instances → components.** `COMPONENT`/`INSTANCE` → Jx components emitted under `components/`,
   with instances replaced by element refs (Figma already gives the reuse boundaries — leverage
   `mainComponent`/`componentId`, fall back to subtree-hash dedup from `import/componentize.ts`).
2. **Component properties → `$props`.** Map Figma component properties (TEXT/BOOLEAN/INSTANCE-swap)
   to Jx `$props`, so an instance's overrides become prop values.
3. **Variants → reactive state.** Map a component's variant set to a `state` field + conditional
   styling/markup, so the "hover"/"active"/"open" variants become **real interactions** in the
   live preview. This is the headline demo: _your variants are now working states._
4. **Demo wiring.** Pick the strongest variant story (button hover, toggle, tab switch) and ensure
   it's interactive in the in-Figma preview.

Tests: instance-dedup, prop extraction, variant→state mapping; render-proof asserts an interaction
(e.g. dispatch a click, assert DOM state change).

**Turnover (date): Phase 3 ✅ COMPLETE.** _(required)_

---

## Phase 4: Plugin UX polish & publish prep (2–3 days)

_Goal: a shippable plugin that sells the wedge and funnels to the ecosystem._

1. **Preview UX.** Static-vs-live toggle, responsive resize affordance (drag to prove
   responsiveness), loading/empty/error states, multi-frame selection handling.
2. **Eject CTA.** Clear "Download `.jx` project" + "Open in Jx Studio" calls-to-action positioned
   _after_ the user has felt the live preview.
3. **Branding & copy.** Plugin name, icon, cover art, store description framing the trojan-horse
   pitch ("your design, alive").
4. **Figma submission prep.** Manifest review, permissions minimization, plugin-store assets,
   README for reviewers.

Tests: UI smoke where feasible; manual run-through checklist documented in the turnover.

**Turnover (date): Phase 4 ✅ COMPLETE.** _(required)_

---

## Out of scope (backlog)

- Push-to-running-Studio eject (needs a platform-routed endpoint — revisit after download path).
- Multi-page Figma → multi-page Jx site mapping (pages from Figma sections/frames).
- AI componentization pass (naming/semantic grouping) à la `import/ai-componentize.ts`.
- Pixel-diff fidelity verification harness (the `import/verify.ts` approach) — only if fidelity
  complaints warrant it.
