/**
 * Index.js — Jx AI assistant core (`@jxsuite/assistant`)
 *
 * Re-exports the `AssistantHost` seam plus the Jx-coupled tools, system prompt, agent loop,
 * context manager, schema validation, and token-lint helpers. See specs/ai-assistant.md §11.
 *
 * @license MIT
 */

// Re-export from sub-modules so consumers can `import { ... } from "@jxsuite/assistant"`.
// Importing individual files instead enables tree-shaking.
export type {
  AssistantHost,
  AssistantHostDocument,
  ComponentEntry,
  RenderCheckResult,
} from "./host.js";

export { registerAiTools } from "./tools.js";

export { buildSystemPrompt } from "./system-prompt.js";

export { runAgentLoop } from "./agent-loop.js";

export { trimContext } from "./context-manager.js";

export { validateDoc } from "./validate.js";

export { flagHardcodedTokens, formatTokenHints } from "./token-lint.js";
