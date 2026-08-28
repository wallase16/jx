/**
 * The walkthrough contract — the shot contract's five verbs plus one (`scripts/videos/PLAN.md`).
 *
 * A walkthrough is a boot (`open`) and an ordered list of **cues**; a cue is one line of narration
 * (`say`) plus the steps performed while it is spoken. There is no per-cue `hold` and no per-step
 * `expect`: narration length sets the clock, and a walkthrough-level `expect` already fails the
 * render — each is a knob to add when the over-run report demands it, never before.
 *
 * `open`, `steps` (`cmd` | `seed` | `input`) and `expect` are unchanged from
 * `scripts/screenshots/lib/types.ts` — reused, not re-declared, so a region grammar change or a
 * removed verb has exactly one definition to update. This file adds only what the shot contract has
 * no use for: `cues[]` and the `docs:` source field, which is required here (never a tag — see
 * "Authoring" in the plan).
 */

import {
  checkRemovedKeys,
  CONTRACT_VERSION,
  resolveOpenState,
  validateExpectation,
  validateOpen,
  validateStep,
} from "../../screenshots/lib/types";
import type { Expectation, ResolvedOpen, ShotOpen, ShotStep } from "../../screenshots/lib/types";

export {
  CONTRACT_VERSION,
  DEFAULT_DEVICE_SCALE_FACTOR,
  DEFAULT_PROFILE,
  DEFAULT_VIEWPORT,
} from "../../screenshots/lib/types";
export type { Expectation, ResolvedOpen, ShotOpen, ShotStep } from "../../screenshots/lib/types";

/** One line of narration and the steps performed while it is spoken (`CONTEXT.md`). */
export interface Cue {
  say: string;
  steps?: ShotStep[];
}

export interface Walkthrough {
  name: string;
  /** Docs-page slugs this walkthrough compiles from. Required — this is the source, not a tag. */
  docs: string[];
  open?: ShotOpen;
  /**
   * Overrides `defaults.voice` for this walkthrough alone. Validated the same way defaults.voice
   * is.
   */
  voice?: string;
  cues: Cue[];
  expect?: Expectation[];
}

export interface VoiceDefaults {
  voice: string;
}

export interface WalkthroughsManifest {
  contract: number;
  outDir: string;
  defaults?: ShotOpen & Partial<VoiceDefaults> & { fps?: number };
  walkthroughs: Walkthrough[];
}

export interface ResolvedWalkthrough extends Omit<Walkthrough, "open"> {
  open: ResolvedOpen;
}

const DEFAULT_FPS = 30;
const DEFAULT_VOICE = "narrator-a";

function fail(message: string): never {
  throw new Error(`walkthroughs manifest: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(where: string, key: string, value: unknown): unknown[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    fail(`${where}: ${key} must be an array`);
  }
  return value;
}

export function validateWalkthroughsManifest(raw: unknown): WalkthroughsManifest {
  if (!isRecord(raw)) {
    fail("root must be an object");
  }
  if (raw.contract !== CONTRACT_VERSION) {
    fail(
      `declares contract ${JSON.stringify(raw.contract)}; this runner implements ${CONTRACT_VERSION}`,
    );
  }
  if (typeof raw.outDir !== "string" || !raw.outDir) {
    fail("outDir must be a non-empty string");
  }
  if (raw.defaults !== undefined) {
    if (!isRecord(raw.defaults)) {
      fail("defaults must be an object");
    }
    const { fps, voice, ...open } = raw.defaults;
    if (fps !== undefined && (typeof fps !== "number" || fps <= 0)) {
      fail("defaults.fps must be a positive number");
    }
    if (voice !== undefined && (typeof voice !== "string" || !voice)) {
      fail("defaults.voice must be a non-empty string");
    }
    validateOpen("manifest defaults", open);
  }
  if (!Array.isArray(raw.walkthroughs) || raw.walkthroughs.length === 0) {
    fail("walkthroughs must be a non-empty array");
  }

  const names = new Set<string>();
  for (const [index, walkthrough] of raw.walkthroughs.entries()) {
    if (!isRecord(walkthrough)) {
      fail(`walkthrough #${index + 1} must be an object`);
    }
    if (typeof walkthrough.name !== "string" || !walkthrough.name) {
      fail(`walkthrough #${index + 1} needs a name`);
    }
    const where = `walkthrough "${walkthrough.name}"`;
    if (names.has(walkthrough.name)) {
      fail(`duplicate walkthrough name "${walkthrough.name}"`);
    }
    names.add(walkthrough.name);
    checkRemovedKeys(where, walkthrough);
    if (walkthrough.open !== undefined) {
      validateOpen(where, walkthrough.open);
    }
    if (
      walkthrough.voice !== undefined &&
      (typeof walkthrough.voice !== "string" || !walkthrough.voice)
    ) {
      fail(`${where}: voice must be a non-empty string`);
    }
    if (!Array.isArray(walkthrough.docs) || walkthrough.docs.length === 0) {
      fail(`${where}: docs must be a non-empty array of docs-page slugs — it is the source`);
    }
    for (const slug of walkthrough.docs) {
      if (typeof slug !== "string" || !slug) {
        fail(`${where}: every docs entry must be a non-empty string`);
      }
    }
    if (!Array.isArray(walkthrough.cues) || walkthrough.cues.length === 0) {
      fail(`${where}: cues must be a non-empty array`);
    }
    for (const [cueIndex, cue] of walkthrough.cues.entries()) {
      const cueWhere = `${where} cue ${cueIndex + 1}`;
      if (!isRecord(cue)) {
        fail(`${cueWhere} must be an object`);
      }
      if (typeof cue.say !== "string" || !cue.say.trim()) {
        fail(`${cueWhere}: say must be a non-empty string`);
      }
      checkRemovedKeys(cueWhere, cue);
      for (const [stepIndex, step] of asArray(cueWhere, "steps", cue.steps).entries()) {
        validateStep(`${cueWhere} step ${stepIndex + 1}`, step);
      }
    }
    for (const entry of asArray(where, "expect", walkthrough.expect)) {
      validateExpectation(where, entry);
    }
  }
  return raw as unknown as WalkthroughsManifest;
}

/** `manifest.defaults.fps`, or {@link DEFAULT_FPS} — the output framerate `assemble.ts` encodes at. */
export function resolveFps(manifest: WalkthroughsManifest): number {
  return manifest.defaults?.fps ?? DEFAULT_FPS;
}

/** `walkthrough.voice`, else `manifest.defaults.voice`, else {@link DEFAULT_VOICE}. */
export function resolveVoice(manifest: WalkthroughsManifest, walkthrough: Walkthrough): string {
  return walkthrough.voice ?? manifest.defaults?.voice ?? DEFAULT_VOICE;
}

/** {@link resolveOpenState}, applied to one walkthrough against its manifest's defaults. */
export function resolveWalkthrough(
  manifest: WalkthroughsManifest,
  walkthrough: Walkthrough,
): ResolvedWalkthrough {
  return {
    ...walkthrough,
    open: resolveOpenState(manifest.defaults ?? {}, walkthrough.open ?? {}),
  };
}
