/**
 * Isolated from validate.test.ts (bun test --isolate gives each test file a fresh module registry)
 * so mocking ajv's loader here can't leak into the other file's real-ajv assertions.
 */
import { describe, expect, mock, test } from "bun:test";

describe("validate — ajv unavailable", () => {
  test("degrades to no errors when ajv fails to load or compile", async () => {
    void mock.module("ajv/dist/2020.js", () => {
      throw new Error("ajv unavailable in this environment");
    });
    const { validateDoc } = await import("../src/validate");
    const errs = await validateDoc({ tagName: "div" });
    expect(errs).toEqual([]);
  });
});
