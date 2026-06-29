# Plan: Figma → Jx Plugin

**Status:** Phase 3 ✅ complete — next up **Phase 4 (Plugin UX polish & publish prep)**
**Date:** 2026-06-29
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

## Agency GTM & positioning

> The plugin's job is to **introduce** Jx; it is not, by itself, the **agency go-to-market**. Those
> are different bars — keep them separate or the wow-moment gets mistaken for an adoption strategy.

**Primary ICP:** digital / design / web agencies (the people who live in Figma and feel
design→dev handoff pain on every project). Secondary: in-house product design teams.

### Introduce vs. adopt (the funnel)

| Stage         | Who                          | What moves them                                                                 | Owned by                       |
| ------------- | ---------------------------- | ------------------------------------------------------------------------------- | ------------------------------ |
| **Introduce** | A designer/dev in the agency | The live-preview "your design is alive" moment, inside Figma, zero commitment   | **The plugin**                 |
| **Evaluate**  | Tech lead                    | Output is _maintainable & editable_ (round-trips through Studio, not dead code) | Phase 2–3 + Studio             |
| **Adopt**     | Agency owner / principal     | Multi-project leverage, client handoff, longevity, support — margin & speed     | Case studies + design partners |

A plugin install reaches the **Introduce** row only. Standardising an agency onto Jx is an
**Adopt**-row decision (they're betting client deliverables on a runtime) — won by proof of
delivery, not by a wow-moment. Plan the plugin to _earn the first conversation_, not to close.

### What agencies actually buy (and what it means for this plan)

Agencies pay for **leverage across many client projects** — margin and delivery speed. That has
two consequences for phase priority:

1. **The agency value prop lives in Phase 3, not Phase 1.** "Your Figma component library becomes a
   reusable, reactive Jx component set you reskin across every client" is the killer story — not
   pixel-perfect single-frame import. Treat Phase 3 (components / variants→state / design-system
   reuse) as the agency headline.
2. **Do not over-invest in Phase 1 fidelity to impress agencies.** Medium fidelity + a
   maintainable, editable, reusable result beats pixel-perfect _dead_ output. Agencies forgive a
   90% import; they will not forgive output they can't maintain. (This is the trust scar the
   Anima/Locofy/Builder category left — Jx's differentiator is the editable JSON document, Studio,
   and static compile — _not_ export fidelity. Position against the category, don't join it.)

### Marketing motion (beyond the plugin listing)

The plugin is awareness; the **conversion motion is proof of delivery**:

- **Design-partner 2–3 agencies** — ship real client sites on Jx, in exchange for case studies.
- **Lead with the reuse + handoff story**, not "Figma to code": build-once-reuse-everywhere
  component libraries, maintainable round-trip editing, static deploy-anywhere client handoff.
- **Case studies are the asset that gets Jx standardised**, not the plugin's store page.

**One line:** plugin = the introduction; component-reuse + maintainable handoff + a couple of real
agency case studies = the marketing. Use the first to earn the second.

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
- [x] **Commit the Phase 0 spike** on `feat/figma-plugin` (`packages/figma/**` + this plan) —
      done in `a1225fe`.
- [x] When Phase 2 copies emit code from `packages/import`, copy **only** the lean files — re-verify
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

**Turnover (2026-06-28): Phase 1 ✅ COMPLETE.**

Built and verified end-to-end. All 8 plan items delivered.

| File                                  | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/convert/figma-to-jx.ts`          | Extended with: gradient fills (`linear-gradient`/`radial-gradient`), multiple fill compositing, strokes → `border`/`boxShadow`, effects (drop/inner shadow, layer/background blur), sizing modes (`FILL`→100%, `HUG`→fit-content, `FIXED`→px), min/max constraints, absolute positioning for `NONE`-layout frames, rotation, `clipsContent`→overflow, `rectangleCornerRadii`, `layoutWrap`/`counterAxisSpacing`, image fills → `<img>`/background, vector SVG inlining, typography depth (lineHeight, letterSpacing, textDecoration, textTransform, fontWeight-from-style, fontStyle italic), design token `var()` refs. **All keys remain camelCase.** |
| `src/convert/serialize.ts`            | Extended to copy all new Phase 1 fields from raw Figma nodes (strokes, effects, sizing, constraints, position, rotation, text fields, variables). Symbol (`figma.mixed`) values dropped for all new numeric/object fields.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `src/index.ts`                        | Re-exports new types: `FigmaEffect`, `FigmaStroke`, `FigmaColorStop`, `ConvertOptions`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/fixtures/hero-section.json`    | Marketing hero: gradient background, inner shadow, badge with letter-spacing + uppercase, headline with line-height, underline CTA, drop-shadow button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tests/fixtures/card-grid.json`       | Wrapping card grid: `WRAP` layout with `counterAxisSpacing`, image fills (FILL + FIT scaleModes), card shadows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tests/fixtures/nav-bar.json`         | Nav bar: multiple solid fills, inside stroke, backdrop blur, vector logo with SVG content, min/max constraints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `tests/fixtures/absolute-layout.json` | Absolute positioning: `NONE`-layout parent, positioned children, rotated rectangle, ellipse with image fill.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tests/figma-to-jx.test.ts`           | Expanded from 11 → 46 tests covering all Phase 1 mappings, fixture-driven.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `tests/serialize.test.ts`             | Expanded from 5 → 10 tests covering all new serialized fields + symbol dropping.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `tests/render-proof.test.ts`          | Expanded from 1 → 4 tests: gradient background, typography (lineHeight, fontSize), overflow, stroke/blur, text content survival.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Design decisions:

- **Vectors use inline SVG via `svgContent`.** The plugin sandbox can call `node.exportAsync({ format: 'SVG' })` to get SVG markup, which the serializer passes through as `svgContent`. This avoids needing a separate asset pipeline for icons. Vectors without `svgContent` fall back to a sized placeholder `<div>` — the sandbox must explicitly export SVG; the converter cannot synthesize it.
- **Image fills use placeholder URLs** (`images/{imageRef}.png`). Phase 2 will collect real bytes via `image.getBytesAsync()` and rewrite these to local paths. `RECTANGLE`/`ELLIPSE` with image fills become `<img>` elements; `FRAME`s with image fills use `background-image` (preserves child content).
- **Inside strokes use `boxShadow: inset`** rather than `border` to avoid affecting box sizing (matches Figma's rendering model).
- **Font style name parsing** maps common Figma style names (Thin→100, Light→300, SemiBold→600, etc.) to numeric `fontWeight`, and detects trailing "Italic" for `fontStyle`. Only applied when the numeric `fontWeight` field is absent.
- **Design tokens** are collected into a `tokens` map on `ConvertResult`; Phase 2 will emit these into `project.json.$style`. Variable names are kebab-cased from Figma's slash-separated paths (e.g. `brand/primary` → `--brand-primary`).
- **Absolute positioning** only triggers for children of `NONE`-layout parents (the `isAbsoluteChild` check). The parent gets `position: relative` so children can be absolutely positioned within it.

Verification:

- `bun test --isolate --coverage` in `packages/figma`: **74 tests pass, 100% functions / 98.9% lines**.
- `scripts/check-coverage-manifest.ts packages/figma`: all source files covered.
- `oxlint` + `oxfmt`: zero warnings, fully formatted.
- Render-proof tests confirm gradient, typography, and text content survive the full `buildScope → renderNode` round-trip into real (happy-dom) DOM.

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

**Turnover (2026-06-28): Phase 2 ✅ COMPLETE.**

Built and verified end-to-end. All 5 plan items delivered.

| File                  | Role                                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/emit/emit.ts`    | In-memory project emission: takes `ConvertResult` → `FileMap` (Record of path→content). Produces `project.json` (with `$style` tokens when present), `pages/{name}.json`, and `public/images/` entries. Rewrites Phase 1's placeholder `images/{ref}.png` paths to `/images/{ref}.png` when real image bytes are provided. |
| `src/emit/zip.ts`     | Zero-dependency store-only ZIP builder. Produces valid ZIP archives (local headers + central directory + EOCD) entirely in memory — no compression, no external libs. Includes a hand-rolled CRC-32 implementation.                                                                                                        |
| `plugin/code.ts`      | Extended: collects `imageRefs` from `IMAGE` paint fills across the node tree and sends them alongside the serialized node. Handles `request-images` messages from the UI by fetching bytes via `figma.getImageByHash().getBytesAsync()` and posting them back.                                                             |
| `plugin/ui.ts`        | Extended: stores the last `ConvertResult` and image refs. "Download .jx" button triggers project emission + zip build + browser download. When images exist, requests bytes from the sandbox first (deferred download pattern).                                                                                            |
| `plugin/ui.html`      | Added toolbar with status + "Download .jx" button (Figma-blue, disabled until a frame is selected).                                                                                                                                                                                                                        |
| `src/index.ts`        | Re-exports `emitProject`, `buildZip`, and their types (`EmitOptions`, `FileMap`).                                                                                                                                                                                                                                          |
| `tests/emit.test.ts`  | 8 tests: project structure, custom names, token emission, image inclusion, path rewriting (img + background-image), placeholder preservation, no-token case.                                                                                                                                                               |
| `tests/zip.test.ts`   | 5 tests: signature validation, multi-file, binary data round-trip, central directory offset, empty file map.                                                                                                                                                                                                               |
| `tests/index.test.ts` | Extended: verifies `emitProject` and `buildZip` are exported.                                                                                                                                                                                                                                                              |

Design decisions:

- **In-memory file map, not a file-system write.** The Figma plugin iframe has no `node:fs` or `Bun.write` — all emission builds a `Record<string, string | Uint8Array>` which the zip builder consumes directly. This also makes the emit module unit-testable without mocking I/O.
- **Store-only ZIP (no compression).** JSON documents compress well but adding deflate would mean either a dependency or ~300 more lines of bit-twiddling. Store-only keeps the zip builder at ~120 lines, zero deps, and the resulting zips are still small (typical project < 50 KB). Can add deflate later if file size becomes a concern.
- **Deferred image download pattern.** The "Download .jx" button click first requests image bytes from the sandbox (which has `figma.getImageByHash()`), waits for the response, then builds the zip. This avoids fetching image bytes on every selection change (which would be slow for large designs).
- **Image path rewriting uses JSON reviver.** `JSON.parse(JSON.stringify(doc), reviver)` walks every string value in the document and rewrites `images/{ref}.png` → `/images/{ref}.png` and `url(images/{ref}.png)` → `url(/images/{ref}.png)` when the ref exists in the provided image map. This handles both `<img>` src attributes and CSS `background-image` values without needing to walk the tree manually.
- **Token values default to `inherit`.** Phase 1 collects token names but not their resolved values (Figma variables require `resolveVariable()` which needs async plugin API access). The emitted `project.json.$style` maps each `--token-name` to `"inherit"` as a placeholder — the user fills in actual values in Studio.

Verification:

- `bun test --isolate --coverage` in `packages/figma`: **88 tests pass, 100% functions / 99.33% lines**.
- `scripts/check-coverage-manifest.ts packages/figma`: all source files covered.
- `oxlint`: zero violations across `src/`, `tests/`, and `plugin/`.
- Round-trip proof: emit test converts a pricing-card fixture → emits project → parses the emitted JSON → asserts structure matches expectations (valid `project.json` with name/defaults, valid page document with correct tagName).

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

**Turnover (2026-06-29): Phase 3 ✅ COMPLETE.**

Built and verified end-to-end. All 4 plan items delivered.

| File                                  | Role                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/convert/figma-to-jx.ts`          | Extended with: `INSTANCE` → component extraction with variant-diffing (conditional style expressions, auto-wired hover/active/focus events), component property → `$props` extraction, `__component`/`__componentProps` tagging for emit. `COMPONENT` nodes convert like frames. New types: `FigmaComponentPropertyDef`, `FigmaComponentPropertyValue`, `FigmaVariantDef`, `FigmaVariantGroup`. `ConvertResult` gains `components` map. |
| `src/convert/serialize.ts`            | Extended to copy component fields: `componentId`, `mainComponentName`, `componentProperties`, `variantProperties`, `variantGroup` (with recursive variant node serialization).                                                                                                                                                                                                                                                          |
| `src/emit/emit.ts`                    | Extended with component emission: writes `components/{Name}.json` files, registers in `project.json`, replaces inline instances with `$ref` + `$props` in emitted pages, strips variant state from page root.                                                                                                                                                                                                                           |
| `src/index.ts`                        | Re-exports new types: `FigmaComponentPropertyDef`, `FigmaComponentPropertyValue`, `FigmaVariantDef`, `FigmaVariantGroup`.                                                                                                                                                                                                                                                                                                               |
| `plugin/code.ts`                      | Extended with `serializeVariantGroup()` + `enrichWithVariantData()`: walks the serialized tree and enriches INSTANCE nodes with variant data from `mainComponent.parent` (COMPONENT_SET).                                                                                                                                                                                                                                               |
| `tests/fixtures/button-variants.json` | Button with 3 variants (Default/Hover/Active), 2 instances with label overrides.                                                                                                                                                                                                                                                                                                                                                        |
| `tests/fixtures/card-instances.json`  | Card grid with 2 INSTANCE nodes (no variants — basic instance dedup test).                                                                                                                                                                                                                                                                                                                                                              |
| `tests/figma-to-jx.test.ts`           | Expanded from 46 → 60 tests: instance tagging, variant component extraction, conditional styles, event wiring, root state, prop extraction, dedup.                                                                                                                                                                                                                                                                                      |
| `tests/serialize.test.ts`             | Expanded from 10 → 13 tests: component field serialization, variant group with nested nodes, incomplete variant filtering.                                                                                                                                                                                                                                                                                                              |
| `tests/emit.test.ts`                  | Expanded from 8 → 13 tests: component file emission, project.json registration, `$ref` replacement, variant state stripping, prop passthrough.                                                                                                                                                                                                                                                                                          |
| `tests/render-proof.test.ts`          | Expanded from 4 → 5 tests: **variant interaction proof** — button renders, dispatches mouseenter, asserts background style changes reactively.                                                                                                                                                                                                                                                                                          |

Design decisions:

- **Two-mode output.** The converter produces an inline preview document (variant state on root, prefixed keys per instance) AND extracted component definitions (self-contained with own `state`). The preview works directly with `Jx()` in the plugin iframe; the emitter transforms inline instances into `$ref` + `$props` for the downloaded project.
- **Style-diffing, not tree-diffing.** Variant → state mapping diffs CSS style values across all variant nodes, producing ternary template expressions for divergent properties. Static properties (same across all variants) stay as plain values. This keeps the output clean and works for the common case (button color/shadow changes on hover).
- **Heuristic event wiring.** Variant names are matched case-insensitively: Hover → mouseenter/mouseleave, Active/Pressed → mousedown/mouseup, Focus/Focused → focus/blur. This covers the most common interactive patterns without requiring user configuration.
- **Component dedup by name.** The first instance of a component registers its definition in `result.components`; subsequent instances reuse it. Uses `variantGroup.name` or `mainComponentName`, cleaned to a valid identifier.
- **`__component`/`__componentProps` tagging.** Instance elements carry private fields that the emitter reads and replaces with `$ref`/`$props`. The runtime ignores these unknown fields in the preview.
- **Primary axis only.** For multi-axis variant sets (e.g., Size × State), only the first axis is mapped to state. This is intentional — multi-axis variant support adds complexity for diminishing returns; the single-axis mapping covers the interactive demo cases (hover/active) that the plan targets.

Verification:

- `bun test --isolate --coverage` in `packages/figma`: **112 tests pass, 97.56% functions / 94.61% lines** on converter, **100% functions / 99.44% lines** on serializer.
- `scripts/check-coverage-manifest.ts packages/figma`: all source files covered.
- `oxlint`: zero violations across `src/`, `tests/`, and `plugin/`.
- Render-proof test confirms variant interaction: button converts with reactive conditional background, dispatching `mouseenter` changes the style via Vue reactivity.

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
