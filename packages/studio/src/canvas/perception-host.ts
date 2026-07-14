/// <reference lib="dom" />
/**
 * Perception-host.js — the studio `PerceptionCapability` implementation for `AssistantHost`
 * (specs/ai-assistant.md §12). `getSelection` reads `tab.session.selection` directly; `getRenderedTree`
 * / `measure` round-trip the `enumerate`/`measure` messages over the SAME postMessage channel
 * `iframe-host.ts` already owns for the active canvas panel (`hostForCanvas`/`postDragMessage` — a
 * generic send despite its drag-session name); `highlight` is fire-and-forget.
 *
 * @license MIT
 */

import { getActivePanel } from "./canvas-helpers";
import { hostForCanvas, postDragMessage } from "./iframe-host";
import type { DragHost } from "./iframe-host";
import type { IframeToParent } from "./iframe-protocol";
import type { PerceptionCapability, RenderedNode, SerializableRect } from "@jxsuite/assistant/host";
import type { JxPath } from "@jxsuite/schema/types";
import type { Tab } from "../tabs/tab";

/** How long to wait for an `enumerate`/`measure` reply before giving up and resolving empty. */
const REQUEST_TIMEOUT_MS = 2000;

/**
 * Negative, module-scoped counter for `enumerate`/`measure` requests this capability issues —
 * disjoint from `iframe-host.ts`'s own (positive, per-host) `selReqId`/`presenceReqId`/`panReqId`
 * counters, so a `geometry`/`renderedTree` reply can never be misrouted to the wrong requester even
 * though every listener on the shared channel sees every message.
 */
let nextReqId = -1;

/** The `HostState` for the tab's currently active canvas panel, or null if none is mounted. */
function activeCanvasHost(): DragHost | null {
  const panel = getActivePanel();
  return panel ? hostForCanvas(panel.canvas) : null;
}

/** One `enumerate` round trip: post it, resolve on the matching `renderedTree`, or time out empty. */
function requestRenderedTree(host: DragHost, root: JxPath | undefined): Promise<RenderedNode[]> {
  return new Promise((resolve) => {
    const reqId = nextReqId;
    nextReqId -= 1;
    let settled = false;
    const off = host.channel.onMessage((msg: IframeToParent) => {
      if (settled || msg.kind !== "renderedTree" || msg.reqId !== reqId) {
        return;
      }
      settled = true;
      off();
      resolve(msg.nodes);
    });
    postDragMessage(host, { kind: "enumerate", reqId, ...(root ? { root } : {}) });
    setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      off();
      resolve([]);
    }, REQUEST_TIMEOUT_MS);
  });
}

/** One `measure` round trip: post it, resolve on the matching `geometry`, or time out empty. */
function requestMeasure(
  host: DragHost,
  paths: JxPath[],
): Promise<{ path: JxPath; rect: SerializableRect }[]> {
  return new Promise((resolve) => {
    const reqId = nextReqId;
    nextReqId -= 1;
    let settled = false;
    const off = host.channel.onMessage((msg: IframeToParent) => {
      if (settled || msg.kind !== "geometry" || msg.reqId !== reqId) {
        return;
      }
      settled = true;
      off();
      resolve(msg.hits);
    });
    postDragMessage(host, { kind: "measure", paths, reqId });
    setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      off();
      resolve([]);
    }, REQUEST_TIMEOUT_MS);
  });
}

/**
 * Build the `PerceptionCapability` for a tab, re-resolving `getTab()` and the active canvas panel
 * on every call (never captured once) — matching how the studio `AssistantHost.document` capability
 * re-reads `activeTab.value` each call, so the capability always reflects whichever tab/panel is
 * currently active.
 */
export function createPerceptionHost(getTab: () => Tab | null): PerceptionCapability {
  return {
    getSelection: () => getTab()?.session.selection ?? null,
    async getRenderedTree(opts) {
      const host = activeCanvasHost();
      if (!host) {
        return [];
      }
      return requestRenderedTree(host, opts?.root);
    },
    async measure(paths) {
      const host = activeCanvasHost();
      if (!host || paths.length === 0) {
        return [];
      }
      return requestMeasure(host, paths);
    },
    highlight(paths, opts) {
      const host = activeCanvasHost();
      if (!host || paths.length === 0) {
        return;
      }
      postDragMessage(host, { kind: "highlight", paths, ttl: opts?.ttl ?? 1500 });
    },
  };
}
