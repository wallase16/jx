import { describe, test, expect } from "bun:test";
import { figmaToJx, figmaColorToCss } from "../src/convert/figma-to-jx.ts";
import type { FigmaNode } from "../src/convert/figma-to-jx.ts";
import pricingCard from "./fixtures/pricing-card.json" with { type: "json" };
import heroSection from "./fixtures/hero-section.json" with { type: "json" };
import cardGrid from "./fixtures/card-grid.json" with { type: "json" };
import navBar from "./fixtures/nav-bar.json" with { type: "json" };
import absoluteLayout from "./fixtures/absolute-layout.json" with { type: "json" };

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

  test("non-solid and hidden fills are ignored when no gradient stops", () => {
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

describe("figmaToJx — gradient fills", () => {
  test("linear gradient with stops produces CSS gradient", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    expect(document.style?.background).toContain("linear-gradient(");
    expect(document.style?.background).toContain("rgb(13, 13, 38) 0%");
    expect(document.style?.background).toContain("rgb(38, 26, 89) 100%");
  });

  test("radial gradient produces radial-gradient", () => {
    const { document } = figmaToJx({
      type: "FRAME",
      fills: [
        {
          type: "GRADIENT_RADIAL",
          gradientStops: [
            { position: 0, color: { r: 1, g: 1, b: 1 } },
            { position: 1, color: { r: 0, g: 0, b: 0 } },
          ],
        },
      ],
    });
    expect(document.style?.background).toBe(
      "radial-gradient(circle, rgb(255, 255, 255) 0%, rgb(0, 0, 0) 100%)",
    );
  });

  test("multiple fills are composited", () => {
    const { document } = figmaToJx(navBar as FigmaNode);
    expect(document.style?.background).toContain("rgb(255, 255, 255)");
    expect(document.style?.background).toContain("rgba(0, 0, 0, 0.02)");
  });
});

describe("figmaToJx — strokes", () => {
  test("INSIDE stroke maps to inset boxShadow", () => {
    const { document } = figmaToJx(navBar as FigmaNode);
    expect(document.style?.boxShadow).toContain("inset 0 0 0 1px");
  });

  test("regular stroke maps to border", () => {
    const { document } = figmaToJx({
      type: "FRAME",
      strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      strokeWeight: 2,
    });
    expect(document.style?.border).toBe("2px solid rgb(255, 0, 0)");
  });

  test("dashed stroke uses dashed border style", () => {
    const { document } = figmaToJx({
      type: "FRAME",
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      strokeWeight: 1,
      dashPattern: [4, 4],
    });
    expect(document.style?.border).toBe("1px dashed rgb(0, 0, 0)");
  });
});

describe("figmaToJx — effects", () => {
  test("drop shadow maps to boxShadow", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    const ctaRow = (document.children as Record<string, unknown>[]).at(-1) as {
      children?: Record<string, unknown>[];
    };
    const primaryCta = ctaRow.children?.[0] as { style?: Record<string, string> };
    expect(primaryCta.style?.boxShadow).toContain("0px 4px 20px 0px");
  });

  test("inner shadow maps to inset boxShadow", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    expect(document.style?.boxShadow).toContain("inset");
  });

  test("layer blur maps to filter: blur()", () => {
    const { document } = figmaToJx({
      type: "FRAME",
      effects: [{ type: "LAYER_BLUR", visible: true, radius: 8 }],
    });
    expect(document.style?.filter).toBe("blur(8px)");
  });

  test("background blur maps to backdropFilter", () => {
    const { document } = figmaToJx(navBar as FigmaNode);
    expect(document.style?.backdropFilter).toBe("blur(12px)");
  });

  test("invisible effects are skipped", () => {
    const { document } = figmaToJx({
      type: "FRAME",
      effects: [{ type: "LAYER_BLUR", visible: false, radius: 8 }],
    });
    expect(document.style?.filter).toBeUndefined();
  });
});

describe("figmaToJx — image fills", () => {
  test("IMAGE fill on RECTANGLE produces an img element", () => {
    const { document } = figmaToJx(cardGrid as FigmaNode);
    const card1 = (document.children as Record<string, unknown>[])[0] as {
      children?: Record<string, unknown>[];
    };
    const img = card1.children?.[0] as {
      tagName?: string;
      attributes?: Record<string, string>;
      style?: Record<string, string>;
    };
    expect(img.tagName).toBe("img");
    expect(img.attributes?.src).toBe("images/abc123.png");
    expect(img.style?.objectFit).toBe("cover");
  });

  test("IMAGE fill with FIT scaleMode uses contain", () => {
    const { document } = figmaToJx(cardGrid as FigmaNode);
    const card2 = (document.children as Record<string, unknown>[])[1] as {
      children?: Record<string, unknown>[];
    };
    const img = card2.children?.[0] as { style?: Record<string, string> };
    expect(img.style?.objectFit).toBe("contain");
  });

  test("IMAGE fill on FRAME becomes background-image", () => {
    const { document } = figmaToJx({
      type: "FRAME",
      width: 200,
      height: 200,
      fills: [{ type: "IMAGE", imageRef: "hero-bg", scaleMode: "FILL" }],
    });
    expect(document.style?.backgroundImage).toBe("url(images/hero-bg.png)");
    expect(document.style?.backgroundSize).toBe("cover");
  });

  test("ELLIPSE with image fill produces img with border-radius", () => {
    const { document } = figmaToJx(absoluteLayout as FigmaNode);
    const avatar = (document.children as Record<string, unknown>[])[3] as {
      tagName?: string;
      style?: Record<string, string>;
    };
    expect(avatar.tagName).toBe("img");
    expect(avatar.style?.borderRadius).toBe("50%");
  });
});

describe("figmaToJx — geometry & sizing", () => {
  test("FILL sizing maps to width: 100%", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    expect(document.style?.width).toBe("100%");
  });

  test("HUG sizing maps to fit-content", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    expect(document.style?.height).toBe("fit-content");
  });

  test("FIXED sizing with width maps to px", () => {
    const { document } = figmaToJx(cardGrid as FigmaNode);
    const card = (document.children as Record<string, unknown>[])[0] as {
      style?: Record<string, string>;
    };
    expect(card.style?.width).toBe("360px");
  });

  test("min/max constraints land in style", () => {
    const { document } = figmaToJx(navBar as FigmaNode);
    expect(document.style?.minHeight).toBe("48px");
    expect(document.style?.maxWidth).toBe("1440px");
  });

  test("clipsContent maps to overflow: hidden", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    expect(document.style?.overflow).toBe("hidden");
  });

  test("rectangleCornerRadii maps to 4-value borderRadius", () => {
    const { document } = figmaToJx({
      type: "FRAME",
      rectangleCornerRadii: [8, 8, 0, 0] as [number, number, number, number],
    });
    expect(document.style?.borderRadius).toBe("8px 8px 0px 0px");
  });

  test("layoutWrap WRAP maps to flexWrap", () => {
    const { document } = figmaToJx(cardGrid as FigmaNode);
    expect(document.style?.flexWrap).toBe("wrap");
  });

  test("counterAxisSpacing with wrap splits gap into rowGap/columnGap", () => {
    const { document } = figmaToJx(cardGrid as FigmaNode);
    expect(document.style?.rowGap).toBe("32px");
    expect(document.style?.columnGap).toBe("24px");
    expect(document.style?.gap).toBeUndefined();
  });
});

describe("figmaToJx — absolute positioning", () => {
  test("children in NONE-layout frames get absolute position", () => {
    const { document } = figmaToJx(absoluteLayout as FigmaNode);
    const badge = (document.children as Record<string, unknown>[])[0] as {
      style?: Record<string, string>;
    };
    expect(badge.style?.position).toBe("absolute");
    expect(badge.style?.left).toBe("16px");
    expect(badge.style?.top).toBe("16px");
  });

  test("NONE-layout parent gets position: relative", () => {
    const { document } = figmaToJx(absoluteLayout as FigmaNode);
    expect(document.style?.position).toBe("relative");
  });

  test("text in absolute parent gets position and coordinates", () => {
    const { document } = figmaToJx(absoluteLayout as FigmaNode);
    const text = (document.children as Record<string, unknown>[])[1] as {
      style?: Record<string, string>;
    };
    expect(text.style?.position).toBe("absolute");
    expect(text.style?.left).toBe("100px");
    expect(text.style?.top).toBe("130px");
  });

  test("rotation maps to transform: rotate()", () => {
    const { document } = figmaToJx(absoluteLayout as FigmaNode);
    const rotated = (document.children as Record<string, unknown>[])[2] as {
      style?: Record<string, string>;
    };
    expect(rotated.style?.transform).toBe("rotate(-45deg)");
  });
});

describe("figmaToJx — typography depth", () => {
  test("line-height in pixels", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    const headline = (document.children as Record<string, unknown>[])[1] as {
      style?: Record<string, string>;
    };
    expect(headline.style?.lineHeight).toBe("64px");
  });

  test("line-height in percent converts to unitless", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    const sub = (document.children as Record<string, unknown>[])[2] as {
      style?: Record<string, string>;
    };
    expect(sub.style?.lineHeight).toBe("1.5");
  });

  test("letter-spacing in percent converts to em", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    const badge = (document.children as Record<string, unknown>[])[0] as {
      children?: Record<string, unknown>[];
    };
    const badgeText = badge.children?.[0] as { style?: Record<string, string> };
    expect(badgeText.style?.letterSpacing).toBe("0.05em");
  });

  test("textCase UPPER maps to textTransform: uppercase", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    const badge = (document.children as Record<string, unknown>[])[0] as {
      children?: Record<string, unknown>[];
    };
    const badgeText = badge.children?.[0] as { style?: Record<string, string> };
    expect(badgeText.style?.textTransform).toBe("uppercase");
  });

  test("textDecoration UNDERLINE maps to textDecorationLine", () => {
    const { document } = figmaToJx(heroSection as FigmaNode);
    const ctaRow = (document.children as Record<string, unknown>[]).at(-1) as {
      children?: Record<string, unknown>[];
    };
    const secondaryCta = ctaRow.children?.[1] as { children?: Record<string, unknown>[] };
    const label = secondaryCta.children?.[0] as { style?: Record<string, string> };
    expect(label.style?.textDecorationLine).toBe("underline");
  });

  test("fontName.style derives fontWeight when fontWeight is absent", () => {
    const { document } = figmaToJx({
      type: "TEXT",
      characters: "Test",
      fontSize: 14,
      fontName: { family: "Inter", style: "SemiBold" },
    });
    expect(document.style?.fontWeight).toBe("600");
  });

  test("fontName.style with Italic suffix sets fontStyle", () => {
    const { document } = figmaToJx(absoluteLayout as FigmaNode);
    const text = (document.children as Record<string, unknown>[])[1] as {
      style?: Record<string, string>;
    };
    expect(text.style?.fontStyle).toBe("italic");
    expect(text.style?.fontWeight).toBe("700");
  });

  test("textCase LOWER maps to lowercase", () => {
    const { document } = figmaToJx({
      type: "TEXT",
      characters: "test",
      fontSize: 14,
      textCase: "LOWER",
    });
    expect(document.style?.textTransform).toBe("lowercase");
  });

  test("textCase TITLE maps to capitalize", () => {
    const { document } = figmaToJx({
      type: "TEXT",
      characters: "test",
      fontSize: 14,
      textCase: "TITLE",
    });
    expect(document.style?.textTransform).toBe("capitalize");
  });

  test("textDecoration STRIKETHROUGH maps to line-through", () => {
    const { document } = figmaToJx({
      type: "TEXT",
      characters: "old price",
      fontSize: 14,
      textDecoration: "STRIKETHROUGH",
    });
    expect(document.style?.textDecorationLine).toBe("line-through");
  });

  test("letter-spacing in pixels", () => {
    const { document } = figmaToJx({
      type: "TEXT",
      characters: "test",
      fontSize: 14,
      letterSpacing: { value: 2, unit: "PIXELS" },
    });
    expect(document.style?.letterSpacing).toBe("2px");
  });
});

describe("figmaToJx — design tokens", () => {
  test("bound variables produce var() references and populate tokens", () => {
    const { document, tokens } = figmaToJx({
      type: "FRAME",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }],
      boundVariables: { fills: { type: "VARIABLE_ALIAS", id: "var:1" } },
      resolvedVariables: { fills: { id: "var:1", name: "brand/primary" } },
    });
    expect(document.style?.background).toBe("var(--brand-primary)");
    expect(tokens).toEqual({ "--brand-primary": "" });
  });

  test("text color can bind to a variable", () => {
    const { document, tokens } = figmaToJx({
      type: "TEXT",
      characters: "Hello",
      fontSize: 14,
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      boundVariables: { fills: { type: "VARIABLE_ALIAS", id: "var:2" } },
      resolvedVariables: { fills: { id: "var:2", name: "text/default" } },
    });
    expect(document.style?.color).toBe("var(--text-default)");
    expect(tokens).toEqual({ "--text-default": "" });
  });

  test("tokens are not returned when no variables are bound", () => {
    const { tokens } = figmaToJx({ type: "FRAME" });
    expect(tokens).toBeUndefined();
  });
});

describe("figmaToJx — vectors", () => {
  test("VECTOR with svgContent wraps in a sized div", () => {
    const { document } = figmaToJx(navBar as FigmaNode);
    const logo = (document.children as Record<string, unknown>[])[0] as {
      tagName?: string;
      style?: Record<string, string>;
      children?: { tagName?: string; textContent?: string }[];
    };
    expect(logo.tagName).toBe("div");
    expect(logo.style?.width).toBe("32px");
    expect(logo.style?.height).toBe("32px");
    expect(logo.children?.[0]?.tagName).toBe("svg");
    expect(logo.children?.[0]?.textContent).toContain("path");
  });

  test("VECTOR without svgContent falls back to sized placeholder div", () => {
    const { document } = figmaToJx({
      type: "VECTOR",
      width: 24,
      height: 24,
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    });
    expect(document.tagName).toBe("div");
    expect(document.style?.width).toBe("24px");
    expect(document.style?.height).toBe("24px");
  });

  test("BOOLEAN_OPERATION with svgContent maps like VECTOR", () => {
    const { document } = figmaToJx({
      type: "BOOLEAN_OPERATION",
      width: 20,
      height: 20,
      svgContent: '<circle cx="10" cy="10" r="10"/>',
    });
    expect(document.children).toHaveLength(1);
    const [svg] = document.children as { tagName?: string }[];
    expect(svg.tagName).toBe("svg");
  });

  test("LINE and POLYGON types are handled as vectors", () => {
    for (const type of ["LINE", "POLYGON", "STAR"]) {
      const { document } = figmaToJx({ type, width: 16, height: 16 });
      expect(document.tagName).toBe("div");
      expect(document.style?.width).toBe("16px");
    }
  });
});

describe("figmaToJx — ELLIPSE", () => {
  test("ELLIPSE gets border-radius: 50%", () => {
    const { document } = figmaToJx({
      type: "ELLIPSE",
      width: 100,
      height: 100,
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    });
    expect(document.style?.borderRadius).toBe("50%");
  });
});
