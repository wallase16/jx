/**
 * Figma-to-jx — Convert a Figma node tree into a Jx document.
 *
 * This is the de-risk core of the Figma plugin. Figma's plugin API hands us a structured
 * scene-graph (FRAME / TEXT / RECTANGLE / COMPONENT / INSTANCE …) with auto-layout, fills and
 * typography already resolved — so this is a *mapping*, not the CSS reverse-engineering the web
 * importer has to do. Output is a `JxDocument` that the runtime can mount directly.
 *
 * v0 scope (spike): containers + auto-layout → flexbox, TEXT → text nodes, solid fills →
 * background/color, corner radius, basic typography. Constraints / absolute positioning / effects
 * are intentionally out of scope until the live-preview hook is validated.
 *
 * @license MIT
 */

import type { JxDocument, JxElement, JxStyle } from "@jxsuite/schema/types";

/** A 0..1 RGBA colour as Figma reports it. */
export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** A Figma paint (only SOLID is mapped in the spike). */
export interface FigmaPaint {
  type: string;
  color?: FigmaColor;
  opacity?: number;
  visible?: boolean;
}

/**
 * The subset of Figma `SceneNode` fields this converter reads. Real nodes carry far more; the
 * plugin sandbox serialises only what we list here before posting to the UI.
 */
export interface FigmaNode {
  id?: string;
  name?: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  children?: FigmaNode[];

  // Auto-layout (FRAME / COMPONENT / INSTANCE)
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";

  // Box
  width?: number;
  height?: number;
  cornerRadius?: number;
  fills?: FigmaPaint[];

  // TEXT
  characters?: string;
  fontSize?: number;
  fontName?: { family?: string; style?: string };
  fontWeight?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
}

export interface ConvertResult {
  document: JxDocument;
  nodeCount: number;
}

const PRIMARY_ALIGN: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  SPACE_BETWEEN: "space-between",
};

const COUNTER_ALIGN: Record<string, string> = {
  MIN: "flex-start",
  CENTER: "center",
  MAX: "flex-end",
  BASELINE: "baseline",
};

/** Round to at most 2 decimals to keep emitted JSON tidy. */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Convert a Figma 0..1 colour (with optional paint opacity) to a CSS rgb/rgba string. */
export function figmaColorToCss(color: FigmaColor, paintOpacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = r2((color.a ?? 1) * paintOpacity);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** First visible solid paint, as a CSS colour, or undefined. */
function firstSolidFill(fills?: FigmaPaint[]): string | undefined {
  if (!fills) {
    return undefined;
  }
  for (const paint of fills) {
    if (paint.visible === false) {
      continue;
    }
    if (paint.type === "SOLID" && paint.color) {
      return figmaColorToCss(paint.color, paint.opacity ?? 1);
    }
  }
  return undefined;
}

/** Build the flex/box style for a container node. */
function containerStyle(node: FigmaNode): JxStyle {
  const style: JxStyle = {};

  if (node.layoutMode && node.layoutMode !== "NONE") {
    style.display = "flex";
    style.flexDirection = node.layoutMode === "HORIZONTAL" ? "row" : "column";
    if (node.itemSpacing) {
      style.gap = `${node.itemSpacing}px`;
    }
    if (node.primaryAxisAlignItems && PRIMARY_ALIGN[node.primaryAxisAlignItems]) {
      style.justifyContent = PRIMARY_ALIGN[node.primaryAxisAlignItems];
    }
    if (node.counterAxisAlignItems && COUNTER_ALIGN[node.counterAxisAlignItems]) {
      style.alignItems = COUNTER_ALIGN[node.counterAxisAlignItems];
    }
  }

  const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
  if (pad.some(Boolean)) {
    style.padding = pad.map((p) => `${p ?? 0}px`).join(" ");
  }

  const bg = firstSolidFill(node.fills);
  if (bg) {
    style.background = bg;
  }
  if (node.cornerRadius) {
    style.borderRadius = `${node.cornerRadius}px`;
  }
  if (typeof node.opacity === "number" && node.opacity < 1) {
    style.opacity = r2(node.opacity);
  }

  return style;
}

/** Build the typographic style for a TEXT node. */
function textStyle(node: FigmaNode): JxStyle {
  const style: JxStyle = {};
  if (node.fontSize) {
    style.fontSize = `${node.fontSize}px`;
  }
  if (node.fontName?.family) {
    style.fontFamily = node.fontName.family;
  }
  if (node.fontWeight) {
    style.fontWeight = String(node.fontWeight);
  }
  if (node.textAlignHorizontal) {
    style.textAlign = node.textAlignHorizontal.toLowerCase();
  }
  const color = firstSolidFill(node.fills);
  if (color) {
    style.color = color;
  }
  return style;
}

/**
 * Heuristic tag for a TEXT node: large/bold text becomes a heading, everything else a paragraph.
 * Keeps emitted markup semantic without a full type-scale analysis (deferred).
 */
function textTag(node: FigmaNode): string {
  const size = node.fontSize ?? 16;
  if (size >= 32) {
    return "h1";
  }
  if (size >= 24) {
    return "h2";
  }
  if (size >= 18) {
    return "h3";
  }
  return "p";
}

/** Convert one Figma node into a JxElement (or null if it should be dropped). */
function convertNode(node: FigmaNode): JxElement | null {
  if (node.visible === false) {
    return null;
  }

  switch (node.type) {
    case "TEXT": {
      const el: JxElement = { tagName: textTag(node), textContent: node.characters ?? "" };
      const style = textStyle(node);
      if (Object.keys(style).length > 0) {
        el.style = style;
      }
      return el;
    }
    case "RECTANGLE":
    case "ELLIPSE":
    case "VECTOR": {
      const el: JxElement = { tagName: "div" };
      const style = containerStyle(node);
      if (node.width) {
        style.width = `${r2(node.width)}px`;
      }
      if (node.height) {
        style.height = `${r2(node.height)}px`;
      }
      if (Object.keys(style).length > 0) {
        el.style = style;
      }
      return el;
    }
    // FRAME / GROUP / COMPONENT / INSTANCE and any unknown node → generic container.
    default: {
      const el: JxElement = { tagName: "div" };
      const style = containerStyle(node);
      if (Object.keys(style).length > 0) {
        el.style = style;
      }
      const children = (node.children ?? [])
        .map((child) => convertNode(child))
        .filter((c): c is JxElement => c !== null);
      if (children.length > 0) {
        el.children = children;
      }
      return el;
    }
  }
}

function countNodes(el: JxElement | string): number {
  if (typeof el === "string") {
    return 0;
  }
  let n = 1;
  if (Array.isArray(el.children)) {
    for (const c of el.children) {
      n += countNodes(c as JxElement | string);
    }
  }
  return n;
}

/**
 * Convert a Figma node (typically the selected frame) into a mountable Jx document.
 *
 * @param root - The serialised Figma scene node.
 * @returns The Jx document plus an element count for diagnostics.
 */
export function figmaToJx(root: FigmaNode): ConvertResult {
  const converted = convertNode(root) ?? { tagName: "div" };
  const document = converted as JxDocument;
  return { document, nodeCount: countNodes(document) };
}
