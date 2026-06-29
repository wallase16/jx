/**
 * Serialize — Flatten a live Figma `SceneNode` into the plain `FigmaNode` shape the converter
 * consumes.
 *
 * @license MIT
 */

import type { FigmaNode } from "./figma-to-jx.ts";

export interface RawFigmaNode {
  id?: string;
  name?: string;
  type?: string;
  visible?: boolean;
  opacity?: number;
  children?: RawFigmaNode[];
  layoutMode?: string;
  layoutWrap?: string;
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  width?: number;
  height?: number;
  minWidth?: number | symbol;
  maxWidth?: number | symbol;
  minHeight?: number | symbol;
  maxHeight?: number | symbol;
  cornerRadius?: number | symbol;
  rectangleCornerRadii?: [number, number, number, number] | symbol;
  fills?: unknown;
  strokes?: unknown;
  strokeWeight?: number | symbol;
  strokeAlign?: string;
  dashPattern?: number[];
  clipsContent?: boolean;
  constraints?: { horizontal?: { type?: string }; vertical?: { type?: string } };
  x?: number;
  y?: number;
  rotation?: number | symbol;
  effects?: unknown;
  characters?: string;
  fontSize?: number | symbol;
  fontName?: { family?: string; style?: string } | symbol;
  fontWeight?: number | symbol;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  lineHeight?: { value?: number; unit?: string } | symbol;
  letterSpacing?: { value?: number; unit?: string } | symbol;
  textDecoration?: string | symbol;
  textCase?: string | symbol;
  boundVariables?: Record<string, { type?: string; id?: string }>;
  resolvedVariables?: Record<string, { id?: string; name?: string }>;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

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
  if (node.layoutWrap !== undefined) {
    out.layoutWrap = node.layoutWrap as FigmaNode["layoutWrap"];
  }
  for (const key of [
    "itemSpacing",
    "counterAxisSpacing",
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

  if (node.layoutSizingHorizontal !== undefined) {
    out.layoutSizingHorizontal = node.layoutSizingHorizontal as FigmaNode["layoutSizingHorizontal"];
  }
  if (node.layoutSizingVertical !== undefined) {
    out.layoutSizingVertical = node.layoutSizingVertical as FigmaNode["layoutSizingVertical"];
  }

  for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
    const v = num(node[key]);
    if (v !== undefined) {
      out[key] = v;
    }
  }

  const cornerRadius = num(node.cornerRadius);
  if (cornerRadius !== undefined) {
    out.cornerRadius = cornerRadius;
  }
  if (Array.isArray(node.rectangleCornerRadii) && node.rectangleCornerRadii.length === 4) {
    out.rectangleCornerRadii = node.rectangleCornerRadii as [number, number, number, number];
  }

  if (Array.isArray(node.fills)) {
    out.fills = node.fills as FigmaNode["fills"];
  }
  if (Array.isArray(node.strokes)) {
    out.strokes = node.strokes as FigmaNode["strokes"];
  }
  const strokeWeight = num(node.strokeWeight);
  if (strokeWeight !== undefined) {
    out.strokeWeight = strokeWeight;
  }
  if (node.strokeAlign !== undefined) {
    out.strokeAlign = node.strokeAlign as FigmaNode["strokeAlign"];
  }
  if (Array.isArray(node.dashPattern) && node.dashPattern.length > 0) {
    out.dashPattern = node.dashPattern;
  }
  if (node.clipsContent !== undefined) {
    out.clipsContent = node.clipsContent;
  }

  if (node.constraints) {
    out.constraints = node.constraints as FigmaNode["constraints"];
  }
  if (typeof node.x === "number") {
    out.x = node.x;
  }
  if (typeof node.y === "number") {
    out.y = node.y;
  }
  const rotation = num(node.rotation);
  if (rotation !== undefined) {
    out.rotation = rotation;
  }

  if (Array.isArray(node.effects)) {
    out.effects = node.effects as FigmaNode["effects"];
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
  if (node.textAlignVertical !== undefined) {
    out.textAlignVertical = node.textAlignVertical as FigmaNode["textAlignVertical"];
  }
  if (node.lineHeight && typeof node.lineHeight === "object") {
    out.lineHeight = node.lineHeight as FigmaNode["lineHeight"];
  }
  if (node.letterSpacing && typeof node.letterSpacing === "object") {
    out.letterSpacing = node.letterSpacing as FigmaNode["letterSpacing"];
  }
  const textDecoration = str(node.textDecoration);
  if (textDecoration) {
    out.textDecoration = textDecoration as FigmaNode["textDecoration"];
  }
  const textCase = str(node.textCase);
  if (textCase) {
    out.textCase = textCase as FigmaNode["textCase"];
  }

  if (node.boundVariables) {
    out.boundVariables = node.boundVariables as FigmaNode["boundVariables"];
  }
  if (node.resolvedVariables) {
    out.resolvedVariables = node.resolvedVariables as FigmaNode["resolvedVariables"];
  }

  if (Array.isArray(node.children)) {
    out.children = node.children.map((child) => serializeNode(child));
  }

  return out;
}
