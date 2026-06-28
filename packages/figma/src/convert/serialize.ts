/**
 * Serialize — Flatten a live Figma `SceneNode` into the plain `FigmaNode` shape the converter
 * consumes. The plugin sandbox (code.ts) cannot pass live nodes across the postMessage boundary,
 * so we copy exactly the fields figmaToJx reads. Kept pure and field-driven so it is unit-testable
 * without the Figma runtime.
 *
 * @license MIT
 */

import type { FigmaNode } from "./figma-to-jx.ts";

/** A structural view of the Figma API node — every field optional, read defensively. */
export interface RawFigmaNode {
  id?: string;
  name?: string;
  type?: string;
  visible?: boolean;
  opacity?: number;
  children?: RawFigmaNode[];
  layoutMode?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  width?: number;
  height?: number;
  cornerRadius?: number | symbol;
  fills?: unknown;
  characters?: string;
  fontSize?: number | symbol;
  fontName?: { family?: string; style?: string } | symbol;
  fontWeight?: number | symbol;
  textAlignHorizontal?: string;
}

/** Copy a scalar only when it is a real number (Figma uses a `figma.mixed` symbol otherwise). */
function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Serialize one node and its descendants into the converter's input shape. */
export function serializeNode(node: RawFigmaNode): FigmaNode {
  const out: FigmaNode = { type: node.type ?? "FRAME" };

  if (node.id !== undefined) {
    out.id = node.id;
  }
  if (node.name !== undefined) {
    out.name = node.name;
  }
  if (node.visible !== undefined) {
    out.visible = node.visible;
  }
  if (node.opacity !== undefined) {
    out.opacity = node.opacity;
  }

  if (node.layoutMode !== undefined) {
    out.layoutMode = node.layoutMode as FigmaNode["layoutMode"];
  }
  for (const key of [
    "itemSpacing",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom",
    "width",
    "height",
  ] as const) {
    const v = num(node[key]);
    if (v !== undefined) {
      out[key] = v;
    }
  }
  if (node.primaryAxisAlignItems !== undefined) {
    out.primaryAxisAlignItems = node.primaryAxisAlignItems as FigmaNode["primaryAxisAlignItems"];
  }
  if (node.counterAxisAlignItems !== undefined) {
    out.counterAxisAlignItems = node.counterAxisAlignItems as FigmaNode["counterAxisAlignItems"];
  }

  const cornerRadius = num(node.cornerRadius);
  if (cornerRadius !== undefined) {
    out.cornerRadius = cornerRadius;
  }
  if (Array.isArray(node.fills)) {
    out.fills = node.fills as FigmaNode["fills"];
  }

  if (node.characters !== undefined) {
    out.characters = node.characters;
  }
  const fontSize = num(node.fontSize);
  if (fontSize !== undefined) {
    out.fontSize = fontSize;
  }
  if (node.fontName && typeof node.fontName === "object") {
    out.fontName = node.fontName;
  }
  const fontWeight = num(node.fontWeight);
  if (fontWeight !== undefined) {
    out.fontWeight = fontWeight;
  }
  if (node.textAlignHorizontal !== undefined) {
    out.textAlignHorizontal = node.textAlignHorizontal as FigmaNode["textAlignHorizontal"];
  }

  if (Array.isArray(node.children)) {
    out.children = node.children.map((child) => serializeNode(child));
  }

  return out;
}
