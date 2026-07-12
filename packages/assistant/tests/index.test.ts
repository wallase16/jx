/**
 * Tests for the @jxsuite/assistant barrel (src/index.ts) — asserts the public API surface is
 * re-exported.
 *
 * @module @jxsuite/assistant/tests
 */

import { describe, expect, it } from "bun:test";
import * as assistant from "../src/index.js";

describe("@jxsuite/assistant barrel", () => {
  it("re-exports the tools, system-prompt, agent-loop, context-manager, validate, and token-lint public API", () => {
    expect(typeof assistant.registerAiTools).toBe("function");
    expect(typeof assistant.buildSystemPrompt).toBe("function");
    expect(typeof assistant.runAgentLoop).toBe("function");
    expect(typeof assistant.trimContext).toBe("function");
    expect(typeof assistant.validateDoc).toBe("function");
    expect(typeof assistant.flagHardcodedTokens).toBe("function");
    expect(typeof assistant.formatTokenHints).toBe("function");
  });
});
