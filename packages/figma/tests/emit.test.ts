import { describe, test, expect } from "bun:test";
import { figmaToJx } from "../src/convert/figma-to-jx.ts";
import type { FigmaNode } from "../src/convert/figma-to-jx.ts";
import { emitProject } from "../src/emit/emit.ts";
import type { FileMap } from "../src/emit/emit.ts";
import pricingCard from "./fixtures/pricing-card.json" with { type: "json" };
import buttonVariants from "./fixtures/button-variants.json" with { type: "json" };

function parse(files: FileMap, path: string): Record<string, unknown> {
  const raw = files[path];
  expect(raw).toBeDefined();
  expect(typeof raw).toBe("string");
  return JSON.parse(raw as string) as Record<string, unknown>;
}

describe("emitProject", () => {
  test("produces a valid project.json and pages/index.json", () => {
    const result = figmaToJx(pricingCard as FigmaNode);
    const files = emitProject(result);

    const project = parse(files, "project.json");
    expect(project.name).toBe("Figma Import");
    expect((project.defaults as Record<string, unknown>).lang).toBe("en");

    const page = parse(files, "pages/index.json");
    expect(page.tagName).toBe("div");
  });

  test("respects custom projectName and pageName", () => {
    const result = figmaToJx(pricingCard as FigmaNode);
    const files = emitProject(result, {
      projectName: "My Site",
      pageName: "home",
    });

    const project = parse(files, "project.json");
    expect(project.name).toBe("My Site");
    expect(files["pages/home.json"]).toBeDefined();
    expect(files["pages/index.json"]).toBeUndefined();
  });

  test("emits design tokens into project.json style", () => {
    const node: FigmaNode = {
      type: "FRAME",
      layoutMode: "VERTICAL",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      boundVariables: { fills: { type: "COLOR", id: "var-1" } },
      resolvedVariables: { fills: { id: "var-1", name: "brand/primary" } },
    };
    const result = figmaToJx(node);
    expect(result.tokens).toBeDefined();

    const files = emitProject(result);
    const project = parse(files, "project.json");
    const style = project.style as Record<string, string>;
    expect(style["--brand-primary"]).toBe("inherit");
  });

  test("includes image assets in public/images/ when provided", () => {
    const node: FigmaNode = {
      type: "RECTANGLE",
      width: 100,
      height: 100,
      fills: [{ type: "IMAGE", imageRef: "abc123" }],
    };
    const result = figmaToJx(node);
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const files = emitProject(result, {
      images: new Map([["abc123", imageBytes]]),
    });

    expect(files["public/images/abc123.png"]).toBeInstanceOf(Uint8Array);
    expect(files["public/images/abc123.png"]).toEqual(imageBytes);
  });

  test("rewrites image placeholder paths when images are provided", () => {
    const node: FigmaNode = {
      type: "RECTANGLE",
      width: 200,
      height: 150,
      fills: [{ type: "IMAGE", imageRef: "img1" }],
    };
    const result = figmaToJx(node);
    const files = emitProject(result, {
      images: new Map([["img1", new Uint8Array([1, 2, 3])]]),
    });

    const page = parse(files, "pages/index.json");
    const attrs = (page as Record<string, Record<string, Record<string, string>>>).attributes;
    expect(attrs.src).toBe("/images/img1.png");
  });

  test("rewrites background-image url() paths for frame image fills", () => {
    const node: FigmaNode = {
      type: "FRAME",
      layoutMode: "VERTICAL",
      width: 300,
      height: 200,
      fills: [{ type: "IMAGE", imageRef: "bg1" }],
    };
    const result = figmaToJx(node);
    const files = emitProject(result, {
      images: new Map([["bg1", new Uint8Array([4, 5, 6])]]),
    });

    const page = parse(files, "pages/index.json");
    const { style } = page as Record<string, Record<string, string>>;
    expect(style.backgroundImage).toBe("url(/images/bg1.png)");
  });

  test("leaves image placeholder paths unchanged when no images provided", () => {
    const node: FigmaNode = {
      type: "RECTANGLE",
      width: 100,
      height: 100,
      fills: [{ type: "IMAGE", imageRef: "nodata" }],
    };
    const result = figmaToJx(node);
    const files = emitProject(result);

    const page = parse(files, "pages/index.json");
    const attrs = (page as Record<string, Record<string, Record<string, string>>>).attributes;
    expect(attrs.src).toBe("images/nodata.png");
  });

  test("emits no style key when no tokens exist", () => {
    const result = figmaToJx({ type: "TEXT", characters: "hello" });
    const files = emitProject(result);
    const project = parse(files, "project.json");
    expect(project.style).toBeUndefined();
  });
});

describe("emitProject — components", () => {
  test("emits component files under components/", () => {
    const result = figmaToJx(buttonVariants as FigmaNode);
    const files = emitProject(result);
    expect(files["components/Button.json"]).toBeDefined();
    const comp = JSON.parse(files["components/Button.json"] as string) as Record<string, unknown>;
    expect(comp.tagName).toBe("div");
    expect(comp.state).toBeDefined();
  });

  test("registers components in project.json", () => {
    const result = figmaToJx(buttonVariants as FigmaNode);
    const files = emitProject(result);
    const project = parse(files, "project.json");
    const components = project.components as Record<string, { src: string }>;
    expect(components.Button).toBeDefined();
    expect(components.Button.src).toBe("./components/Button.json");
  });

  test("replaces inline instances with $ref in page", () => {
    const result = figmaToJx(buttonVariants as FigmaNode);
    const files = emitProject(result);
    const page = parse(files, "pages/index.json");
    const children = page.children as Record<string, unknown>[];
    expect(children[0].$ref).toBe("./components/Button.json");
    expect(children[0].$props).toBeDefined();
  });

  test("strips variant state from emitted page root", () => {
    const result = figmaToJx(buttonVariants as FigmaNode);
    const files = emitProject(result);
    const page = parse(files, "pages/index.json");
    expect(page.state).toBeUndefined();
  });

  test("passes component props through $ref", () => {
    const result = figmaToJx(buttonVariants as FigmaNode);
    const files = emitProject(result);
    const page = parse(files, "pages/index.json");
    const children = page.children as Record<string, unknown>[];
    const props1 = children[0].$props as Record<string, unknown>;
    const props2 = children[1].$props as Record<string, unknown>;
    expect(props1.label).toBe("Get Started");
    expect(props2.label).toBe("Learn More");
  });
});
