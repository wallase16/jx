# Assistant SDK + Canvas-Awareness — Plan

**Status:** Phases 0–1 complete — `specs/ai-assistant.md` is authored; eval hardening done
(19/19 headless, worst-of-3). Phase 2 (seam extraction) is next.
**Date:** 2026-07-10
**Owner:** Gideon
**Branch:** `feat/assistant-sdk-spec` (off `upstream/main`)
**Relates to:** `specs/ai-assistant.md` (this plan's Phase 0 output — done),
`docs/strategy-brief.md`, `docs/ai-assistant-headless-harness.md` (Phase 1 output — done, now
committed on this branch along with the rest of the `docs/ai-assistant-*.md` family),
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

- **Phase 0 — Spec: done.** Authored `specs/ai-assistant.md` (port + revise the old local
  spec; §11 → "Packages & the AssistantHost seam", §12 perception, §13 SDK vs API, §14 folds
  the roadmap). Doc-only.
- **Phase 1 — Eval hardening: done.** The `score.ts` `toRaw` fix was already committed
  (`0ebd74a4`) before this phase started. Ported the `docs/ai-assistant-*.md` family + the 5
  example fixtures. L3.4/L5.3 closed — L5.3's root cause was a real schema/runtime mismatch
  ($switch), not a prompt gap; L3.4 needed one system-prompt rule (semantic HTML), not a
  few-shot rewrite. Recovery axis recalibrated with a new injected-fault test (L4.6). Gate:
  **19/19 headless** (worst-of-3, 18 original tests + L4.6). Full turnover:
  `docs/ai-assistant-headless-harness.md` §6.
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
- **2026-07-09 — Phase 0 done.** Authored `specs/ai-assistant.md` (14 sections, ~880 lines).
  Read every source file the spec makes claims about (`ai-tools.ts`, `tool-executor.ts`,
  `ai-system-prompt.ts`, `document-assistant.ts`, `context-manager.ts`, `jx-validate.ts`,
  `render-critic.ts`, `token-lint.ts`, `ai-settings.ts`, `ai-session-store.ts`, all of
  `packages/ai/src/`, `packages/server/src/ai-api.ts`, `canvas/iframe-protocol.ts`,
  `panels/ai-panel.ts` + `panels/ai-chat/*`, `specs/extensions.md` §2/§6,
  `tests/harness/real-llm.ts`) rather than trusting the old draft or the plan's own summaries.
  Found and corrected real drift from the old local spec, not just cosmetic updates:
  - **§3 Chat Panel UX was wrong at the architecture level.** The old spec described a
    resizable bottom panel with an overlay fallback below 900px and a `Ctrl+L` shortcut —
    none of that exists. The assistant is actually a tab in the **right panel**
    (`right-panel.ts`) alongside Properties/Events/Style, with its own key-gate → sessions ↔
    chat view-state machine (`ai-panel.ts`). Rewrote §3 from the real component tree.
  - **Session persistence is multi-session, not single-conversation** — `ai-session-store.ts`
    (project-scoped index + one payload key per session, 20-session cap) postdates the old
    spec's single `localStorage` key design. §7.2 rewritten accordingly.
  - **The batched Accept/Reject diff preview was already superseded** by optimistic apply
    before the old spec was even written (its own §8 said so) — kept as §8.2 "superseded, for
    reference" only, per the old doc's own framing.
  - The `score.ts` `structuredClone`/`toRaw` fix that Phase 1 is chartered to "salvage from the
    eval worktree" **is already committed** on this branch (`0ebd74a4`) — noted in both the
    Phases list above and §14.1 of the spec so Phase 1 doesn't re-derive it.
  - `docs/strategy-brief.md` and `docs/ai-assistant-headless-harness.md` (cited under _Relates
    to_ above) don't exist in this worktree — they live on `feat/ai-assistant-stack-b-v2` and a
    separate local clone at `/home/gideon/Dev/jx`. Read both for grounding (confirmed the
    `AssistantHost`/perception rationale and the harness's real file layout match what's
    described here) without copying them in — that copy is explicitly Phase 1's job.
  - New §12 (Perception) and §13 (SDK vs API) are clearly labeled **not yet built** — every
    interface in them (`PerceptionCapability`, the `enumerate`/`renderedTree`/`highlight`
    protocol messages) is a Phase 3 target, cross-checked against what `iframe-protocol.ts`
    already has (`measure`/`geometry` exists; bulk enumerate doesn't) so the target isn't
    invented from nothing.
  - Ran `oxfmt specs/ai-assistant.md` clean (twice, after a manual diagram touch-up).
    Next: Phase 1 — eval hardening (port the `docs/ai-assistant-*.md` family + 5 fixtures from
    the old branches, close L3.4/L5.3, recalibrate Recovery). The `toRaw` fix sub-item is
    already done; scope Phase 1's kickoff to the rest.
- **2026-07-10 — Phase 1 done.** Full turnover in `docs/ai-assistant-headless-harness.md` §6;
  summary here. Ran the eval suite cold first rather than trusting the plan's stated 15/17 —
  found L5.3 genuinely failing (L3.4 passed single-run but flaked under worst-of-3). Both
  turned out to be real bugs, not prompt gaps:
  - **L5.3 root cause:** `$switch` was unbuildable — two orphaned-wiring bugs in
    `packages/schema` (`SwitchNode` never wired into the children-array union; `switchDefSchema`
    required an `InternalRef` `$ref` instead of `StateRef`). These are the exact fixes a
    `2026-06-20b` session on `feat/ai-assistant-stack-b-v2` already made and verified — they
    just never reached `upstream/main`. Re-applied them; `examples/components/router.json`
    (previously invalid on this branch) now validates.
  - **A second schema bug, not previously known**, surfaced while porting the 5 example
    fixtures: `dynamic-task-list.json` failed on a `PropsObject` `oneOf` ambiguity (a
    `{ "$ref": ... }` prop value is simultaneously a plain object and a `RefObject`, so
    `oneOf`'s exactly-one constraint rejected every ref-valued prop) — this is the very bug
    `docs/ai-assistant-decision.md` §6b flagged as a known-but-unfixed upstream issue. Fixed
    (`oneOf` → `anyOf`). `examples/pages/blog/[slug].json` stays invalid (unrelated
    Markdown-content-pipeline gap, out of scope, ported as-is and flagged).
  - **L3.4 root cause:** not a bug — the model just wasn't reliably reusing the semantic `<nav>`
    convention already visible in `nav-bar.json`'s "Available Components" context. One new
    `DESIGN_PRINCIPLES` rule (Semantic HTML) fixed it; 3/3 after.
  - **Recovery recalibration:** added `L4.6`, a deterministic injected fault (an `update_state`
    call on a fixture with no `state` object at all, guaranteed to hit `{ success: false }`)
    distinct in kind from L4.5's path-based fault — Recovery axis now has two independent,
    reliable exercises instead of one.
  - Gate: **19/19 Completeness 5** at worst-of-3 (18 original + L4.6). `bun run typecheck` /
    `bun run lint` clean; `packages/studio` 3670/3670; `packages/schema` 115/115 at 100%
    coverage. One flake logged, not chased: L5.2 scored Undo 1 on one of three runs
    (non-deterministic, batch-size-correlated, and Undo is an explicitly browser-owned
    partial-signal axis in `score.ts` by design) — flagged for whoever next touches
    `beginBatch`/`endBatch` (candidate: Phase 2, since batching moves into `AssistantHost`).
  - Docs family (`ai-assistant-{decision,testing-plan,premium-components-plan,headless-harness}.md`)
    and the 5 example fixtures are now committed on this branch, ported from
    `feat/ai-assistant-stack-b-v2` with provenance notes at the top of each.
  - Next: Phase 2 — seam extraction into `packages/assistant` per `specs/ai-assistant.md` §11
    (pure refactor; eval parity — re-run this same 19-test gate — is the acceptance bar).
