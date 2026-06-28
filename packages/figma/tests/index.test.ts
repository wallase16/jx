import { describe, test, expect } from "bun:test";
import * as api from "../src/index.ts";

describe("public API surface", () => {
  test("exports the converter entry points", () => {
    expect(typeof api.figmaToJx).toBe("function");
    expect(typeof api.figmaColorToCss).toBe("function");
    expect(api.figmaToJx({ type: "TEXT", characters: "hi" }).document.tagName).toBe("p");
  });
});
