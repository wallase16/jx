import { describe, test, expect } from "bun:test";
import { figmaToJx, figmaColorToCss } from "../src/convert/figma-to-jx.ts";
import type { FigmaNode } from "../src/convert/figma-to-jx.ts";
import pricingCard from "./fixtures/pricing-card.json" with { type: "json" };

describe("figmaColorToCss", () => {
  test("maps a 0..1 solid colour to rgb", () => {
    expect(figmaColorToCss({ r: 1, g: 1, b: 1 })).toBe("rgb(255, 255, 255)");
    expect(figmaColorToCss({ r: 0.23, g: 0.51, b: 0.96 })).toBe("rgb(59, 130, 245)");
  });

  test("emits rgba when alpha or paint opacity is below 1", () => {
    expect(figmaColorToCss({ r: 0, g: 0, b: 0, a: 0.5 })).toBe("rgba(0, 0, 0, 0.5)");
    expect(figmaColorToCss({ r: 0, g: 0, b: 0 }, 0.25)).toBe("rgba(0, 0, 0, 0.25)");
  });
});

describe("figmaToJx — container mapping", () => {
  test("auto-layout VERTICAL frame becomes a flex column with gap and padding", () => {
    const { document } = figmaToJx(pricingCard as FigmaNode);
    expect(document.tagName).toBe("div");
    expect(document.style?.display).toBe("flex");
    expect(document.style?.flexDirection).toBe("column");
    expect(document.style?.gap).toBe("16px");
    expect(document.style?.padding).toBe("32px 24px 32px 24px");
    expect(document.style?.alignItems).toBe("center");
    expect(document.style?.background).toBe("rgb(255, 255, 255)");
    expect(document.style?.borderRadius).toBe("12px");
  });

  test("HORIZONTAL CTA frame maps primary axis to justify-content", () => {
    const { document } = figmaToJx(pricingCard as FigmaNode);
    const cta = (document.children as Record<string, unknown>[]).at(-1) as {
      style?: Record<string, string>;
    };
    expect(cta.style?.flexDirection).toBe("row");
    expect(cta.style?.justifyContent).toBe("center");
    expect(cta.style?.background).toBe("rgb(59, 130, 245)");
  });
});

describe("figmaToJx — text mapping", () => {
  test("text nodes carry content and typography, with heading heuristic by size", () => {
    const { document } = figmaToJx(pricingCard as FigmaNode);
    const [plan, price, tagline] = document.children as { tagName: string; textContent: string }[];
    expect(plan.tagName).toBe("h2"); // 28px → h2
    expect(plan.textContent).toBe("Pro");
    expect(price.tagName).toBe("h1"); // 40px → h1
    expect(price.textContent).toBe("$29/mo");
    expect(tagline.tagName).toBe("p"); // 16px → p
  });

  test("text colour and font-size land in style", () => {
    const { document } = figmaToJx(pricingCard as FigmaNode);
    const [, price] = document.children as { style?: Record<string, string> }[];
    expect(price.style?.fontSize).toBe("40px");
    expect(price.style?.color).toBe("rgb(59, 130, 245)");
    expect(price.style?.fontFamily).toBe("Inter");
  });
});

describe("figmaToJx — edge cases", () => {
  test("invisible nodes are dropped", () => {
    const node: FigmaNode = {
      type: "FRAME",
      children: [
        { type: "TEXT", characters: "keep" },
        { type: "TEXT", characters: "drop", visible: false },
      ],
    };
    const { document } = figmaToJx(node);
    expect(document.children).toHaveLength(1);
  });

  test("nodeCount counts the whole tree", () => {
    const { nodeCount } = figmaToJx(pricingCard as FigmaNode);
    // 1 root + 3 text + 1 cta frame + 1 cta label = 6
    expect(nodeCount).toBe(6);
  });

  test("RECTANGLE maps box size, radius and opacity", () => {
    const { document } = figmaToJx({
      type: "RECTANGLE",
      width: 100.5,
      height: 50,
      cornerRadius: 4,
      opacity: 0.5,
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    });
    expect(document.tagName).toBe("div");
    expect(document.style?.width).toBe("100.5px");
    expect(document.style?.height).toBe("50px");
    expect(document.style?.borderRadius).toBe("4px");
    expect(document.style?.opacity).toBe(0.5);
  });

  test("medium text (18-23px) maps to h3", () => {
    const { document } = figmaToJx({ type: "TEXT", characters: "Sub", fontSize: 20 });
    expect(document.tagName).toBe("h3");
  });

  test("non-solid and hidden fills are ignored", () => {
    const { document } = figmaToJx({
      type: "FRAME",
      fills: [
        { type: "GRADIENT_LINEAR" },
        { type: "SOLID", color: { r: 1, g: 0, b: 0 }, visible: false },
      ],
    });
    expect(document.style?.background).toBeUndefined();
  });

  test("an invisible root yields an empty fallback container", () => {
    const { document, nodeCount } = figmaToJx({ type: "FRAME", visible: false });
    expect(document).toEqual({ tagName: "div" });
    expect(nodeCount).toBe(1);
  });
});
