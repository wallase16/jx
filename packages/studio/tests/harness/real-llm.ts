/**
 * Real-llm.js — headless real-LLM harness for the Stack B agent loop.
 *
 * Assembles the _production_ pieces (`runAgentLoop`, `registerAiTools`, `buildSystemPrompt`,
 * `validateDoc` from `@jxsuite/assistant`) and drives them against a real OpenAI-compatible
 * endpoint — the same code the studio runs, minus the browser. This is the fast, deterministic
 * place to iterate the system prompt / tools / recovery loop (the logic axes); the studio keeps the
 * browser-only axes (rendered-DOM Correctness, Undo/Redo). The headless `AssistantHost` built here
 * wires `document.*` to the exact same `tabs/transact.ts` mutators the studio host uses, over a
 * `createTab()`-backed in-memory document (reactive, like a studio `Tab`, so `getDocument()`
 * de-proxies with `toRaw()` before it reaches validation/serialization — see specs/ai-assistant.md
 * §11.3's "Mapping notes").
 *
 * See docs/ai-assistant-headless-harness.md §3 Step 1.
 *
 * Config via env (per-run, so models swap freely): JX_AI_KEY — API key (required) JX_AI_BASE_URL —
 * OpenAI-compatible base URL (default OpenAI: https://api.openai.com/v1) JX_AI_MODEL — model id
 * (default gpt-5.4; baseline per the doc's §5.3 decision) JX_AI_TEMP — sampling temperature; omit
 * for reasoning models, set 0 for determinism
 */

// Happy-dom shim: createTab/@vue reactivity expect a DOM global to exist. Tools only touch the
// Plain `tab.doc.document` object, so the shim is all that's needed (doc §5.2).
import "../with-dom.ts";

import { createChatState, createToolRegistry, createOpenAIStreamingClient } from "@jxsuite/ai";
import type { ToolRegistry } from "@jxsuite/ai/tools";
import { registerAiTools, runAgentLoop, buildSystemPrompt } from "@jxsuite/assistant";
import type { AssistantHost } from "@jxsuite/assistant/host";
import { createTab, disposeTab } from "../../src/tabs/tab";
import type { Tab } from "../../src/tabs/tab";
import { toRaw } from "../../src/reactivity";
import { getNodeAtPath } from "../../src/state";
import {
  beginBatch,
  endBatch,
  isBatching,
  mutateInsertNode,
  mutateMoveNode,
  mutateRemoveNode,
  mutateUpdateProperty,
  mutateUpdateStyle,
  transactDoc,
} from "../../src/tabs/transact";
import type { JxNodeValue } from "../../src/tabs/transact";
import type { ComponentEntry } from "../../src/files/components";
import type { JxMutableNode, ProjectConfig } from "@jxsuite/schema/types";

const DEFAULT_MODEL = "gpt-5.4";

/**
 * Build the headless `AssistantHost`: `document` delegates to the same `transactDoc()`-wrapped
 * `mutate*` helpers the studio host uses (so undo/redo/patch recording behave identically), and
 * `files.saveFile` is wired to the harness's write sink when provided. `files.openDocument`
 * degrades explicitly — the headless harness has exactly one working document and never switches
 * it, matching today's behavior where `openDocument` was never injected into `registerAiTools` here
 * (the tool reported unavailable).
 */
function buildHeadlessHost(
  tab: Tab,
  saveFile?: ((relPath: string, content: string) => Promise<void>) | undefined,
): AssistantHost {
  const document: AssistantHost["document"] = {
    beginBatch: () => beginBatch(tab),
    endBatch: () => endBatch(),
    getDocument: () => toRaw(tab.doc.document) as JxMutableNode,
    getNodeAtPath: (path) => getNodeAtPath(tab.doc.document, path),
    insertNode: (parentPath, index, node) =>
      transactDoc(tab, (t) => mutateInsertNode(t, parentPath, index, node)),
    isBatching: () => isBatching(),
    moveNode: (fromPath, toParentPath, toIndex) =>
      transactDoc(tab, (t) => mutateMoveNode(t, fromPath, toParentPath, toIndex)),
    removeNode: (path) => transactDoc(tab, (t) => mutateRemoveNode(t, path)),
    setText: (path, value) =>
      transactDoc(tab, (t) => {
        const node = getNodeAtPath(t.doc.document, path);
        delete node.textContent;
        node.children = [value];
      }),
    updateProperty: (path, key, value) =>
      transactDoc(tab, (t) => mutateUpdateProperty(t, path, key, value as JxNodeValue)),
    updateState: (key, value) =>
      transactDoc(tab, (t) => {
        if (value === undefined) {
          if (t.doc.document.state) {
            delete t.doc.document.state[key];
          }
          return;
        }
        if (!t.doc.document.state) {
          t.doc.document.state = {};
        }
        t.doc.document.state[key] = value;
      }),
    updateStyle: (path, property, value) =>
      transactDoc(tab, (t) => mutateUpdateStyle(t, path, property, value)),
  };

  if (!saveFile) {
    return { document };
  }

  return {
    document,
    files: {
      openDocument: async () => {
        throw new Error("File navigation is not available in this environment.");
      },
      saveFile,
    },
  };
}

/**
 * Build a fully-wired headless harness around one working document.
 *
 * @param {object} opts
 * @param {Record<string, unknown>} opts.document - The page/component to edit (the live doc).
 * @param {Record<string, unknown>} [opts.projectConfig] - Project.json, for prompt context.
 * @param {{ name?: string; tag?: string; path?: string }[]} [opts.components] - Component list.
 * @param {string} [opts.projectRoot] - Absolute root, for prompt context + file-write tools.
 * @param {(relPath: string, content: string) => Promise<void>} [opts.saveFile] -
 *   Create_component/create_page sink.
 * @param {string} [opts.model] - Override JX_AI_MODEL.
 */
export function buildRealHarness({
  document,
  projectConfig,
  components,
  projectRoot,
  saveFile,
  model = process.env.JX_AI_MODEL || DEFAULT_MODEL,
}: {
  document: Record<string, unknown>;
  projectConfig?: Record<string, unknown>;
  components?: { name?: string; tag?: string; path?: string }[];
  projectRoot?: string;
  saveFile?: ((relPath: string, content: string) => Promise<void>) | undefined;
  model?: string;
}) {
  // Reuse the repo's existing OPENAI_* convention (packages/server/src/ai-api.js) so one .env key
  // Serves both the server and the harness; JX_AI_* overrides when you want a harness-only target.
  const apiKey = process.env.JX_AI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "No API key — set JX_AI_KEY or OPENAI_API_KEY (e.g. in a .env at the repo root).",
    );
  }

  const tab = createTab({ document, id: "harness" });

  const chatState = createChatState({ model });

  const toolRegistry = createToolRegistry() as ToolRegistry;
  const host = buildHeadlessHost(tab, saveFile);
  // Default `validate` (validateDoc) is the real schema check, so the loop self-corrects just like
  // Production — registerAiTools falls back to it whenever host.validation is absent.
  registerAiTools(toolRegistry, host);

  const temperature =
    process.env.JX_AI_TEMP === undefined ? undefined : Number(process.env.JX_AI_TEMP);
  const client = createOpenAIStreamingClient({
    baseUrl:
      process.env.JX_AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey,
    model,
    temperature,
  });

  const systemPrompt = buildSystemPrompt({
    document: document as JxMutableNode,
    projectConfig: projectConfig as ProjectConfig | undefined,
    components: components as ComponentEntry[] | undefined,
    projectRoot,
  });

  return {
    tab,
    chatState,
    toolRegistry,
    client,
    host,
    systemPrompt,
    model,
    dispose: () => disposeTab(tab),
  };
}

/**
 * Send one user prompt through the production agent loop and resolve when the turn settles.
 *
 * @param {ReturnType<typeof buildRealHarness>} h
 * @param {string} userText
 * @returns {Promise<ReturnType<typeof buildRealHarness>["chatState"]>}
 */
export async function runPrompt(h: ReturnType<typeof buildRealHarness>, userText: string) {
  h.chatState.sendMessage(userText);
  await runAgentLoop({
    chatState: h.chatState,
    host: h.host,
    streamingClient: h.client,
    toolRegistry: h.toolRegistry,
    systemPrompt: h.systemPrompt,
  });
  return h.chatState;
}
