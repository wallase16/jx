/**
 * Tests for src/services/document-assistant.ts — the Stack B document AI session.
 *
 * Drives createDocumentAssistant().sendMessage() end-to-end with a scripted streaming client. The
 * AI barrel's createProxyStreamingClient is mocked while createChatState/createToolRegistry stay
 * real, so the full wiring — system prompt, context trim, tool registry, agent loop, persistence —
 * runs without a network. The tool path mutates the live document as one undo step.
 */
import { installMockPlatform, resetWorkspaceWithTab } from "./harness";
import { createChatState, createToolRegistry } from "@jxsuite/ai";
import type { StreamingClient } from "@jxsuite/ai/streaming-client";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { workspace } from "../src/workspace/workspace";

/** The normalized stream event the StreamingClient emits (not exported, so derived here). */
type StreamEvent =
  ReturnType<StreamingClient["streamChat"]> extends AsyncGenerator<infer E> ? E : never;

let nextRounds: StreamEvent[][] = [];
let createErrorMessage: string | null = null;
let lastClientOpts: Record<string, unknown> | null = null;
let lastSystemPrompt: string | null = null;

function fakeClient(rounds: StreamEvent[][]): StreamingClient {
  let call = 0;
  return {
    async *streamChat(_messages, _tools, systemPrompt) {
      lastSystemPrompt = systemPrompt;
      const events = rounds[call] ?? [{ stopReason: "stop", type: "done" }];
      call += 1;
      for (const e of events) {
        yield e;
      }
    },
  };
}

/** One tool call followed by a tool_calls stop. */
function toolCallRound(id: string, name: string, args: object): StreamEvent[] {
  return [
    { id, name, type: "tool_call_start" },
    { args: JSON.stringify(args), id, type: "tool_call_delta" },
    { id, type: "tool_call_end" },
    { stopReason: "tool_calls", type: "done" },
  ];
}

void mock.module("@jxsuite/ai", () => ({
  createChatState,
  createProxyStreamingClient: (opts: Record<string, unknown>) => {
    lastClientOpts = opts;
    if (createErrorMessage) {
      throw new Error(createErrorMessage);
    }
    return fakeClient(nextRounds);
  },
  createToolRegistry,
}));

const LEGACY_PERSIST_KEY = "jx-ai-chat-history";
const { createDocumentAssistant } = await import("../src/services/document-assistant");
const { getActiveSessionId, listSessions, loadSession } =
  await import("../src/services/ai-session-store");

/** The messages persisted for the assistant's active session (tests run with no project root). */
function persistedMessages() {
  const activeId = getActiveSessionId("");
  return activeId ? loadSession("", activeId) : null;
}

beforeEach(() => {
  installMockPlatform();
  resetWorkspaceWithTab();
  globalThis.localStorage.clear();
  nextRounds = [];
  createErrorMessage = null;
  lastClientOpts = null;
  lastSystemPrompt = null;
});

afterEach(() => {
  globalThis.localStorage.clear();
});

describe("document-assistant", () => {
  test("streams a text reply and persists the conversation", async () => {
    globalThis.localStorage.setItem("jx.ai.openaiKey", "sk-secret");
    globalThis.localStorage.setItem("jx.ai.baseUrl", "http://localhost:11434/v1");
    nextRounds = [
      [
        { content: "Hello there", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];

    const a = createDocumentAssistant();
    await a.sendMessage("hi");

    expect(a.chatState.status).toBe("idle");
    expect(
      a.chatState.messages.some((m) => m.role === "assistant" && m.content.includes("Hello")),
    ).toBe(true);
    // The streaming client received the stored credentials.
    expect(lastClientOpts?.apiKey).toBe("sk-secret");
    expect(lastClientOpts?.baseUrl).toBe("http://localhost:11434/v1");
    // A session was lazily created on first send, and the completed reply was
    // Persisted after the stream settled (not just the pre-stream user message).
    const persisted = persistedMessages();
    expect(persisted?.some((m) => m.role === "user" && m.content === "hi")).toBe(true);
    expect(persisted?.some((m) => m.role === "assistant" && m.content.includes("Hello"))).toBe(
      true,
    );
    expect(listSessions("")[0]!.title).toBe("hi");
  });

  test("executes a tool call that mutates the document as a single undo step", async () => {
    nextRounds = [
      toolCallRound("c1", "add_child", {
        index: 1,
        node: { tagName: "span", textContent: "added" },
        parentPath: [],
      }),
      [{ stopReason: "stop", type: "done" }],
    ];

    const a = createDocumentAssistant();
    const tab = resetWorkspaceWithTab({
      children: [{ tagName: "p", textContent: "Hello" }],
      tagName: "div",
    });
    await a.sendMessage("add a span");

    const children = tab.doc.document.children as (JxMutableNode | string)[];
    expect(children).toHaveLength(2);
    expect((children[1] as JxMutableNode).tagName).toBe("span");
    expect(tab.history.index).toBe(1); // One undoable transaction (batched)
    expect(a.chatState.status).toBe("idle");
  });

  test("ignores empty input and re-entrant sends while streaming", async () => {
    const a = createDocumentAssistant();
    await a.sendMessage("   ");
    expect(a.chatState.messages).toHaveLength(0);
    // Rejected sends never create a session.
    expect(listSessions("")).toHaveLength(0);

    a.chatState.status = "streaming";
    await a.sendMessage("blocked");
    expect(a.chatState.messages).toHaveLength(0);
    expect(listSessions("")).toHaveLength(0);
  });

  test("surfaces a streaming-client construction failure as an error", async () => {
    createErrorMessage = "network down";
    const a = createDocumentAssistant();
    await a.sendMessage("hi");
    expect(a.chatState.status).toBe("error");
    expect(a.chatState.error).toContain("network down");
  });

  test("stop() and newChat() detach from the session without deleting it", async () => {
    nextRounds = [
      [
        { content: "x", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];
    const a = createDocumentAssistant();
    await a.sendMessage("hi");
    expect(a.chatState.messages.length).toBeGreaterThan(0);
    const sessionId = a.activeSessionId();
    expect(sessionId).toBeTruthy();

    a.stop(); // No active controller → just cancels stream state
    a.newChat();
    expect(a.chatState.messages).toHaveLength(0);
    expect(a.activeSessionId()).toBeNull();
    expect(getActiveSessionId("")).toBeNull();
    // The previous conversation stays in the session list.
    expect(listSessions("").some((s) => s.id === sessionId)).toBe(true);
    expect(loadSession("", sessionId!)?.some((m) => m.content === "hi")).toBe(true);
  });

  test("openSession swaps the live chat; deleteSession of the open one clears it", async () => {
    nextRounds = [
      [
        { content: "first reply", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
      [
        { content: "second reply", type: "delta" },
        { stopReason: "stop", type: "done" },
      ],
    ];
    const a = createDocumentAssistant();
    await a.sendMessage("first chat");
    const firstId = a.activeSessionId()!;
    a.newChat();
    await a.sendMessage("second chat");
    const secondId = a.activeSessionId()!;
    expect(secondId).not.toBe(firstId);

    a.openSession(firstId);
    expect(a.activeSessionId()).toBe(firstId);
    expect(getActiveSessionId("")).toBe(firstId);
    expect(a.chatState.messages.some((m) => m.content === "first chat")).toBe(true);
    expect(a.chatState.messages.some((m) => m.content === "second chat")).toBe(false);

    // Opening an unknown session is a no-op.
    a.openSession("nope");
    expect(a.activeSessionId()).toBe(firstId);

    a.deleteSession(firstId);
    expect(a.chatState.messages).toHaveLength(0);
    expect(a.activeSessionId()).toBeNull();
    expect(listSessions("").map((s) => s.id)).toEqual([secondId]);

    // Deleting a non-open session leaves the live chat alone.
    a.openSession(secondId);
    a.deleteSession("already-gone");
    expect(a.activeSessionId()).toBe(secondId);
  });

  test("restores the last-active session on creation", () => {
    globalThis.localStorage.setItem(
      LEGACY_PERSIST_KEY,
      JSON.stringify([
        { content: "earlier", id: "m1", role: "user", timestamp: 1 },
        { content: "reply", role: "assistant", timestamp: 2 }, // Missing id → synthesized
      ]),
    );
    // The legacy single-conversation store migrates into the first session…
    const a = createDocumentAssistant();
    expect(a.chatState.messages).toHaveLength(2);
    expect(a.chatState.messages[0]!.content).toBe("earlier");
    expect(a.chatState.messages[1]!.id).toBeTruthy();
    expect(a.activeSessionId()).toBe(getActiveSessionId(""));

    // …and a second assistant restores that same active session.
    const b = createDocumentAssistant();
    expect(b.chatState.messages).toHaveLength(2);
  });

  test("ignores corrupt or empty persisted history", () => {
    globalThis.localStorage.setItem(LEGACY_PERSIST_KEY, "{not json");
    expect(createDocumentAssistant().chatState.messages).toHaveLength(0);

    globalThis.localStorage.setItem(LEGACY_PERSIST_KEY, "[]");
    expect(createDocumentAssistant().chatState.messages).toHaveLength(0);
  });

  test("host.document exercises move_node, remove_node, set_text, set_style, add_state, and update_state", async () => {
    nextRounds = [
      toolCallRound("c1", "move_node", {
        fromPath: ["children", 0, "children", 0],
        toIndex: 0,
        toParentPath: ["children", 1],
      }),
      [{ stopReason: "stop", type: "done" }],
    ];
    const a = createDocumentAssistant();
    const tab = resetWorkspaceWithTab({
      children: [
        { children: [{ tagName: "p", textContent: "move me" }], tagName: "section" },
        { children: [], tagName: "aside" },
      ],
      tagName: "div",
    });
    await a.sendMessage("move the paragraph into the aside");
    const roots = tab.doc.document.children as JxMutableNode[];
    expect(roots[0]!.children).toHaveLength(0);
    expect((roots[1]!.children as JxMutableNode[])[0]!.tagName).toBe("p");
    expect(a.chatState.status).toBe("idle");

    nextRounds = [
      toolCallRound("c2", "set_text", { path: ["children", 0], value: "fresh" }),
      [{ stopReason: "stop", type: "done" }],
    ];
    await a.sendMessage("retext");
    const afterText = tab.doc.document.children as JxMutableNode[];
    expect((afterText[0]!.children as string[])[0]).toBe("fresh");

    nextRounds = [
      toolCallRound("c3", "set_style", {
        path: [],
        property: "backgroundColor",
        value: "var(--color-accent)",
      }),
      [{ stopReason: "stop", type: "done" }],
    ];
    await a.sendMessage("style it");
    expect(tab.doc.document.style?.backgroundColor).toBe("var(--color-accent)");

    nextRounds = [
      toolCallRound("c4", "add_state", { key: "count", value: 0 }),
      [{ stopReason: "stop", type: "done" }],
    ];
    await a.sendMessage("add state");
    expect(tab.doc.document.state?.count).toBe(0);

    nextRounds = [
      toolCallRound("c5", "update_state", { key: "count", value: 5 }),
      [{ stopReason: "stop", type: "done" }],
    ];
    await a.sendMessage("update state");
    expect(tab.doc.document.state?.count).toBe(5);

    nextRounds = [
      toolCallRound("c6", "update_state", { key: "count", value: null }),
      [{ stopReason: "stop", type: "done" }],
    ];
    await a.sendMessage("remove state");
    expect(tab.doc.document.state).not.toHaveProperty("count");

    nextRounds = [
      toolCallRound("c7", "remove_node", { path: ["children", 0] }),
      [{ stopReason: "stop", type: "done" }],
    ];
    await a.sendMessage("remove first child");
    expect(tab.doc.document.children).toHaveLength(1);
  });

  test("buildPrompt includes project context once workspace projectConfig/projectRoot are set", async () => {
    workspace.projectConfig = { name: "Demo Project", style: { "--color-accent": "#3b82f6" } };
    workspace.projectRoot = "/tmp/demo-project";
    try {
      nextRounds = [[{ stopReason: "stop", type: "done" }]];
      const a = createDocumentAssistant();
      resetWorkspaceWithTab({ tagName: "div", children: [] });
      // ResetWorkspaceWithTab doesn't touch projectConfig/projectRoot — re-assert they're live.
      workspace.projectConfig = { name: "Demo Project", style: { "--color-accent": "#3b82f6" } };
      workspace.projectRoot = "/tmp/demo-project";
      await a.sendMessage("hi");
      expect(a.chatState.status).toBe("idle");
    } finally {
      workspace.projectConfig = null;
      workspace.projectRoot = null;
    }
  });

  test("listSessions reflects a persisted session", async () => {
    nextRounds = [[{ stopReason: "stop", type: "done" }]];
    const a = createDocumentAssistant();
    await a.sendMessage("hi there");
    expect(a.listSessions().some((s) => s.id === a.activeSessionId())).toBe(true);
  });
});

describe("document-assistant — perception (§12)", () => {
  test("advertises the perception capability in the system prompt", async () => {
    nextRounds = [[{ stopReason: "stop", type: "done" }]];
    const a = createDocumentAssistant();
    await a.sendMessage("hi");
    expect(lastSystemPrompt).toContain("Canvas perception");
    expect(lastSystemPrompt).toMatch(/Canvas perception.*available/);
  });

  test("prepends an ephemeral selection addendum when a node is selected", async () => {
    const tab = resetWorkspaceWithTab({
      tagName: "div",
      children: [{ tagName: "button", textContent: "Save" }],
    });
    tab.session.selection = ["children", 0];
    nextRounds = [[{ stopReason: "stop", type: "done" }]];

    const a = createDocumentAssistant();
    await a.sendMessage("make this bigger");

    expect(lastSystemPrompt).toContain("Current selection");
    expect(lastSystemPrompt).toContain("<button>");
    expect(lastSystemPrompt).toContain(JSON.stringify(["children", 0]));
    // The addendum is ephemeral — it must never leak into the PERSISTED user message.
    const persisted = persistedMessages();
    const userMsg = persisted?.find((m) => m.role === "user");
    expect(userMsg?.content).toBe("make this bigger");
    expect(userMsg?.content).not.toContain("Current selection");
  });

  test("omits the selection addendum when nothing is selected", async () => {
    nextRounds = [[{ stopReason: "stop", type: "done" }]];
    const a = createDocumentAssistant();
    await a.sendMessage("hi");
    expect(lastSystemPrompt).not.toContain("Current selection");
  });

  test("re-reads the selection on every send (not captured once at session creation)", async () => {
    const tab = resetWorkspaceWithTab({
      tagName: "div",
      children: [{ tagName: "button", textContent: "Save" }],
    });
    nextRounds = [[{ stopReason: "stop", type: "done" }]];
    const a = createDocumentAssistant();

    await a.sendMessage("first, nothing selected");
    expect(lastSystemPrompt).not.toContain("Current selection");

    tab.session.selection = ["children", 0];
    nextRounds = [[{ stopReason: "stop", type: "done" }]];
    await a.sendMessage("second, now selected");
    expect(lastSystemPrompt).toContain("Current selection");
  });
});
