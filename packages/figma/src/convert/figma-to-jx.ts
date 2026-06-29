/**
 * Figma-to-jx — Convert a Figma node tree into a Jx document.
 *
 * @license MIT
 */

import type { JxDocument, JxElement, JxStyle } from "@jxsuite/schema/types";

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface FigmaColorStop {
  position: number;
  color: FigmaColor;
}

export interface FigmaGradientTransform {
  0: [number, number, number];
  1: [number, number, number];
}

export interface FigmaPaint {
  type: string;
  color?: FigmaColor;
  opacity?: number;
  visible?: boolean;
  gradientStops?: FigmaColorStop[];
  gradientTransform?: FigmaGradientTransform;
  scaleMode?: string;
  imageRef?: string;
}

export interface FigmaStroke {
  type: string;
  color?: FigmaColor;
  opacity?: number;
  visible?: boolean;
}

export interface FigmaEffect {
  type: string;
  visible?: boolean;
  radius?: number;
  offset?: { x: number; y: number };
  color?: FigmaColor;
  spread?: number;
}

export interface FigmaConstraint {
  type: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
}

export interface FigmaVariable {
  id: string;
  name: string;
}

export interface FigmaBoundVariable {
  type: string;
  id: string;
}

export interface FigmaNode {
  id?: string;
  name?: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  children?: FigmaNode[];

  // Auto-layout (FRAME / COMPONENT / INSTANCE)
  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  layoutWrap?: "NO_WRAP" | "WRAP";
  itemSpacing?: number;
  counterAxisSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";

  // Sizing
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";

  // Box
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  fills?: FigmaPaint[];
  strokes?: FigmaStroke[];
  strokeWeight?: number;
  strokeAlign?: "INSIDE" | "OUTSIDE" | "CENTER";
  dashPattern?: number[];
  clipsContent?: boolean;

  // Constraints (non-auto-layout positioning)
  constraints?: { horizontal?: FigmaConstraint; vertical?: FigmaConstraint };
  x?: number;
  y?: number;
  rotation?: number;

  // Effects
  effects?: FigmaEffect[];

  // TEXT
  characters?: string;
  fontSize?: number;
  fontName?: { family?: string; style?: string };
  fontWeight?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  textAlignVertical?: "TOP" | "CENTER" | "BOTTOM";
  lineHeight?: { value?: number; unit?: "PIXELS" | "PERCENT" | "AUTO" };
  letterSpacing?: { value?: number; unit?: "PIXELS" | "PERCENT" };
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE";

  // Design tokens / variables
  boundVariables?: Record<string, FigmaBoundVariable>;
  resolvedVariables?: Record<string, FigmaVariable>;

  // Vectors
  svgContent?: string;
}

export interface ConvertOptions {
  variables?: Map<string, string>;
}

export interface ConvertResult {
  document: JxDocument;
  nodeCount: number;
  tokens?: Record<string, string>;
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

const FONT_STYLE_WEIGHT: Record<string, number> = {
  Thin: 100,
  Hairline: 100,
  ExtraLight: 200,
  "Extra Light": 200,
  UltraLight: 200,
  Light: 300,
  Regular: 400,
  Normal: 400,
  Medium: 500,
  SemiBold: 600,
  "Semi Bold": 600,
  DemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  "Extra Bold": 800,
  UltraBold: 800,
  Black: 900,
  Heavy: 900,
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function figmaColorToCss(color: FigmaColor, paintOpacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = r2((color.a ?? 1) * paintOpacity);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function gradientAngle(transform?: FigmaGradientTransform): number {
  if (!transform) {
    return 180;
  }
  const [x0, y0] = [transform[0][0], transform[0][1]];
  return r2((Math.atan2(y0, x0) * 180) / Math.PI + 90);
}

function gradientToCss(paint: FigmaPaint): string | undefined {
  if (!paint.gradientStops || paint.gradientStops.length < 2) {
    return undefined;
  }
  const stops = paint.gradientStops
    .map((s) => `${figmaColorToCss(s.color)} ${r2(s.position * 100)}%`)
    .join(", ");
  if (paint.type === "GRADIENT_RADIAL") {
    return `radial-gradient(circle, ${stops})`;
  }
  const angle = gradientAngle(paint.gradientTransform);
  return `linear-gradient(${angle}deg, ${stops})`;
}

function resolveFills(fills?: FigmaPaint[]): string | undefined {
  if (!fills) {
    return undefined;
  }
  const visible = fills.filter((p) => p.visible !== false);
  const parts: string[] = [];
  for (const paint of visible) {
    if (paint.type === "SOLID" && paint.color) {
      parts.push(figmaColorToCss(paint.color, paint.opacity ?? 1));
    } else if (
      (paint.type === "GRADIENT_LINEAR" || paint.type === "GRADIENT_RADIAL") &&
      paint.gradientStops
    ) {
      const grad = gradientToCss(paint);
      if (grad) {
        parts.push(grad);
      }
    }
  }
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return parts.join(", ");
}

function hasImageFill(fills?: FigmaPaint[]): FigmaPaint | undefined {
  if (!fills) {
    return undefined;
  }
  return fills.find((p) => p.visible !== false && p.type === "IMAGE");
}

function resolveStrokes(node: FigmaNode): Partial<JxStyle> {
  const style: Partial<JxStyle> = {};
  if (!node.strokes || !node.strokeWeight) {
    return style;
  }
  const visible = node.strokes.filter((s) => s.visible !== false);
  if (visible.length === 0) {
    return style;
  }
  const [stroke] = visible;
  if (!stroke.color) {
    return style;
  }
  const color = figmaColorToCss(stroke.color, stroke.opacity ?? 1);
  const w = node.strokeWeight;
  const dashStr = node.dashPattern?.length ? "dashed" : "solid";
  if (node.strokeAlign === "INSIDE") {
    style.boxShadow = `inset 0 0 0 ${w}px ${color}`;
  } else {
    style.border = `${w}px ${dashStr} ${color}`;
  }
  return style;
}

function resolveEffects(effects?: FigmaEffect[]): Partial<JxStyle> {
  const style: Partial<JxStyle> = {};
  if (!effects) {
    return style;
  }
  const visible = effects.filter((e) => e.visible !== false);
  const shadows: string[] = [];
  const filters: string[] = [];
  for (const e of visible) {
    if (e.type === "DROP_SHADOW" && e.color) {
      const x = e.offset?.x ?? 0;
      const y = e.offset?.y ?? 0;
      const r = e.radius ?? 0;
      const spread = e.spread ?? 0;
      shadows.push(`${x}px ${y}px ${r}px ${spread}px ${figmaColorToCss(e.color)}`);
    } else if (e.type === "INNER_SHADOW" && e.color) {
      const x = e.offset?.x ?? 0;
      const y = e.offset?.y ?? 0;
      const r = e.radius ?? 0;
      const spread = e.spread ?? 0;
      shadows.push(`inset ${x}px ${y}px ${r}px ${spread}px ${figmaColorToCss(e.color)}`);
    } else if (e.type === "LAYER_BLUR" && e.radius) {
      filters.push(`blur(${e.radius}px)`);
    } else if (e.type === "BACKGROUND_BLUR" && e.radius) {
      style.backdropFilter = `blur(${e.radius}px)`;
    }
  }
  if (shadows.length > 0) {
    style.boxShadow = style.boxShadow
      ? `${style.boxShadow}, ${shadows.join(", ")}`
      : shadows.join(", ");
  }
  if (filters.length > 0) {
    style.filter = filters.join(" ");
  }
  return style;
}

function applySizing(style: JxStyle, node: FigmaNode): void {
  const h = node.layoutSizingHorizontal;
  const v = node.layoutSizingVertical;
  if (h === "FILL") {
    style.width = "100%";
  } else if (h === "HUG") {
    style.width = "fit-content";
  } else if (h === "FIXED" && node.width) {
    style.width = `${r2(node.width)}px`;
  }
  if (v === "FILL") {
    style.height = "100%";
  } else if (v === "HUG") {
    style.height = "fit-content";
  } else if (v === "FIXED" && node.height) {
    style.height = `${r2(node.height)}px`;
  }
  if (node.minWidth) {
    style.minWidth = `${r2(node.minWidth)}px`;
  }
  if (node.maxWidth) {
    style.maxWidth = `${r2(node.maxWidth)}px`;
  }
  if (node.minHeight) {
    style.minHeight = `${r2(node.minHeight)}px`;
  }
  if (node.maxHeight) {
    style.maxHeight = `${r2(node.maxHeight)}px`;
  }
}

function applyAbsolutePosition(style: JxStyle, node: FigmaNode): void {
  style.position = "absolute";
  if (typeof node.x === "number") {
    style.left = `${r2(node.x)}px`;
  }
  if (typeof node.y === "number") {
    style.top = `${r2(node.y)}px`;
  }
  if (node.width) {
    style.width = `${r2(node.width)}px`;
  }
  if (node.height) {
    style.height = `${r2(node.height)}px`;
  }
}

function resolveVariableRef(
  prop: string,
  node: FigmaNode,
  tokens: Record<string, string>,
): string | undefined {
  const bound = node.boundVariables?.[prop];
  const resolved = node.resolvedVariables?.[prop];
  if (!bound || !resolved) {
    return undefined;
  }
  const name = resolved.name.replaceAll("/", "-").replaceAll(/\s+/g, "-").toLowerCase();
  const varName = `--${name}`;
  tokens[varName] = "";
  return `var(${varName})`;
}

function containerStyle(node: FigmaNode, tokens: Record<string, string>): JxStyle {
  const style: JxStyle = {};

  if (node.layoutMode && node.layoutMode !== "NONE") {
    style.display = "flex";
    style.flexDirection = node.layoutMode === "HORIZONTAL" ? "row" : "column";
    if (node.layoutWrap === "WRAP") {
      style.flexWrap = "wrap";
    }
    if (node.itemSpacing) {
      style.gap = `${node.itemSpacing}px`;
    }
    if (node.counterAxisSpacing && node.layoutWrap === "WRAP") {
      style.rowGap = `${node.counterAxisSpacing}px`;
      style.columnGap = `${node.itemSpacing ?? 0}px`;
      delete style.gap;
    }
    if (node.primaryAxisAlignItems && PRIMARY_ALIGN[node.primaryAxisAlignItems]) {
      style.justifyContent = PRIMARY_ALIGN[node.primaryAxisAlignItems];
    }
    if (node.counterAxisAlignItems && COUNTER_ALIGN[node.counterAxisAlignItems]) {
      style.alignItems = COUNTER_ALIGN[node.counterAxisAlignItems];
    }
  }

  applySizing(style, node);

  const pad = [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft];
  if (pad.some(Boolean)) {
    style.padding = pad.map((p) => `${p ?? 0}px`).join(" ");
  }

  const bgVar = resolveVariableRef("fills", node, tokens);
  if (bgVar) {
    style.background = bgVar;
  } else {
    const bg = resolveFills(node.fills);
    if (bg) {
      style.background = bg;
    }
  }

  if (node.cornerRadius) {
    style.borderRadius = `${node.cornerRadius}px`;
  } else if (node.rectangleCornerRadii) {
    const [tl, tr, br, bl] = node.rectangleCornerRadii;
    style.borderRadius = `${tl}px ${tr}px ${br}px ${bl}px`;
  }

  if (node.clipsContent) {
    style.overflow = "hidden";
  }

  if (typeof node.opacity === "number" && node.opacity < 1) {
    style.opacity = r2(node.opacity);
  }
  if (typeof node.rotation === "number" && node.rotation !== 0) {
    style.transform = `rotate(${r2(-node.rotation)}deg)`;
  }

  Object.assign(style, resolveStrokes(node));
  Object.assign(style, resolveEffects(node.effects));

  return style;
}

function textStyle(node: FigmaNode, tokens: Record<string, string>): JxStyle {
  const style: JxStyle = {};
  if (node.fontSize) {
    style.fontSize = `${node.fontSize}px`;
  }
  if (node.fontName?.family) {
    style.fontFamily = node.fontName.family;
  }
  if (node.fontWeight) {
    style.fontWeight = String(node.fontWeight);
  } else if (node.fontName?.style) {
    const base = node.fontName.style.replace(/\s*Italic$/, "");
    if (base && FONT_STYLE_WEIGHT[base]) {
      style.fontWeight = String(FONT_STYLE_WEIGHT[base]);
    }
    if (node.fontName.style.endsWith("Italic")) {
      style.fontStyle = "italic";
    }
  }
  if (node.textAlignHorizontal) {
    style.textAlign = node.textAlignHorizontal.toLowerCase();
  }
  if (node.lineHeight) {
    if (node.lineHeight.unit === "PIXELS" && node.lineHeight.value) {
      style.lineHeight = `${r2(node.lineHeight.value)}px`;
    } else if (node.lineHeight.unit === "PERCENT" && node.lineHeight.value) {
      style.lineHeight = `${r2(node.lineHeight.value / 100)}`;
    }
  }
  if (node.letterSpacing) {
    if (node.letterSpacing.unit === "PIXELS" && node.letterSpacing.value) {
      style.letterSpacing = `${r2(node.letterSpacing.value)}px`;
    } else if (node.letterSpacing.unit === "PERCENT" && node.letterSpacing.value) {
      style.letterSpacing = `${r2(node.letterSpacing.value / 100)}em`;
    }
  }
  if (node.textDecoration === "UNDERLINE") {
    style.textDecorationLine = "underline";
  } else if (node.textDecoration === "STRIKETHROUGH") {
    style.textDecorationLine = "line-through";
  }
  if (node.textCase === "UPPER") {
    style.textTransform = "uppercase";
  } else if (node.textCase === "LOWER") {
    style.textTransform = "lowercase";
  } else if (node.textCase === "TITLE") {
    style.textTransform = "capitalize";
  }

  const colorVar = resolveVariableRef("fills", node, tokens);
  if (colorVar) {
    style.color = colorVar;
  } else {
    const color = resolveFills(node.fills);
    if (color) {
      style.color = color;
    }
  }

  Object.assign(style, resolveEffects(node.effects));

  return style;
}

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

function isAbsoluteChild(node: FigmaNode, parent?: FigmaNode): boolean {
  if (!parent) {
    return false;
  }
  return !parent.layoutMode || parent.layoutMode === "NONE";
}

function convertNode(
  node: FigmaNode,
  tokens: Record<string, string>,
  parent?: FigmaNode,
): JxElement | null {
  if (node.visible === false) {
    return null;
  }

  switch (node.type) {
    case "TEXT": {
      const el: JxElement = { tagName: textTag(node), textContent: node.characters ?? "" };
      const style = textStyle(node, tokens);
      if (isAbsoluteChild(node, parent)) {
        applyAbsolutePosition(style, node);
      }
      if (Object.keys(style).length > 0) {
        el.style = style;
      }
      return el;
    }
    case "VECTOR":
    case "BOOLEAN_OPERATION":
    case "STAR":
    case "LINE":
    case "POLYGON": {
      if (node.svgContent) {
        const el: JxElement = { tagName: "div" };
        const style: JxStyle = {};
        if (node.width) {
          style.width = `${r2(node.width)}px`;
        }
        if (node.height) {
          style.height = `${r2(node.height)}px`;
        }
        style.display = "flex";
        style.alignItems = "center";
        style.justifyContent = "center";
        if (isAbsoluteChild(node, parent)) {
          applyAbsolutePosition(style, node);
        }
        Object.assign(style, resolveEffects(node.effects));
        if (Object.keys(style).length > 0) {
          el.style = style;
        }
        el.children = [{ tagName: "svg", textContent: node.svgContent }];
        return el;
      }
      const el: JxElement = { tagName: "div" };
      const style = containerStyle(node, tokens);
      if (node.width) {
        style.width = `${r2(node.width)}px`;
      }
      if (node.height) {
        style.height = `${r2(node.height)}px`;
      }
      if (isAbsoluteChild(node, parent)) {
        applyAbsolutePosition(style, node);
      }
      if (Object.keys(style).length > 0) {
        el.style = style;
      }
      return el;
    }
    case "RECTANGLE":
    case "ELLIPSE": {
      const imageFill = hasImageFill(node.fills);
      if (imageFill) {
        const el: JxElement = { tagName: "img" };
        const style: JxStyle = {};
        const ref = imageFill.imageRef ?? "placeholder";
        (el as Record<string, unknown>).attributes = {
          src: `images/${ref}.png`,
          alt: node.name ?? "",
        };
        style.objectFit = imageFill.scaleMode === "FIT" ? "contain" : "cover";
        if (node.width) {
          style.width = `${r2(node.width)}px`;
        }
        if (node.height) {
          style.height = `${r2(node.height)}px`;
        }
        if (node.type === "ELLIPSE") {
          style.borderRadius = "50%";
        } else if (node.cornerRadius) {
          style.borderRadius = `${node.cornerRadius}px`;
        }
        if (isAbsoluteChild(node, parent)) {
          applyAbsolutePosition(style, node);
        }
        if (Object.keys(style).length > 0) {
          el.style = style;
        }
        return el;
      }
      const el: JxElement = { tagName: "div" };
      const style = containerStyle(node, tokens);
      if (!style.width && node.width) {
        style.width = `${r2(node.width)}px`;
      }
      if (!style.height && node.height) {
        style.height = `${r2(node.height)}px`;
      }
      if (node.type === "ELLIPSE") {
        style.borderRadius = "50%";
      }
      if (isAbsoluteChild(node, parent)) {
        applyAbsolutePosition(style, node);
      }
      if (Object.keys(style).length > 0) {
        el.style = style;
      }
      return el;
    }
    default: {
      const el: JxElement = { tagName: "div" };
      const style = containerStyle(node, tokens);

      const imageFill = hasImageFill(node.fills);
      if (imageFill) {
        const ref = imageFill.imageRef ?? "placeholder";
        style.backgroundImage = `url(images/${ref}.png)`;
        style.backgroundSize = imageFill.scaleMode === "FIT" ? "contain" : "cover";
        style.backgroundPosition = "center";
      }

      if (isAbsoluteChild(node, parent) && parent) {
        applyAbsolutePosition(style, node);
      }

      if (node.children?.length && (!node.layoutMode || node.layoutMode === "NONE")) {
        style.position ??= "relative";
      }

      if (Object.keys(style).length > 0) {
        el.style = style;
      }
      const children = (node.children ?? [])
        .map((child) => convertNode(child, tokens, node))
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

export function figmaToJx(root: FigmaNode, _options?: ConvertOptions): ConvertResult {
  const tokens: Record<string, string> = {};
  const converted = convertNode(root, tokens) ?? { tagName: "div" };
  const document = converted as JxDocument;
  const result: ConvertResult = { document, nodeCount: countNodes(document) };
  if (Object.keys(tokens).length > 0) {
    result.tokens = tokens;
  }
  return result;
}
