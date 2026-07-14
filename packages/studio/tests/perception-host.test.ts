/**
 * Tests for src/canvas/perception-host.ts — the studio `PerceptionCapability` implementation
 * (specs/ai-assistant.md §12). Mocks `iframe-channel.ts` the same way iframe-host.test.ts does, so
 * `enumerate`/`measure`/`highlight` posts can be captured and replies injected without a real
 * iframe.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { canvasPanels } from "../src/store";
import { resetWorkspaceWithTab } from "./harness";
import type { CanvasPanel } from "../src/types";

const { happyDOM } = globalThis as unknown as { happyDOM: { setURL: (u: string) => void } };
happyDOM.setURL("http://localhost:3000/");

interface FakeChannel {
  posts: Record<string, unknown>[];
  deliver: (m: Record<string, unknown>) => void;
}
const channels: FakeChannel[] = [];

void mock.module("../src/canvas/iframe-channel", () => ({
  postMessageChannel: () => {
    let handler: ((m: Record<string, unknown>) => void) | null = null;
    const rec: FakeChannel = { deliver: (m) => handler?.(m), posts: [] };
    channels.push(rec);
    return {
      dispose: () => {},
      onMessage: (h: (m: Record<string, unknown>) => void) => {
        handler = h;
        return () => {};
      },
      post: (m: Record<string, unknown>) => {
        rec.posts.push(m);
      },
    };
  },
}));

// The host imports applyDropInstruction (panels/dnd → stylebook-panel); stub it light (as
// Iframe-host.test.ts does) so mounting doesn't pull in the real stylebook preview renderer.
void mock.module("../src/panels/stylebook-panel", () => ({
  renderComponentPreview: async () => document.createElement("div"),
}));

void mock.module("../src/canvas/canvas-live-render", () => ({
  resolveCanvasDocument: () =>
    Promise.resolve({
      docBase: "http://localhost:3000/doc.json",
      mapperCtx: {
        arrayPaths: [],
        canvasMode: "design",
        layoutWrapped: false,
        pageContentOffset: null,
        pageContentPrefix: null,
      },
      renderDoc: { children: [], tagName: "div" },
      siteStyle: null,
    }),
}));

const { mountIframeCanvas } = await import("../src/canvas/iframe-host");
const { createPerceptionHost } = await import("../src/canvas/perception-host");

/** Mount a fresh iframe canvas + register it as the (only) active panel, return its fake channel. */
async function mountPanel(): Promise<FakeChannel> {
  const canvasEl = document.createElement("div");
  document.body.append(canvasEl);
  canvasPanels.push({ canvas: canvasEl, mediaName: "base" } as unknown as CanvasPanel);
  await mountIframeCanvas(1, { tagName: "div", children: [] } as never, canvasEl);
  return channels.at(-1)!;
}

beforeEach(() => {
  channels.length = 0;
  canvasPanels.length = 0;
  document.body.innerHTML = "";
});

describe("perception-host — getSelection", () => {
  test("reads tab.session.selection live, re-resolving getTab() each call", () => {
    const tab = resetWorkspaceWithTab({ tagName: "div", children: [] });
    const capability = createPerceptionHost(() => tab);
    expect(capability.getSelection()).toBeNull();
    tab.session.selection = ["children", 0];
    expect(capability.getSelection()).toEqual(["children", 0]);
  });

  test("returns null when there's no active tab", () => {
    const capability = createPerceptionHost(() => null);
    expect(capability.getSelection()).toBeNull();
  });
});

describe("perception-host — no mounted canvas panel", () => {
  test("getRenderedTree/measure/highlight degrade to empty/no-op", async () => {
    const capability = createPerceptionHost(() => null);
    expect(await capability.getRenderedTree()).toEqual([]);
    expect(await capability.measure([["children", 0]])).toEqual([]);
    expect(() => capability.highlight!([["children", 0]])).not.toThrow();
  });
});

describe("perception-host — getRenderedTree", () => {
  test("round-trips an enumerate → renderedTree exchange, threading root through", async () => {
    const channel = await mountPanel();
    const capability = createPerceptionHost(() => null);

    const pending = capability.getRenderedTree({ root: ["children", 0] });
    const req = channel.posts.find((p) => p.kind === "enumerate")!;
    expect(req.root).toEqual(["children", 0]);
    channel.deliver({
      kind: "renderedTree",
      nodes: [
        { childCount: 0, path: [], rect: { height: 1, width: 1, x: 0, y: 0 }, tagName: "div" },
      ],
      reqId: req.reqId,
    });

    const nodes = await pending;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.tagName).toBe("div");
  });

  test("omits root from the enumerate post when scoping the whole canvas", async () => {
    const channel = await mountPanel();
    const capability = createPerceptionHost(() => null);

    const pending = capability.getRenderedTree();
    const req = channel.posts.find((p) => p.kind === "enumerate")!;
    expect("root" in req).toBe(false);
    channel.deliver({ kind: "renderedTree", nodes: [], reqId: req.reqId });
    expect(await pending).toEqual([]);
  });

  test("ignores a renderedTree reply for a different reqId", async () => {
    const channel = await mountPanel();
    const capability = createPerceptionHost(() => null);

    const pending = capability.getRenderedTree();
    const req = channel.posts.find((p) => p.kind === "enumerate")!;
    channel.deliver({ kind: "renderedTree", nodes: [{ tagName: "stale" }], reqId: -9999 });
    channel.deliver({ kind: "renderedTree", nodes: [], reqId: req.reqId });
    expect(await pending).toEqual([]);
  });

  test("resolves empty after the request times out unanswered", async () => {
    await mountPanel();
    const capability = createPerceptionHost(() => null);
    expect(await capability.getRenderedTree()).toEqual([]);
  }, 3000);
});

describe("perception-host — measure", () => {
  test("round-trips a measure → geometry exchange", async () => {
    const channel = await mountPanel();
    const capability = createPerceptionHost(() => null);

    const pending = capability.measure([["children", 0]]);
    const req = channel.posts.find((p) => p.kind === "measure")!;
    expect(req.paths).toEqual([["children", 0]]);
    channel.deliver({
      hits: [{ path: ["children", 0], rect: { height: 2, width: 2, x: 1, y: 1 } }],
      kind: "geometry",
      reqId: req.reqId,
    });

    const hits = await pending;
    expect(hits).toEqual([{ path: ["children", 0], rect: { height: 2, width: 2, x: 1, y: 1 } }]);
  });

  test("resolves empty for an empty paths array without posting anything", async () => {
    const channel = await mountPanel();
    const capability = createPerceptionHost(() => null);
    expect(await capability.measure([])).toEqual([]);
    expect(channel.posts.some((p) => p.kind === "measure")).toBe(false);
  });

  test("resolves empty after the request times out unanswered", async () => {
    await mountPanel();
    const capability = createPerceptionHost(() => null);
    expect(await capability.measure([["children", 0]])).toEqual([]);
  }, 3000);
});

describe("perception-host — highlight", () => {
  test("posts a highlight message with the given paths and a default ttl", async () => {
    const channel = await mountPanel();
    const capability = createPerceptionHost(() => null);
    capability.highlight!([
      ["children", 0],
      ["children", 1],
    ]);
    const msg = channel.posts.find((p) => p.kind === "highlight")!;
    expect(msg.paths).toEqual([
      ["children", 0],
      ["children", 1],
    ]);
    expect(msg.ttl).toBe(1500);
  });

  test("honors a custom ttl", async () => {
    const channel = await mountPanel();
    const capability = createPerceptionHost(() => null);
    capability.highlight!([["children", 0]], { ttl: 250 });
    const msg = channel.posts.find((p) => p.kind === "highlight")!;
    expect(msg.ttl).toBe(250);
  });

  test("is a no-op for an empty paths array", async () => {
    const channel = await mountPanel();
    const capability = createPerceptionHost(() => null);
    capability.highlight!([]);
    expect(channel.posts.some((p) => p.kind === "highlight")).toBe(false);
  });
});
