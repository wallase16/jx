/**
 * Render proof — the de-risk gate for the Figma plugin.
 *
 * The whole "it's alive inside Figma" hook rests on one assumption: a tree produced by figmaToJx
 * can be mounted by the real @jxsuite/runtime with no server, no build step, no DOM of its own
 * beyond a throwaway container — exactly the conditions inside the plugin's iframe.
 *
 * This test converts the fixture and drives it through the runtime's buildScope → renderNode
 * pipeline (the same path render-critic uses), then asserts real DOM came out with the expected
 * text and computed-ish styles. If this passes, the preview shell is just packaging.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, test, expect, beforeAll } from "bun:test";
import { buildScope, renderNode, setSkipServerFunctions } from "@jxsuite/runtime";
import { figmaToJx } from "../src/convert/figma-to-jx.ts";
import type { FigmaNode } from "../src/convert/figma-to-jx.ts";
import pricingCard from "./fixtures/pricing-card.json" with { type: "json" };

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
});
