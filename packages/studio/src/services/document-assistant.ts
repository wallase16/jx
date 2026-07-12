/// <reference lib="dom" />
/**
 * Document-assistant.js — Stack B (canonical) document AI assistant session
 *
 * Wires `@jxsuite/assistant` (tools, agent loop, system prompt, validation) to the active Jx
 * document via an `AssistantHost` whose `document` capability delegates to `tabs/transact`, and
 * drives the error-correction agent loop. See docs/ai-assistant-decision.md and
 * specs/ai-assistant.md §11 (the `AssistantHost` seam).
 *
 * @license MIT
 */

import { createChatState, createProxyStreamingClient, createToolRegistry } from "@jxsuite/ai";
import { registerAiTools, runAgentLoop, buildSystemPrompt, trimContext } from "@jxsuite/assistant";
import type { AssistantHost } from "@jxsuite/assistant/host";
import type {
  JxMutableNode,
  JxPath,
  JxStateDefinition,
  ProjectConfig,
} from "@jxsuite/schema/types";
import { getPlatform } from "../platform";
import { activeTab, workspace } from "../workspace/workspace";
import { toRaw } from "../reactivity";
import { componentRegistry } from "../files/components";
import { getNodeAtPath } from "../state";
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
} from "../tabs/transact";
import type { JxNodeValue } from "../tabs/transact";
import { getBaseUrl, getModel, getOpenAiKey } from "./ai-settings";
import { renderCheck } from "./render-critic";
import { openFileInTab } from "../files/files";
import * as sessionStore from "./ai-session-store";

/**
 * Project root scoping the session store (ADR §11.5 / §14.2 — conversations don't bleed across
 * projects). Falls back to a shared unscoped store when no project is open.
 *
 * @returns {string}
 */
function projectRoot() {
  return workspace.projectRoot || "";
}

/**
 * Build the studio `AssistantHost`: `document` delegates every mutation to a `transactDoc()`-
 * wrapped `mutate*` helper from `tabs/transact.ts` (so AI edits share undo/redo history with manual
 * edits), `getDocument()` de-proxies the reactive document with `toRaw()` before it reaches
 * validation/serialization, `renderCheck` wraps `render-critic.ts`, and `files`/`project` carry the
 * platform file API and the active project's style/config/components.
 *
 * @returns {AssistantHost}
 */
function buildStudioHost(): AssistantHost {
  const getTab = () => activeTab.value;

  const document: AssistantHost["document"] = {
    beginBatch: () => beginBatch(getTab()),
    endBatch: () => endBatch(),
    getDocument: () => {
      const tab = getTab();
      return tab ? (toRaw(tab.doc.document) as JxMutableNode) : null;
    },
    getNodeAtPath: (path: JxPath) => {
      const tab = getTab();
      return tab ? getNodeAtPath(tab.doc.document, path) : undefined;
    },
    insertNode: (parentPath, index, node) => {
      const tab = getTab();
      if (tab) {
        transactDoc(tab, (t) => mutateInsertNode(t, parentPath, index, node));
      }
    },
    isBatching: () => isBatching(),
    moveNode: (fromPath, toParentPath, toIndex) => {
      const tab = getTab();
      if (tab) {
        transactDoc(tab, (t) => mutateMoveNode(t, fromPath, toParentPath, toIndex));
      }
    },
    removeNode: (path) => {
      const tab = getTab();
      if (tab) {
        transactDoc(tab, (t) => mutateRemoveNode(t, path));
      }
    },
    setText: (path, value) => {
      const tab = getTab();
      if (!tab) {
        return;
      }
      transactDoc(tab, (t) => {
        const node = getNodeAtPath(t.doc.document, path);
        delete node.textContent;
        node.children = [value];
      });
    },
    updateProperty: (path, key, value) => {
      const tab = getTab();
      if (tab) {
        transactDoc(tab, (t) => mutateUpdateProperty(t, path, key, value as JxNodeValue));
      }
    },
    updateState: (key: string, value: JxStateDefinition | undefined) => {
      const tab = getTab();
      if (!tab) {
        return;
      }
      transactDoc(tab, (t) => {
        /*
         * Directly mutate — bypass mutateUpdateProperty because its "" → delete behaviour
         * (transact.ts:248) is wrong for state defaults (e.g. "title": "").
         */
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
      });
    },
    updateStyle: (path, property, value) => {
      const tab = getTab();
      if (tab) {
        transactDoc(tab, (t) => mutateUpdateStyle(t, path, property, value));
      }
    },
  };

  // Captured once at host-build time (session start) — matches today's registerAiTools call,
  // Which received projectStyle as a one-time snapshot rather than a live binding.
  const hostProjectConfig = (workspace.projectConfig as ProjectConfig | null) || undefined;
  const hostProjectStyle = hostProjectConfig?.style as Record<string, string> | undefined;
  const hostProjectRoot = workspace.projectRoot || undefined;
  const hostComponents = componentRegistry.length > 0 ? componentRegistry : undefined;

  const project: NonNullable<AssistantHost["project"]> = {};
  if (hostComponents) {
    project.components = hostComponents;
  }
  if (hostProjectConfig) {
    project.projectConfig = hostProjectConfig;
  }
  if (hostProjectRoot) {
    project.projectRoot = hostProjectRoot;
  }
  if (hostProjectStyle) {
    project.projectStyle = hostProjectStyle;
  }

  return {
    document,
    files: {
      openDocument: openFileInTab,
      saveFile: async (relPath: string, content: string) => {
        const plat = getPlatform();
        await plat.writeFile(relPath, content);
      },
    },
    project,
    renderCheck: renderCheck as (
      doc: unknown,
    ) => Promise<{ ok: true } | { ok: false; error: string }>,
  };
}

/**
 * Create a document-assistant session bound to the currently active tab.
 *
 * @returns {{
 *   chatState: ReturnType<typeof createChatState>;
 *   sendMessage: (text: string) => Promise<void>;
 *   stop: () => void;
 *   newChat: () => void;
 *   listSessions: () => import("./ai-session-store").SessionMeta[];
 *   openSession: (id: string) => void;
 *   deleteSession: (id: string) => void;
 *   activeSessionId: () => string | null;
 * }}
 */
export function createDocumentAssistant() {
  const chatState = createChatState({ model: getModel() });

  const host = buildStudioHost();
  const toolRegistry = createToolRegistry();
  registerAiTools(toolRegistry, host);

  let controller: AbortController | null = null;

  /** The persisted session backing the live chat; null = fresh unsaved chat. */
  let sessionId: string | null = null;

  function buildPrompt() {
    const tab = activeTab.value;
    return buildSystemPrompt({
      capabilities: { files: Boolean(host.files), renderCheck: Boolean(host.renderCheck) },
      components: componentRegistry.length > 0 ? componentRegistry : undefined,
      document: tab ? (toRaw(tab.doc.document) as JxMutableNode) : undefined,
      projectConfig: (workspace.projectConfig as ProjectConfig | null) || undefined,
      projectRoot: workspace.projectRoot || undefined,
    });
  }

  async function sendMessage(text: string) {
    if (!text.trim() || chatState.status === "streaming") {
      return;
    }

    // Lazily create the backing session on the first message so empty "New Chat"
    // Clicks never pollute the session list.
    if (!sessionId) {
      sessionId = sessionStore.createSession(projectRoot(), text).id;
    }

    chatState.sendMessage(text);

    // Trim context before streaming to keep the conversation within token limits.
    const trimmed = trimContext(chatState, buildPrompt());
    if (trimmed) {
      chatState.setTokenCount(trimmed.estimatedTokens);
    }

    // Persist after trimming so the saved history reflects what's actually sent.
    persistChat();

    try {
      const plat = getPlatform();
      const chatUrl = await Promise.resolve(plat.aiChatUrl());
      // Re-read the persisted model each send: the session is constructed once at module load
      // (before the user sets a key/model), so the picker's choice must be picked up here.
      chatState.setModel(getModel());
      const streamingClient = createProxyStreamingClient({
        apiKey: getOpenAiKey() || undefined,
        baseUrl: getBaseUrl() || undefined,
        chatUrl,
        model: chatState.model,
      });

      controller = new AbortController();
      await runAgentLoop({
        chatState,
        host,
        signal: controller.signal,
        streamingClient,
        systemPrompt: buildPrompt(),
        toolRegistry,
      });
    } catch (error) {
      /*
       * Synchronous failure (e.g. platform not registered, network unreachable before the
       * stream starts). Set the error so the panel can display it.
       */
      chatState.setError(error instanceof Error ? error.message : String(error));
    } finally {
      controller = null;
      // Persist again once the stream settled so the completed reply (or the state
      // After an error/abort cleanup) survives a reload without another send.
      persistChat();
    }
  }

  function stop() {
    controller?.abort();
    chatState.cancelStream();
  }

  function newChat() {
    stop();
    chatState.clearChat();
    sessionId = null;
    sessionStore.setActiveSession(projectRoot(), null);
  }

  // ── Sessions ──────────────────────────────────────────────────────────

  /** The project's persisted sessions, most recently updated first. */
  function listSessions() {
    return sessionStore.listSessions(projectRoot());
  }

  /** Replace the live chat with a persisted session's messages. */
  function openSession(id: string) {
    const msgs = sessionStore.loadSession(projectRoot(), id);
    if (!msgs) {
      return;
    }
    stop();
    chatState.clearChat();
    pushRestoredMessages(msgs);
    sessionId = id;
    sessionStore.setActiveSession(projectRoot(), id);
  }

  /** Delete a persisted session; deleting the open one leaves a fresh unsaved chat. */
  function deleteSession(id: string) {
    sessionStore.deleteSession(projectRoot(), id);
    if (sessionId === id) {
      stop();
      chatState.clearChat();
      sessionId = null;
    }
  }

  function activeSessionId() {
    return sessionId;
  }

  // ── Persistence ───────────────────────────────────────────────────────

  /** Persist the live conversation into its backing session (non-blocking). */
  function persistChat() {
    if (!sessionId) {
      return;
    }
    // Skip a still-empty streaming placeholder so reloads don't restore blank bubbles.
    const msgs = chatState.messages.filter(
      (m) => m.role !== "assistant" || m.content || (m.toolCalls?.length ?? 0) > 0,
    );
    sessionStore.saveSession(projectRoot(), sessionId, msgs);
  }

  /** Push persisted messages into chat state, synthesizing ids where missing. */
  function pushRestoredMessages(msgs: sessionStore.PersistedMessage[]) {
    for (const m of msgs) {
      chatState.messages.push({
        ...m,
        id: m.id || `restored_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      } as (typeof chatState.messages)[number]);
    }
  }

  /** Restore the last-active session once on creation, if any. */
  function restoreChat() {
    const root = projectRoot();
    const activeId = sessionStore.getActiveSessionId(root);
    if (!activeId) {
      return;
    }
    const msgs = sessionStore.loadSession(root, activeId);
    if (!msgs || msgs.length === 0) {
      return;
    }
    pushRestoredMessages(msgs);
    sessionId = activeId;
  }

  // Restore once on creation.
  restoreChat();

  return {
    activeSessionId,
    chatState,
    deleteSession,
    listSessions,
    newChat,
    openSession,
    sendMessage,
    stop,
  };
}
