/**
 * Code — Figma plugin sandbox entry.
 *
 * Runs in Figma's sandbox (no DOM). Serializes the current selection into the converter's plain
 * `FigmaNode` shape and posts it to the UI iframe, where figmaToJx + the Jx runtime render a live
 * preview. Re-posts whenever the selection changes.
 *
 * @license MIT
 */

import { serializeNode } from "../src/convert/serialize.ts";
import type { RawFigmaNode } from "../src/convert/serialize.ts";

/** Minimal view of the Figma plugin global this spike relies on. */
interface FigmaApi {
  showUI: (html: string, opts: { width: number; height: number; themeColors?: boolean }) => void;
  currentPage: { selection: readonly RawFigmaNode[] };
  ui: { postMessage: (msg: unknown) => void };
  on: (event: string, handler: () => void) => void;
}

declare const figma: FigmaApi;
declare const __html__: string;

function postSelection(): void {
  const [selected] = figma.currentPage.selection;
  if (!selected) {
    // oxlint-disable-next-line require-post-message-target-origin -- Figma's plugin postMessage takes no targetOrigin.
    figma.ui.postMessage({ type: "empty" });
    return;
  }
  // oxlint-disable-next-line require-post-message-target-origin -- Figma's plugin postMessage takes no targetOrigin.
  figma.ui.postMessage({ type: "node", node: serializeNode(selected) });
}

figma.showUI(__html__, { width: 480, height: 640, themeColors: true });
postSelection();
figma.on("selectionchange", postSelection);
