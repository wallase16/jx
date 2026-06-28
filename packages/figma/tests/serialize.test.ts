import { describe, test, expect } from "bun:test";
import { serializeNode } from "../src/convert/serialize.ts";
import type { RawFigmaNode } from "../src/convert/serialize.ts";

describe("serializeNode", () => {
  test("copies the converter-relevant fields", () => {
    const raw: RawFigmaNode = {
      id: "1:1",
      name: "Card",
      type: "FRAME",
      layoutMode: "VERTICAL",
      itemSpacing: 16,
      paddingTop: 8,
      cornerRadius: 12,
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
    };
    const out = serializeNode(raw);
    expect(out.type).toBe("FRAME");
    expect(out.layoutMode).toBe("VERTICAL");
    expect(out.itemSpacing).toBe(16);
    expect(out.paddingTop).toBe(8);
    expect(out.cornerRadius).toBe(12);
    expect(out.fills).toHaveLength(1);
  });

  test("drops figma.mixed symbols (non-number scalars)", () => {
    const mixed = Symbol("figma.mixed");
    const raw: RawFigmaNode = {
      type: "TEXT",
      fontSize: mixed,
      cornerRadius: mixed,
      fontWeight: 400,
    };
    const out = serializeNode(raw);
    expect(out.fontSize).toBeUndefined();
    expect(out.cornerRadius).toBeUndefined();
    expect(out.fontWeight).toBe(400);
  });

  test("carries identity, geometry and alignment fields through", () => {
    const raw: RawFigmaNode = {
      id: "9:9",
      name: "Hero",
      type: "FRAME",
      visible: true,
      opacity: 0.8,
      width: 200,
      height: 120,
      primaryAxisAlignItems: "SPACE_BETWEEN",
      counterAxisAlignItems: "CENTER",
      textAlignHorizontal: "CENTER",
      fontName: { family: "Inter", style: "Bold" },
    };
    const out = serializeNode(raw);
    expect(out.id).toBe("9:9");
    expect(out.name).toBe("Hero");
    expect(out.visible).toBe(true);
    expect(out.opacity).toBe(0.8);
    expect(out.width).toBe(200);
    expect(out.height).toBe(120);
    expect(out.primaryAxisAlignItems).toBe("SPACE_BETWEEN");
    expect(out.counterAxisAlignItems).toBe("CENTER");
    expect(out.textAlignHorizontal).toBe("CENTER");
    expect(out.fontName).toEqual({ family: "Inter", style: "Bold" });
  });

  test("recurses into children", () => {
    const raw: RawFigmaNode = {
      type: "FRAME",
      children: [{ type: "TEXT", characters: "hi" }],
    };
    const out = serializeNode(raw);
    expect(out.children).toHaveLength(1);
    expect(out.children?.[0].characters).toBe("hi");
  });

  test("defaults a missing type to FRAME and ignores non-array fills/children", () => {
    const raw: RawFigmaNode = { fills: "not-an-array", children: undefined };
    const out = serializeNode(raw);
    expect(out.type).toBe("FRAME");
    expect(out.fills).toBeUndefined();
    expect(out.children).toBeUndefined();
  });
});
