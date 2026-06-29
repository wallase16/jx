/**
 * Code — Figma plugin sandbox entry.
 *
 * Runs in Figma's sandbox (no DOM). Serializes the current selection into the converter's plain
 * `FigmaNode` shape and posts it to the UI iframe, where figmaToJx + the Jx runtime render a live
 * preview. Re-posts whenever the selection changes.
 *
 * Phase 2: also handles image-export requests from the UI — the sandbox has access to
 * `figma.getImageByHash()` which the iframe does not.
 *
 * @license MIT
 */

import { serializeNode } from "../src/convert/serialize.ts";
import type { RawFigmaNode } from "../src/convert/serialize.ts";

interface FigmaImage {
  getBytesAsync: () => Promise<Uint8Array>;
}

interface FigmaApi {
  showUI: (html: string, opts: { width: number; height: number; themeColors?: boolean }) => void;
  currentPage: { selection: readonly RawFigmaNode[] };
  ui: { postMessage: (msg: unknown) => void };
  on: (event: string, handler: () => void) => void;
  getImageByHash: (hash: string) => FigmaImage | null;
}

declare const figma: FigmaApi;
declare const __html__: string;

function collectImageRefs(node: RawFigmaNode): string[] {
  const refs: string[] = [];
  if (Array.isArray(node.fills)) {
    for (const fill of node.fills as { type?: string; imageRef?: string }[]) {
      if (fill.type === "IMAGE" && fill.imageRef) {
        refs.push(fill.imageRef);
      }
    }
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      refs.push(...collectImageRefs(child));
    }
  }
  return refs;
}

function postSelection(): void {
  const [selected] = figma.currentPage.selection;
  if (!selected) {
    // oxlint-disable-next-line require-post-message-target-origin -- Figma's plugin postMessage takes no targetOrigin.
    figma.ui.postMessage({ type: "empty" });
    return;
  }
  const node = serializeNode(selected);
  const imageRefs = [...new Set(collectImageRefs(selected))];
  // oxlint-disable-next-line require-post-message-target-origin -- Figma's plugin postMessage takes no targetOrigin.
  figma.ui.postMessage({ type: "node", node, imageRefs });
}

async function handleImageRequest(refs: string[]): Promise<void> {
  const images: Record<string, number[]> = {};
  for (const ref of refs) {
    const image = figma.getImageByHash(ref);
    if (image) {
      const bytes = await image.getBytesAsync();
      images[ref] = [...bytes];
    }
  }
  // oxlint-disable-next-line require-post-message-target-origin -- Figma's plugin postMessage takes no targetOrigin.
  figma.ui.postMessage({ type: "images", images });
}

figma.showUI(__html__, { width: 480, height: 640, themeColors: true });
postSelection();
figma.on("selectionchange", postSelection);

// oxlint-disable-next-line no-restricted-globals -- Figma plugin sandbox uses onmessage for UI→sandbox communication.
onmessage = (event: MessageEvent<{ pluginMessage?: { type: string; refs?: string[] } }>) => {
  const msg = event.data.pluginMessage;
  if (msg?.type === "request-images" && msg.refs) {
    void handleImageRequest(msg.refs);
  }
};
