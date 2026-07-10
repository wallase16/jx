# Assistant SDK + Canvas-Awareness — Plan

**Status:** Phase 0 (spec authoring) not yet started — this doc is the plan of record
**Date:** 2026-07-09
**Owner:** Gideon
**Branch:** `feat/assistant-sdk-spec` (off `upstream/main`)
**Relates to:** `specs/ai-assistant.md` (to be authored — this plan's Phase 0 output),
`docs/strategy-brief.md`, `docs/ai-assistant-headless-harness.md`,
`packages/studio/src/services/{ai-tools,tool-executor,ai-system-prompt}.ts`,
`packages/studio/src/canvas/iframe-protocol.ts`, `specs/extensions.md`

> Committed to the repo for agent turnovers. The strategy rationale for why this initiative
> matters commercially lives in `docs/strategy-brief.md` (§1 "wow" factors, §5 backbone).

---

## Context

Two goals, in tension:

- **A. Quality ceiling:** evolve the assistant + evals until the LLM writes "perfect Jx" —
  builds components and makes changes with awareness of the current selection and what's
  actually rendered in the canvas ("intuitively understands intent").
- **B. Extensibility:** separate the AI from the canvas/studio so the assistant core ships
  as an SDK (and later an API) for extending Jx into other contexts — CLI, integrations,
  areas "realized or unrealized."

Resolution (validated against the code): a **host-interface / capability pattern**. The
assistant core consumes a formal `AssistantHost`; canvas perception is an _optional_
capability on that host. The core never imports canvas modules — goal A's perception and
goal B's decoupling stop being in tension. Precedent already in the code: `ai-tools.ts`
tools like `create_component`/`open_document` already degrade to "not available in this
environment" when their injected dep (`saveFile`/`openDocument`) is absent, and the
headless-harness doc §4 already declares "The SDK is: that injected contract, documented,
with two reference wirings — studio and headless."

Session findings the plan builds on:

- `@jxsuite/ai` is already SDK-shaped (sole dep `@vue/reactivity`, clean exports). The
  Jx-specific pieces (12 tools, system prompt, agent loop, context manager, validate) live
  in `packages/studio/src/services/` — they are the extraction targets. Real coupling:
  `ai-tools.ts` imports `tabs/transact` mutators + `Tab`; `tool-executor.ts` imports
  `beginBatch`/`endBatch`; `ai-system-prompt.ts` imports `VOID_ELEMENTS`/`flattenTree`.
- Upstream's iframe canvas has the perception primitives (`data-jx-path` stamping,
  `measure`→`geometry`, `tab.session.selection`) but NO bulk rendered-tree enumeration, and
  zero AI↔canvas wiring beyond a manual "attach selected element" chip.
- Extensions v2 (upstream tip) has no AI extension point; dep rules allow extension→core,
  so extension-contributed tools are a legal later phase.
- Evals on upstream/main today: task suite 4/4; headless 15/17 (fails L3.4 component
  creation, L5.3 `$map`/`$switch`); Recovery axis stuck at its floor of 3.
- **Confirmed upstream bug:** `packages/studio/tests/harness/score.ts:188`
  `structuredClone(tab.doc.document)` throws DataCloneError on the reactive proxy; the fix
  `structuredClone(toRaw(...))` is proven (full 17-layer eval ran green). The fix currently
  lives **uncommitted in a separate eval worktree** — salvage it for Phase 1, don't
  re-derive. The bug is real on `upstream/main` (verified via `git show`).
- `specs/ai-assistant.md` exists ONLY on the old local `feat/ai-assistant-stack-b` branch —
  `upstream/main` has no assistant spec. Phase 0 ports + revises it here.

## Package decision: new `@jxsuite/assistant`

Keep `@jxsuite/ai` exactly as chartered (provider-agnostic, `@vue/reactivity`-only). Create
a new core package `packages/assistant` (`@jxsuite/assistant`), deps: `@jxsuite/ai`,
`@jxsuite/schema`, `ajv`, `ajv-formats`. Rationale: deps are package-scoped, so a second
entry point on `@jxsuite/ai` would break its charter for every consumer; separate semver
streams (infra stable, assistant churning); one obvious import target for future extensions.

- **Moves into `packages/assistant`:** `host.ts` (the interface), `tools.ts` (from
  `ai-tools.ts`, calling `host.document.*`), `system-prompt.ts` (absorbs
  `VOID_ELEMENTS`/`flattenTree`), `agent-loop.ts` (from `tool-executor.ts`; batching via
  `host.document.beginBatch`), `context-manager.ts`, `validate.ts`, `token-lint.ts`.
- **Stays studio-side:** `document-assistant.ts` (becomes the studio host impl),
  `ai-settings`, `ai-session-store`, `render-critic`, all `panels/ai-chat/` UI.

## The `AssistantHost` seam

Required `document` capability (getDocument / getNodeAtPath / beginBatch / endBatch /
insertNode / removeNode / moveNode / updateProperty / updateStyle / updateState); optional
`validation`, `files`, `project`, `renderCheck`, `perception`. Replaces today's two
injection sites — `registerAiTools(registry, {...})` and `runAgentLoop({..., getTab?})`.

Absent-capability semantics: all tools always registered; a tool whose capability is missing
returns `{ok:false, error:"<X> is not available in this environment."}`; `buildSystemPrompt`
gains an "Environment capabilities" line so the model rarely calls a dead tool. Two reference
hosts: studio (delegates to `tabs/transact`, render-critic, workspace) and headless (the
harness wiring in `tests/harness/real-llm.ts`).

## Perception capability (canvas awareness)

- `PerceptionCapability`: `getSelection()` (from `tab.session.selection`),
  `getRenderedTree(opts?)`, `measure(paths)`, optional `highlight(paths)`.
- Protocol additions to `canvas/iframe-protocol.ts`: ParentToIframe `enumerate`
  (reqId-correlated) → IframeToParent `renderedTree`
  (`{path, tagName, rect, textSnippet?, childCount, hidden?}[]`, built by walking
  `data-jx-path` elements); ParentToIframe `highlight` (paths + ttl). `measure`→`geometry`
  already exists.
- Studio impl: new `packages/studio/src/canvas/perception-host.ts`.
- Three new tools in `@jxsuite/assistant`: `get_selection`, `describe_canvas`,
  `measure_nodes` — all via `host.perception`, degrade gracefully headless.
- Automatic selection context: on each send, if a selection exists, prepend an ephemeral
  context block to the user turn (generalizes today's manual chip; chip remains as the
  opt-out affordance). Post-tool highlight: loop collects touched paths, calls
  `host.perception?.highlight(paths)` after `endBatch`.

## SDK vs API — decision: SDK now, API later on top of the SDK

Tool execution is inherently host-side (mutates the in-memory reactive doc so AI edits share
undo history). A server-executing API needs a server-side document session — an optional
Phase 5 ("headless project-editing service"), cheap _because_ it's just `@jxsuite/assistant`
plus a Node host (the harness already prototypes that host). Transport/credentials for SDK
consumers are already solved: `/__studio/ai/chat` proxy + managed mode, or
`createOpenAIStreamingClient` direct. Extensions v2 later contributes tools via a new
`assistant` admission block (extension→core is legal).

## Phases

- **Phase 0 — Spec:** author `specs/ai-assistant.md` here (port + revise the old local spec;
  §11 → "Packages & the AssistantHost seam", add perception + SDK/API sections, fold the
  roadmap into §12). Doc-only; the deliverable of the current planning cycle.
- **Phase 1 — Eval hardening:** commit the `score.ts` `toRaw` fix (salvage from the eval
  worktree); port the local-only `docs/ai-assistant-*.md` family + 5 local-only example
  fixtures (`card-with-observed-attrs`, `dynamic-task-list`, `user-profile`, `page-shell`,
  `blog/[slug]` — they double as few-shot sources); close L3.4/L5.3 with few-shot exemplars
  in the system prompt; recalibrate the Recovery axis with injected faults. Gate: 17/17
  headless.
- **Phase 2 — Seam extraction:** create `packages/assistant`, move the modules, convert
  studio + harness to host impls. Pure refactor; eval parity is the gate.
- **Phase 3 — Perception (launch milestone):** protocol messages, `perception-host.ts`,
  three tools, auto-selection context, highlight feedback; new L6 eval layer (mock
  `PerceptionCapability` with preset selection — "make THIS button larger" asserts the
  mutation lands at the selected path; component-detection assertions — model reuses an
  existing component tag instead of re-authoring markup). Rendered-DOM axes stay in the
  chrome-devtools browser eval.
- **Phase 4 — Extensibility:** publish `@jxsuite/assistant`, CLI reference host, extensions
  `assistant` admission block.
- **Phase 5 (optional):** server-side document-session API.

## Verification (per phase)

- Phase 0: spec renders clean, `oxfmt specs/ai-assistant.md` passes, every interface sketch
  cross-checked against the real signatures in the files listed under _Relates to_ (no
  invented parameters).
- Phases 1–3: `cd packages/studio && bun run eval:headless` (worst-of-3) and `bun run eval`
  are the regression gates; Phase 2 requires exact eval parity (behavior-preserving
  refactor); Phase 3 adds the L6 perception layer + chrome-devtools browser eval for the
  rendered-DOM/highlight axes.
- Never push or open a PR without asking the user.

## Turnover log

- **2026-07-09 — Plan authored.** Researched upstream vs local alignment (AI stack merged
  via PR #66, TS port), ran both eval harnesses on `upstream/main` (task 4/4; headless 15/17
  after fixing the `score.ts` clone bug), designed the `AssistantHost` + perception
  architecture, evaluated package shape (→ new `@jxsuite/assistant`). No code written yet.
  Next: Phase 0, author `specs/ai-assistant.md` on this branch.
