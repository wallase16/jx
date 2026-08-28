/**
 * TTS behind one interface (`scripts/videos/PLAN.md`, Phase 2).
 *
 * Two drivers ship. A hosted one, selected by whichever of `OPENAI_API_KEY` / `ELEVENLABS_API_KEY`
 * is set, and a **keyless stub** that emits correctly-timed silence estimated from the word count.
 * The stub is not a mock — it is the default, and it is what makes the whole pipeline runnable on a
 * machine with no key, no network and no account: a silent cut with correct pacing, which becomes
 * the real voiceover the moment a key is present and nothing else about the manifest changes.
 *
 * Audio is cached by `hash(driverId + voiceId + text)` under `.cache/`, so re-rendering after a
 * step change does not re-synthesize (and, for a hosted driver, does not re-bill) every cue's
 * narration — {@link cachingVoice}. The driver is part of the key: setting a key for the first time
 * is a cache MISS against the stub's prior silent entry, never a silent no-op.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface SpokenAudio {
  path: string;
  /** The driver's own estimate. `run.ts` re-measures with `ffprobe` — see {@link measureSeconds}. */
  seconds: number;
}

export interface Voice {
  /**
   * Which driver this is — folded into {@link cacheKey} so switching drivers can never reuse a cache
   * entry another driver wrote for the same text.
   */
  id: string;
  speak: (text: string, voiceId: string) => Promise<SpokenAudio>;
}

// ─── Measurement ────────────────────────────────────────────────────────────

/**
 * The true length of an audio file, via `ffprobe` — never assumed from the driver's estimate.
 * Narration-first pacing (ADR-0003) is only as honest as this number.
 */
export async function measureSeconds(path: string): Promise<number> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
    { stderr: "pipe", stdout: "pipe" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(
      `ffprobe failed on ${path} (${code}): ${await new Response(proc.stderr).text()}`,
    );
  }
  const out = (await new Response(proc.stdout).json()) as { format?: { duration?: string } };
  const seconds = Number(out.format?.duration);
  if (!Number.isFinite(seconds)) {
    throw new TypeError(`ffprobe returned no duration for ${path}`);
  }
  return seconds;
}

// ─── The stub: keyless, correctly-timed silence ──────────────────────────────

/** Average narration pace. Between a documentary's ~150 and an audiobook's ~160. */
const WORDS_PER_MINUTE = 155;
/** No cue is shorter than this, however few words it carries — a beat needs somewhere to land. */
const MIN_SECONDS = 1.5;

/** One definition of "a word", shared with `draft.ts`'s word-cap check — both read a cue's length. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** The stub's pacing estimate, exported so a manifest author can predict a cue's length offline. */
export function estimateSeconds(text: string): number {
  return Math.max(MIN_SECONDS, (wordCount(text) / WORDS_PER_MINUTE) * 60);
}

const SAMPLE_RATE = 44_100;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

/**
 * A minimal PCM WAV of `seconds` of silence — no ffmpeg dependency for the one format the stub
 * needs.
 */
export function silentWav(seconds: number): Buffer {
  const frames = Math.round(seconds * SAMPLE_RATE);
  const dataSize = frames * CHANNELS * (BITS_PER_SAMPLE / 8);
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // Fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28); // Byte rate
  buf.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32); // Block align
  buf.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  // The rest is already zero — digital silence.
  return buf;
}

/** The default driver: no key, no network, no account. Every cue paces correctly with no sound. */
export function createStubVoice(outDir: string): Voice {
  return {
    id: "stub",
    async speak(text) {
      const seconds = estimateSeconds(text);
      await mkdir(outDir, { recursive: true });
      const path = join(
        outDir,
        `stub-${createHash("sha256").update(text).digest("hex").slice(0, 16)}.wav`,
      );
      await writeFile(path, silentWav(seconds));
      return { path, seconds };
    },
  };
}

// ─── Hosted drivers ───────────────────────────────────────────────────────────

/** Abstract voice ids a manifest names, mapped to each hosted provider's own id. */
export const VOICE_MAP: Readonly<Record<string, { openai: string; elevenlabs: string }>> = {
  "narrator-a": { elevenlabs: "21m00Tcm4TlvDq8ikWAM", openai: "alloy" },
  "narrator-b": { elevenlabs: "AZnzlk1XvdvUeBnXmlld", openai: "onyx" },
};

function providerVoice(voiceId: string, provider: "elevenlabs" | "openai"): string {
  return VOICE_MAP[voiceId]?.[provider] ?? voiceId;
}

/**
 * `OPENAI_API_KEY` — `POST /v1/audio/speech`, requested as WAV so {@link measureSeconds} needs no
 * format sniffing.
 */
export function createOpenAiVoice(apiKey: string, outDir: string): Voice {
  return {
    id: "openai",
    async speak(text, voiceId) {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        body: JSON.stringify({
          input: text,
          model: "tts-1",
          response_format: "wav",
          voice: providerVoice(voiceId, "openai"),
        }),
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`OpenAI TTS failed (${res.status}): ${await res.text()}`);
      }
      await mkdir(outDir, { recursive: true });
      const path = join(
        outDir,
        `openai-${createHash("sha256")
          .update(text + voiceId)
          .digest("hex")
          .slice(0, 16)}.wav`,
      );
      await writeFile(path, Buffer.from(await res.arrayBuffer()));
      return { path, seconds: await measureSeconds(path) };
    },
  };
}

/** `ELEVENLABS_API_KEY` — `POST /v1/text-to-speech/{voiceId}`, mp3 by default. */
export function createElevenLabsVoice(apiKey: string, outDir: string): Voice {
  return {
    id: "elevenlabs",
    async speak(text, voiceId) {
      const provider = providerVoice(voiceId, "elevenlabs");
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${provider}`, {
        body: JSON.stringify({ model_id: "eleven_monolingual_v1", text }),
        headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`ElevenLabs TTS failed (${res.status}): ${await res.text()}`);
      }
      await mkdir(outDir, { recursive: true });
      const path = join(
        outDir,
        `elevenlabs-${createHash("sha256")
          .update(text + voiceId)
          .digest("hex")
          .slice(0, 16)}.mp3`,
      );
      await writeFile(path, Buffer.from(await res.arrayBuffer()));
      return { path, seconds: await measureSeconds(path) };
    },
  };
}

// ─── Selection and caching ────────────────────────────────────────────────────

/** Picks a hosted driver from the environment, or falls back to the stub. */
export function selectVoice(outDir: string, env: NodeJS.ProcessEnv = process.env): Voice {
  if (env.OPENAI_API_KEY) {
    return createOpenAiVoice(env.OPENAI_API_KEY, outDir);
  }
  if (env.ELEVENLABS_API_KEY) {
    return createElevenLabsVoice(env.ELEVENLABS_API_KEY, outDir);
  }
  return createStubVoice(outDir);
}

/**
 * `hash(driverId + voiceId + text)`.
 *
 * `driverId` is load-bearing, not decoration: without it, rendering once with no key (the stub
 * caches correctly-timed silence), then setting `OPENAI_API_KEY` and re-rendering the SAME
 * manifest, would find the stub's old cache entry still on disk and never call the real driver — a
 * "real" render that stays silently silent. Folding the driver in makes that a cache MISS instead,
 * the same way a `voiceId` change already does.
 */
export function cacheKey(text: string, voiceId: string, driverId: string): string {
  return createHash("sha256").update(`${driverId} ${voiceId} ${text}`).digest("hex");
}

/**
 * Wrap any {@link Voice} with a cache under `cacheDir`, keyed on `hash(driverId + voiceId + text)`
 * ({@link cacheKey}).
 *
 * A cue's narration is committed prose (R3), so the same manifest hits the same key every render —
 * a step change moves cues, not the text they carry, so unrelated cues stay cache-hot across the
 * edit that provoked the re-render.
 */
export function cachingVoice(voice: Voice, cacheDir: string): Voice {
  return {
    id: voice.id,
    async speak(text, voiceId) {
      const key = cacheKey(text, voiceId, voice.id);
      const metaPath = join(cacheDir, `${key}.json`);
      if (existsSync(metaPath)) {
        const meta = JSON.parse(await readFile(metaPath, "utf8")) as SpokenAudio;
        if (existsSync(meta.path)) {
          return meta;
        }
      }
      const result = await voice.speak(text, voiceId);
      await mkdir(cacheDir, { recursive: true });
      await writeFile(metaPath, JSON.stringify(result));
      return result;
    },
  };
}
