/**
 * The cursor, composited at assemble time (`scripts/videos/PLAN.md` — "The cursor: composited at
 * assemble time"). Never drawn by `src/` (R2): the runner logs `(t, x, y)` per pointer move during
 * capture — `regionPoint()` in `drive.ts` already answers the exact top-document coordinate of
 * every gesture — and `assemble.ts` composites a sprite over it, interpolating between logged
 * points with an ffmpeg filter expression built here.
 */

/**
 * One logged pointer position, seconds since the walkthrough started (not the cue — see
 * `assemble.ts`).
 */
export interface PointerEvent {
  t: number;
  x: number;
  y: number;
}

/**
 * Linear interpolation between two points, as an ffmpeg eval expression over `t`.
 *
 * `(t-t0)/(t1-t0)` is the fraction of the way from `t0` to `t1`; `a1==a0` short-circuits to the
 * flat value rather than dividing by zero on a pointer log with two events at the same instant (a
 * click dispatched at the same moment a move landed).
 */
function lerpExpr(t0: number, t1: number, a0: number, a1: number): string {
  if (a0 === a1) {
    return a0.toFixed(2);
  }
  return `(${a0.toFixed(2)}+(${a1.toFixed(2)}-${a0.toFixed(2)})*(t-${t0.toFixed(3)})/(${t1.toFixed(3)}-${t0.toFixed(3)}))`;
}

/**
 * Build the `x(t)` / `y(t)` ffmpeg overlay expressions for a whole pointer log.
 *
 * Before the first point and after the last, the cursor holds — a walkthrough's cue steps are the
 * only source of movement, so there is nothing to interpolate toward outside their span. Between
 * consecutive points it moves linearly, matching the straight-line gesture `page.mouse.move` itself
 * performs.
 */
export function cursorExpr(points: readonly PointerEvent[]): { x: string; y: string } {
  if (points.length === 0) {
    // No gesture was logged — hold off-canvas rather than draw a cursor nobody moved.
    return { x: "-100", y: "-100" };
  }
  const build = (axis: "x" | "y"): string => {
    const last = points.at(-1)!;
    // Built back-to-front: each step's fallback (its ELSE) is the chain for every point after it,
    // So a later `if` only ever needs to ask "is t still inside MY segment" — the point after this
    // One is already correctly answered by the chain it wraps.
    let expr = last[axis].toFixed(2);
    for (let i = points.length - 2; i >= 0; i -= 1) {
      const a = points[i]!;
      const b = points[i + 1]!;
      expr = `if(lt(t,${b.t.toFixed(3)}),${lerpExpr(a.t, b.t, a[axis], b[axis])},${expr})`;
    }
    const first = points[0]!;
    return `if(lt(t,${first.t.toFixed(3)}),${first[axis].toFixed(2)},${expr})`;
  };
  return { x: build("x"), y: build("y") };
}
