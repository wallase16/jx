import { describe, expect, test } from "bun:test";
import * as drive from "./drive";
import * as shot from "./shot";

/**
 * `shot.ts` re-exports the boot/drive/region/assert primitives that moved to `./drive`
 * (scripts/videos/PLAN.md, Phase 0) — `run.ts` and its own tests still address them as `./shot`.
 * Behaviour is covered where the functions are defined, in `drive.test.ts`; this just guards the
 * re-export surface from silently going stale as `drive.ts` grows.
 */
describe("shot.ts re-exports drive.ts's boot/drive/region/assert primitives", () => {
  test("every re-exported name is the same function/value drive.ts defines", () => {
    expect(shot.applyOpenState).toBe(drive.applyOpenState);
    expect(shot.armFreeze).toBe(drive.armFreeze);
    expect(shot.assertExpectations).toBe(drive.assertExpectations);
    expect(shot.assertNoUninvitedModal).toBe(drive.assertNoUninvitedModal);
    expect(shot.bootUrl).toBe(drive.bootUrl);
    expect(shot.DOCK_COMMAND).toBe(drive.DOCK_COMMAND);
    expect(shot.frameBlockers).toBe(drive.frameBlockers);
    expect(shot.matchState).toBe(drive.matchState);
    expect(shot.measureRegion).toBe(drive.measureRegion);
    expect(shot.OPEN_COMMANDS).toBe(drive.OPEN_COMMANDS);
    expect(shot.regionPoint).toBe(drive.regionPoint);
    expect(shot.resetPointerAndFocus).toBe(drive.resetPointerAndFocus);
    expect(shot.runStep).toBe(drive.runStep);
    expect(shot.trackRequests).toBe(drive.trackRequests);
  });
});
