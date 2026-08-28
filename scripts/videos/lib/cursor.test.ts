import { describe, expect, test } from "bun:test";
import { cursorExpr } from "./cursor";
import type { PointerEvent } from "./cursor";

/**
 * A tiny evaluator for the subset of ffmpeg eval syntax {@link cursorExpr} emits: `if`, `lt`,
 * numeric literals, `+ - * /` and parens. Good enough to check the generated expression actually
 * computes what the docstring claims, at a handful of sample `t` values — without shelling out to
 * ffmpeg for a pure-function test.
 */
function evalExpr(expr: string, t: number): number {
  let i = 0;
  const skip = () => {
    while (expr[i] === " ") {
      i += 1;
    }
  };
  function parsePrimary(): number {
    skip();
    if (expr.startsWith("if(", i)) {
      i += 3;
      const cond = parseComparison();
      expect(expr[i]).toBe(",");
      i += 1;
      const whenTrue = parseExpr();
      expect(expr[i]).toBe(",");
      i += 1;
      const whenFalse = parseExpr();
      expect(expr[i]).toBe(")");
      i += 1;
      return cond ? whenTrue : whenFalse;
    }
    if (expr.startsWith("lt(", i)) {
      throw new Error("lt() only valid as a condition");
    }
    if (expr[i] === "t" && !/[a-z]/.test(expr[i + 1] ?? "")) {
      i += 1;
      return t;
    }
    if (expr[i] === "(") {
      i += 1;
      const value = parseExpr();
      expect(expr[i]).toBe(")");
      i += 1;
      return value;
    }
    const start = i;
    while (/[\d.]/.test(expr[i] ?? "")) {
      i += 1;
    }
    return Number(expr.slice(start, i));
  }
  function parseTerm(): number {
    let value = parsePrimary();
    for (;;) {
      skip();
      if (expr[i] === "*") {
        i += 1;
        value *= parsePrimary();
      } else if (expr[i] === "/") {
        i += 1;
        value /= parsePrimary();
      } else {
        return value;
      }
    }
  }
  function parseExpr(): number {
    let value = parseTerm();
    for (;;) {
      skip();
      if (expr[i] === "+") {
        i += 1;
        value += parseTerm();
      } else if (expr[i] === "-") {
        i += 1;
        value -= parseTerm();
      } else {
        return value;
      }
    }
  }
  function parseComparison(): boolean {
    expect(expr.startsWith("lt(", i)).toBe(true);
    i += 3;
    const a = parseExpr();
    expect(expr[i]).toBe(",");
    i += 1;
    const b = parseExpr();
    expect(expr[i]).toBe(")");
    i += 1;
    return a < b;
  }
  const value = parseExpr();
  return value;
}

describe("cursorExpr", () => {
  test("with no points, holds off-canvas", () => {
    const { x, y } = cursorExpr([]);
    expect(x).toBe("-100");
    expect(y).toBe("-100");
  });

  test("with one point, holds it everywhere", () => {
    const points: PointerEvent[] = [{ t: 2, x: 50, y: 60 }];
    const { x, y } = cursorExpr(points);
    for (const t of [0, 2, 10]) {
      expect(evalExpr(x, t)).toBeCloseTo(50, 2);
      expect(evalExpr(y, t)).toBeCloseTo(60, 2);
    }
  });

  test("holds the first point's value before it, and interpolates after", () => {
    const points: PointerEvent[] = [
      { t: 1, x: 0, y: 0 },
      { t: 2, x: 100, y: 0 },
    ];
    const { x } = cursorExpr(points);
    expect(evalExpr(x, 0)).toBeCloseTo(0, 2);
    expect(evalExpr(x, 1)).toBeCloseTo(0, 2);
    expect(evalExpr(x, 1.5)).toBeCloseTo(50, 2);
    expect(evalExpr(x, 2)).toBeCloseTo(100, 2);
  });

  test("holds the last point's value after it", () => {
    const points: PointerEvent[] = [
      { t: 1, x: 0, y: 0 },
      { t: 2, x: 100, y: 0 },
    ];
    const { x } = cursorExpr(points);
    expect(evalExpr(x, 5)).toBeCloseTo(100, 2);
  });

  test("interpolates linearly across three logged points, each segment independently", () => {
    const points: PointerEvent[] = [
      { t: 0, x: 0, y: 0 },
      { t: 1, x: 100, y: 200 },
      { t: 3, x: 300, y: 0 },
    ];
    const { x, y } = cursorExpr(points);
    // First segment: 0 -> 100 over [0,1].
    expect(evalExpr(x, 0.5)).toBeCloseTo(50, 2);
    // Second segment: 100 -> 300 over [1,3], y: 200 -> 0.
    expect(evalExpr(x, 2)).toBeCloseTo(200, 2);
    expect(evalExpr(y, 2)).toBeCloseTo(100, 2);
    // Exactly on a logged point.
    expect(evalExpr(x, 1)).toBeCloseTo(100, 2);
    expect(evalExpr(y, 1)).toBeCloseTo(200, 2);
  });

  test("two points at the same instant do not divide by zero", () => {
    const points: PointerEvent[] = [
      { t: 1, x: 10, y: 10 },
      { t: 1, x: 20, y: 20 },
    ];
    const { x } = cursorExpr(points);
    expect(Number.isFinite(evalExpr(x, 1))).toBe(true);
  });
});
