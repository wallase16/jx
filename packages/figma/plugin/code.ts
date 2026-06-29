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

interface RawComponentPropertyDef {
  type?: string;
  defaultValue?: string | boolean;
}

interface RawVariantComponent {
  type?: string;
  variantProperties?: Record<string, string>;
  children?: RawFigmaNode[];
  [key: string]: unknown;
}

interface MainComponentRef {
  name?: string;
  parent?: {
    type?: string;
    name?: string;
    componentPropertyDefinitions?: Record<string, RawComponentPropertyDef>;
    children?: RawVariantComponent[];
  };
}

function serializeVariantGroup(
  node: RawFigmaNode & {
    mainComponent?: MainComponentRef;
    componentProperties?: Record<string, { type?: string; value?: string | boolean }>;
    variantProperties?: Record<string, string>;
    componentId?: string;
  },
): Partial<RawFigmaNode> {
  const extra: Partial<RawFigmaNode> = {};

  if (node.componentId) {
    extra.componentId = node.componentId;
  }
  if (node.componentProperties) {
    extra.componentProperties = node.componentProperties;
  }
  if (node.variantProperties) {
    extra.variantProperties = node.variantProperties;
  }

  const mc = node.mainComponent;
  if (!mc) {
    return extra;
  }

  extra.mainComponentName = mc.name ?? node.name;

  const { parent } = mc;
  if (parent?.type === "COMPONENT_SET" && Array.isArray(parent.children)) {
    extra.variantGroup = {
      name: parent.name ?? mc.name ?? "",
      componentPropertyDefinitions: parent.componentPropertyDefinitions,
      variants: parent.children
        .filter(
          (child): child is RawVariantComponent & { variantProperties: Record<string, string> } =>
            Boolean(child.variantProperties),
        )
        .map((child) => ({
          properties: child.variantProperties,
          node: serializeNode(child as unknown as RawFigmaNode),
        })),
    };
  }

  return extra;
}

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

function enrichWithVariantData(
  node: RawFigmaNode & {
    mainComponent?: MainComponentRef;
    componentProperties?: Record<string, { type?: string; value?: string | boolean }>;
    variantProperties?: Record<string, string>;
    componentId?: string;
  },
  serialized: ReturnType<typeof serializeNode>,
): void {
  Object.assign(serialized, serializeVariantGroup(node));
  if (Array.isArray(node.children) && Array.isArray(serialized.children)) {
    for (let i = 0; i < node.children.length; i += 1) {
      const rawChild = node.children[i] as typeof node | undefined;
      const serChild = serialized.children[i];
      if (rawChild && serChild) {
        enrichWithVariantData(rawChild, serChild);
      }
    }
  }
}

function postSelection(): void {
  const [selected] = figma.currentPage.selection;
  if (!selected) {
    // oxlint-disable-next-line require-post-message-target-origin -- Figma's plugin postMessage takes no targetOrigin.
    figma.ui.postMessage({ type: "empty" });
    return;
  }
  const node = serializeNode(selected);
  enrichWithVariantData(selected as Parameters<typeof enrichWithVariantData>[0], node);
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
