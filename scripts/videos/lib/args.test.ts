import { describe, expect, test } from "bun:test";
import { parseArgs } from "./args";

describe("parseArgs", () => {
  test("defaults to the given manifest and every walkthrough", () => {
    const opts = parseArgs([], "/repo/scripts/videos/manifest.json");
    expect(opts.manifestPath).toBe("/repo/scripts/videos/manifest.json");
    expect(opts.only.size).toBe(0);
  });

  test("--only accepts a comma-separated list", () => {
    const opts = parseArgs(["--only", "first-collection, second"], "/m.json");
    expect([...opts.only]).toEqual(["first-collection", "second"]);
  });

  test("--only is repeatable", () => {
    const opts = parseArgs(["--only", "a", "--only", "b"], "/m.json");
    expect([...opts.only]).toEqual(["a", "b"]);
  });

  test("--manifest resolves against cwd", () => {
    const opts = parseArgs(["--manifest", "x.json"], "/default.json");
    expect(opts.manifestPath.endsWith("/x.json")).toBe(true);
  });

  test("--only with no value throws", () => {
    expect(() => parseArgs(["--only"], "/m.json")).toThrow(/requires a walkthrough name/);
  });

  test("--manifest with no value throws", () => {
    expect(() => parseArgs(["--manifest"], "/m.json")).toThrow(/requires a path/);
  });

  test("an unknown flag throws, naming what was expected", () => {
    expect(() => parseArgs(["--bogus"], "/m.json")).toThrow(/unknown argument "--bogus"/);
  });
});
