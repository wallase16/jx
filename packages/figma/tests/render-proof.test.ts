/**
 * Render proof — the de-risk gate for the Figma plugin.
 *
 * Converts fixtures and drives them through the runtime's buildScope → renderNode pipeline, then
 * asserts real DOM came out with the expected text and styles.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, test, expect, beforeAll } from "bun:test";
import { buildScope, renderNode, setSkipServerFunctions } from "@jxsuite/runtime";
import { figmaToJx } from "../src/convert/figma-to-jx.ts";
import type { FigmaNode } from "../src/convert/figma-to-jx.ts";
import pricingCard from "./fixtures/pricing-card.json" with { type: "json" };
import heroSection from "./fixtures/hero-section.json" with { type: "json" };
import navBar from "./fixtures/nav-bar.json" with { type: "json" };
import buttonVariants from "./fixtures/button-variants.json" with { type: "json" };

beforeAll(() => {
  try {
    GlobalRegistrator.register();
  } catch {}
});

describe("render proof", () => {
  test("the runtime mounts a figmaToJx tree into real DOM", async () => {
    setSkipServerFunctions(true);
    const { document: doc } = figmaToJx(pricingCard as FigmaNode);

    const state = await buildScope(doc, {});
    const container = document.createElement("div");
    container.append(renderNode(doc, state));

    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.tagName.toLowerCase()).toBe("div");

    // The converted text survives the round-trip into the DOM.
    expect(container.textContent).toContain("Pro");
    expect(container.textContent).toContain("$29/mo");
    expect(container.textContent).toContain("Get started");

    // The heading heuristic produced an <h1> for the 40px price.
    expect(container.querySelector("h1")?.textContent).toBe("$29/mo");

    // Flexbox style made it onto the root element's inline style.
    expect(root.style.display).toBe("flex");
    expect(root.style.flexDirection).toBe("column");
  });

  test("gradient background lands on the hero section root", async () => {
    setSkipServerFunctions(true);
    const { document: doc } = figmaToJx(heroSection as FigmaNode);

    const state = await buildScope(doc, {});
    const container = document.createElement("div");
    container.append(renderNode(doc, state));

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.background).toContain("linear-gradient(");
    expect(root.style.overflow).toBe("hidden");
  });

  test("typography styles survive round-trip into DOM", async () => {
    setSkipServerFunctions(true);
    const { document: doc } = figmaToJx(heroSection as FigmaNode);

    const state = await buildScope(doc, {});
    const container = document.createElement("div");
    container.append(renderNode(doc, state));

    const h1 = container.querySelector("h1") as HTMLElement;
    expect(h1).toBeTruthy();
    expect(h1.textContent).toBe("Design to code in seconds");
    expect(h1.style.lineHeight).toBe("64px");
    expect(h1.style.fontSize).toBe("56px");
  });

  test("stroke border and backdrop-filter land on nav bar", async () => {
    setSkipServerFunctions(true);
    const { document: doc } = figmaToJx(navBar as FigmaNode);

    const state = await buildScope(doc, {});
    const container = document.createElement("div");
    container.append(renderNode(doc, state));

    const root = container.firstElementChild as HTMLElement;
    expect(root.style.display).toBe("flex");
    expect(root.textContent).toContain("Features");
    expect(root.textContent).toContain("Sign in");
  });

  test("variant button renders and responds to mouseenter interaction", async () => {
    setSkipServerFunctions(true);
    const { document: doc } = figmaToJx(buttonVariants as FigmaNode);

    const state = await buildScope(doc, {});
    const container = document.createElement("div");
    container.append(renderNode(doc, state));

    const root = container.firstElementChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.display).toBe("flex");

    const btn = root.children[0] as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("Button");

    const initialBg = btn.style.background;
    expect(initialBg).toBeTruthy();

    btn.dispatchEvent(new Event("mouseenter"));

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    const hoverBg = btn.style.background;
    expect(hoverBg).not.toBe(initialBg);
  });
});
