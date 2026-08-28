/**
 * Command-line surface of the video runner — its own module for the reason `screenshots/lib/
 * args.ts` is: `run.ts` renders the moment it is imported, and flags are the one part of it
 * testable without a browser or ffmpeg.
 */

import { resolve } from "node:path";

export interface RunOptions {
  manifestPath: string;
  /** Walkthrough names to render; empty means all of them. */
  only: Set<string>;
}

const FLAGS = "--only, --manifest";

export function parseArgs(argv: string[], defaultManifest: string): RunOptions {
  const only = new Set<string>();
  let manifestPath = defaultManifest;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--only") {
      i += 1;
      const value = argv[i];
      if (!value) {
        throw new Error("--only requires a walkthrough name");
      }
      for (const name of value.split(",")) {
        only.add(name.trim());
      }
    } else if (arg === "--manifest") {
      i += 1;
      const value = argv[i];
      if (!value) {
        throw new Error("--manifest requires a path");
      }
      manifestPath = resolve(process.cwd(), value);
    } else {
      throw new Error(`unknown argument "${arg}" (expected ${FLAGS})`);
    }
  }
  return { manifestPath, only };
}
