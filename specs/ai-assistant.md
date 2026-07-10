# `@jxsuite/ai` + Studio AI Assistant Specification

## LLM-Powered Chat Builder for Jx Documents

**Version:** 2.0.0-draft
**Status:** Describes the implementation on `upstream/main` as of this branch, plus the
target architecture for Phases 2–4 (not yet built — see §14).
**License:** MIT

> This is the Phase 0 deliverable of `docs/assistant-sdk-perception-plan.md`: a port +
> revision of the spec that previously existed only on the local `feat/ai-assistant-stack-b`
> branch, brought current against the TS port that actually shipped and extended with the
> `AssistantHost` seam and canvas-perception architecture the plan calls for.
>
> **Read the status of each part correctly:** §§1–10 describe the **shipped** system, and every
> interface there is checked against the cited source file. §§11–13 (the `AssistantHost` seam,
> `PerceptionCapability`, the SDK/API decision) are the **design of record for Phases 2–4 —
> proposals, not yet built.** Their interface sketches are _derived from_ the real injection
> sites they replace, but the exact shapes are settled during implementation, not here; §11.3
> and §12 call out the specific open questions. File references throughout make drift easy to
> catch on the next revision.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Chat Panel UX](#3-chat-panel-ux)
4. [Streaming Protocol](#4-streaming-protocol)
5. [Tool System](#5-tool-system)
6. [System Prompt Design](#6-system-prompt-design)
7. [Context Management](#7-context-management)
8. [Apply UX — Optimistic Apply + Undo/Redo](#8-apply-ux--optimistic-apply--undoredo)
9. [Settings & Configuration](#9-settings--configuration)
10. [Error Handling](#10-error-handling)
11. [Packages & the `AssistantHost` Seam](#11-packages--the-assistanthost-seam)
12. [Perception (Canvas Awareness)](#12-perception-canvas-awareness)
13. [SDK vs API](#13-sdk-vs-api)
14. [Roadmap & Future Directions](#14-roadmap--future-directions)

---

## 1. Overview

The Jx AI Assistant is a chat tab in Jx Studio's right panel that lets users build, modify,
and iterate on Jx documents (components, pages, layouts) using natural language. An LLM
(OpenAI or any OpenAI-compatible endpoint — Azure, OpenRouter, a local model server) is given
a tool-calling interface to read and mutate the active document. Every mutation applies
**immediately** through `transactDoc()`-backed tools, landing in the same undo/redo history
stack as manual edits — see §8.

### 1.1 Design Principles

1. **AI is an assistant, not an operator.** In-document edits are individually undoable
   (native Ctrl+Z / an in-chat Stop button); there is no separate AI-only revert path. File
   creation (`create_component`, `create_page`) writes directly to disk with no confirmation
   dialog — the same trust model as a manual save, recoverable through source control like
   any other edit.
2. **Tool-first, not prompt-first.** The LLM manipulates documents through a typed,
   schema-validated tool interface (12 tools today — §5.2), not by generating raw JSON. This
   gives validation, undo, and self-correcting error recovery for free.
3. **Canvas is the live result, not a diff viewer.** Each tool call applies to the live
   canvas as the agent loop runs; there is no separate before/after diff view (the original
   batched-diff design was superseded before ship — see §8.2). Undo/redo is the review
   mechanism.
4. **Context is selective.** The full Jx document is never dumped into the prompt. A
   structural summary (element tree outline + state key types, not full property values)
   keeps token usage proportional to conversation complexity; `read_document` fetches detail
   on demand.
5. **Studio-native UI.** All chat UI (`packages/studio/src/panels/ai-chat/`,
   `packages/studio/src/panels/ai-panel.ts`) uses lit-html templates and Spectrum Web
   Components. No React.

### 1.2 Relationship to assistant-ui

The architecture follows [assistant-ui](https://github.com/assistant-ui/assistant-ui)
patterns — composable chat primitives, streaming state management, tool-calling UI — but is
implemented natively with lit-html + Spectrum. assistant-ui is a React library; Jx Studio
prohibits React. The architecture is the transferable asset, not the code.

---

## 2. Architecture

### 2.1 System Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                         Jx Studio (Browser)                         │
│  ┌───────────────┐  ┌──────────┐  ┌───────────────────────────┐    │
│  │ Assistant tab  │  │ Canvas   │  │ Properties / Events / Style│    │
│  │ (right panel,  │  │ (iframe  │  │ (other right-panel tabs)   │    │
│  │ lit-html)      │  │ render)  │  │                             │    │
│  └───────┬────────┘  └────┬─────┘  └─────────────────────────────┘   │
│          │                │                                          │
│  ┌───────┴────────────────┴──────────────────────────────────────┐  │
│  │                       Studio Services                          │  │
│  │  ┌───────────────────┐ ┌───────────┐ ┌──────────────────────┐ │  │
│  │  │ document-assistant│ │ ai-tools  │ │ tool-executor         │ │  │
│  │  │ (session wiring)  │ │(12 tools) │ │ (agent loop)          │ │  │
│  │  └─────────┬──────────┘ └─────┬─────┘ └──────────┬────────────┘ │  │
│  │            │                  │                   │              │  │
│  │  ┌─────────┴──────────────────┴───────────────────┴───────────┐ │  │
│  │  │  @jxsuite/ai (chat-state, streaming-client, tools registry) │ │  │
│  │  └──────────────────────────┬────────────────────────────────┘ │  │
│  └─────────────────────────────┼──────────────────────────────────┘  │
└────────────────────────────────┼───────────────────────────────────────┘
                                  │ SSE POST /__studio/ai/chat
                         ┌────────┴─────────┐
                         │  @jxsuite/server  │
                         │  ai-api.ts (proxy)│
                         └─────────┬─────────┘
                                   │ fetch (SSE)
                         ┌─────────┴──────────┐
                         │  OpenAI-compatible  │
                         │ API (gpt-4o default)│
                         └─────────────────────┘
```

Studio may also skip the proxy entirely and talk to the provider directly via
`createOpenAIStreamingClient` — that path is what the headless eval harness uses (§11.4).

### 2.2 Data Flow

```
User types message
  → document-assistant.sendMessage(text)
    → context-manager.trimContext() (token budget check, §7)
    → POST /__studio/ai/chat { messages, tools, systemPrompt, model }
      (or createOpenAIStreamingClient directly, bypassing the proxy)
      → SSE events: delta, tool_call_start/delta/end, done, error
    → chat-state updates reactively (@vue/reactivity)
      → ai-panel.ts repaints (rAF-coalesced)
        → Tool calls detected → tool-executor.runAgentLoop runs them
          → Each tool validates → executes → transactDoc() (own undo entry)
            → Canvas re-renders showing the change as it lands
              → Up to 5 rounds; loop ends when the model stops calling tools
```

---

## 3. Chat Panel UX

### 3.1 Placement

The assistant is a tab (`"assistant"`) in Studio's **right panel**, alongside Properties,
Events, and Style (`packages/studio/src/panels/right-panel.ts`) — not a separate resizable
bottom panel. Its container owns a private rAF-coalesced render loop
(`bindAiPanelHost`/`scheduleAiRender` in `ai-panel.ts`) so streaming can repaint every frame
without fighting the right panel's shared render scheduler.

### 3.2 View States

`ai-panel.ts` is a small view-state machine:

- **Key gate** — shown when no API key is stored locally and the proxy doesn't report
  `configured` (managed platforms / env-keyed dev servers unlock without a local key). Renders
  `createAiCredentialsForm()` (`packages/studio/src/ui/ai-credentials-form.ts`).
- **Chat** — the default view: header (`renderChatHeader`), scrollable message list
  (`renderMessageList`, stick-to-bottom unless the user scrolls up more than 48px from the
  bottom), and the sticky composer (`createComposer`).
- **Sessions** — `renderSessionsList()`, opened via the header's history affordance; lists,
  opens, and deletes persisted conversations (§7.3).

### 3.3 Composer & Attached Context

The composer (`packages/studio/src/panels/ai-chat/composer.ts`) supports attaching the
current page or the canvas selection as **context chips** — the manual precedent for the
automatic selection context described in §12. Chips are serialized into the outgoing user
message content itself, after a delimiter line (`buildMessageWithContext` /
`splitAttachedContext` in `attached-context.ts`):

```
<user text>

---- attached context ----
<context line 1>
<context line 2>
```

This is the only channel available (the streaming payload carries message `content` only),
and it persists with the session for free. The chat view splits the delimiter back out to
render chips instead of the raw block. The convention is soft — a model echoing the delimiter
verbatim would at worst render a stray chip; no security implication.

### 3.4 Programmatic Seeding

`seedAssistantPrompt(text)` (exported from `ai-panel.ts`) drives the same send path as the
composer, used by flows like New Project handing off an initial project brief.

---

## 4. Streaming Protocol

### 4.1 `StreamingClient` Interface

Defined in `packages/ai/src/streaming-client.ts`:

```ts
type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; args: string } // partial JSON fragment
  | { type: "tool_call_end"; id: string }
  | { type: "done"; stopReason: string }
  | { type: "error"; message: string; code?: string };

interface StreamingClient {
  streamChat(
    messages: object[],
    tools: object[],
    systemPrompt: string,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent>;
}
```

Three implementations ship today:

- **`createOpenAIStreamingClient({ baseUrl, apiKey, model?, temperature? })`** — talks
  directly to an OpenAI-compatible `/chat/completions` endpoint, no server involved. Used by
  the headless eval harness and available to Studio as a direct (non-proxied) path.
  `temperature` is forwarded only when defined — reasoning models (GPT-5.x, o-series) reject a
  custom temperature.
- **`createProxyStreamingClient({ chatUrl, model?, apiKey?, baseUrl? })`** — POSTs to a
  same-origin proxy (`/__studio/ai/chat`) that already speaks the normalized `StreamEvent` SSE
  format. `apiKey`/`baseUrl`, when given, ride as `X-Api-Key`/`X-Api-Base-URL` headers; the
  proxy owns provider credentials otherwise. This is what Studio uses by default
  (`document-assistant.ts`).
- **`createAnthropicStreamingClient()`** — **stub.** Every call yields a single `{ type:
"error", code: "NOT_IMPLEMENTED" }` event. Full implementation (content-block delta model,
  `stop_reason` field, whole-JSON tool-argument blocks per block) is a v1.x candidate (§14.1).

### 4.2 OpenAI SSE → `StreamEvent` Mapping

Both the direct client and the server proxy implement the same transform independently
(`streaming-client.ts` and `packages/server/src/ai-api.ts`):

- `choices[0].delta.content` → `{ type: "delta", content }`
- `choices[0].delta.tool_calls[].function` (first appearance, has `id`) →
  `tool_call_start` + (if args present) `tool_call_delta`
- Subsequent `tool_calls[]` fragments (no `id`, has `function.arguments`) → `tool_call_delta`
- `finish_reason === "tool_calls"` → pending `tool_call_end`s, then `{ type: "done", stopReason:
"tool_calls" }`
- `finish_reason === "stop" | "length"` → `{ type: "done", stopReason }`
- Network/parse failure or non-2xx → `{ type: "error", message, code? }`; an aborted fetch
  yields `{ type: "done", stopReason: "cancelled" }` instead of an error.

### 4.3 Server Endpoints (`packages/server/src/ai-api.ts`)

**`POST /__studio/ai/chat`** — thin SSE proxy. Body: `{ messages, tools, systemPrompt, model
}`. Response: `text/event-stream` of `data: {"type":"...",...}\n\n` StreamEvents. API key
resolution: `X-Api-Key` header → `Authorization: Bearer` header → `OPENAI_API_KEY` env var → 401. Base URL: `X-Api-Base-URL` header → `OPENAI_BASE_URL` env var → `https://api.openai.com/v1`.
The `AbortSignal` from the incoming `Request` is forwarded to the upstream `fetch()`.

**`GET /__studio/ai/models`** — model picker data. With no key configured, returns a
hardcoded default list (`{ models, configured: false, managed: false }`) so the UI can still
render. With a key, proxies to the upstream `/models` endpoint and maps its response to `{ id,
name, contextWindow, ownedBy? }[]`; falls back to a one-entry default list on upstream failure.

---

## 5. Tool System

### 5.1 Tool Registry (`packages/ai/src/tools.ts`)

```ts
interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  summary?: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  strict: boolean; // registry's own arg validation — default true
  llmStrict: boolean; // send OpenAI `strict: true` in the function schema — default false
  execute: (args: object) => Promise<ToolResult> | ToolResult;
}

interface ToolRegistry {
  register(tool: ToolDefinition): void;
  list(): ToolDefinition[];
  listForLLM(): object[]; // OpenAI function-calling format
  validate(toolName: string, args: object): { valid: boolean; errors?: string[] };
  execute(toolName: string, args: object): Promise<ToolResult>;
  getDefinition(toolName: string): ToolDefinition | undefined;
}
```

`strict` (registry-side structural argument checking: required keys, basic type matching) and
`llmStrict` (OpenAI's `strict: true` function-schema flag) are deliberately decoupled: the Jx
tool schemas are not OpenAI-strict-compliant (polymorphic/optional `value` fields), and GPT-5.x
rejects the request if `strict: true` is sent for a non-compliant schema. `llmStrict` defaults
off; `strict` defaults on.

### 5.2 Jx Document Tools (`packages/studio/src/services/ai-tools.ts`)

`registerAiTools(registry, ctx)` registers 12 tools that all resolve paths against
`ctx.getTab().doc.document` (a `JxPath` is a JSON array of keys/indices from the root, e.g.
`["children", 0, "children", 1]`):

| Tool               | Parameters                            | Notes                                                                                            |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `read_document`    | `path?`                               | Whole document or subtree at `path`.                                                             |
| `set_property`     | `path`, `key`, `value?`               | `value: null`/omitted removes the property.                                                      |
| `add_child`        | `parentPath`, `index`, `node`         | Rejects `parentPath` pointing at a children array or at mapped-array children.                   |
| `set_style`        | `path`, `property`, `value?`          | camelCase CSS property; `value: null`/omitted removes it.                                        |
| `set_text`         | `path`, `value`                       | Convenience alias for `set_property(path, "textContent", value)`.                                |
| `add_state`        | `key`, `value`                        | Errors if `key` already exists in `state`.                                                       |
| `update_state`     | `key`, `value?`                       | Errors if `key` doesn't exist; `value: null` removes it.                                         |
| `move_node`        | `fromPath`, `toParentPath`, `toIndex` | Rejects moving the document root.                                                                |
| `remove_node`      | `path`                                | Rejects removing the document root.                                                              |
| `create_component` | `path`, `content`                     | Writes a `.json` file via `ctx.saveFile`; schema- and render-validated before write.             |
| `create_page`      | `path`, `content`                     | Same as `create_component`, for `pages/`.                                                        |
| `open_document`    | `path`                                | Switches the active tab; flushes and re-opens the agent-loop's undo batch on the new tab (§8.1). |

The document-mutation tools need only an open tab (they return `"No document is open."` when
there is none). The **file and navigation** tools additionally gate on an injected capability —
`create_component`/`create_page` on `saveFile`, `open_document` on `openDocument` — returning
`{ success: false, error: "... is not available in this environment." }` when it is absent,
rather than being dropped from the registry. §11.3 generalizes this always-registered /
degrade-at-call-time pattern to the full `AssistantHost` capability model.

### 5.3 Validation Pipeline (`applyAndValidate` in `ai-tools.ts`)

Every mutating tool routes through one helper:

1. Snapshot the document's current validation errors (`validateDoc`, §5.4).
2. Apply the mutation via `transactDoc()` (own undo entry).
3. Re-validate; diff against the pre-mutation error set. Only **newly introduced** errors are
   reported as a tool failure — pre-existing errors elsewhere in the document don't block
   unrelated edits.
4. If schema-valid and a `renderCheck` capability is wired (§5.5), attempt a detached render of
   the mutated document; a render-time throw is reported the same way as a schema error.
5. If neither failed, optionally append **soft** design-token hints (`flagHardcodedTokens` /
   `formatTokenHints`, §5.6) to the success summary — these never fail the mutation.

Schema errors are translated by `translateValidationError()` into an actionable `"→ Fix:"`
line (e.g. "Style properties must be camelCase") before being handed back to the model, so the
next round can self-correct without re-deriving the rule from a raw ajv message.

### 5.4 Schema Validation (`packages/studio/src/services/jx-validate.ts`)

`validateDoc(doc)` compiles `@jxsuite/schema`'s pre-generated `schema.json` once per session
with `ajv/dist/2020.js` (draft 2020-12) + `ajv-formats`, then reuses the compiled validator on
every call — full JSON Schema recompilation on every mutation would be too slow inside the
agent loop. Degrades to a no-op (`[]`, i.e. "no errors") if ajv is unavailable, so the loop
never hard-fails purely on a missing optional dependency.

### 5.5 Render Check (`packages/studio/src/services/render-critic.ts`)

`renderCheck(doc)` attempts a detached render (`buildScope` → `renderNode` from
`@jxsuite/runtime`, into a throwaway `<div>`) and reports `{ ok: true }` or `{ ok: false, error
}` with a translated, actionable message (`translateRenderError`). v1 scope: catches
render-time throws only — missing `$ref`s, malformed `Function` bodies, bad template
expressions. Does not detect zero-node output or exercise custom-element
`connectedCallback` (it never fires on detached nodes).

### 5.6 Token-Discipline Hints (`packages/studio/src/services/token-lint.ts`)

`flagHardcodedTokens(doc, projectStyle)` walks a document's `style` objects and flags values
that match a project design-token value but aren't referenced via `var(--token)` — e.g. a
literal `"#3b82f6"` where `--color-accent` is already defined as that value.
`formatTokenHints()` renders findings as a hint block appended to a successful tool result's
`summary`. Purely advisory — never fails the mutation (unlike schema/render checks).

### 5.7 Agent Loop (`packages/studio/src/services/tool-executor.ts`)

`runAgentLoop({ chatState, streamingClient, toolRegistry, systemPrompt, signal?, getTab? })`:

```
1. If getTab is provided, beginBatch(getTab()) — see §8.1.
2. For round = 1..5 (MAX_ROUNDS):
   a. Stream one chat round; forward events into chatState (delta/tool_call_*/done/error).
   b. On a stream error → chatState.setError(message); return.
   c. If the round didn't end in tool_calls → return (done).
   d. Execute every tool call from this round in order; parse-failure and tool-level
      failures both produce a { success: false } result, but execution continues for the
      remaining calls in the batch.
   e. Push each result back as a `tool` role message; begin the next assistant turn.
3. If MAX_ROUNDS is exhausted without the model stopping, report a summary of applied
   changes + accumulated errors so the user isn't left with a bare "I couldn't do it."
4. finally: endBatch() — always closes the undo batch, even on error/abort.
```

---

## 6. System Prompt Design

`buildSystemPrompt({ document?, projectConfig?, components?, projectRoot? })`
(`packages/studio/src/services/ai-system-prompt.ts`) is the single most important quality
driver for the assistant — it is rebuilt fresh on every send so it always reflects the
currently-open document and project.

### 6.1 Prompt Sections (joined with `\n\n---\n\n`)

1. **Role, tool list, and workflow guidance** — names all 12 tools with their signatures,
   instructs the model to call `read_document` before mutating, to batch related edits, and
   that edits are live/undoable/schema-checked after every step.
2. **Jx Schema Reference** — condensed structural rules: `$id`, `tagName`, `children`, the
   `state` shape decision tree, `style` (camelCase, always-string values), `$elements`,
   `$media`, the void-elements list (from `VOID_ELEMENTS` in `../store.js`).
3. **State Shape Decision Tree** — scalar / typed / computed / function / data-source, each
   with a one-line example.
4. **Real-World Patterns** — canonical component/layout/config JSON pulled from the
   `jxsuite.com` production site (`cta-button`, `stat-card`, `step-card`, a layout with
   `$elements`/`slot`, `project.json` design tokens, `@--breakpoint` responsive overrides).
5. **Design Principles** — tokens-first, spacing rhythm, type scale, color/elevation layering,
   layout, restraint — the premium-output guidance layered on after early eval runs showed
   generic-looking output (see §14 turnover history).
6. **Control Flow & Reactivity** — signals + event handlers, `$prototype: "Array"` list
   rendering (`$map.item`/`$map.index`), `$switch`/`cases` conditionals, and full worked
   examples (counter, todo list with per-item delete, tab switcher). Added specifically to
   close eval gaps L5.2/L5.3 (§11.4) — the prompt previously had zero `$map`/`$switch`
   coverage despite the schema using them heavily.
7. **Multi-Page Site Building** — file-based routing (`pages/index.json` → `/`, `pages/blog/
[slug].json` → `/blog/:slug`), `$layout` inheritance with `<slot>`, `$head` metadata, the
   create-layout-then-pages-then-`open_document` workflow.
8. **Current Document** _(conditional on `document`)_ — `buildDocumentSummary()`: element tree
   outline (via `flattenTree`), state key list with inferred type labels (Scalar / Typed /
   Computed / Function / Data source), `$elements` import list.
9. **Project Context** _(conditional)_ — `buildProjectSummary()`: project name/root,
   reusable components (`<tag> — $id (path)`, so the model prefers reuse over rebuilding),
   design tokens grouped by `--color*`/`--font*`/other, `$media` breakpoints.
10. **Error Recovery** — how to read a `"→ Fix:"` hint, a table of the most common validation
    error patterns and their fixes, and an explicit instruction not to retry the exact same
    failing call twice in a row.

### 6.2 Structural Summary, Not Full Document

The "Current Document" section is a structural outline, not the serialized JSON — this is the
key token-usage optimization from design principle 4 (§1.1). When the model needs a specific
subtree's full detail (e.g. to edit a deeply nested node precisely), it calls
`read_document(path)`.

---

## 7. Context Management

### 7.1 Token Tracking & Trimming

`trimContext(chatState, systemPrompt)` (`packages/studio/src/services/context-manager.ts`),
called before every send:

- **Token estimate:** `charCount / 4` heuristic, summed over the system prompt plus
  `chatState.toMessagesArray()` (message content + tool-call name/argument text + ~4 tokens
  framing overhead per message).
- **Model-aware budget:** context window resolved by longest-prefix match against a small
  table (`gpt-4o`: 128k, `gpt-4.1`: 1M, `gpt-4-turbo`: 128k, `gpt-4`: 8192, `gpt-3.5`: 16385,
  `o1`/`o3`/`claude`: 200k; unknown models fall back to 32k). Budget = 80% of the window; a
  50%-of-window crossing sets `chatState.contextWarning = true` even before any trimming.
- **Trim strategy:** once over budget, keep the most recent 20 messages
  (`KEEP_RECENT`), extending further back if fewer than 3 (`MIN_USER_TURNS`) user/tool
  messages fall inside that window. Dropped messages are replaced with a single synthesized
  `user`-role note: `"[Earlier conversation truncated. N messages dropped ...]"`. If trimming
  can't free enough room without dropping everything, the warning stays on but nothing is
  truncated (never silently lose the entire conversation).

### 7.2 Conversation Persistence — Multi-Session (`ai-session-store.ts`)

Unlike the single-conversation design in the original draft, the shipped implementation is
**multi-session**, project-scoped in `localStorage`:

- An index key (`jx-ai-chat-sessions[:projectRoot]`) holds `SessionMeta[]` (`id`, `title`,
  `createdAt`, `updatedAt`, `messageCount`), sorted by `updatedAt` descending, capped at
  `MAX_SESSIONS = 20` (oldest evicted).
- One payload key per session (`jx-ai-chat-session:...`) holds up to `MAX_PERSIST_MESSAGES =
50` `PersistedMessage`s.
- `document-assistant.ts` lazily creates the backing session on the **first** message of a
  chat (so an unsent "New Chat" click never pollutes the session list), persists after every
  send (both before and after streaming settles, so a mid-stream error/abort still survives a
  reload), and restores the last-active session once on creation.
- Sessions are listed/opened/deleted from the panel's Sessions view (§3.2); switching
  sessions stops any in-flight stream first.

---

## 8. Apply UX — Optimistic Apply + Undo/Redo

The original batched Accept/Reject diff preview (§8.2 below, retained for context) was
superseded before ship in favor of optimistic apply — this is a load-bearing decision, not a
placeholder: it removes an entire class of before/after state-synchronization machinery.

### 8.1 Optimistic Apply (Shipped)

Each mutation tool applies to the live canvas **immediately** through `transactDoc()`. There
is no Accept/Reject gate:

1. Every mutation tool (`set_property`, `add_child`, `set_style`, ...) is one `transactDoc()`
   transaction, so each AI edit is a discrete, reversible step — same undo/redo stack as
   manual edits, not a separate AI history.
2. `tool-executor.ts` wraps a full agent-loop turn (all rounds) in one `beginBatch()` /
   `endBatch()` pair, so a multi-tool-call turn collapses to a single undo step from the
   user's perspective. `open_document` explicitly flushes and re-opens the batch on the newly
   active tab when the model switches documents mid-loop (§5.2), so edits in each document stay
   individually undoable rather than stranding the new tab's edits with no history snapshot.
3. To undo an AI change the user uses native Ctrl+Z/Ctrl+Y — no special AI-only revert
   affordance.
4. After each mutation the document is schema-validated (§5.3/§5.4); newly introduced errors
   come back to the model as a failed tool result so the loop self-corrects on the next round.

File writes (`create_component`, `create_page`) are **not** part of this undo stack — they are
direct filesystem writes via the injected `saveFile` capability, schema- and render-validated
before the write but with no in-app revert. Recovery is through source control, same as any
manual file edit.

This removed the batched-diff synchronization machinery entirely: no before/after panes, no
pre-batch document snapshot, no separate diff-preview component.

### 8.2 Batched Canvas Diff (Original Design — Superseded, Kept for Reference)

The original plan previewed tool-call changes as a single visual diff before applying them: a
before/after canvas view, a floating **[✓ Accept] [✗ Reject] [▼ Expand]** action bar, Expand
revealing individual tool effects in an accordion, Accept pushing one combined undo snapshot,
Reject restoring the pre-batch state. Not built — optimistic apply (§8.1) shipped instead.

---

## 9. Settings & Configuration

### 9.1 Stored Settings (`packages/studio/src/services/ai-settings.ts`)

Persisted to `localStorage`, each with a `getX`/`setX` pair (writes go through
`persistSettings()`):

| Setting  | Storage key       | Default    | Notes                                                                                                                 |
| -------- | ----------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| API key  | `jx.ai.openaiKey` | `""`       | Blank clears it. Sent as `X-Api-Key`; proxy falls back to `OPENAI_API_KEY`.                                           |
| Base URL | `jx.ai.baseUrl`   | `""`       | Trailing slashes stripped. Blank uses the proxy default.                                                              |
| Model    | `jx.ai.model`     | `"gpt-4o"` | Re-read on every send (`document-assistant.ts`), so the picker's choice takes effect without re-creating the session. |

There is no persisted Temperature control in the shipped Studio UI (the original draft's §9.1
included one) — temperature is a harness/direct-client parameter (`createOpenAIStreamingClient`'s
`temperature` option) used by the eval harness for determinism, not a Studio setting.

### 9.2 Credentials Form & Model Picker

`createAiCredentialsForm()` (`packages/studio/src/ui/ai-credentials-form.ts`) is the settings
UI, shown as the panel's key gate (§3.2) or opened via the composer's settings affordance.
`ai-models.ts` fetches `/__studio/ai/models` for the picker and exposes `isProxyConfigured()`
so the gate can unlock without a locally stored key when the proxy itself reports it has one
(managed platforms, env-keyed dev servers). The same `/models` response also carries
`managed` (`isManagedProxy()` — the platform owns credentials itself, e.g. cloud Workers AI, so
no key field is shown) and an optional `defaultModel` (`getProxyDefaultModel()` — the proxy's
preferred model id, used to seed the picker).

### 9.3 API Key Flow

1. User enters a key in the credentials form → persisted to `localStorage`.
2. Each chat request sends it as `X-Api-Key` (the proxy path) or directly as `Authorization:
Bearer` (the direct-client path).
3. Server/direct client: request key → `OPENAI_API_KEY` env var → 401 if neither is present.
4. On 401 from the proxy, the panel falls back to the key gate.

---

## 10. Error Handling

### 10.1 Error Categories

| Error               | Detection                      | User Experience                                                                                                   |
| ------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Missing API key     | Key gate check on render       | Panel shows the credentials form instead of the chat view.                                                        |
| Invalid/failed auth | 401 from proxy/provider        | `chatState.error` set; rendered inline above the composer.                                                        |
| Rate limit / 5xx    | Non-2xx from proxy/provider    | Error message surfaced from the parsed `{ error }`/`{ error: { message } }` body.                                 |
| Network error       | `fetch()` rejection            | `"Network error: {message}"` surfaced the same way.                                                               |
| Invalid tool call   | Tool validation / schema check | Actionable `"→ Fix:"` error text fed back to the model (§5.3), visible in the tool-call display.                  |
| Context overflow    | `contextWarning` flag (§7)     | Warning surfaced in the panel once total tokens cross 50% of the model's window.                                  |
| Stream parse error  | Malformed SSE data             | Silently skipped per-chunk (both client and proxy `continue` past unparseable lines) — does not abort the stream. |

### 10.2 LLM Self-Correction

A failed tool call's result is sent back as a `tool` role message with its error text (`§5.7`
step d). The system prompt's Error Recovery section (§6.1 item 10) explicitly instructs the
model to read the `"→ Fix:"` hint, apply a targeted correction, and never re-issue the exact
same failing call unchanged. This happens within the 5-round budget (`MAX_ROUNDS` in
`tool-executor.ts`); if rounds are exhausted, the loop reports applied changes plus
accumulated errors (§5.7 step 3) rather than a bare failure.

---

## 11. Packages & the `AssistantHost` Seam

### 11.1 Today's Boundary (shipped)

**`@jxsuite/ai`** (`packages/ai/`) — provider-agnostic, sole dependency `@vue/reactivity`:

- `streaming-client.ts` — `StreamingClient` interface + `StreamEvent` union + the OpenAI,
  proxy, and stub-Anthropic implementations (§4.1).
- `tools.ts` — `ToolDefinition`, `ToolRegistry`, `ToolResult` (§5.1).
- `chat-state.ts` — reactive chat state (`createChatState`): messages, streaming status,
  pending tool calls, model/token-count/context-warning, plus the mutators the agent loop and
  UI both call (`sendMessage`, `beginAssistantTurn`, `appendDelta`, `appendToolCall*`,
  `pushToolResultMessage`, `finishStream`, `setError`, `cancelStream`, `clearChat`, `retryLast`,
  `setModel`, `setTokenCount`, `setContextWarning`, `toMessagesArray`).

**`packages/studio/src/services/`** (Jx- and Studio-specific, depends on `@jxsuite/ai`):
`ai-tools.ts`, `tool-executor.ts`, `ai-system-prompt.ts`, `context-manager.ts`,
`jx-validate.ts`, `token-lint.ts`, `render-critic.ts`, `ai-settings.ts`,
`ai-session-store.ts`, `ai-models.ts`, and the orchestrator, `document-assistant.ts`, which
wires all of the above to `activeTab`/`workspace`/`getPlatform()`.

**`packages/studio/src/panels/`** (UI, depends on the services above): `ai-panel.ts` +
`panels/ai-chat/*` (`chat-view.ts`, `composer.ts`, `sessions-view.ts`, `chat-markdown.ts`,
`attached-context.ts`).

This boundary already buys real reuse — the headless eval harness
(`packages/studio/tests/harness/real-llm.ts`, §11.4) is a second, non-browser consumer of
`registerAiTools` + `runAgentLoop` + `buildSystemPrompt` + `validateDoc`, proving those modules
don't secretly depend on the DOM.

### 11.2 Target: a new `@jxsuite/assistant` package

The `services/` layer above is Jx-coupled in exactly three places: `ai-tools.ts` imports
`tabs/transact` mutators + `Tab`; `tool-executor.ts` imports `beginBatch`/`endBatch`;
`ai-system-prompt.ts` imports `VOID_ELEMENTS`/`flattenTree` from `store.js`/`state.js`. Phase 2
(`docs/assistant-sdk-perception-plan.md`) extracts a new core package, `packages/assistant`
(`@jxsuite/assistant`) — deps: `@jxsuite/ai`, `@jxsuite/schema`, `ajv`, `ajv-formats` — rather
than adding a second entry point to `@jxsuite/ai` itself, because dependencies are
package-scoped: pulling in `@jxsuite/schema`/`ajv` on `@jxsuite/ai` would break its "reusable
in any chat UI context, no Jx dependencies" charter for every consumer. A separate package also
gets its own semver stream (infra stable, assistant iterating) and gives extensions one obvious
import target (§13).

Moves into `packages/assistant`:

- `host.ts` — the `AssistantHost` interface itself (below).
- `tools.ts` (from `ai-tools.ts`) — the same 12 tools, rewritten to call `host.document.*`
  instead of `tabs/transact` directly.
- `system-prompt.ts` (from `ai-system-prompt.ts`) — absorbs `VOID_ELEMENTS`/`flattenTree` so it
  has no `store.js`/`state.js` import.
- `agent-loop.ts` (from `tool-executor.ts`) — batches via `host.document.beginBatch`/`endBatch`.
- `context-manager.ts`, `jx-validate.ts` (as `validate.ts`), `token-lint.ts`.

Stays studio-side: `document-assistant.ts` (becomes the **studio** `AssistantHost`
implementation), `ai-settings.ts`, `ai-session-store.ts`, `render-critic.ts`, all of
`panels/ai-chat/`.

### 11.3 The `AssistantHost` Interface

A formal capability-injection contract, replacing today's two ad hoc injection sites
(`registerAiTools(registry, { getTab, validate?, saveFile?, renderCheck?, openDocument?,
projectStyle? })` and `runAgentLoop({ ..., getTab? })`):

```ts
interface AssistantHost {
  // Required.
  document: {
    getDocument(): JxMutableNode | null;
    getNodeAtPath(path: JxPath): unknown;
    beginBatch(): void;
    endBatch(): void;
    insertNode(parentPath: JxPath, index: number, node: JxMutableNode): void;
    removeNode(path: JxPath): void;
    moveNode(fromPath: JxPath, toParentPath: JxPath, toIndex: number): void;
    updateProperty(path: JxPath, key: string, value: unknown): void;
    updateStyle(path: JxPath, property: string, value: string | undefined): void;
    updateState(key: string, value: JxStateDefinition | undefined): void;
  };
  // Optional capabilities — absent ones make their dependent tools degrade gracefully.
  validation?: { validate(doc: unknown): Promise<string[]> };
  files?: {
    saveFile(relPath: string, content: string): Promise<void>;
    openDocument(relPath: string): Promise<void>;
  };
  project?: {
    projectStyle?: Record<string, string>;
    projectConfig?: ProjectConfig;
    components?: ComponentEntry[];
    projectRoot?: string;
  };
  renderCheck?: (doc: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
  perception?: PerceptionCapability; // §12
}
```

**Absent-capability semantics** (generalizing the pattern `ai-tools.ts` already uses for
`saveFile`/`openDocument` today): every tool is always registered — the model always sees the
same tool list — but a tool whose backing capability is missing returns `{ success: false,
error: "<X> is not available in this environment." }` at call time rather than being silently
omitted. `buildSystemPrompt` gains an "Environment capabilities" line summarizing which
optional capabilities are present, so the model rarely calls a tool it can't use.

**Two reference hosts** ship with `@jxsuite/assistant`: the **studio** host (`document-
assistant.ts`, delegating to `tabs/transact`, `render-critic`, `workspace`) and the
**headless** host (the harness wiring already prototyped in `tests/harness/real-llm.ts` —
§11.4). A CLI reference host is a Phase 4 deliverable (§14).

**Mapping notes (for the Phase 2 implementer).** The sketch above is derived from today's real
injection sites, but three things it doesn't show on its face will decide the extraction — the
sketch is a starting point, not a finished contract:

- **Each `document.*` mutation is one `transactDoc()` transaction; `beginBatch`/`endBatch`
  group them.** Today `applyAndValidate` wraps every `mutate*` call in `transactDoc(tab, fn)`
  and `runAgentLoop` wraps the whole turn in `beginBatch`/`endBatch` (§5.7/§8.1). The host
  methods inherit that contract: one call is atomically undoable; a batch collapses a turn to a
  single undo step. `beginBatch`/`endBatch` are on `document` precisely so the agent loop can
  drive batching without importing `tabs/transact`.
- **`getDocument()` returns the raw (non-reactive) document.** The studio host must `toRaw()`
  its reactive proxy before returning, because validation and file serialization `ajv`-walk and
  `structuredClone` it — the `0ebd74a4` scorer bug was exactly a reactive proxy reaching
  `structuredClone`. A headless host returns its plain object as-is.
- **Not every tool maps 1:1 to a listed method.** `set_text` today is a raw closure (`delete
textContent; children = [value]`) and `add_state`/`update_state` deliberately bypass
  `updateProperty` (its `"" → delete` rule is wrong for state defaults). Phase 2 either adds
  narrow methods for these or expresses them as composed calls — the extraction settles which,
  not this sketch. The broader `transact.ts` surface (`mutateWrapNode`, `mutateDuplicateNode`,
  attribute / media / nested-style variants) stays studio-side; only the subset the 12 tools
  actually use crosses into `host.document`.

Per the repo testing policy (`CLAUDE.md`), the new package ships with its own `bunfig.toml`
per-file coverage thresholds and the manifest check from day one — its extraction PR adds it to
the CI matrix.

### 11.4 Precedent: the Headless Eval Harness

`packages/studio/tests/harness/real-llm.ts` already proves the seam works today, ahead of the
formal `AssistantHost` extraction: `buildRealHarness()` assembles the exact production pieces
(`createChatState`, `createToolRegistry`, `createOpenAIStreamingClient` from `@jxsuite/ai`;
`registerAiTools`, `runAgentLoop`, `buildSystemPrompt`, `validateDoc` from studio services)
against a `createTab()`-backed in-memory document, with **no browser** — a `happy-dom` shim
(`tests/with-dom.ts`) is the only DOM dependency, because the tools only ever touch
`tab.doc.document`, a plain reactive object. `run-eval.ts` drives an eval suite (`bun run
eval:headless`, worst-of-N reporting) covering the logic axes (Completeness, Efficiency,
Recovery, schema-Correctness); rendered-DOM correctness and full Undo/Redo stay
studio/browser-only concerns (`score.ts` marks them `N/A (browser)` rather than faking a
result). This is exactly the "whatever we must stub to run headless is the studio-coupling
boundary" argument for why Phase 2 is a pure refactor, not new design.

---

## 12. Perception (Canvas Awareness)

**Not yet built** — this section specifies the Phase 3 target (`docs/assistant-sdk-perception-
plan.md`), the launch milestone: today the assistant edits the document tree blind to what's
actually selected or rendered on canvas, beyond the manual "attach context" chip (§3.3).

### 12.1 What Exists Today to Build On

- **Selection state:** `tab.session.selection: JxPath | null` (`packages/studio/src/store.ts`),
  set via the session-only `dispatch()` patch mechanism from canvas clicks, the Layers panel,
  or keyboard nav.
- **`data-jx-path` stamping:** the canvas iframe's render walk stamps every rendered element
  with its document path, the substrate the drag/drop, hit-testing, and inline-edit systems
  already use (`canvas/iframe-protocol.ts` types reference it throughout).
- **Geometry:** the iframe protocol already has a `measure` (parent→iframe, `{ paths, reqId
}`) → `geometry` (iframe→parent, `{ reqId, hits: NodeHit[] }`) round trip
  (`iframe-protocol.ts`). There is **no bulk rendered-tree enumeration** message yet — a
  parent can ask "where are these N known paths" but not "what's currently rendered."
- **Manual precedent:** the composer's attach-context chips (§3.3) are exactly what automatic
  selection context (§12.4) generalizes — the chip remains as the opt-out affordance once
  automatic context ships.

### 12.2 `PerceptionCapability`

An optional capability on `AssistantHost` (§11.3):

```ts
interface PerceptionCapability {
  getSelection(): JxPath | null;
  getRenderedTree(opts?: { root?: JxPath }): Promise<RenderedNode[]>;
  measure(paths: JxPath[]): Promise<{ path: JxPath; rect: SerializableRect }[]>;
  highlight?(paths: JxPath[], opts?: { ttl?: number }): void;
}

interface RenderedNode {
  path: JxPath;
  tagName: string;
  rect: SerializableRect;
  textSnippet?: string;
  childCount: number;
  hidden?: boolean;
}
```

### 12.3 New `iframe-protocol.ts` Messages

- **`ParentToIframe`**: `{ kind: "enumerate"; root?: (string | number)[]; reqId: number }` —
  walk the currently rendered `data-jx-path` elements (optionally scoped to a subtree) and
  report them back.
- **`IframeToParent`**: `{ kind: "renderedTree"; reqId: number; nodes: RenderedNode[] }` — the
  `enumerate` response, reqId-correlated the same way `measure`/`geometry` already are.
- **`ParentToIframe`**: `{ kind: "highlight"; paths: (string | number)[][]; ttl: number }` —
  transient visual emphasis on the given paths (post-tool-call feedback, §12.5). `measure` →
  `geometry` is reused as-is for the `PerceptionCapability.measure()` call; no new message
  needed there.

These ride the existing security-reviewed parent↔iframe postMessage boundary
(`iframe-protocol.ts`). `renderedTree` carries text snippets from rendered content — display /
context data at the same trust level as today's `hit`/`geometry` payloads; no new capability
crosses the sandbox, and (like the rest of the protocol) messages are `gen`/`reqId`-guarded so a
stale enumeration from a superseded render is dropped.

### 12.4 New Tools

Three tools registered in `@jxsuite/assistant`, all routed through `host.perception` and
degrading to the standard "not available in this environment" `ToolResult` when the capability
is absent (headless hosts, or a canvas mode that doesn't support it):

- **`get_selection`** — returns the currently selected node's path (and a short description),
  or `null`.
- **`describe_canvas`** — returns the rendered-tree summary (`getRenderedTree`), giving the
  model ground truth about what's actually on screen versus what the document tree says should
  be there (catches, e.g., a `hidden: true` node or a `$switch` case that isn't the active one).
- **`measure_nodes`** — returns rects for a list of paths, for size/layout-aware edits ("make
  this button larger" needs to know its current size).

### 12.5 Automatic Selection Context + Post-Tool Highlight

- **On send:** if `host.perception.getSelection()` returns a path, `document-assistant.ts`
  (or its Phase-2 successor) prepends an ephemeral context block to the outgoing user turn —
  the automatic generalization of today's manual attach-context chip (§3.3); the chip stays as
  the user's opt-out (attach something _other_ than the live selection, or suppress it).
  **Open question:** today's chip embeds context into _persisted_ message content (§3.3), while
  automatic selection context is described here as _ephemeral_ (recomputed each send, not stored)
  so a reloaded session isn't pinned to a stale selection. Phase 3 must pick one — embedded-and-
  persisted (chip parity) vs. ephemeral-and-recomputed — since they replay differently when a
  saved conversation is reopened.
- **Post-tool highlight:** the agent loop (`agent-loop.ts`) collects the set of paths touched
  by the round's tool calls and, after `endBatch()`, calls
  `host.perception?.highlight(paths)` so the user sees exactly what the model changed on the
  live canvas, not just in the chat transcript.

### 12.6 New Eval Layer

A new L6 layer in the eval suite (§11.4), gated on a mock `PerceptionCapability` with a preset
selection:

- Selection-targeting assertions — "make THIS button larger" must land the mutation at the
  selected path, not a lookalike elsewhere in the tree.
- Component-detection assertions — given `describe_canvas` output naming an existing
  component, the model reuses that tag instead of re-authoring equivalent markup inline.

Rendered-DOM and highlight-timing axes stay in the chrome-devtools **browser** eval, same as
today's rendered-DOM/Undo-Redo split (§11.4) — headless can mock the capability's shape but not
verify the iframe actually painted the highlight.

---

## 13. SDK vs API

**Decision: SDK now, a server-executing API later, on top of the SDK.**

Tool execution is inherently host-side — it mutates an in-memory reactive document so AI edits
share undo history with manual edits (§8.1). There is no clean way to make that
"server-executing" without inventing a server-side document session, so an API is not the
Phase-2/3 deliverable.

**The SDK is:** the `AssistantHost` injected contract (§11.3), documented, with two reference
wirings (studio, headless — §11.3/§11.4). Consuming it means implementing `AssistantHost` for a
new context; nothing about the tool/loop/prompt logic changes.

**Transport for SDK consumers is already solved twice:** the `/__studio/ai/chat` proxy +
managed-mode credential flow (§9.3), or `createOpenAIStreamingClient` used directly against any
OpenAI-compatible provider (as the eval harness does today, §11.4) — no new transport work is
needed to consume the SDK outside Studio.

**A server-executing API (Phase 5, optional)** — a headless project-editing service for CI/
integration use cases — becomes cheap once the SDK ships, because it is just
`@jxsuite/assistant` plus a Node `AssistantHost` (the eval harness already prototypes exactly
that shape, minus the "server" framing). Not scheduled; a candidate once Phase 4 extensibility
work surfaces real demand for it.

**Extensions v2 contributes tools later, not now.** `specs/extensions.md` §2 establishes that
extensions may depend on core packages but core packages may never depend on an extension —
so a future `assistant` admission block (alongside today's `format`/`project`/`server`/
`connector`, `specs/extensions.md` §6) contributing extension-authored tools into the registry
is architecturally legal today even though extensions v2 currently has zero AI extension point
(Phase 4, §14).

---

## 14. Roadmap & Future Directions

### 14.1 Phased Delivery (`docs/assistant-sdk-perception-plan.md`)

- **Phase 0 — Spec (this document): done.** Gate met: renders clean, every interface sketch
  checked against real signatures.
- **Phase 1 — Eval hardening: done.** The `score.ts` `structuredClone`/`toRaw` fix landed
  ahead of this phase (`0ebd74a4`); the `docs/ai-assistant-*.md` family plus five example
  fixtures are ported. L3.4/L5.3 closed — L5.3 was a real schema/runtime mismatch (`$switch`'s
  `$ref` required `#/$defs/...` when the runtime and every real example use `#/state/...`, and
  `SwitchNode` was never wired into the children-array union), not a prompt gap; L3.4 needed
  one `DESIGN_PRINCIPLES` rule (semantic HTML), not few-shot rework. Recovery axis recalibrated
  with a new deterministic injected-fault test. Gate met: 19/19 headless (worst-of-3, the 18
  original tests + the new fault test). Full turnover: `docs/ai-assistant-headless-harness.md`
  §6.
- **Phase 2 — Seam extraction (next).** Create `packages/assistant`, move the modules per §11.2,
  convert studio + the eval harness to `AssistantHost` implementations. Pure refactor — eval
  parity is the gate, not new capability.
- **Phase 3 — Perception (launch milestone).** §12 in full: protocol messages,
  `perception-host.ts`, the three new tools, automatic selection context, highlight feedback,
  the L6 eval layer.
- **Phase 4 — Extensibility.** Publish `@jxsuite/assistant`; a CLI reference `AssistantHost`;
  the extensions `assistant` admission block (§13).
- **Phase 5 (optional) — Server-side document-session API.** §13.

### 14.2 v1.x Candidates (independent of the phase plan above)

- **Full Anthropic provider** — `createAnthropicStreamingClient` beyond its current stub
  (§4.1): content-block delta model, `stop_reason` field, whole-JSON tool-argument blocks.
- **Image generation tool** — "generate a hero image," saved to the project's `public/`.
- **Markdown content editing** — AI edits content-collection Markdown files, not just Jx JSON
  documents.

### 14.3 v2 Candidates

- **Agent mode** — multi-step autonomous tasks ("build a full blog with posts, categories, and
  an RSS feed") without per-step confirmation. Requires trust calibration beyond today's
  optimistic-apply model (§8.1).
- **Voice input** — Web Speech API dictation into the composer.
- **Multi-modal input** — screenshots/design mockups as vision input.
- **MCP / external agent-framework integration.**
- **Fine-tuned Jx model** — a fine-tune on the Jx schema + examples for higher accuracy than a
  general-purpose model with a large system prompt.
- **Collaborative sessions** — multiple users in one chat session.
- **Server-side session persistence** — swap the `localStorage`-backed `ai-session-store.ts`
  for a server-backed store behind the same interface, once Phase 5's API exists.

---

## References

- [assistant-ui](https://github.com/assistant-ui/assistant-ui) — architecture inspiration.
- [OpenAI Streaming API](https://platform.openai.com/docs/api-reference/streaming)
- [Anthropic Streaming API](https://docs.anthropic.com/en/api/messages-streaming)
- `docs/assistant-sdk-perception-plan.md` — the plan of record this spec is Phase 0 of.
- `specs/extensions.md` — extension admission blocks + the core/extension dependency rule
  §13 relies on.
- `specs/studio.md`, `specs/studio-ui-guidelines.md` — Studio spec + UI conventions
  (lit-html, Spectrum, no inline styles).
- `specs/site-architecture.md` — site-level project structure (pages/layouts/components
  referenced throughout §6).
- `specs/spec.md` — the Jx document format itself.
