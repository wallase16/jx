import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cacheKey,
  cachingVoice,
  createStubVoice,
  estimateSeconds,
  measureSeconds,
  selectVoice,
  silentWav,
} from "./voice";
import type { Voice } from "./voice";

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "jx-videos-voice-"));
}

describe("estimateSeconds", () => {
  test("scales with word count", () => {
    const short = estimateSeconds("Every Jx project starts with a collection.");
    const long = estimateSeconds(
      "Every Jx project starts with a collection — a shape your content has to fit, " +
        "and every document in it inherits the fields you declare.",
    );
    expect(long).toBeGreaterThan(short);
  });

  test("floors at MIN_SECONDS for a one-word cue", () => {
    expect(estimateSeconds("Continue.")).toBe(1.5);
  });
});

describe("silentWav", () => {
  test("is a valid RIFF/WAVE header sized for the requested duration", () => {
    const buf = silentWav(1);
    expect(buf.toString("ascii", 0, 4)).toBe("RIFF");
    expect(buf.toString("ascii", 8, 12)).toBe("WAVE");
    expect(buf.toString("ascii", 36, 40)).toBe("data");
    // 44.1kHz * 1 channel * 2 bytes/sample * 1 second, plus the 44-byte header.
    expect(buf.length).toBe(44 + 44_100 * 2);
  });

  test("the data is actually silent", () => {
    const buf = silentWav(0.01);
    expect(buf.subarray(44).every((byte) => byte === 0)).toBe(true);
  });
});

describe("createStubVoice + measureSeconds", () => {
  test("emits a file whose ffprobe duration matches the estimate", async () => {
    const dir = await tmp();
    try {
      const voice = createStubVoice(dir);
      const { path, seconds } = await voice.speak(
        "Add a field, and every document gains it.",
        "narrator-a",
      );
      const measured = await measureSeconds(path);
      expect(measured).toBeCloseTo(seconds, 1);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe("cacheKey", () => {
  test("differs by voice as well as by text", () => {
    expect(cacheKey("hello", "narrator-a", "stub")).not.toBe(
      cacheKey("hello", "narrator-b", "stub"),
    );
    expect(cacheKey("hello", "narrator-a", "stub")).not.toBe(
      cacheKey("goodbye", "narrator-a", "stub"),
    );
  });

  test("is stable across calls", () => {
    expect(cacheKey("hello", "narrator-a", "stub")).toBe(cacheKey("hello", "narrator-a", "stub"));
  });
});

describe("cachingVoice", () => {
  test("does not re-invoke the wrapped driver for a repeated (text, voiceId)", async () => {
    const dir = await tmp();
    try {
      let calls = 0;
      const fake: Voice = {
        id: "stub",
        speak: async () => {
          calls += 1;
          return { path: join(dir, `${calls}.wav`), seconds: 3 };
        },
      };
      const cached = cachingVoice(fake, dir);
      // The path the fake driver names has to exist for the cache hit to trust it.
      await Bun.write(join(dir, "1.wav"), silentWav(3));
      await cached.speak("Add a field.", "narrator-a");
      const second = await cached.speak("Add a field.", "narrator-a");
      expect(calls).toBe(1);
      expect(second.seconds).toBe(3);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("re-invokes when the cached audio file has gone missing", async () => {
    const dir = await tmp();
    try {
      let calls = 0;
      const fake: Voice = {
        id: "stub",
        speak: async () => {
          calls += 1;
          const path = join(dir, `${calls}.wav`);
          await Bun.write(path, silentWav(1));
          return { path, seconds: 1 };
        },
      };
      const cached = cachingVoice(fake, dir);
      const first = await cached.speak("x", "narrator-a");
      await rm(first.path, { force: true });
      await cached.speak("x", "narrator-a");
      expect(calls).toBe(2);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("a different voiceId for the same text misses the cache", async () => {
    const dir = await tmp();
    try {
      let calls = 0;
      const fake: Voice = {
        id: "stub",
        speak: async () => {
          calls += 1;
          const path = join(dir, `${calls}.wav`);
          await Bun.write(path, silentWav(1));
          return { path, seconds: 1 };
        },
      };
      const cached = cachingVoice(fake, dir);
      await cached.speak("x", "narrator-a");
      await cached.speak("x", "narrator-b");
      expect(calls).toBe(2);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("a different DRIVER for the same text and voiceId misses the cache — never a silently silent 'real' render", async () => {
    const dir = await tmp();
    try {
      const stubCalls: string[] = [];
      const stub: Voice = {
        id: "stub",
        speak: async (text) => {
          stubCalls.push(text);
          const path = join(dir, "stub.wav");
          await Bun.write(path, silentWav(1));
          return { path, seconds: 1 };
        },
      };
      const hostedCalls: string[] = [];
      const hosted: Voice = {
        id: "openai",
        speak: async (text) => {
          hostedCalls.push(text);
          const path = join(dir, "hosted.wav");
          await Bun.write(path, silentWav(1));
          return { path, seconds: 1 };
        },
      };
      // Render once with the stub (no key set), then "set a key" and re-render the same manifest —
      // The hosted driver must actually be invoked, not answered out of the stub's cache entry.
      await cachingVoice(stub, dir).speak("Add a field.", "narrator-a");
      await cachingVoice(hosted, dir).speak("Add a field.", "narrator-a");
      expect(stubCalls).toEqual(["Add a field."]);
      expect(hostedCalls).toEqual(["Add a field."]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("the cache metadata round-trips through JSON", async () => {
    const dir = await tmp();
    try {
      const fake: Voice = {
        id: "stub",
        speak: async () => {
          const path = join(dir, "a.wav");
          await Bun.write(path, silentWav(2));
          return { path, seconds: 2 };
        },
      };
      await cachingVoice(fake, dir).speak("x", "narrator-a");
      const metaPath = join(dir, `${cacheKey("x", "narrator-a", "stub")}.json`);
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as { seconds: number };
      expect(meta.seconds).toBe(2);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

describe("selectVoice", () => {
  test("falls back to the stub with no key in the environment", async () => {
    const dir = await tmp();
    try {
      const voice = selectVoice(dir, {});
      const { path } = await voice.speak("Continue.", "narrator-a");
      expect(path).toContain("stub-");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  test("prefers OpenAI over ElevenLabs when both keys are present", async () => {
    const dir = await tmp();
    const originalFetch = globalThis.fetch;
    let calledUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calledUrl = String(input);
      return new Response(silentWav(0.1), { status: 200 });
    }) as typeof fetch;
    try {
      await selectVoice(dir, { ELEVENLABS_API_KEY: "e", OPENAI_API_KEY: "o" }).speak(
        "x",
        "narrator-a",
      );
    } finally {
      globalThis.fetch = originalFetch;
      await rm(dir, { force: true, recursive: true });
    }
    expect(calledUrl).toContain("api.openai.com");
  });
});
