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

  test("serializes Phase 1 fields: strokes, effects, sizing, constraints", () => {
    const raw: RawFigmaNode = {
      type: "FRAME",
      layoutWrap: "WRAP",
      counterAxisSpacing: 16,
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
      minWidth: 200,
      maxWidth: 800,
      minHeight: 100,
      maxHeight: 600,
      rectangleCornerRadii: [8, 8, 0, 0],
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      strokeWeight: 2,
      strokeAlign: "INSIDE",
      dashPattern: [4, 4],
      clipsContent: true,
      x: 10,
      y: 20,
      rotation: 45,
      effects: [{ type: "DROP_SHADOW", visible: true, radius: 4 }],
    };
    const out = serializeNode(raw);
    expect(out.layoutWrap).toBe("WRAP");
    expect(out.counterAxisSpacing).toBe(16);
    expect(out.layoutSizingHorizontal).toBe("FILL");
    expect(out.layoutSizingVertical).toBe("HUG");
    expect(out.minWidth).toBe(200);
    expect(out.maxWidth).toBe(800);
    expect(out.minHeight).toBe(100);
    expect(out.maxHeight).toBe(600);
    expect(out.rectangleCornerRadii).toEqual([8, 8, 0, 0]);
    expect(out.strokes).toHaveLength(1);
    expect(out.strokeWeight).toBe(2);
    expect(out.strokeAlign).toBe("INSIDE");
    expect(out.dashPattern).toEqual([4, 4]);
    expect(out.clipsContent).toBe(true);
    expect(out.x).toBe(10);
    expect(out.y).toBe(20);
    expect(out.rotation).toBe(45);
    expect(out.effects).toHaveLength(1);
  });

  test("serializes Phase 1 text fields: lineHeight, letterSpacing, textDecoration, textCase", () => {
    const raw: RawFigmaNode = {
      type: "TEXT",
      characters: "Hello",
      lineHeight: { value: 24, unit: "PIXELS" },
      letterSpacing: { value: 5, unit: "PERCENT" },
      textDecoration: "UNDERLINE",
      textCase: "UPPER",
      textAlignVertical: "CENTER",
    };
    const out = serializeNode(raw);
    expect(out.lineHeight).toEqual({ value: 24, unit: "PIXELS" });
    expect(out.letterSpacing).toEqual({ value: 5, unit: "PERCENT" });
    expect(out.textDecoration).toBe("UNDERLINE");
    expect(out.textCase).toBe("UPPER");
    expect(out.textAlignVertical).toBe("CENTER");
  });

  test("drops symbol values for Phase 1 mixed fields", () => {
    const mixed = Symbol("figma.mixed");
    const raw: RawFigmaNode = {
      type: "FRAME",
      minWidth: mixed,
      maxWidth: mixed,
      rotation: mixed,
      strokeWeight: mixed,
      rectangleCornerRadii: mixed as unknown as [number, number, number, number] | symbol,
    };
    const out = serializeNode(raw);
    expect(out.minWidth).toBeUndefined();
    expect(out.maxWidth).toBeUndefined();
    expect(out.rotation).toBeUndefined();
    expect(out.strokeWeight).toBeUndefined();
    expect(out.rectangleCornerRadii).toBeUndefined();
  });

  test("drops symbol values for text fields", () => {
    const mixed = Symbol("figma.mixed");
    const raw: RawFigmaNode = {
      type: "TEXT",
      lineHeight: mixed as unknown as { value?: number; unit?: string } | symbol,
      letterSpacing: mixed as unknown as { value?: number; unit?: string } | symbol,
      textDecoration: mixed,
      textCase: mixed,
    };
    const out = serializeNode(raw);
    expect(out.lineHeight).toBeUndefined();
    expect(out.letterSpacing).toBeUndefined();
    expect(out.textDecoration).toBeUndefined();
    expect(out.textCase).toBeUndefined();
  });

  test("serializes boundVariables and resolvedVariables", () => {
    const raw: RawFigmaNode = {
      type: "FRAME",
      boundVariables: { fills: { type: "VARIABLE_ALIAS", id: "var:1" } },
      resolvedVariables: { fills: { id: "var:1", name: "brand/primary" } },
    };
    const out = serializeNode(raw);
    expect(out.boundVariables?.fills).toEqual({ type: "VARIABLE_ALIAS", id: "var:1" });
    expect(out.resolvedVariables?.fills).toEqual({ id: "var:1", name: "brand/primary" });
  });

  test("serializes constraints", () => {
    const raw: RawFigmaNode = {
      type: "FRAME",
      constraints: { horizontal: { type: "STRETCH" }, vertical: { type: "MIN" } },
    };
    const out = serializeNode(raw);
    expect(out.constraints?.horizontal?.type).toBe("STRETCH");
    expect(out.constraints?.vertical?.type).toBe("MIN");
  });
});
